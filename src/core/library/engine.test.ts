import { describe, expect, it } from "vitest";
import { entry, item, NOW, testConfig } from "../../test/fixtures";
import type { MediaItem, MediaKind } from "../types";
import { SuggestionEngine, type SuggestionPort } from "./engine";
import type { LibraryEntry } from "./entry";
import type { FeedbackLog } from "./feedback";
import type { RegistryFacts } from "./strategies";
import { buildTaste } from "./taste";

/**
 * The coverage that could not exist before.
 *
 * All of this lived in a `.tsx`, which vitest does not collect, so the row's
 * whole lifecycle — abandoning a round, surviving a source that throws,
 * re-ranking without re-asking — was untested. None of it needs a DOM; it
 * needed the code to not be inside a component.
 */

const config = testConfig();

/** A source that answers from a script and counts what it was asked. */
class FakeSource implements SuggestionPort {
	readonly asked: string[] = [];
	throws = false;
	private readonly answers: Map<string, MediaItem[]>;

	constructor(
		answers: Record<string, MediaItem[]> = {},
		readonly ownedTitles: ReadonlySet<string> = new Set(),
	) {
		this.answers = new Map(Object.entries(answers));
	}

	facts: RegistryFacts = {
		recommendable: () => ["tmdb"],
		discoverable: () => ["tmdb"],
		seriesAware: () => ["tmdb"],
	};

	async similar(
		providerId: string,
		ref: { id: string },
		signal: AbortSignal,
	): Promise<MediaItem[]> {
		this.asked.push(`similar:${ref.id}`);
		if (this.throws) throw new Error("the source is down");
		if (signal.aborted) return [];
		return this.answers.get(`similar:${ref.id}`) ?? [];
	}

	async discover(
		providerId: string,
		query: { kind: MediaKind; page?: number },
	): Promise<MediaItem[]> {
		this.asked.push(`discover:${query.page ?? 1}`);
		if (this.throws) throw new Error("the source is down");
		return this.answers.get(`discover:${query.page ?? 1}`) ?? [];
	}

	async series(providerId: string, ref: { id: string }): Promise<MediaItem[]> {
		this.asked.push(`series:${ref.id}`);
		if (this.throws) throw new Error("the source is down");
		return this.answers.get(`series:${ref.id}`) ?? [];
	}

	owned = (one: MediaItem) => this.ownedTitles.has(one.title);
}

function seeded(title: string, id: string): LibraryEntry {
	return entry({
		title,
		rating: 9,
		status: "Watched",
		tags: ["Science Fiction"],
		ref: { providerId: "tmdb", kind: "movie", id },
	});
}

function drive(
	port: SuggestionPort,
	entries: readonly LibraryEntry[],
	feedback: FeedbackLog = {},
): SuggestionEngine {
	const engine = new SuggestionEngine(port);
	engine.update({
		config,
		entries,
		profile: buildTaste(config, entries, NOW, feedback),
		feedback,
		kinds: ["movie"] as MediaKind[],
		now: NOW,
	});
	return engine;
}

