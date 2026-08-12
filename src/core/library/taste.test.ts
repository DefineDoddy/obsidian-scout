import { describe, expect, it } from "vitest";
import { entry, NOW, opinionated, testConfig } from "../../test/fixtures";
import {
	affinity,
	buildTaste,
	candidateOf,
	entrySignal,
	kindShare,
	rankDiverse,
	scoreCandidate,
	topTraits,
} from "./taste";

const config = testConfig();

describe("entrySignal", () => {
	it("has nothing to say about something you have not started", () => {
		expect(entrySignal(config, entry({ status: "To watch" }), NOW)).toBeNull();
	});

	// Most libraries are mostly unrated; reading only the scores would throw
	// away the majority of what is actually recorded.
	it("reads a finish and a drop as opinions of their own", () => {
		const done = entrySignal(config, entry({ status: "Watched" }), NOW);
		const gone = entrySignal(config, entry({ status: "Dropped" }), NOW);
		expect(done?.value).toBeGreaterThan(0.5);
		expect(gone?.value).toBeLessThan(0.3);
	});

	it("trusts a score you typed more than a status it inferred", () => {
		const typed = entrySignal(config, entry({ rating: 8 }), NOW);
		const guessed = entrySignal(config, entry({ status: "Watched" }), NOW);
		expect(typed?.weight).toBeGreaterThan(guessed?.weight ?? 0);
	});

	// Taste moves, but a favourite from years ago is still a favourite.
	it("weighs a recent finish above an old one, without silencing it", () => {
		const fresh = entrySignal(
			config,
			entry({ rating: 8, finished: "2026-07-01" }),
			NOW,
		);
		const old = entrySignal(
			config,
			entry({ rating: 8, finished: "2014-01-01" }),
			NOW,
		);
		expect(fresh?.weight).toBeGreaterThan(old?.weight ?? 0);
		expect(old?.weight).toBeGreaterThan(0.2);
	});

	/**
	 * The star used to be added twice to a note the status branches did not
	 * catch — once inside the favourite branch and again on the way out. So a
	 * note carrying nothing but a star outranked a considered nine out of ten,
	 * which is the one thing a ratings model must never do.
	 */
	it("counts a favourite once, not twice", () => {
		const starred = entry({ favorite: true });
		const finished = entry({ status: "Watched" });
		const typed = entry({ rating: 9, status: "Watched" });
		const value = (at: typeof starred) => entrySignal(config, at, NOW)?.value ?? 0;

		expect(value(starred)).toBeGreaterThan(value(finished));
		expect(value(starred)).toBeLessThan(value(typed));
	});

	// The loudest endorsement a library holds, and it was being read as silence.
	it("weighs something you went back to above something you saw once", () => {
		const again = entrySignal(
			config,
			entry({
				rating: 8,
				status: "Watched",
				history: ["2021-01-01", "2023-01-01"],
			}),
			NOW,
		);
		const once = entrySignal(config, entry({ rating: 8, status: "Watched" }), NOW);
		expect(again?.value).toBeGreaterThan(once?.value ?? 0);
		expect(again?.weight).toBeGreaterThan(once?.weight ?? 0);
	});

	// Staying with something for thirty episodes is an opinion about it.
	it("has an opinion about a series you are a long way into", () => {
		const deep = entry({
			kind: "tv",
			status: "Watching",
			progress: 30,
			progressTotal: 40,
		});
		const barely = entry({
			kind: "tv",
			status: "Watching",
			progress: 1,
			progressTotal: 40,
		});
		expect(entrySignal(config, deep, NOW)?.value).toBeGreaterThan(0.5);
		expect(entrySignal(config, barely, NOW)).toBeNull();
	});

	// Both are "dropped" and they mean opposite things.
	it("tells giving up early apart from giving up near the end", () => {
		const early = entrySignal(
			config,
			entry({ status: "Dropped", progress: 1, progressTotal: 20 }),
			NOW,
		);
		const late = entrySignal(
			config,
			entry({ status: "Dropped", progress: 18, progressTotal: 20 }),
			NOW,
		);
		expect(late?.value).toBeGreaterThan(early?.value ?? 1);
		expect(late?.value).toBeLessThan(0.5);
	});

	it("reads the episodes you scored when you never scored the series", () => {
		const logged = entry({
			kind: "tv",
			status: "Watching",
			episodeLog: { S01E01: { rating: 9 }, S01E02: { rating: 8 } },
		});
		expect(entrySignal(config, logged, NOW)?.value).toBeGreaterThan(0.7);
	});

	// One marked-up episode is a note about an episode, not a verdict on a show.
	it("does not take a single episode note as a verdict", () => {
		const one = entry({
			kind: "tv",
			status: "To watch",
			episodeLog: { S01E01: { rating: 9 } },
		});
		expect(entrySignal(config, one, NOW)).toBeNull();
	});
});

