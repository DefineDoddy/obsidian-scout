import { describe, expect, it } from "vitest";
import {
	entry,
	fromCatalogue,
	fromSeed,
	item,
	NOW,
	pooled,
	raw,
	testConfig,
} from "../../test/fixtures";
import type { MediaItem } from "../types";
import type { LibraryEntry } from "./entry";
import type { FeedbackLog } from "./feedback";
import {
	discoverPlans,
	emptyPool,
	fillSlots,
	LIKED_SEATS,
	mergeSuggestions,
	rankSuggestions,
	recommendationSeeds,
	scoreSuggestion,
	seedStrength,
	tasteGenres,
	type StrategyId,
	type SuggestionPool,
} from "./recommend";
import { affinity, buildTaste } from "./taste";

const config = testConfig();
const ref = { providerId: "tmdb", kind: "movie" as const, id: "1" };

const taste = (entries: LibraryEntry[], feedback: FeedbackLog = {}) =>
	buildTaste(config, entries, NOW, feedback);

describe("seedStrength", () => {
	it("passes over something you never finished and never rated", () => {
		expect(
			seedStrength(config, entry({ status: "To watch", ref }), NOW),
		).toBeNull();
	});

	it("passes over something you gave up on", () => {
		expect(
			seedStrength(config, entry({ status: "Dropped", rating: 9, ref }), NOW),
		).toBeNull();
	});

	// The old row asked only about 9s and 10s, which on a normal library is six
	// titles, and six titles have one neighbourhood between them.
	it("asks about something you merely finished, not only your favourites", () => {
		const finished = seedStrength(
			config,
			entry({ status: "Watched", ref }),
			NOW,
		);
		expect(finished).not.toBeNull();
		const loved = seedStrength(
			config,
			entry({ status: "Watched", rating: 10, ref }),
			NOW,
		);
		expect(loved ?? 0).toBeGreaterThan(finished ?? 0);
	});

	it("leaves out something you thought was middling", () => {
		expect(
			seedStrength(config, entry({ status: "Watched", rating: 4, ref }), NOW),
		).toBeNull();
	});

	it("has nothing to ask a source about with no source on the note", () => {
		expect(
			seedStrength(config, entry({ rating: 10, status: "Watched" }), NOW),
		).toBeNull();
	});
});

describe("recommendationSeeds", () => {
	it("spreads the seeds across genres", () => {
		const seeds = recommendationSeeds(
			config,
			[
				entry({ title: "A", tags: ["Sci-Fi"], rating: 10, status: "Watched", ref }),
				entry({ title: "B", tags: ["Sci-Fi"], rating: 10, status: "Watched", ref }),
				entry({ title: "C", tags: ["Sci-Fi"], rating: 9, status: "Watched", ref }),
				entry({ title: "D", tags: ["Comedy"], rating: 8, status: "Watched", ref }),
			],
			2,
			NOW,
		);
		expect(seeds.map((at) => at.entry.title)).toContain("D");
	});

	it("hands back how much each seed is worth, best first", () => {
		const seeds = recommendationSeeds(
			config,
			[
				entry({ title: "Fine", rating: 6, status: "Watched", ref }),
				entry({ title: "Loved", rating: 10, status: "Watched", ref }),
			],
			5,
			NOW,
		);
		expect(seeds[0]?.entry.title).toBe("Loved");
		expect(seeds[0]?.strength).toBeGreaterThan(seeds[1]?.strength ?? 1);
	});
});

