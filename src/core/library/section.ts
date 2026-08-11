/**
 * Reading and rewriting one Markdown section by its heading.
 *
 * This is how "thoughts" round-trip: the note stays a normal note that anyone
 * can edit by hand, and the manage panel only ever rewrites the body of the
 * heading it was told about. Pure string work, so the edge cases (fenced code
 * containing a `#`, a missing section, a section at the end of the file) are
 * testable directly.
 */

const FENCE = /^\s*(```|~~~)/;

interface Heading {
	line: number;
	level: number;
}

/** Heading lines, skipping anything inside a fenced code block. */
function headings(lines: readonly string[]): Heading[] {
	const out: Heading[] = [];
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const fenceMatch = FENCE.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? "";
			if (fence === null) fence = marker;
			else if (fence === marker) fence = null;
			continue;
		}
		if (fence !== null) continue;

		const match = /^(#{1,6})\s+(.*)$/.exec(line);
		if (match) out.push({ line: i, level: (match[1] ?? "").length });
	}
	return out;
}

function headingText(line: string): string {
	return (/^#{1,6}\s+(.*?)\s*$/.exec(line)?.[1] ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

interface Located {
	/** Index of the heading line. */
	heading: number;
	/** First body line. */
	start: number;
	/** One past the last body line. */
	end: number;
}

function locate(lines: readonly string[], heading: string): Located | null {
	const wanted = heading.replace(/^#+\s*/, "").trim().toLowerCase();
	if (!wanted) return null;

	const all = headings(lines);
	const index = all.findIndex(
		(h) => headingText(lines[h.line] ?? "") === wanted,
	);
	if (index === -1) return null;

	const found = all[index];
	if (!found) return null;

	// The section runs until a heading of the same level or shallower.
	const next = all.slice(index + 1).find((h) => h.level <= found.level);
	return {
		heading: found.line,
		start: found.line + 1,
		end: next ? next.line : lines.length,
	};
}

/** The body of a section, trimmed of its surrounding blank lines. */
export function readSection(content: string, heading: string): string {
	const lines = content.split("\n");
	const found = locate(lines, heading);
	if (!found) return "";
	return lines.slice(found.start, found.end).join("\n").trim();
}

/**
 * Replaces a section's body, creating the section at the end of the note when
 * it is not there. Returns the content unchanged when nothing would differ.
 */
export function writeSection(
	content: string,
	heading: string,
	body: string,
): string {
	const title = heading.replace(/^#+\s*/, "").trim();
	if (!title) return content;

	const text = body.trim();
	const lines = content.split("\n");
	const found = locate(lines, heading);

	if (!found) {
		if (!text) return content;
		const prefix = content.trimEnd();
		return `${prefix}\n\n## ${title}\n\n${text}\n`;
	}

	const before = lines.slice(0, found.start);
	const after = lines.slice(found.end);
	// One blank line either side keeps the note readable however it is edited.
	const replacement = text ? ["", text, ""] : [""];
	return [...before, ...replacement, ...after].join("\n");
}
