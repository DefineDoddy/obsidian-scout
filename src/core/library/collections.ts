import type { LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import {
	emptyRule,
	matchesRule,
	normalizeRule,
	ruleIsEmpty,
	type RuleGroup,
} from "./rules";

/**
 * Collections.
 *
 * A shelf you decide the contents of: "Bond, in order", "Comfort rewatches",
 * "Books for the flight". Two things make it more than a saved filter.
 *
 * The first is that membership is a fact about the note, written into its
 * frontmatter, not a list of paths in a settings file. A path in a settings
 * file breaks the moment you rename the note, it is invisible from the note
 * itself, Dataview cannot see it, and it does not survive a reinstall. A
 * property can be typed by hand, queried, synced and read a decade from now.
 *
 * The second is that there are two kinds of them, and a collection is one or
 * the other rather than a sliding scale between:
 *
 * - **Manual** — it holds what you put in it, and nothing arrives on its own.
 *   Three unrelated films because they remind you of the same summer is a
 *   perfectly good reason, and no condition could ever state it.
 * - **Smart** — a rule keeps it filled: everything that qualifies now, and
 *   anything that qualifies later. The rule is also a doorman, so what it would
 *   not have added by itself cannot be put in by hand either; a set that says
 *   "every Bond film" and holds one that is not is a set that lies.
 *
 * Membership is *written* in both cases rather than computed on the fly. A
 * smart list that recomputes has no memory of you having taken something off
 * it, and the answer to "why is this back" is never good. Taking something out
 * records it, and the rule respects that.
 *
 * Pure: no Obsidian, no clock of its own. Writing is the mutator's job; this
 * module only ever says what *should* be added.
 */

export interface CollectionDef {
	/** Stable across renames. */
	id: string;
	/** Also the value written into frontmatter, so it reads as itself. */
	name: string;
	icon: string;
	description: string;
	/**
	 * What the rule says, for a smart one. Ignored entirely by a manual one,
	 * and kept rather than cleared when you switch, so changing your mind twice
	 * does not cost you the conditions you wrote.
	 */
	rule: RuleGroup;
	/**
	 * Smart, rather than manual: the rule fills it in and guards the door.
	 *
	 * One flag rather than a kind field, because that is what it has always
	 * been in the stored data and every collection ever saved reads correctly
	 * under it — off is a manual collection, which is also what a new one is.
	 */
	auto: boolean;
	/**
	 * Notes taken out by hand, by path.
	 *
	 * Without this, removing something from an auto collection is a fight you
	 * lose: the rule puts it straight back on the next index pass.
	 */
	excluded: string[];
	created: number;
}

export function newCollectionId(now: Date = new Date()): string {
	return `c${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyCollection(
	name = "New collection",
	now: Date = new Date(),
): CollectionDef {
	return {
		id: newCollectionId(now),
		name,
		icon: "layers",
		description: "",
		rule: emptyRule(),
		auto: false,
		excluded: [],
		created: now.getTime(),
	};
}

const lower = (value: string) => value.trim().toLowerCase();

/* ---------------------------------------------------------------- normalizing */

export function normalizeCollections(raw: unknown): CollectionDef[] {
	if (!Array.isArray(raw)) return [];
	const out: CollectionDef[] = [];
	const taken = new Set<string>();

	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const stored = item as Partial<CollectionDef>;
		const name = typeof stored.name === "string" ? stored.name.trim() : "";
		// The name is the membership token, so two collections cannot share one.
		if (!name || taken.has(lower(name))) continue;
		taken.add(lower(name));

		out.push({
			id:
				typeof stored.id === "string" && stored.id
					? stored.id
					: newCollectionId(),
			name,
			icon: typeof stored.icon === "string" && stored.icon ? stored.icon : "layers",
			description:
				typeof stored.description === "string" ? stored.description : "",
			rule: normalizeRule(stored.rule),
			auto: Boolean(stored.auto),
			excluded: Array.isArray(stored.excluded)
				? stored.excluded.filter((v): v is string => typeof v === "string")
				: [],
			created:
				typeof stored.created === "number" && Number.isFinite(stored.created)
					? stored.created
					: Date.now(),
		});
	}
	return out;
}

/* ----------------------------------------------------------------- membership */

export function isMember(entry: LibraryEntry, collection: CollectionDef): boolean {
	const wanted = lower(collection.name);
	return entry.collections.some((name) => lower(name) === wanted);
}

/** The entries in a collection, in whatever order they were handed over. */
export function collectionMembers(
	entries: readonly LibraryEntry[],
	collection: CollectionDef,
): LibraryEntry[] {
	return entries.filter((entry) => isMember(entry, collection));
}

/** Which of the two kinds this is. */
export type CollectionMode = "manual" | "smart";

export function collectionMode(collection: CollectionDef): CollectionMode {
	return collection.auto ? "smart" : "manual";
}

/** Switching between them. The rule survives being switched away from. */
export function withMode(
	collection: CollectionDef,
	mode: CollectionMode,
): CollectionDef {
	return { ...collection, auto: mode === "smart" };
}

/**
 * Whether this is allowed in at all.
 *
 * A manual collection takes anything, which is the whole point of one: it holds
 * what you put in it, for reasons that are yours. A smart one takes only what
 * its rule describes, and this is what the add buttons ask before they offer
 * themselves — refusing at the point of the click, rather than accepting and
 * quietly dropping it on the next pass.
 */
export function admits(
	entry: LibraryEntry,
	collection: CollectionDef,
	config: LibraryConfig,
	now: Date = new Date(),
): boolean {
	if (!collection.auto || ruleIsEmpty(collection.rule)) return true;
	return matchesRule(entry, collection.rule, config, now);
}

/**
 * The members that no longer pass the gate.
 *
 * Tightening a rule cannot throw things out — membership is a fact written in
 * the note, and deleting somebody's picks because a condition changed is not a
 * thing an app gets to do. They are listed instead, and removing them is a
 * button.
 */
export function trespassers(
	entries: readonly LibraryEntry[],
	collection: CollectionDef,
	config: LibraryConfig,
	now: Date = new Date(),
): LibraryEntry[] {
	if (!collection.auto || ruleIsEmpty(collection.rule)) return [];
	return collectionMembers(entries, collection).filter(
		(entry) => !matchesRule(entry, collection.rule, config, now),
	);
}

/**
 * What the rule would add, given what is already in and what was taken out.
 *
 * Returns entries rather than doing anything with them: writing to the vault is
 * somebody else's job, and this way the same answer drives both the one-off
 * sweep when a collection is created and the standing check afterwards.
 */
export function qualifying(
	entries: readonly LibraryEntry[],
	collection: CollectionDef,
	config: LibraryConfig,
	now: Date = new Date(),
): LibraryEntry[] {
	if (!collection.auto || ruleIsEmpty(collection.rule)) return [];
	const excluded = new Set(collection.excluded);
	return entries.filter(
		(entry) =>
			!isMember(entry, collection) &&
			!excluded.has(entry.path) &&
			matchesRule(entry, collection.rule, config, now),
	);
}

/** Adding a collection to a note's list, case-insensitively and in order. */
export function withCollection(
	entry: LibraryEntry,
	collection: CollectionDef,
): string[] {
	if (isMember(entry, collection)) return [...entry.collections];
	return [...entry.collections, collection.name];
}

/**
 * The note's list with one collection renamed.
 *
 * Renaming is not a settings edit. The name *is* the membership token — it is
 * what the notes say — so changing it in the definition alone leaves every
 * member pointing at a collection that no longer exists, which looks exactly
 * like the rename having emptied it. The notes have to be brought along, and
 * this is the pure half of doing that.
 *
 * Order is kept, and so is the spelling of every other name on the list.
 */
export function withRenamed(
	entry: LibraryEntry,
	from: string,
	to: string,
): string[] {
	const wanted = lower(from);
	let touched = false;
	const out = entry.collections.map((name) => {
		if (lower(name) !== wanted) return name;
		touched = true;
		return to;
	});
	// A note that names the new collection already — typed by hand, most
	// likely — must not come out holding it twice.
	const seen = new Set<string>();
	const deduped = out.filter((name) => {
		const key = lower(name);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return touched ? deduped : [...entry.collections];
}

/** Removing one, keeping every other name exactly as the note spelled it. */
export function withoutCollection(
	entry: LibraryEntry,
	collection: CollectionDef,
): string[] {
	const wanted = lower(collection.name);
	return entry.collections.filter((name) => lower(name) !== wanted);
}

/**
 * Every collection name the vault mentions, whether or not it is defined here.
 *
 * A note can name a collection nobody has created — typed by hand, or left
 * behind by a collection since deleted — and the filter has to be able to find
 * those notes, so the names count as collections for reading even though
 * nothing configures them.
 */
export function collectionNames(
	entries: readonly LibraryEntry[],
	defined: readonly CollectionDef[],
): string[] {
	const seen = new Map<string, string>();
	for (const collection of defined) seen.set(lower(collection.name), collection.name);
	for (const entry of entries) {
		for (const name of entry.collections) {
			const key = lower(name);
			if (key && !seen.has(key)) seen.set(key, name.trim());
		}
	}
	return [...seen.values()];
}

/** How many notes are in each collection — for the counts on the chips. */
export function collectionCounts(
	entries: readonly LibraryEntry[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		for (const name of entry.collections) {
			const key = lower(name);
			if (!key) continue;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}