describe("tasteGenres", () => {
	it("names what you go for and what you avoid, separately", () => {
		const profile = taste([
			entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
			entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 2, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 2, status: "Watched" }),
		]);
		expect(tasteGenres(profile, "liked")).toContain("science fiction");
		expect(tasteGenres(profile, "liked")).not.toContain("romance");
		expect(tasteGenres(profile, "disliked")).toContain("romance");
	});

	/**
	 * A library of nothing but one genre has no genre that stands out — the
	 * comparison is against your own average, and everything you own *is* your
	 * average. Correct arithmetic, useless as a search, so what you keep most
	 * of stands in.
	 */
	it("falls back to what you keep most of when nothing stands out", () => {
		const profile = taste([
			entry({ tags: ["Drama"], rating: 9, status: "Watched" }),
			entry({ tags: ["Drama"], rating: 9, status: "Watched" }),
			entry({ tags: ["Drama"], rating: 8, status: "Watched" }),
		]);
		expect(tasteGenres(profile, "liked")).toEqual(["drama"]);
	});

	it("does not fall back to something you keep and keep not enjoying", () => {
		const profile = taste([
			entry({ tags: ["Reality"], rating: 3, status: "Watched" }),
			entry({ tags: ["Reality"], rating: 3, status: "Watched" }),
			entry({ tags: ["Reality"], rating: 2, status: "Watched" }),
			entry({ tags: ["Drama"], rating: 9, status: "Watched" }),
		]);
		expect(tasteGenres(profile, "liked")).not.toContain("reality");
	});
});

describe("discoverPlans", () => {
	const profile = taste([
		entry({ kind: "movie", tags: ["Drama"], rating: 9, status: "Watched" }),
		entry({ kind: "movie", tags: ["Drama"], rating: 9, status: "Watched" }),
		entry({ kind: "anime", tags: ["Drama"], rating: 8, status: "Watched" }),
	]);

	it("asks each catalogue about the kind you keep, not about all of them", () => {
		const plans = discoverPlans(profile, 0, ["movie", "anime", "book"]);
		expect(plans.map((p) => p.kind)).toEqual(["movie", "anime"]);
		expect(plans[0]?.genres).toContain("drama");
	});

	// Paging is what makes "show me others" mean something on the discovery
	// half — the same page again is the same eight films again.
	it("walks further down the list on later rounds", () => {
		expect(discoverPlans(profile, 0, ["movie"])[0]?.page).toBe(1);
		expect(discoverPlans(profile, 3, ["movie"])[0]?.page).toBe(4);
	});

	it("still asks something of a library that has nothing to go on", () => {
		const plans = discoverPlans(taste([]), 0, ["movie"]);
		expect(plans).toHaveLength(1);
		expect(plans[0]?.genres).toEqual([]);
	});
});

describe("mergeSuggestions", () => {
	const only = (pool: SuggestionPool) => [...pool.by.values()][0];

	it("counts the second title that points at the same thing", () => {
		const pool = emptyPool();
		const one = item({ title: "Arrival" });
		mergeSuggestions(pool, [one], fromSeed("Sicario", 0.8));
		mergeSuggestions(pool, [{ ...one }], fromSeed("Dune", 0.9));

		expect(pool.by.size).toBe(1);
		expect(only(pool)?.seeds).toEqual(["Sicario", "Dune"]);
		expect(only(pool)?.seedStrength).toBeCloseTo(0.9, 5);
	});

	it("marks a catalogue pick as one, until a title of yours agrees", () => {
		const pool = emptyPool();
		const one = item();
		mergeSuggestions(pool, [one], fromCatalogue);
		expect(only(pool)?.explored).toBe(true);
		mergeSuggestions(pool, [one], fromSeed("Dune", 0.9));
		expect(only(pool)?.explored).toBe(false);
	});

	it("keeps whichever copy of a record says more", () => {
		const pool = emptyPool();
		const bare = item({ title: "Bare" });
		mergeSuggestions(pool, [bare], fromCatalogue);
		mergeSuggestions(pool, [{ ...bare, tags: ["Drama", "Crime"] }], fromCatalogue);
		expect(only(pool)?.item.tags).toEqual(["Drama", "Crime"]);
	});

	/**
	 * The same anime comes back from TMDB and from AniList under two ids, and
	 * two of the seven places went to one show. The keys cannot be changed to
	 * fix it — `providerId:id` is also the feedback key — so the pool carries a
	 * second index on title and year.
	 */
	it("treats the same film from two sources as one film", () => {
		const pool = emptyPool();
		mergeSuggestions(
			pool,
			[
				{
					...item({ title: "Cowboy Bebop", year: 1998 }),
					ref: { providerId: "tmdb", kind: "anime", id: "30991" },
				},
			],
			fromSeed("Trigun"),
		);
		mergeSuggestions(
			pool,
			[
				{
					...item({ title: "Cowboy Bebop", year: 1998 }),
					ref: { providerId: "anilist", kind: "anime", id: "1" },
				},
			],
			fromSeed("Samurai Champloo"),
		);
		expect(pool.by.size).toBe(1);
		expect(only(pool)?.seeds).toEqual(["Trigun", "Samurai Champloo"]);
	});

	it("does not fold together two different films that share a name", () => {
		const pool = emptyPool();
		mergeSuggestions(pool, [item({ title: "Dune", year: 1984 })], fromCatalogue);
		mergeSuggestions(pool, [item({ title: "Dune", year: 2021 })], fromCatalogue);
		expect(pool.by.size).toBe(2);
	});
});