describe("buildTaste", () => {
	it("separates what you like from what you merely watch", () => {
		const taste = buildTaste(config, opinionated(), NOW);
		const sci = affinity(taste, "genre", "science fiction");
		const romance = affinity(taste, "genre", "romance");
		expect(sci?.score).toBeGreaterThan(0);
		expect(romance?.score).toBeLessThan(0);
		expect(sci?.count).toBe(3);
	});

	/**
	 * The heart of it. One 10 for the only western you have seen is not
	 * evidence that you love westerns, and a recommender that treats it as such
	 * spends its first suggestion on a fluke.
	 */
	it("holds back on a genre it has only seen once", () => {
		const once = buildTaste(
			config,
			[
				entry({ tags: ["Western"], rating: 10, status: "Watched" }),
				...opinionated(),
			],
			NOW,
		);
		const western = affinity(once, "genre", "western");
		const sci = affinity(once, "genre", "science fiction");
		expect(western?.score).toBeGreaterThan(0);
		expect(western?.score).toBeLessThan(sci?.score ?? 0);
	});

	it("measures against your own average, not against the middle", () => {
		// Somebody who marks everything 7 or 8 likes the 8s.
		const generous = buildTaste(
			config,
			[
				entry({ tags: ["Drama"], rating: 8, status: "Watched" }),
				entry({ tags: ["Drama"], rating: 8, status: "Watched" }),
				entry({ tags: ["Comedy"], rating: 7, status: "Watched" }),
				entry({ tags: ["Comedy"], rating: 7, status: "Watched" }),
			],
			NOW,
		);
		expect(affinity(generous, "genre", "drama")?.score).toBeGreaterThan(0);
		expect(affinity(generous, "genre", "comedy")?.score).toBeLessThan(0);
	});

	/**
	 * People rate by kind. Someone generous about films and hard on books was
	 * having every book trait dragged below zero by the films, which says
	 * nothing about books and quietly emptied that half of the row.
	 */
	it("judges each shelf against its own average", () => {
		const taste = buildTaste(
			config,
			[
				entry({ kind: "movie", tags: ["Thriller"], rating: 9, status: "Watched" }),
				entry({ kind: "movie", tags: ["Thriller"], rating: 9, status: "Watched" }),
				entry({ kind: "movie", tags: ["Thriller"], rating: 8, status: "Watched" }),
				entry({ kind: "book", tags: ["Memoir"], rating: 6, status: "Read" }),
				entry({ kind: "book", tags: ["Memoir"], rating: 6, status: "Read" }),
				entry({ kind: "book", tags: ["Cookery"], rating: 3, status: "Read" }),
				entry({ kind: "book", tags: ["Cookery"], rating: 3, status: "Read" }),
			],
			NOW,
		);
		// Memoir is this reader's best book by a mile. Against an average pulled
		// up by the films it reads as a disappointment.
		expect(affinity(taste, "genre", "memoir")?.score ?? 0).toBeGreaterThan(0);
		expect(affinity(taste, "genre", "cookery")?.score ?? 0).toBeLessThan(0);
	});

	// A to-read pile is an intention, not a preference.
	it("ignores a backlog you have never started when deciding what you watch", () => {
		const shelf = Array.from({ length: 20 }, () =>
			entry({ kind: "book", status: "To read" }),
		);
		const taste = buildTaste(
			config,
			[
				entry({ kind: "movie", rating: 9, status: "Watched" }),
				entry({ kind: "movie", rating: 8, status: "Watched" }),
				...shelf,
			],
			NOW,
		);
		expect(taste.kinds.get("book")?.owned).toBe(20);
		expect(taste.kinds.get("book")?.engaged).toBe(0);
		expect(kindShare(taste, "movie")).toBeGreaterThan(kindShare(taste, "book"));
	});

	/**
	 * The same two pieces of evidence, one about a name and one about a genre.
	 * Two films by one director is a pattern; two films sharing "Western" is a
	 * coincidence, and the priors are what encode the difference.
	 */
	it("believes a director sooner than it believes a genre", () => {
		const twice = [
			entry({
				tags: ["Western"],
				people: ["Some Director"],
				authored: ["Some Director"],
				rating: 10,
				status: "Watched",
			}),
			entry({
				tags: ["Western"],
				people: ["Some Director"],
				authored: ["Some Director"],
				rating: 10,
				status: "Watched",
			}),
		];
		const profile = buildTaste(config, [...twice, ...opinionated()], NOW);
		const director = affinity(profile, "director", "Some Director")?.score ?? 0;
		const genre = affinity(profile, "genre", "western")?.score ?? 0;
		expect(director).toBeGreaterThan(genre);
		expect(genre).toBeGreaterThan(0);
	});

	it("starts from nothing without dividing by it", () => {
		const empty = buildTaste(config, [], NOW);
		expect(empty.sampled).toBe(0);
		expect(Number.isFinite(empty.baseline)).toBe(true);
		expect(
			scoreCandidate(empty, { kind: "movie", tags: [], people: [] }).score,
		).toBeCloseTo(0, 5);
	});
});

