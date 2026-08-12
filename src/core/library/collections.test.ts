import { describe, expect, it } from "vitest";
import { defaultLibraryConfig } from "./config";
import {
	admits,
	collectionCounts,
	collectionMembers,
	collectionNames,
	emptyCollection,
	isMember,
	normalizeCollections,
	qualifying,
	trespassers,
	withCollection,
	withoutCollection,
	withRenamed,
	type CollectionDef,
} from "./collections";
import type { LibraryEntry } from "./entry";
import type { RuleGroup } from "./rules";

const config = defaultLibraryConfig();
const now = new Date("2026-08-12T12:00:00Z");

function entry(
	title: string,
	overrides: Partial<LibraryEntry> = {},
): LibraryEntry {
	return {
		path: `Media/${title}.md`,
		basename: title,
		title,
		kind: "movie",
		tags: [],
		people: [],
		authored: [],
		favorite: false,
		history: [],
		episodeLog: {},
		collections: [],
		created: 0,
		modified: 0,
		frontmatter: {},
		...overrides,
	};
}

const scifi: RuleGroup = {
	match: "all",
	conditions: [{ field: "genre", op: "has", value: "science fiction" }],
	groups: [],
};

function collection(overrides: Partial<CollectionDef> = {}): CollectionDef {
	return { ...emptyCollection("Sci-fi night", now), ...overrides };
}

describe("membership", () => {
	// The property is typed by hand as often as it is written by Scout, so the
	// casing in the note is nobody's promise.
	it("matches the name however the note spelled it", () => {
		const note = entry("Arrival", { collections: ["sci-fi NIGHT"] });
		expect(isMember(note, collection())).toBe(true);
	});

	it("adds without duplicating and removes without disturbing the rest", () => {
		const note = entry("Arrival", { collections: ["Comfort", "sci-fi night"] });
		expect(withCollection(note, collection())).toEqual([
			"Comfort",
			"sci-fi night",
		]);
		expect(withoutCollection(note, collection())).toEqual(["Comfort"]);
		expect(withCollection(entry("Dune"), collection())).toEqual([
			"Sci-fi night",
		]);
	});

	it("counts and lists what the vault mentions", () => {
		const entries = [
			entry("Arrival", { collections: ["Sci-fi night"] }),
			entry("Dune", { collections: ["Sci-fi night", "Owned on disc"] }),
		];
		expect(collectionMembers(entries, collection())).toHaveLength(2);
		expect(collectionCounts(entries).get("sci-fi night")).toBe(2);
		// A name nobody defined is still a collection for the purpose of
		// finding the notes that claim it.
		expect(collectionNames(entries, [collection()])).toEqual([
			"Sci-fi night",
			"Owned on disc",
		]);
	});
});

describe("admits", () => {
	const scifiFilm = entry("Arrival", { tags: ["Science Fiction"] });
	const crime = entry("Heat", { tags: ["Crime"] });

	// A manual collection is a list of things somebody liked together, with
	// nothing to say about what belongs — including when a rule is sitting
	// there unused from the last time it was smart.
	it("takes anything into a manual collection", () => {
		expect(admits(crime, collection(), config, now)).toBe(true);
		expect(admits(crime, collection({ rule: scifi }), config, now)).toBe(true);
	});

	// A smart one is also a doorman: a set that says "science fiction" and
	// holds a crime film is a set that lies.
	it("refuses what a smart collection's rule excludes", () => {
		const smart = collection({ rule: scifi, auto: true });
		expect(admits(scifiFilm, smart, config, now)).toBe(true);
		expect(admits(crime, smart, config, now)).toBe(false);
	});
});

