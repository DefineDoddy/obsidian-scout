import { describe, expect, it } from "vitest";
import { entry, item, NOW, testConfig, verdict } from "../../test/fixtures";
import type { FeedbackLog } from "./feedback";
import { anchorsOf, neighbourBoost } from "./neighbours";
import { traitsOfItem, type TraitKey } from "./traits";

const config = testConfig();
const DAY = 86_400_000;

const traitsOf = (one: Parameters<typeof traitsOfItem>[0]): TraitKey[] =>
	traitsOfItem(one).map((at) => at.key);

describe("anchorsOf", () => {
	/**
	 * A favourite is a like the vault recorded before the row existed. Ignoring
	 * them would mean starting from nothing on a library kept for years.
	 */
	it("counts a starred note as something you said yes to", () => {
		const anchors = anchorsOf(
			config,
			[entry({ title: "Arrival", favorite: true, tags: ["Science Fiction"] })],
			{},
		);
		expect(anchors.map((one) => one.title)).toEqual(["Arrival"]);
	});

	it("counts a thumbs-up, and ignores a thumbs-down", () => {
		const feedback: FeedbackLog = {
			yes: verdict({ verdict: "liked", title: "Heat", tags: ["Crime"] }),
			no: verdict({ verdict: "disliked", title: "Cats", tags: ["Musical"] }),
		};
		const titles = anchorsOf(config, [], feedback).map((one) => one.title);
		expect(titles).toEqual(["Heat"]);
	});

	it("passes over a record that says nothing about what it was", () => {
		const feedback: FeedbackLog = {
			bare: verdict({ verdict: "liked", tags: [], people: [] }),
		};
		expect(anchorsOf(config, [], feedback)).toEqual([]);
	});

	it("has nothing to anchor to on a library nobody has rated", () => {
		expect(anchorsOf(config, [entry(), entry()], {})).toEqual([]);
	});
});

describe("neighbourBoost", () => {
	const arrival = item({
		title: "Arrival",
		tags: ["Science Fiction", "Drama"],
		people: ["Denis Villeneuve", "Amy Adams"],
		extra: { directors: ["Denis Villeneuve"] },
		year: 2016,
	});

	const anchors = anchorsOf(config, [], {
		one: verdict({
			verdict: "liked",
			title: "Arrival",
			traits: traitsOf(arrival),
		}),
	});

	/**
	 * The whole point. The affinity model is an average and applies what it
	 * knows to everything equally; this is the part that notices one particular
	 * candidate is the same shape as one particular thing you said yes to — and,
	 * crucially, can say which.
	 */
	it("finds the closest thing you liked, and names it", () => {
		const near = neighbourBoost(anchors, traitsOf(arrival), NOW);
		expect(near.boost).toBeGreaterThan(0);
		expect(near.reason?.label).toBe("Because you liked Arrival");
		expect(near.reason?.kind).toBe("neighbour");
	});

	/**
	 * Overclaiming costs more trust than staying quiet. A record the source
	 * barely described is *mostly* whatever it does say, so on a plain cosine
	 * "they are both dramas" scores 0.46 — which is why there is a floor on how
	 * much two things must actually share, and not only on the ratio.
	 */
	it("stays quiet when all they share is one genre", () => {
		const distant = item({ tags: ["Drama"], people: [], year: 1974 });
		expect(neighbourBoost(anchors, traitsOf(distant), NOW).boost).toBe(0);
	});

	it("speaks up once they share a genre and a name", () => {
		const close = item({
			tags: ["Drama"],
			people: ["Amy Adams"],
			year: 1974,
		});
		expect(neighbourBoost(anchors, traitsOf(close), NOW).boost).toBeGreaterThan(
			0,
		);
	});

	it("says nothing at all about something with nothing in common", () => {
		const other = item({ tags: ["Cookery"], people: ["Nobody"] });
		expect(neighbourBoost(anchors, traitsOf(other), NOW)).toEqual({ boost: 0 });
	});

	it("has nothing to say before you have said yes to anything", () => {
		expect(neighbourBoost([], traitsOf(arrival), NOW).boost).toBe(0);
	});

	// The best match rather than the sum: summing lets a long log dominate
	// everything, and only the best match has a name worth printing.
	it("names one thing, not every thing that half matched", () => {
		const many = anchorsOf(config, [], {
			a: verdict({ verdict: "liked", title: "A", traits: traitsOf(arrival) }),
			b: verdict({ verdict: "liked", title: "B", traits: traitsOf(arrival) }),
			c: verdict({ verdict: "liked", title: "C", traits: traitsOf(arrival) }),
		});
		const one = neighbourBoost(
			anchorsOf(config, [], {
				a: verdict({ verdict: "liked", title: "A", traits: traitsOf(arrival) }),
			}),
			traitsOf(arrival),
			NOW,
		);
		const three = neighbourBoost(many, traitsOf(arrival), NOW);
		expect(three.boost).toBeCloseTo(one.boost, 5);
		expect(three.reason?.label).toMatch(/^Because you liked [ABC]$/);
	});

	it("weighs a recent yes above one from years ago", () => {
		const fresh = anchorsOf(config, [], {
			a: verdict({
				verdict: "liked",
				title: "Recent",
				at: NOW.getTime() - 10 * DAY,
				traits: traitsOf(arrival),
			}),
		});
		const stale = anchorsOf(config, [], {
			a: verdict({
				verdict: "liked",
				title: "Ages ago",
				at: NOW.getTime() - 2000 * DAY,
				traits: traitsOf(arrival),
			}),
		});
		expect(neighbourBoost(fresh, traitsOf(arrival), NOW).boost).toBeGreaterThan(
			neighbourBoost(stale, traitsOf(arrival), NOW).boost,
		);
	});

	// Otherwise a film listing twenty keywords out-matches one listing four on
	// volume alone, which is a fact about its metadata and not about the film.
	it("does not reward a candidate simply for listing more about itself", () => {
		const focused = item({ tags: ["Science Fiction", "Drama"], people: [] });
		const padded = item({
			tags: ["Science Fiction", "Drama", ...Array.from({ length: 12 }, (_, at) => `Filler ${at}`)],
			people: [],
		});
		const to = anchorsOf(config, [], {
			a: verdict({ verdict: "liked", title: "A", traits: traitsOf(focused) }),
		});
		expect(neighbourBoost(to, traitsOf(focused), NOW).boost).toBeGreaterThan(
			neighbourBoost(to, traitsOf(padded), NOW).boost,
		);
	});
});