describe("scoreSuggestion", () => {
	const profile = taste([
		entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
		entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
		entry({ tags: ["Science Fiction"], rating: 8, status: "Watched" }),
	]);

	/**
	 * The heart of the rewrite. Three of your titles independently pointing at
	 * the same film is the strongest thing a source ever says, and the previous
	 * version dropped every mention after the first as a duplicate.
	 */
	it("ranks a film three of your titles agree on above one that only one does", () => {
		const shared = scoreSuggestion(
			profile,
			raw({ seeds: ["A", "B", "C"], seedStrength: 0.8 }),
			NOW,
		);
		const lone = scoreSuggestion(
			profile,
			raw({ seeds: ["A"], seedStrength: 0.8 }),
			NOW,
		);
		expect(shared.score).toBeGreaterThan(lone.score);
		expect(shared.reasons.map((one) => one.label)).toContain(
			"3 things you liked point here",
		);
	});

	it("prefers a neighbour of something you loved to one you merely finished", () => {
		const beloved = scoreSuggestion(
			profile,
			raw({ seeds: ["A"], seedStrength: 0.95 }),
			NOW,
		);
		const mild = scoreSuggestion(
			profile,
			raw({ seeds: ["B"], seedStrength: 0.55 }),
			NOW,
		);
		expect(beloved.score).toBeGreaterThan(mild.score);
	});

	// A 9.4 from eleven people is a small sample, not a better film.
	it("discounts a high score hardly anyone gave", () => {
		const obscure = scoreSuggestion(
			profile,
			raw({ item: item({ rating: 9.4, ratingCount: 11 }), explored: true }),
			NOW,
		);
		const known = scoreSuggestion(
			profile,
			raw({ item: item({ rating: 8.4, ratingCount: 40_000 }), explored: true }),
			NOW,
		);
		expect(known.score).toBeGreaterThan(obscure.score);
	});

	it("says something about a catalogue pick nothing of yours explains", () => {
		const verdict = scoreSuggestion(profile, raw({ explored: true }), NOW);
		expect(verdict.reasons.map((one) => one.label)).toEqual([
			"Well liked, and in your line",
		]);
	});

	// The card has room for two chips; the dialog wants the whole account.
	it("names the trait it recognised alongside the title it came from", () => {
		// A library with an opinion, rather than one made of a single genre —
		// where everything is science fiction, science fiction is the baseline
		// and the model correctly has nothing to say about it.
		const mixed = taste([
			entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
			entry({ tags: ["Science Fiction"], rating: 9, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
		]);
		const verdict = scoreSuggestion(
			mixed,
			raw({ item: item({ tags: ["Science Fiction"] }), seeds: ["Dune"] }),
			NOW,
		);
		expect(verdict.reasons.find((one) => one.kind === "genre")?.label).toBe(
			"Science Fiction",
		);
		expect(verdict.reasons.find((one) => one.kind === "seed")?.label).toBe(
			"Because you liked Dune",
		);
	});
});

describe("fillSlots", () => {
	const one = (
		id: string,
		strategy: StrategyId,
		score: number,
		tags: string[] = [],
	) => ({ id, strategy, score, tags });

	/**
	 * The whole reason a budget exists. A sequel shares its predecessor's
	 * genres, so on one flat ranking the diversity pass docks it and the
	 * suggestion a person would find most obviously right is the one that
	 * reliably loses its seat.
	 */
	it("keeps a seat for the pick a flat ranking would always drop", () => {
		const pool = [
			...Array.from({ length: 10 }, (_, at) =>
				one(`exploit${at}`, "exploit", 5 - at * 0.01, ["Drama"]),
			),
			one("sequel", "franchise", 0.2, ["Drama"]),
		];
		expect(fillSlots(pool, 7).map((at) => at.id)).toContain("sequel");
	});

	it("gives a slot nobody can fill to whoever else is waiting", () => {
		const pool = Array.from({ length: 9 }, (_, at) =>
			one(`e${at}`, "exploit", 5 - at, [`G${at}`]),
		);
		// No franchise, person, keyword, explore or wildcard candidate exists.
		expect(fillSlots(pool, 7)).toHaveLength(7);
	});

	it("still takes the best of a strategy when it has several", () => {
		const pool = [
			one("weak", "exploit", 0.1, ["A"]),
			one("strong", "exploit", 9, ["B"]),
		];
		expect(fillSlots(pool, 1)[0]?.id).toBe("strong");
	});

	/**
	 * Guaranteeing the franchise strategy a seat must not mean guaranteeing
	 * three films of one series — every pick still pays the penalty for what is
	 * already placed. A close second of the same sort loses to a clear change
	 * of subject; a runaway favourite still wins, which is the point of a
	 * penalty rather than a ban.
	 */
	it("still spreads the row out across what things are about", () => {
		const close = [
			one("a", "exploit", 1, ["Drama"]),
			one("b", "exploit", 0.9, ["Drama"]),
			one("c", "exploit", 0.5, ["Comedy"]),
		];
		expect(fillSlots(close, 2).map((at) => at.id)).toEqual(["a", "c"]);

		const runaway = [
			one("a", "exploit", 5, ["Drama"]),
			one("b", "exploit", 4.9, ["Drama"]),
			one("c", "exploit", 1, ["Comedy"]),
		];
		expect(fillSlots(runaway, 2).map((at) => at.id)).toEqual(["a", "b"]);
	});

	it("never returns more than there is", () => {
		expect(fillSlots([one("a", "exploit", 1)], 7)).toHaveLength(1);
		expect(fillSlots([], 7)).toEqual([]);
	});

	/**
	 * A library four-fifths film got a row entirely of film, however many books
	 * and shows came back — the other kinds were always the eighth-best thing on
	 * it. The subject penalty could not fix this, because two films sharing
	 * nothing at all still share being films.
	 */
	it("makes room for another sort of thing", () => {
		const pool = [
			{ ...one("film1", "exploit", 1, ["Drama"]), family: "movie" },
			{ ...one("film2", "exploit", 0.95, ["Comedy"]), family: "movie" },
			{ ...one("film3", "exploit", 0.9, ["Horror"]), family: "movie" },
			{ ...one("book", "exploit", 0.6, ["Fantasy"]), family: "book" },
		];
		expect(fillSlots(pool, 3).map((at) => at.id)).toContain("book");
	});

	// Gentle, not a quota: a clearly better film still beats a mediocre book.
	it("does not seat a poor one of another sort over a good one", () => {
		const pool = [
			{ ...one("film1", "exploit", 5, ["Drama"]), family: "movie" },
			{ ...one("film2", "exploit", 4.8, ["Comedy"]), family: "movie" },
			{ ...one("book", "exploit", 0.1, ["Fantasy"]), family: "book" },
		];
		expect(fillSlots(pool, 2).map((at) => at.id)).toEqual(["film1", "film2"]);
	});

	/**
	 * A discount could not do this job, and it is worth being precise about why.
	 * The candidate best placed to shrug off a charge for having been seen is the
	 * one that keeps winning — so the titles that came back were exactly the
	 * titles you were most tired of.
	 */
	it("passes over what you were shown yesterday while anything else is left", () => {
		const pool = [
			{ ...one("seen", "exploit", 9, ["A"]), stale: true },
			{ ...one("fresh", "exploit", 0.1, ["B"]), stale: false },
		];
		expect(
			fillSlots(pool, 1, { held: (at) => at.stale }).map((at) => at.id),
		).toEqual(["fresh"]);
	});

	// A budgeted seat is a promise about the sort of pick that gets one, not
	// about that pick in particular.
	it("donates a budgeted seat rather than spending it on a repeat", () => {
		const pool = [
			{ ...one("sequel", "franchise", 5, ["A"]), stale: true },
			{ ...one("other", "explore", 1, ["B"]), stale: false },
		];
		expect(
			fillSlots(pool, 1, { held: (at) => at.stale }).map((at) => at.id),
		).toEqual(["other"]);
	});

	// Holding things back to keep the row moving is pointless once there is
	// nowhere left for it to move to.
	it("gives them back in order once nothing else is left", () => {
		const pool = [
			{ ...one("a", "exploit", 1, ["A"]), stale: true },
			{ ...one("b", "exploit", 2, ["B"]), stale: true },
		];
		expect(
			fillSlots(pool, 2, { held: (at) => at.stale }).map((at) => at.id),
		).toEqual(["b", "a"]);
	});

	it("lets a group take only the seats it is allowed", () => {
		const pool = [
			...Array.from({ length: 6 }, (_, at) => ({
				...one(`old${at}`, "exploit" as StrategyId, 9 - at, [`G${at}`]),
				group: "old" as string | undefined,
			})),
			{ ...one("new", "exploit", 0.1, ["Z"]), group: undefined },
		];
		const row = fillSlots(pool, 4, {
			quota: { of: (at) => at.group, max: 2 },
		});
		expect(row.filter((at) => at.group === "old")).toHaveLength(2);
		expect(row.map((at) => at.id)).toContain("new");
	});
});

describe("rankSuggestions", () => {
	const profile = taste([entry({ tags: ["Drama"], rating: 9, status: "Watched" })]);
	const pool = (...items: MediaItem[]) => pooled(items);

	const base = {
		limit: 8,
		owned: () => false,
		feedback: {} as FeedbackLog,
		now: NOW,
	};

	it("drops what you have already said no to", () => {
		const gone = item({ title: "No thanks" });
		const kept = item({ title: "Fine" });
		const feedback: FeedbackLog = {
			[`${gone.ref.providerId}:${gone.ref.id}`]: {
				verdict: "disliked",
				at: NOW.getTime(),
				kind: "movie",
				title: gone.title,
				tags: [],
				people: [],
			},
		};
		const shown = rankSuggestions(pool(gone, kept), profile, {
			...base,
			feedback,
		});
		expect(shown.map((at) => at.item.title)).toEqual(["Fine"]);
	});

	// Liking the look of something is not the same as having dealt with it.
	it("keeps one you liked, and remembers that you did", () => {
		const loved = item({ title: "Yes please" });
		const feedback: FeedbackLog = {
			[`${loved.ref.providerId}:${loved.ref.id}`]: {
				verdict: "liked",
				at: NOW.getTime(),
				kind: "movie",
				title: loved.title,
				tags: [],
				people: [],
			},
		};
		const shown = rankSuggestions(pool(loved), profile, { ...base, feedback });
		expect(shown[0]?.verdict).toBe("liked");
	});

	/**
	 * A row mostly made of things you have already said yes to has stopped being
	 * a recommendation and become a reading list. They stay eligible — a like is
	 * not a dismissal — but the reason to open the row is the part you have not
	 * seen yet.
	 */
	describe("things you have already thumbed up", () => {
		const liked = (title: string) => item({ title, tags: ["Drama"] });
		const loved = Array.from({ length: 5 }, (_, at) => liked(`Yes ${at}`));
		const feedback: FeedbackLog = Object.fromEntries(
			loved.map((one) => [
				`${one.ref.providerId}:${one.ref.id}`,
				{
					verdict: "liked" as const,
					at: NOW.getTime(),
					kind: "movie" as const,
					title: one.title,
					tags: ["Drama"],
					people: [],
				},
			]),
		);

		it("seats no more than a couple of them", () => {
			const fresh = Array.from({ length: 6 }, (_, at) =>
				item({ title: `New ${at}`, tags: ["Drama"] }),
			);
			const shown = rankSuggestions(pool(...loved, ...fresh), profile, {
				...base,
				limit: 7,
				feedback,
			});
			expect(
				shown.filter((one) => one.verdict === "liked").length,
			).toBeLessThanOrEqual(LIKED_SEATS);
		});

		it("puts one you have not seen first", () => {
			const shown = rankSuggestions(
				pool(loved[0] as MediaItem, item({ title: "New", tags: ["Drama"] })),
				profile,
				{ ...base, feedback },
			);
			expect(shown[0]?.item.title).toBe("New");
		});

		it("still shows them when there is nothing else to show", () => {
			const shown = rankSuggestions(pool(...loved), profile, {
				...base,
				feedback,
			});
			expect(shown.length).toBeGreaterThan(0);
		});
	});

	/**
	 * Seven films on a shelf that also holds books and shows was the row's own
	 * answer to "what about the other types": it had one.
	 */
	it("does not fill the whole row with one sort of thing", () => {
		const films = Array.from({ length: 8 }, (_, at) =>
			item({ title: `Film ${at}`, tags: ["Drama"] }),
		);
		const book = item({
			title: "A book",
			tags: ["Drama"],
			ref: { providerId: "openlibrary", kind: "book", id: "b1" },
		});
		const shown = rankSuggestions(pool(...films, book), profile, {
			...base,
			limit: 7,
		});
		expect(shown.map((at) => at.item.title)).toContain("A book");
	});

	/**
	 * `fillSlots` fills every seat it is given, so a thin pool used to put its
	 * worst answers on screen beside its best and the row was judged on all of
	 * them. Six good suggestions is a better row than seven.
	 */
	it("would rather show fewer than pad the row with what you avoid", () => {
		const avoided = taste([
			entry({ tags: ["Musical"], rating: 2, status: "Watched" }),
			entry({ tags: ["Musical"], rating: 1, status: "Watched" }),
			entry({ tags: ["Musical"], rating: 2, status: "Watched" }),
			entry({ tags: ["Thriller"], rating: 9, status: "Watched" }),
			entry({ tags: ["Thriller"], rating: 9, status: "Watched" }),
			entry({ tags: ["Thriller"], rating: 8, status: "Watched" }),
		]);
		const good = Array.from({ length: 4 }, (_, at) =>
			item({ title: `Good ${at}`, tags: ["Thriller"] }),
		);
		const bad = Array.from({ length: 4 }, (_, at) =>
			item({ title: `Bad ${at}`, tags: ["Musical"] }),
		);
		const shown = rankSuggestions(pool(...good, ...bad), avoided, {
			...base,
			limit: 8,
		});
		expect(shown.length).toBeLessThan(8);
		expect(shown.map((at) => at.item.title).join()).not.toContain("Bad");
	});

	/**
	 * "I want fresh things." What the row had was a decaying penalty worth about a
	 * strong genre affinity, which is nothing to the candidate that keeps winning
	 * — so a row opened twice in an evening was mostly the same row, and the
	 * suggestions it repeated were its most confident ones.
	 */
	describe("what it has drawn lately", () => {
		const key = (one: MediaItem) => `${one.ref.providerId}:${one.ref.id}`;
		const days = (n: number) => NOW.getTime() - n * 86_400_000;

		it("holds back yesterday's pick for one it has never drawn", () => {
			const seen = item({ title: "Again", tags: ["Drama"], rating: 9 });
			const never = item({ title: "Never shown", tags: ["Drama"] });
			const shown = rankSuggestions(pool(seen, never), profile, {
				...base,
				limit: 1,
				shown: { [key(seen)]: days(1) },
			});
			expect(shown.map((at) => at.item.title)).toEqual(["Never shown"]);
		});

		it("shows them again rather than showing you nothing", () => {
			const both = [item({ title: "One" }), item({ title: "Two" })];
			const shown = rankSuggestions(pool(...both), profile, {
				...base,
				shown: Object.fromEntries(both.map((at) => [key(at), days(1)])),
			});
			expect(shown).toHaveLength(2);
		});

		// Held out of the row for a few days, not struck off it: past the window
		// all that is left is a small charge a good suggestion can afford.
		it("lets one it drew a fortnight ago win again", () => {
			const old = item({ title: "Long enough ago", tags: ["Drama"], rating: 9 });
			const never = item({ title: "Never shown", tags: ["Drama"] });
			const shown = rankSuggestions(pool(old, never), profile, {
				...base,
				limit: 1,
				shown: { [key(old)]: days(14) },
			});
			expect(shown.map((at) => at.item.title)).toEqual(["Long enough ago"]);
		});
	});

	it("drops what is already on a shelf", () => {
		const owned = item({ title: "Have it" });
		const shown = rankSuggestions(pool(owned, item()), profile, {
			...base,
			owned: (at) => at.title === "Have it",
		});
		expect(shown.map((at) => at.item.title)).not.toContain("Have it");
	});

	it("leaves out what was stood aside this session", () => {
		const gone = item({ title: "Seen this row already" });
		const shown = rankSuggestions(pool(gone, item()), profile, {
			...base,
			skipped: new Set([`${gone.ref.providerId}:${gone.ref.id}`]),
		});
		expect(shown.map((at) => at.item.title)).not.toContain(gone.title);
	});

	it("never returns more than asked for", () => {
		const many = Array.from({ length: 20 }, () => item());
		expect(
			rankSuggestions(pool(...many), profile, { ...base, limit: 8 }),
		).toHaveLength(8);
	});
});

describe("feedback in the model", () => {
	const library = [
		entry({ tags: ["Horror"], rating: 7, status: "Watched" }),
		entry({ tags: ["Drama"], rating: 7, status: "Watched" }),
	];

	/**
	 * The one thing a vault cannot record. Every note is about something you
	 * chose, so a library alone can say what you like but never what the model
	 * keeps mistaking for what you like.
	 */
	it("learns from a thumbs-down on something never added", () => {
		const before = affinity(taste(library), "genre", "horror")?.score ?? 0;
		const after = affinity(
			taste(library, {
				"tmdb:99": {
					verdict: "disliked",
					at: NOW.getTime(),
					kind: "movie",
					title: "Some slasher",
					tags: ["Horror"],
					people: [],
				},
			}),
			"genre",
			"horror",
		);
		expect(after?.score ?? 0).toBeLessThan(before);
	});

	it("counts what it was trained on, so the page can say", () => {
		const profile = taste(library, {
			"tmdb:1": {
				verdict: "liked",
				at: NOW.getTime(),
				kind: "movie",
				title: "One",
				tags: ["Drama"],
				people: [],
			},
		});
		expect(profile.trained).toBe(1);
	});

	// A run of thumbs-up must not quietly raise the bar every note is judged by.
	it("does not move the baseline the library is measured against", () => {
		const plain = taste(library).baseline;
		const thumbed = taste(library, {
			"tmdb:1": {
				verdict: "liked",
				at: NOW.getTime(),
				kind: "movie",
				title: "One",
				tags: ["Drama"],
				people: [],
			},
			"tmdb:2": {
				verdict: "liked",
				at: NOW.getTime(),
				kind: "movie",
				title: "Two",
				tags: ["Drama"],
				people: [],
			},
		}).baseline;
		expect(thumbed).toBeCloseTo(plain, 10);
	});
});
