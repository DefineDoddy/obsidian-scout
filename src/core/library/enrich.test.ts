import { describe, expect, it } from "vitest";
import { entry, NOW, testConfig, verdict } from "../../test/fixtures";
import { sourceKey, type MediaRef } from "../types";
import {
	dueForEnrichment,
	enrichmentProgress,
	ENRICH_VERSION,
	isFresh,
	normalizeEnrichment,
	pruneEnrichment,
	recordOf,
	type EnrichmentCache,
	type EnrichmentRecord,
} from "./enrich";
import { FIELD_INFO } from "./config";

const config = testConfig();
const DAY = 86_400_000;
const ago = (days: number) => NOW.getTime() - days * DAY;
const always = () => true;

const ref = (id: string): MediaRef => ({
	providerId: "tmdb",
	kind: "movie",
	id,
});

const linked = (id: string, over = {}) =>
	entry({ ref: ref(id), title: `Title ${id}`, ...over });

const harvest = (over: Partial<EnrichmentRecord> = {}): EnrichmentRecord => ({
	v: ENRICH_VERSION,
	at: NOW.getTime(),
	keywords: [{ name: "time loop", id: "4565" }],
	people: [],
	directors: [],
	studios: [],
	...over,
});

describe("recordOf", () => {
	it("keeps the ids, because a name alone cannot be asked about", () => {
		const record = recordOf(
			{ keywords: [{ name: "heist", id: "10051" }] },
			NOW,
		);
		expect(record.keywords[0]?.id).toBe("10051");
		expect(record.empty).toBeUndefined();
	});

	// So a title the source knows nothing more about is not asked about daily.
	it("writes down that there was nothing to find", () => {
		expect(recordOf(null, NOW).empty).toBe(true);
		expect(recordOf({ keywords: [] }, NOW).empty).toBe(true);
	});

	it("trims a cast of hundreds down to the ones anybody noticed", () => {
		const people = Array.from({ length: 30 }, (_, at) => ({ name: `P${at}` }));
		expect(recordOf({ people }, NOW).people).toHaveLength(8);
	});
});

describe("isFresh", () => {
	it("believes a recent harvest and doubts an old one", () => {
		expect(isFresh(harvest({ at: ago(30) }), NOW)).toBe(true);
		expect(isFresh(harvest({ at: ago(300) }), NOW)).toBe(false);
	});

	// An absence is stabler news than a presence, and re-asking costs the same.
	it("lets an answer of nothing stand for much longer", () => {
		expect(isFresh(harvest({ at: ago(300), empty: true }), NOW)).toBe(true);
		expect(isFresh(harvest({ at: ago(400), empty: true }), NOW)).toBe(false);
	});

	/**
	 * So a later version that knows to ask for more can go back for it, without
	 * throwing away everything already gathered.
	 */
	it("goes back for a harvest taken before the model knew what to ask", () => {
		expect(isFresh(harvest({ v: 0 }), NOW)).toBe(false);
	});

	it("has nothing to believe about a title never asked about", () => {
		expect(isFresh(undefined, NOW)).toBe(false);
	});
});

