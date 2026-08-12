/**
 * Genre names that Obsidian will accept as tags.
 *
 * Obsidian's tag grammar is narrow — no spaces, no ampersands, no punctuation
 * beyond `-`, `_` and `/` — while every source names its genres for people to
 * read: "Sci-Fi & Fantasy", "Action & Adventure", "Science Fiction". Written
 * into a property Obsidian has typed as Tags, each one comes back struck
 * through with "Invalid tag name" beside it.
 *
 * So this is only applied where it has to be. A property Obsidian treats as a
 * plain list keeps the source's wording, because "Sci-Fi & Fantasy" is what the
 * genre is called and mangling it everywhere to satisfy a property type most
 * people never turn on would be the worse trade.
 */

/** Properties Obsidian always types as tags, whatever the vault says. */
const ALWAYS_TAGS = new Set(["tags", "tag"]);

/**
 * Whether values written to this property have to be valid tag names.
 *
 * `tags` and `tag` always are. Anything else depends on what the vault has the
 * property set to, which only Obsidian knows — hence the callback, so the pure
 * part of this stays testable and the caller supplies the lookup.
 */
export function needsTagSafeNames(
	property: string,
	assignedType?: (property: string) => string | undefined,
): boolean {
	const key = property.trim().toLowerCase();
	if (!key) return false;
	if (ALWAYS_TAGS.has(key)) return true;
	return assignedType?.(property.trim()) === "tags";
}

/**
 * One genre as a tag.
 *
 * `&` becomes "and" rather than being dropped, because "Sci-Fi Fantasy" reads
 * like a single made-up genre; everything else that is not a letter, digit,
 * hyphen, underscore or slash collapses to a single hyphen.
 */
export function tagSafe(name: string): string {
	const out = name
		.trim()
		.replace(/&/g, " and ")
		.replace(/['’]/g, "")
		.replace(/[^\p{L}\p{N}\-_/]+/gu, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^[-/]+|[-/]+$/g, "");
	// A tag cannot be only digits — Obsidian reads `#2001` as a number — so one
	// that came out that way keeps a marker in front of it.
	return /^\d+$/.test(out) ? `_${out}` : out;
}

/** The list form, dropping anything that sanitized away to nothing. */
export function tagSafeList(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of names) {
		const tag = tagSafe(name);
		if (!tag || seen.has(tag.toLowerCase())) continue;
		seen.add(tag.toLowerCase());
		out.push(tag);
	}
	return out;
}
