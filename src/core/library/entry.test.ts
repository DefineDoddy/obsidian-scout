import { describe, expect, it } from "vitest";
import { defaultLibraryConfig, type LibraryConfig } from "./config";
import {
	buildEntry,
	resolveKind,
	sameEntry,
	type NoteSource,
} from "./entry";

/** A note as the metadata cache hands it over. */
function note(
	frontmatter: Record<string, unknown> | undefined,
	overrides: Partial<NoteSource> = {},
): NoteSource {
	return {
		path: "Media/Movies/Arrival.md",
		basename: "Arrival",
		created: 1000,
		modified: 2000,
		frontmatter,
		...overrides,
	};
}

const config = defaultLibraryConfig();

describe("buildEntry", () => {
	it("reads a note created from the built-in movie template", () => {
		const entry = buildEntry(
			config,
			note({
				title: "Arrival",
				type: "movie",
				status: "Watched",
				rating: 4.5,
				tmdb_rating: 7.6,
				genres: ["Drama", "Science Fiction"],
				release_date: "2016-11-10",
				cover: "https://example.test/arrival.jpg",
				source: "tmdb",
				scout_id: "329865",
			}),
		);

		expect(entry).not.toBeNull();
		expect(entry?.title).toBe("Arrival");
		expect(entry?.kind).toBe("movie");
		expect(entry?.status).toBe("Watched");
		expect(entry?.rating).toBe(4.5);
		// The template writes the source's own score under its own name, which
		// is what an unrated card shows instead of nothing.
		expect(entry?.sourceRating).toBe(7.6);
		expect(entry?.year).toBe(2016);
		expect(entry?.tags).toEqual(["Drama", "Science Fiction"]);
		expect(entry?.ref).toEqual({
			providerId: "tmdb",
			kind: "movie",
			id: "329865",
		});
	});

	it("keeps your rating and the source's apart", () => {
		const entry = buildEntry(
			config,
			note({ type: "book", source_rating: 8.2 }),
		);
		expect(entry?.rating).toBeUndefined();
		expect(entry?.sourceRating).toBe(8.2);
	});

	it("reads how far into a series a note is", () => {
		const entry = buildEntry(
			config,
			note({
				type: "tv",
				current_episode: "S02E05",
				episode_log: { S01E01: 9, "2x03": { rating: 7, note: "the boat one" } },
			}),
		);

		expect(entry?.currentEpisode).toEqual({ season: 2, episode: 5 });
		expect(entry?.episodeLog).toEqual({
			S01E01: { rating: 9 },
			S02E03: { rating: 7, note: "the boat one" },
		});
	});

	it("reads the dates of earlier times through", () => {
		const entry = buildEntry(
			config,
			note({
				type: "book",
				finished: "2026-01-01",
				history: ["2020-03-04", "2023-07-09"],
			}),
		);

		expect(entry?.history).toEqual(["2020-03-04", "2023-07-09"]);
		expect(entry?.finished).toBe("2026-01-01");
	});

	it("leaves the series fields empty on a note that has none", () => {
		const entry = buildEntry(config, note({ type: "movie" }));
		expect(entry?.history).toEqual([]);
		expect(entry?.episodeLog).toEqual({});
		expect(entry?.currentEpisode).toBeUndefined();
	});

	it("ignores notes with no frontmatter or no recognizable type", () => {
		expect(buildEntry(config, note(undefined))).toBeNull();
		expect(buildEntry(config, note({ title: "Shopping list" }))).toBeNull();
		expect(buildEntry(config, note({ type: "recipe" }))).toBeNull();
	});

	it("matches property names whatever case they were typed in", () => {
		const entry = buildEntry(
			config,
			note({ Type: "Movie", Status: "Watching", Rating: 3 }),
		);
		expect(entry?.kind).toBe("movie");
		expect(entry?.status).toBe("Watching");
		expect(entry?.rating).toBe(3);
	});

	it("falls back to the common alternatives for read-only fields", () => {
		const entry = buildEntry(
			config,
			note({
				type: "book",
				poster: "covers/dune.jpg",
				overview: "A boy, a desert, a worm.",
				author: "Frank Herbert",
			}),
		);
		expect(entry?.cover).toBe("covers/dune.jpg");
		expect(entry?.description).toBe("A boy, a desert, a worm.");
		expect(entry?.people).toEqual(["Frank Herbert"]);
	});

	it("falls back to the filename when there is no title", () => {
		expect(buildEntry(config, note({ type: "movie" }))?.title).toBe("Arrival");
	});

	it("unwraps wikilinks and hashes in lists", () => {
		const entry = buildEntry(
			config,
			note({
				type: "movie",
				genres: ["#sci-fi", "[[Drama]]"],
				people: "[[Denis Villeneuve|Denis]], Amy Adams",
			}),
		);
		expect(entry?.tags).toEqual(["sci-fi", "Drama"]);
		expect(entry?.people).toEqual(["Denis Villeneuve", "Amy Adams"]);
	});

	it("reads a rating that was written as prose", () => {
		expect(buildEntry(config, note({ type: "movie", rating: "8/10" }))?.rating)
			.toBe(8);
	});

	it("finds a progress total under any of the configured properties", () => {
		const entry = buildEntry(
			config,
			note({ type: "tv", progress: 12, number_of_episodes: 62 }),
		);
		expect(entry?.progress).toBe(12);
		expect(entry?.progressTotal).toBe(62);
	});

	it("treats several spellings of yes as a favourite", () => {
		for (const value of [true, "true", "yes", 1]) {
			expect(
				buildEntry(config, note({ type: "movie", favorite: value }))
					?.favorite,
			).toBe(true);
		}
		expect(
			buildEntry(config, note({ type: "movie", favorite: false }))?.favorite,
		).toBe(false);
	});

	it("has no source ref when the note does not record one", () => {
		expect(buildEntry(config, note({ type: "movie" }))?.ref).toBeUndefined();
	});
});

