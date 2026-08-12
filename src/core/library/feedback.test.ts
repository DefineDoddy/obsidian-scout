import { describe, expect, it } from "vitest";
import { item, NOW, verdict } from "../../test/fixtures";
import {
	activeVerdict,
	countVerdicts,
	isRefusal,
	normalizeFeedback,
	normalizeShown,
	pruneFeedback,
	pruneShown,
	recordFor,
	SNOOZE_DAYS,
	type FeedbackLog,
	type ShownLog,
} from "./feedback";

const DAY = 86_400_000;
const ago = (days: number) => NOW.getTime() - days * DAY;

describe("recordFor", () => {
	/**
	 * The verdict that was missing. The only button that used to clear a thing
	 * off the row was thumbs-down, so anyone using it to mean "seen it" was
	 * teaching the model the exact opposite of the truth.
	 */
	it("records having seen a thing without deciding you disliked it", () => {
		const record = recordFor(item({ title: "Heat" }), "seen", NOW);
		expect(record.verdict).toBe("seen");
		expect(isRefusal("seen")).toBe(true);
		expect(isRefusal("liked")).toBe(false);
	});

	it("gives a snooze a date to run out on", () => {
		const record = recordFor(item(), "snoozed", NOW);
		expect(record.until).toBe(NOW.getTime() + SNOOZE_DAYS * DAY);
	});

	it("leaves a verdict you meant permanently standing", () => {
		expect(recordFor(item(), "disliked", NOW).until).toBeUndefined();
	});

	// So a thing you liked can become a question to ask the source, and so the
	// record still means something once nothing remembers the title.
	it("keeps enough of the thing to go on working without it", () => {
		const record = recordFor(
			item({ title: "Arrival", tags: ["Science Fiction"] }),
			"liked",
			NOW,
		);
		expect(record.ref?.id).toBeTruthy();
		expect(record.traits?.length).toBeGreaterThan(0);
	});
});

describe("activeVerdict", () => {
	// Read rather than swept: a snooze that ended while Obsidian was shut has
	// still ended, and nothing needs to have been running for that to be true.
	it("lets a snooze run out on its own", () => {
		const snoozed = verdict({ verdict: "snoozed", until: ago(1) });
		const holding = verdict({ verdict: "snoozed", until: NOW.getTime() + DAY });
		expect(activeVerdict(snoozed, NOW)).toBeNull();
		expect(activeVerdict(holding, NOW)).toBe("snoozed");
	});

	it("has nothing to say about something never voted on", () => {
		expect(activeVerdict(undefined, NOW)).toBeNull();
	});
});

describe("normalizeFeedback", () => {
	// Three records in a real vault's data file predate all of this.
	it("reads a record written before snoozing existed", () => {
		const log = normalizeFeedback({
			"tmdb:1": {
				verdict: "liked",
				at: ago(30),
				kind: "movie",
				title: "Arrival",
				tags: ["Science Fiction"],
				people: ["Denis Villeneuve"],
			},
		});
		expect(log["tmdb:1"]?.verdict).toBe("liked");
		expect(log["tmdb:1"]?.tags).toEqual(["Science Fiction"]);
		expect(log["tmdb:1"]?.until).toBeUndefined();
	});

	it("keeps all four verdicts and throws away anything else", () => {
		const log = normalizeFeedback({
			a: { verdict: "seen", at: 1, kind: "movie", title: "A" },
			b: { verdict: "snoozed", at: 1, kind: "movie", title: "B" },
			c: { verdict: "shrugged", at: 1, kind: "movie", title: "C" },
		});
		expect(Object.keys(log).sort()).toEqual(["a", "b"]);
	});

	it("survives a hand-edited file full of nonsense", () => {
		expect(normalizeFeedback(null)).toEqual({});
		expect(normalizeFeedback("nope")).toEqual({});
		expect(normalizeFeedback({ a: 3, b: null })).toEqual({});
	});
});

describe("pruneFeedback", () => {
	it("forgets a snooze whose date has passed", () => {
		const log: FeedbackLog = {
			gone: verdict({ verdict: "snoozed", until: ago(1) }),
			held: verdict({ verdict: "snoozed", until: NOW.getTime() + DAY }),
		};
		expect(Object.keys(pruneFeedback(log, NOW))).toEqual(["held"]);
	});

	// Two years on, something you had seen is usually a note in the vault.
	it("forgets a very old seen-it", () => {
		const log: FeedbackLog = {
			old: verdict({ verdict: "seen", at: ago(900) }),
			recent: verdict({ verdict: "seen", at: ago(30) }),
		};
		expect(Object.keys(pruneFeedback(log, NOW))).toEqual(["recent"]);
	});

	/**
	 * A verdict you gave deliberately outlives one the row inferred. Dropping a
	 * thumbs-down to make room for a snooze would let something you rejected
	 * come back, which is the one thing this file exists to prevent.
	 */
	it("gives up the softer records first when it runs out of room", () => {
		const log: FeedbackLog = {};
		for (let at = 0; at < 10; at++) {
			log[`soft${at}`] = verdict({ verdict: "seen", at: ago(at) });
		}
		log.strong = verdict({ verdict: "disliked", at: ago(500) });

		const pruned = pruneFeedback(log, NOW, 3);
		expect(Object.keys(pruned)).toHaveLength(3);
		expect(pruned.strong).toBeDefined();
	});

	it("leaves a log that fits entirely alone", () => {
		const log: FeedbackLog = { a: verdict({ at: ago(5) }) };
		expect(pruneFeedback(log, NOW, 10)).toEqual(log);
	});
});

describe("the shown log", () => {
	it("reads only the numbers out of a stored blob", () => {
		expect(normalizeShown({ a: 12, b: "soon", c: null })).toEqual({ a: 12 });
	});

	// Long enough ago that showing it again is not showing it again.
	it("forgets a row from weeks back", () => {
		const log: ShownLog = { old: ago(40), recent: ago(2) };
		expect(Object.keys(pruneShown(log, NOW))).toEqual(["recent"]);
	});

	it("keeps the most recent when it runs out of room", () => {
		const log: ShownLog = { a: ago(1), b: ago(2), c: ago(3) };
		expect(Object.keys(pruneShown(log, NOW, 21, 2)).sort()).toEqual(["a", "b"]);
	});
});

describe("countVerdicts", () => {
	it("counts each sort, so the page can say what it has been told", () => {
		const counts = countVerdicts({
			a: verdict({ verdict: "liked" }),
			b: verdict({ verdict: "liked" }),
			c: verdict({ verdict: "disliked" }),
			d: verdict({ verdict: "seen" }),
		});
		expect(counts).toEqual({ liked: 2, disliked: 1, seen: 1, snoozed: 0 });
	});
});
