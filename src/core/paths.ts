/**
 * Pure path helpers. Deliberately free of Obsidian imports so they can be
 * unit-tested directly — these are exactly the functions that historically
 * produced broken filenames.
 */

/**
 * Characters Obsidian forbids in filenames, plus `^ [ ] #` which are legal on
 * disk but break any wikilink that references the note, plus control
 * characters that can arrive in scraped metadata.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:\"|?*\\/^\[\]#\u0000-\u001F]/g;

const RESERVED_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

/** Leaves headroom for the folder path and the ".md" extension. */
const MAX_BASENAME = 180;

/**
 * Produces a safe note basename (no extension).
 *
 * Colons become " - " rather than being dropped, because titles like
 * "Blade Runner 2049: The Final Cut" otherwise run together.
 */
export function sanitizeFileName(title: string, fallback = "Untitled"): string {
	let name = (title ?? "")
		.replace(/\s*:\s*/g, " - ")
		.replace(ILLEGAL, "")
		.replace(/\s+/g, " ")
		.trim()
		// Windows rejects trailing dots and spaces.
		.replace(/[. ]+$/, "");

	if (RESERVED_WINDOWS_NAMES.test(name)) name = `_${name}`;
	if (name.length > MAX_BASENAME) name = name.slice(0, MAX_BASENAME).trimEnd();

	return name || fallback;
}