describe("resolveKind", () => {
	it("accepts the kind id, its label, and its aliases", () => {
		expect(resolveKind(config, "tv")).toBe("tv");
		expect(resolveKind(config, "TV show")).toBe("tv");
		expect(resolveKind(config, "series")).toBe("tv");
		expect(resolveKind(config, "Film")).toBe("movie");
	});

	it("honours an alias the user added", () => {
		const custom: LibraryConfig = {
			...config,
			kindAliases: { ...config.kindAliases, game: "game, rom, cartridge" },
		};
		expect(resolveKind(custom, "cartridge")).toBe("game");
	});

	it("still recognizes the kind id after the aliases are emptied", () => {
		const stripped: LibraryConfig = {
			...config,
			kindAliases: { ...config.kindAliases, movie: "" },
		};
		expect(resolveKind(stripped, "movie")).toBe("movie");
		expect(resolveKind(stripped, "film")).toBeNull();
	});

	it("rejects anything it does not know", () => {
		expect(resolveKind(config, "")).toBeNull();
		expect(resolveKind(config, undefined)).toBeNull();
		expect(resolveKind(config, "meeting note")).toBeNull();
	});
});

describe("sameEntry", () => {
	const front = {
		title: "Arrival",
		type: "movie",
		status: "Watched",
		rating: 4.5,
		genres: ["Drama", "Science Fiction"],
	};
	const parse = (
		frontmatter: Record<string, unknown>,
		overrides: Partial<NoteSource> = {},
	) => {
		const entry = buildEntry(config, note(frontmatter, overrides));
		if (!entry) throw new Error("expected an entry");
		return entry;
	};

	it("calls two readings of an unchanged note the same", () => {
		// Two objects, never the same reference: this is the case the index
		// leans on to drop the re-parses that change nothing.
		expect(sameEntry(parse({ ...front }), parse({ ...front }))).toBe(true);
	});

	it("notices a field the library shows", () => {
		expect(sameEntry(parse(front), parse({ ...front, rating: 5 }))).toBe(
			false,
		);
		expect(
			sameEntry(parse(front), parse({ ...front, status: "Watching" })),
		).toBe(false);
	});

	it("notices a reordered list", () => {
		const swapped = { ...front, genres: ["Science Fiction", "Drama"] };
		expect(sameEntry(parse(front), parse(swapped))).toBe(false);
	});

	it("notices a property only a custom field would read", () => {
		expect(sameEntry(parse(front), parse({ ...front, shelf: "Loft" }))).toBe(
			false,
		);
		expect(
			sameEntry(
				parse({ ...front, shelf: "Loft" }),
				parse({ ...front, shelf: "Attic" }),
			),
		).toBe(false);
	});

	it("notices the file being touched", () => {
		expect(
			sameEntry(parse(front), parse(front, { modified: 9000 })),
		).toBe(false);
	});
});