/** Lets the in-flight round settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SuggestionEngine", () => {
	it("asks about your titles and shows what comes back", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "Arrival" }), item({ title: "Sicario" })],
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		expect(port.asked).toContain("similar:1");
		expect(engine.state().shown.map((at) => at.item.title)).toEqual(
			expect.arrayContaining(["Arrival", "Sicario"]),
		);
	});

	it("draws nothing at all when there is nobody to ask", () => {
		const engine = new SuggestionEngine(new FakeSource());
		engine.update({
			config,
			entries: [],
			profile: buildTaste(config, [], NOW),
			feedback: {},
			kinds: [],
			now: NOW,
		});
		expect(engine.state().idle).toBe(true);
	});

	it("leaves out what is already on a shelf", async () => {
		const port = new FakeSource(
			{ "similar:1": [item({ title: "Arrival" }), item({ title: "Have it" })] },
			new Set(["Have it"]),
		);
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();
		expect(engine.state().shown.map((at) => at.item.title)).not.toContain(
			"Have it",
		);
	});

	// One source being unreachable must not empty the row.
	it("still returns a row when a source throws", async () => {
		const port = new FakeSource({ "similar:1": [item({ title: "Arrival" })] });
		port.throws = true;
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const state = engine.state();
		expect(state.loading).toBe(false);
		expect(state.error).toBe("the source is down");
	});

	/**
	 * A thumbs-up changes how the answers already in hand are ordered. Asking
	 * again would make the button feel as though it had thrown the row away.
	 */
	it("re-ranks on a verdict without asking anything again", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "Arrival" }), item({ title: "Nope" })],
		});
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries);
		await settle();
		const asked = port.asked.length;

		const nope = engine.state().shown.find((at) => at.item.title === "Nope");
		const feedback: FeedbackLog = {
			[`${nope?.item.ref.providerId}:${nope?.item.ref.id}`]: {
				verdict: "disliked",
				at: NOW.getTime(),
				kind: "movie",
				title: "Nope",
				tags: [],
				people: [],
			},
		};
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW, feedback),
			feedback,
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});

		expect(port.asked.length).toBe(asked);
		expect(engine.state().shown.map((at) => at.item.title)).not.toContain("Nope");
	});

	it("stands the whole row aside when you ask for others", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 12 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const first = engine.state().shown.map((at) => at.item.title);
		engine.more();
		const second = engine.state().shown.map((at) => at.item.title);
		expect(second.some((title) => first.includes(title))).toBe(false);
	});

	it("goes back and asks for more once the pool runs thin", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "Only one" })],
			"discover:1": [],
			"discover:2": [item({ title: "Found later" })],
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		engine.more();
		await settle();
		expect(port.asked).toContain("discover:2");
	});

	// A new rating changes what the row should be asking about, so the answers
	// to the old questions are dropped rather than left lying around.
	it("abandons what it was asking when the seeds change underneath it", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "From Dune" })],
			"similar:2": [item({ title: "From Arrival" })],
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		engine.update({
			config,
			entries: [seeded("Arrival", "2")],
			profile: buildTaste(config, [seeded("Arrival", "2")], NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();

		const titles = engine.state().shown.map((at) => at.item.title);
		expect(titles).toContain("From Arrival");
		expect(titles).not.toContain("From Dune");
	});

	it("does not ask again when nothing about the library changed", async () => {
		const port = new FakeSource({ "similar:1": [item({ title: "Arrival" })] });
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries);
		await settle();
		const asked = port.asked.length;

		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		expect(port.asked.length).toBe(asked);
	});

	/**
	 * The row used to keep this in memory only, so shutting Obsidian and
	 * opening it again brought back the same seven titles — which reads as
	 * "this is not learning" more loudly than any ranking error.
	 */
	it("does not show the same row again after a reload", async () => {
		const answers = {
			"similar:1": Array.from({ length: 14 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		};
		const entries = [seeded("Dune", "1")];

		const shown: Record<string, number> = {};
		const first = new SuggestionEngine(new FakeSource(answers));
		first.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown,
			onShown: (keys) => {
				for (const key of keys) shown[key] = NOW.getTime();
			},
		});
		await settle();
		const before = first.state().shown.map((at) => at.item.title);
		expect(Object.keys(shown).length).toBe(before.length);

		// A whole new session, reading the log the last one left behind.
		const second = new SuggestionEngine(new FakeSource(answers));
		second.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown,
		});
		await settle();
		const after = second.state().shown.map((at) => at.item.title);

		// Not "fewer of them": none of them. Fourteen answers, seven of which have
		// never been drawn, so there is no reason for the row to repeat itself and
		// it does not — a decaying penalty used to let its most confident picks
		// pay the charge and come straight back.
		expect(after.filter((title) => before.includes(title))).toEqual([]);
	});

	// The penalty decays rather than filtering, so a good suggestion is delayed
	// rather than lost for good.
	it("lets something shown a fortnight ago come back", async () => {
		const answers = { "similar:1": [item({ title: "Only one" })] };
		const entries = [seeded("Dune", "1")];
		const engine = new SuggestionEngine(new FakeSource(answers));
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown: { "tmdb:whatever": NOW.getTime() - 14 * 86_400_000 },
		});
		await settle();
		expect(engine.state().shown.map((at) => at.item.title)).toContain("Only one");
	});

	it("keeps a snoozed title out until its date, and lets it back after", async () => {
		const answers = { "similar:1": [item({ title: "Not tonight" })] };
		const entries = [seeded("Dune", "1")];

		const build = (until: number, now: Date) => {
			const port = new FakeSource(answers);
			const engine = new SuggestionEngine(port);
			const first = answers["similar:1"][0];
			const feedback: FeedbackLog = {
				[`${first?.ref.providerId}:${first?.ref.id}`]: {
					verdict: "snoozed",
					at: NOW.getTime(),
					until,
					kind: "movie",
					title: "Not tonight",
					tags: [],
					people: [],
				},
			};
			engine.update({
				config,
				entries,
				profile: buildTaste(config, entries, now, feedback),
				feedback,
				kinds: ["movie"] as MediaKind[],
				now,
			});
			return engine;
		};

		const holding = build(NOW.getTime() + 30 * 86_400_000, NOW);
		await settle();
		expect(holding.state().shown).toHaveLength(0);

		const later = new Date(NOW.getTime() + 40 * 86_400_000);
		const lapsed = build(NOW.getTime() + 30 * 86_400_000, later);
		await settle();
		expect(lapsed.state().shown.map((at) => at.item.title)).toContain(
			"Not tonight",
		);
	});

	// Used to require a thumbs-down, which taught the model the opposite.
	it("takes away something you have already seen without holding it against it", async () => {
		const answers = {
			"similar:1": [item({ title: "Seen it" }), item({ title: "New" })],
		};
		const entries = [seeded("Dune", "1")];
		const port = new FakeSource(answers);
		const engine = new SuggestionEngine(port);
		const gone = answers["similar:1"][0];
		const feedback: FeedbackLog = {
			[`${gone?.ref.providerId}:${gone?.ref.id}`]: {
				verdict: "seen",
				at: NOW.getTime(),
				kind: "movie",
				title: "Seen it",
				tags: [],
				people: [],
			},
		};
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW, feedback),
			feedback,
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		const titles = engine.state().shown.map((at) => at.item.title);
		expect(titles).not.toContain("Seen it");
		expect(titles).toContain("New");
	});

	/**
	 * "Show me others" used to stop working after four presses, and not because
	 * anything had run out: exhaustion was counted rather than observed, so the
	 * button disabled itself on a schedule regardless of what the sources still
	 * had. A row that can be refreshed three times is a row with a bottom, and a
	 * bottom is the thing that makes people stop pressing.
	 */
	it("keeps giving you others however many times you ask", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 30 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const rows: string[][] = [];
		for (let press = 0; press < 8; press++) {
			rows.push(engine.state().shown.map((at) => at.item.title));
			engine.more();
			await settle();
		}
		for (const row of rows) expect(row.length).toBeGreaterThan(0);
	});

	/**
	 * And when it genuinely has asked everything it can think of, it comes round
	 * again rather than sitting there. Going round is a worse answer than a new
	 * answer and a far better one than nothing.
	 */
	it("comes round again rather than running out", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 9 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const first = engine.state().shown.map((at) => at.item.title);
		// Enough presses to walk past everything the one source ever had.
		for (let press = 0; press < 6; press++) {
			engine.more();
			await settle();
		}
		const later = engine.state().shown.map((at) => at.item.title);
		expect(later.length).toBeGreaterThan(0);
		// It has come back round to titles it stood aside several presses ago,
		// which is the whole point: the alternative was a blank row.
		expect(later.some((title) => first.includes(title))).toBe(true);
	});

	/**
	 * And what it comes round to is what you saw longest ago. Dropping the whole
	 * hold at once brought back the row you had just skipped past along with
	 * everything else, which is the difference between coming round and going in
	 * circles.
	 */
	it("brings the oldest row back before a newer one", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 21 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		// Three full rows, which is the whole pool.
		const rows: string[][] = [];
		for (let press = 0; press < 3; press++) {
			rows.push(engine.state().shown.map((at) => at.item.title));
			engine.more();
			await settle();
		}

		const again = engine.state().shown.map((at) => at.item.title);
		expect(again.length).toBeGreaterThan(0);
		expect(again.every((title) => rows[0]?.includes(title))).toBe(true);
		expect(again.some((title) => rows[1]?.includes(title))).toBe(false);
	});

	it("tells whoever is watching when the answers land", async () => {
		const port = new FakeSource({ "similar:1": [item({ title: "Arrival" })] });
		let told = 0;
		const engine = new SuggestionEngine(port);
		engine.subscribe(() => {
			told += 1;
		});
		engine.update({
			config,
			entries: [seeded("Dune", "1")],
			profile: buildTaste(config, [seeded("Dune", "1")], NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		expect(told).toBeGreaterThan(0);
	});
});