describe("scoreCandidate", () => {
	const taste = buildTaste(
		config,
		[
			...opinionated(),
			entry({
				tags: ["Science Fiction"],
				people: ["Denis Villeneuve"],
				rating: 10,
				status: "Watched",
			}),
			entry({
				tags: ["Drama"],
				people: ["Denis Villeneuve"],
				rating: 9,
				status: "Watched",
			}),
		],
		NOW,
	);

	it("prefers the genre you rate highly", () => {
		const good = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Science Fiction"],
			people: [],
		});
		const bad = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Romance"],
			people: [],
		});
		expect(good.score).toBeGreaterThan(bad.score);
	});

	it("counts a name you keep coming back to", () => {
		const withName = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Thriller"],
			people: ["Denis Villeneuve"],
		});
		const without = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Thriller"],
			people: ["Nobody In Particular"],
		});
		expect(withName.score).toBeGreaterThan(without.score);
		expect(withName.reasons.map((one) => one.label)).toContain(
			"Denis Villeneuve",
		);
	});

	// A 6.8 is the average film. It is not a recommendation, and it should move
	// the score no further than having no score at all does.
	it("treats an average source score as saying nothing", () => {
		const plain = { kind: "movie" as const, tags: [], people: [] };
		const unscored = scoreCandidate(taste, plain).score;
		const average = scoreCandidate(taste, { ...plain, sourceRating: 6.5 }).score;
		const acclaimed = scoreCandidate(taste, { ...plain, sourceRating: 8.5 }).score;
		expect(average).toBeCloseTo(unscored, 5);
		expect(acclaimed).toBeGreaterThan(average);
	});

	/**
	 * Only the top few names of each sort reach the score. Sorting them by how
	 * *positive* they were and slicing meant a candidate carrying three mild
	 * likes and one strong dislike kept the likes and dropped the dislike — so
	 * the model could see everything you go for and nothing you avoid, on
	 * exactly the candidates where avoiding it mattered.
	 */
	it("counts what you avoid as loudly as what you go for", () => {
		const profile = buildTaste(
			config,
			[
				...opinionated(),
				entry({ tags: ["Thriller"], rating: 7, status: "Watched" }),
				entry({ tags: ["Thriller"], rating: 7, status: "Watched" }),
				entry({ tags: ["Crime"], rating: 7, status: "Watched" }),
				entry({ tags: ["Crime"], rating: 7, status: "Watched" }),
				entry({ tags: ["Mystery"], rating: 7, status: "Watched" }),
				entry({ tags: ["Mystery"], rating: 7, status: "Watched" }),
			],
			NOW,
		);
		const mild = ["Thriller", "Crime", "Mystery"];
		const clean = scoreCandidate(profile, {
			kind: "movie",
			tags: mild,
			people: [],
		});
		const tainted = scoreCandidate(profile, {
			kind: "movie",
			tags: [...mild, "Romance"],
			people: [],
		});
		expect(tainted.score).toBeLessThan(clean.score);
	});

	/**
	 * A source's average is on that source's terms. Against TMDB's prior of two
	 * hundred and fifty votes, Open Library's forty-odd ratings shrank every
	 * book to almost exactly nothing — books were losing the row to arithmetic
	 * rather than to taste.
	 */
	it("does not hold a book's handful of ratings against it", () => {
		const profile = buildTaste(config, opinionated(), NOW);
		const shape = {
			kind: "book" as const,
			tags: [],
			people: [],
			sourceRating: 8.4,
			ratingCount: 45,
		};
		const asBook = scoreCandidate(profile, {
			...shape,
			providerId: "openlibrary",
		});
		const asFilm = scoreCandidate(profile, { ...shape, providerId: "tmdb" });
		expect(asBook.score).toBeGreaterThan(asFilm.score);
	});

	/**
	 * Everything that had something to say, for and against. Which of them a
	 * card has room for is `rankReasons`' problem; the dialog wants all of it,
	 * including the marks against, which is why they are kept rather than
	 * filtered out here.
	 */
	it("says why, and says what it is holding against it", () => {
		const verdict = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Science Fiction", "Romance"],
			people: ["Denis Villeneuve"],
		});
		const forIt = verdict.reasons.filter((one) => !one.against);
		const against = verdict.reasons.filter((one) => one.against);

		expect(forIt.map((one) => one.label)).toContain("Denis Villeneuve");
		expect(forIt.map((one) => one.label)).toContain("Science Fiction");
		expect(forIt.map((one) => one.label)).not.toContain("Romance");
		expect(against.map((one) => one.label)).toContain("Romance");
	});

	it("names each reason as the sort of thing it is", () => {
		const verdict = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Science Fiction"],
			people: ["Denis Villeneuve"],
		});
		expect(verdict.reasons.find((one) => one.kind === "person")?.label).toBe(
			"Denis Villeneuve",
		);
		expect(verdict.reasons.find((one) => one.kind === "genre")?.label).toBe(
			"Science Fiction",
		);
	});

	it("scores a library note through the same door", () => {
		const note = entry({ tags: ["Science Fiction"], sourceRating: 8 });
		expect(scoreCandidate(taste, candidateOf(note)).score).toBeGreaterThan(0);
	});

	/**
	 * "Unknown is not disliked" is the right rule for one trait and the wrong
	 * rule for a whole candidate. Dropping every unrecognised trait meant a film
	 * the library had never met anything about scored zero — level with one whose
	 * known traits cancelled out, and ahead of one carrying a mild dislike. So the
	 * row filled with titles the model had no opinion about at all and then
	 * explained them with "well liked at the source".
	 */
	it("prefers something it recognises to something it has never met", () => {
		const known = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Science Fiction"],
			people: [],
		});
		const stranger = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Kabuki"],
			people: ["Nobody At All"],
		});
		expect(known.score).toBeGreaterThan(stranger.score);
	});

	it("holds a stranger's own rating against nothing", () => {
		// The cost is about the profile having had no say, not about the title
		// being bad, so a well-regarded stranger still out-scores a poor one.
		const good = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Kabuki"],
			people: [],
			sourceRating: 8.4,
			ratingCount: 40_000,
			providerId: "tmdb",
		});
		const poor = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Kabuki"],
			people: [],
			sourceRating: 4.1,
			ratingCount: 40_000,
			providerId: "tmdb",
		});
		expect(good.score).toBeGreaterThan(poor.score);
	});

	// Separated so a floor can be put under one without putting it under both:
	// three of your favourites pointing at a musical you hate is a good
	// suggestion by every measure except the one that matters.
	it("reports what the profile thought apart from everything else", () => {
		const verdict = scoreCandidate(taste, {
			kind: "movie",
			tags: ["Romance"],
			people: [],
			sourceRating: 9.2,
			ratingCount: 200_000,
			providerId: "tmdb",
		});
		expect(verdict.fit).toBeLessThan(0);
		expect(verdict.score).toBeGreaterThan(verdict.fit);
	});
});