describe("trespassers", () => {
	// Tightening a rule must not throw anybody out: membership is written in
	// the note, and a changed condition is not permission to edit somebody's
	// picks. They are reported so the dialog can offer the removal.
	it("names the members that would no longer be let in", () => {
		const entries = [
			entry("Arrival", { tags: ["Science Fiction"], collections: ["Sci-fi night"] }),
			entry("Heat", { tags: ["Crime"], collections: ["Sci-fi night"] }),
			entry("Dune", { tags: ["Science Fiction"] }),
		];
		const smart = collection({ rule: scifi, auto: true });
		const out = trespassers(entries, smart, config, now);
		expect(out.map((e) => e.title)).toEqual(["Heat"]);
		// A manual one has no door to be on the wrong side of.
		expect(trespassers(entries, collection(), config, now)).toEqual([]);
		expect(
			trespassers(entries, collection({ rule: scifi }), config, now),
		).toEqual([]);
	});
});

describe("qualifying", () => {
	const entries = [
		entry("Arrival", { tags: ["Science Fiction"] }),
		entry("Dune", { tags: ["Science Fiction"], collections: ["Sci-fi night"] }),
		entry("Heat", { tags: ["Crime"] }),
	];

	it("says nothing until the collection is told to fill itself", () => {
		expect(qualifying(entries, collection({ rule: scifi }), config, now)).toEqual(
			[],
		);
		expect(
			qualifying(entries, collection({ auto: true }), config, now),
		).toEqual([]);
	});

	it("returns what matches and is not already in", () => {
		const pending = qualifying(
			entries,
			collection({ auto: true, rule: scifi }),
			config,
			now,
		);
		expect(pending.map((e) => e.title)).toEqual(["Arrival"]);
	});

	// The whole reason removals are recorded: a standing order that undoes your
	// own edit is an argument you cannot win.
	it("leaves out what you took out by hand", () => {
		const pending = qualifying(
			entries,
			collection({
				auto: true,
				rule: scifi,
				excluded: ["Media/Arrival.md"],
			}),
			config,
			now,
		);
		expect(pending).toEqual([]);
	});
});

describe("normalizeCollections", () => {
	it("keeps what it can read and drops what it cannot", () => {
		const out = normalizeCollections([
			{ id: "a", name: "Sci-fi night", rule: scifi, auto: true },
			{ name: "   " },
			"nonsense",
			// The name is the membership token, so a second one of the same
			// name would be a collection whose contents belong to another.
			{ id: "b", name: "SCI-FI NIGHT" },
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.name).toBe("Sci-fi night");
		expect(out[0]?.icon).toBe("layers");
		expect(out[0]?.excluded).toEqual([]);
	});

	it("makes nothing out of nothing", () => {
		expect(normalizeCollections(undefined)).toEqual([]);
		expect(normalizeCollections({})).toEqual([]);
	});
});

describe("withRenamed", () => {
	// The bug this exists for: the name is the membership token, so renaming
	// the definition alone leaves every member naming a collection that no
	// longer exists — which looks exactly like the rename having emptied it.
	it("carries the notes along, keeping the order and the other names", () => {
		const note = entry("Heat", {
			collections: ["Crime night", "Bond, in order", "Owned on disc"],
		});
		expect(withRenamed(note, "Bond, in order", "The Bond run")).toEqual([
			"Crime night",
			"The Bond run",
			"Owned on disc",
		]);
	});

	it("matches however the note spelled it", () => {
		const note = entry("Heat", { collections: ["bond, IN order"] });
		expect(withRenamed(note, "Bond, in order", "Bond")).toEqual(["Bond"]);
	});

	it("leaves a note that was never in it exactly as it was", () => {
		const note = entry("Heat", { collections: ["Crime night"] });
		expect(withRenamed(note, "Bond", "The Bond run")).toEqual(["Crime night"]);
	});

	// Renaming onto a name the note already carries — typed by hand — must not
	// leave it holding the same collection twice.
	it("does not double up when the new name is already there", () => {
		const note = entry("Heat", { collections: ["Crime night", "Crime"] });
		expect(withRenamed(note, "Crime", "Crime night")).toEqual(["Crime night"]);
	});
});