describe("dueForEnrichment", () => {
	/**
	 * A budget spent alphabetically would take weeks to reach anything the row
	 * actually uses. Spent on the titles that seed the recommendations, the
	 * first run already improves what you see.
	 */
	it("asks about the titles the row will actually use first", () => {
		const due = dueForEnrichment(
			config,
			[
				linked("cold", { status: "To watch" }),
				linked("loved", { rating: 10, status: "Watched" }),
			],
			{},
			always,
			NOW,
			1,
		);
		expect(due.map((one) => one.id)).toEqual(["loved"]);
	});

	it("prefers a favourite to a note nobody has touched", () => {
		const due = dueForEnrichment(
			config,
			[
				linked("cold", { status: "To watch" }),
				linked("starred", { status: "To watch", favorite: true }),
			],
			{},
			always,
			NOW,
			1,
		);
		expect(due.map((one) => one.id)).toEqual(["starred"]);
	});

	it("leaves alone something read up on last week", () => {
		const cache: EnrichmentCache = { "tmdb:done": harvest({ at: ago(7) }) };
		const due = dueForEnrichment(
			config,
			[linked("done", { rating: 9, status: "Watched" })],
			cache,
			always,
			NOW,
		);
		expect(due).toEqual([]);
	});

	it("stops asking about something the source had nothing for", () => {
		const cache: EnrichmentCache = {
			"tmdb:bare": harvest({ at: ago(200), empty: true }),
		};
		const due = dueForEnrichment(config, [linked("bare")], cache, always, NOW);
		expect(due).toEqual([]);
	});

	it("passes over a note that never said where it came from", () => {
		const due = dueForEnrichment(config, [entry()], {}, always, NOW);
		expect(due).toEqual([]);
	});

	// Unconfigured, switched off, or simply not able to answer.
	it("asks nothing of a source that cannot be asked", () => {
		const due = dueForEnrichment(
			config,
			[linked("a"), linked("b")],
			{},
			() => false,
			NOW,
		);
		expect(due).toEqual([]);
	});

	it("never asks for more than the budget in one go", () => {
		const many = Array.from({ length: 40 }, (_, at) => linked(String(at)));
		expect(dueForEnrichment(config, many, {}, always, NOW, 15)).toHaveLength(15);
	});

	// A crash, a quit, or a changed setting costs nothing: there is no cursor,
	// so the next run simply recomputes what is still missing.
	it("picks up where it left off without having kept a place", () => {
		const many = Array.from({ length: 6 }, (_, at) => linked(String(at)));
		const first = dueForEnrichment(config, many, {}, always, NOW, 3);
		const cache: EnrichmentCache = {};
		for (const one of first) cache[sourceKey(one)] = harvest();
		const second = dueForEnrichment(config, many, cache, always, NOW, 3);

		expect(second).toHaveLength(3);
		expect(second.some((one) => first.includes(one))).toBe(false);
	});
});

describe("enrichmentProgress", () => {
	it("counts what could be read and what has been", () => {
		const cache: EnrichmentCache = { "tmdb:a": harvest() };
		const progress = enrichmentProgress(
			config,
			[linked("a"), linked("b"), entry()],
			cache,
			always,
			NOW,
		);
		expect(progress).toEqual({ eligible: 2, known: 1, waiting: 1 });
	});
});

describe("pruneEnrichment", () => {
	it("forgets a title that has left the vault", () => {
		const cache: EnrichmentCache = { "tmdb:here": harvest(), "tmdb:gone": harvest() };
		const kept = pruneEnrichment(cache, [linked("here")], {});
		expect(Object.keys(kept)).toEqual(["tmdb:here"]);
	});

	// The record for a thumbed-up suggestion and for the note later made from
	// it are one record, so a verdict is reason enough to keep it.
	it("keeps what a verdict still refers to", () => {
		const cache: EnrichmentCache = { "tmdb:voted": harvest() };
		const kept = pruneEnrichment(cache, [], { "tmdb:voted": verdict() });
		expect(Object.keys(kept)).toEqual(["tmdb:voted"]);
	});

	it("gives up the oldest once it is past its size", () => {
		const cache: EnrichmentCache = {};
		const entries = [];
		for (let at = 0; at < 10; at++) {
			cache[`tmdb:${at}`] = harvest({ at: ago(at) });
			entries.push(linked(String(at)));
		}
		const kept = pruneEnrichment(cache, entries, {}, 3);
		expect(Object.keys(kept).sort()).toEqual(["tmdb:0", "tmdb:1", "tmdb:2"]);
	});
});

describe("normalizeEnrichment", () => {
	it("reads a hand-edited file without falling over", () => {
		expect(normalizeEnrichment(null)).toEqual({});
		expect(normalizeEnrichment({ a: 3, b: null, c: {} })).toEqual({});
	});

	it("accepts a bare name where a name and an id were expected", () => {
		const cache = normalizeEnrichment({
			"tmdb:1": { v: 1, at: 1, keywords: ["heist", { name: "noir", id: "9" }] },
		});
		expect(cache["tmdb:1"]?.keywords).toEqual([
			{ name: "heist" },
			{ name: "noir", id: "9" },
		]);
	});
});

/**
 * The boundary, held by a test rather than by memory.
 *
 * Everything gathered here is the model's working notes. Nobody asked for
 * `keywords: [dystopia, time-loop]` to appear in their frontmatter, and the
 * user was promised it would not. Adding a writable field for any of it is the
 * kind of change that looks reasonable in isolation and breaks that promise.
 */
describe("the line between Scout's notes and yours", () => {
	it("has no writable field for anything a harvest gathers", () => {
		const writable = Object.entries(FIELD_INFO)
			.filter(([, info]) => info.writes)
			.map(([key]) => key.toLowerCase());
		for (const forbidden of ["keyword", "studio", "series", "language"]) {
			expect(writable.some((key) => key.includes(forbidden))).toBe(false);
		}
	});
});