describe("topTraits", () => {
	const profile = buildTaste(config, opinionated(), NOW);

	it("names what you go for, strongest first", () => {
		const liked = topTraits(profile, "genre", 3);
		expect(liked[0]?.label).toBe("Science Fiction");
		expect(liked.map((one) => one.label)).not.toContain("Romance");
	});

	// The same number read from the other end, not a different question.
	it("names what you avoid by walking the same list backwards", () => {
		const avoided = topTraits(profile, "genre", 3, "disliked");
		expect(avoided[0]?.label).toBe("Romance");
		expect(avoided.map((one) => one.label)).not.toContain("Science Fiction");
	});

	it("says how much of your library each one was learned from", () => {
		expect(topTraits(profile, "genre", 1)[0]?.affinity.count).toBe(3);
	});

	it("keeps the spelling you used, not the folded key", () => {
		expect(topTraits(profile, "genre", 1)[0]?.label).toBe("Science Fiction");
	});

	/**
	 * The bug that killed two strategies and one panel.
	 *
	 * Every caller wanted "the top few backed by more than one title" and wrote
	 * `topTraits(…, 6).filter(count >= 2)` — which slices first. On a library
	 * with hundreds of harvested keywords the top few by score are inevitably
	 * one-off flukes, so every one of them was filtered away afterwards and the
	 * answer was reliably nothing at all. The keyword and director strategies
	 * both went silent, and "What you go for" came out blank on a library of a
	 * hundred and thirty rated titles.
	 */
	it("looks past a one-off fluke to find something corroborated", () => {
		// A dozen things seen once and loved, one thing seen twice and enjoyed,
		// and a heap of ordinary viewing to put an average under them. Shrinkage
		// alone cannot save the second: one 10 out of ten has a bigger gap from
		// your average than two 7s do, however much more the two are worth.
		const flukes = Array.from({ length: 12 }, (_, at) =>
			entry({ tags: [`Only Once ${at}`], rating: 10, status: "Watched" }),
		);
		const ballast = Array.from({ length: 20 }, () =>
			entry({ tags: ["Ordinary"], rating: 3, status: "Watched" }),
		);
		const twice = [
			entry({ tags: ["Twice Over"], rating: 7, status: "Watched" }),
			entry({ tags: ["Twice Over"], rating: 7, status: "Watched" }),
		];
		const wide = buildTaste(config, [...flukes, ...ballast, ...twice], NOW);

		expect(topTraits(wide, "genre", 3).map((one) => one.label)).not.toContain(
			"Twice Over",
		);
		expect(
			topTraits(wide, "genre", 3, "liked", 2).map((one) => one.label),
		).toContain("Twice Over");
	});
});

describe("rankDiverse", () => {
	/**
	 * Six of the same genre is a worse list than five plus one, even when the
	 * sixth scores higher than the one — which is the whole reason this is not
	 * a plain sort.
	 */
	it("does not fill the row with one genre", () => {
		const items = [
			{ id: "a", score: 1.0, tags: ["Sci-Fi"] },
			{ id: "b", score: 0.9, tags: ["Sci-Fi"] },
			{ id: "c", score: 0.8, tags: ["Sci-Fi"] },
			{ id: "d", score: 0.5, tags: ["Comedy"] },
		];
		const picked = rankDiverse(items, (at) => at, 3).map((at) => at.id);
		expect(picked[0]).toBe("a");
		expect(picked).toContain("d");
	});

	it("still takes the best one first", () => {
		const items = [
			{ id: "low", score: 0.1, tags: ["A"] },
			{ id: "high", score: 2, tags: ["B"] },
		];
		expect(rankDiverse(items, (at) => at, 1)[0]?.id).toBe("high");
	});

	it("never returns more than there is", () => {
		expect(rankDiverse([{ score: 1, tags: [] }], (at) => at, 9)).toHaveLength(1);
	});
});
