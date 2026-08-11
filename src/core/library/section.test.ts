import { describe, expect, it } from "vitest";
import { readSection, writeSection } from "./section";

const NOTE = `---
title: Arrival
---

## Overview

A linguist is recruited by the military.

## Thoughts

Loved the structure.

## Resources

- [TMDB page](https://example.test)
`;

describe("readSection", () => {
	it("returns the body of the named section", () => {
		expect(readSection(NOTE, "Thoughts")).toBe("Loved the structure.");
	});

	it("tolerates the heading being given with its hashes", () => {
		expect(readSection(NOTE, "## Thoughts")).toBe("Loved the structure.");
	});

	it("is case- and spacing-insensitive", () => {
		expect(readSection(NOTE, "thoughts")).toBe("Loved the structure.");
	});

	it("returns nothing when the section is absent", () => {
		expect(readSection(NOTE, "Quotes")).toBe("");
	});

	it("stops at the next heading of the same level, not a deeper one", () => {
		const nested = "## Thoughts\n\nFirst.\n\n### Later\n\nSecond.\n\n## End\n\nNo.\n";
		expect(readSection(nested, "Thoughts")).toBe(
			"First.\n\n### Later\n\nSecond.",
		);
	});

	it("ignores headings inside fenced code", () => {
		const fenced =
			"## Thoughts\n\n```md\n## Thoughts\nnot a real heading\n```\n\nReal text.\n\n## After\n\nx\n";
		expect(readSection(fenced, "Thoughts")).toContain("not a real heading");
		expect(readSection(fenced, "Thoughts")).toContain("Real text.");
	});
});

describe("writeSection", () => {
	it("replaces only the named section", () => {
		const out = writeSection(NOTE, "Thoughts", "Changed my mind.");
		expect(readSection(out, "Thoughts")).toBe("Changed my mind.");
		expect(out).toContain("A linguist is recruited by the military.");
		expect(out).toContain("- [TMDB page](https://example.test)");
	});

	it("keeps the frontmatter untouched", () => {
		const out = writeSection(NOTE, "Thoughts", "New.");
		expect(out.startsWith("---\ntitle: Arrival\n---")).toBe(true);
	});

	it("adds the section at the end when the note has none", () => {
		const out = writeSection("# Dune\n\nSome text.\n", "Thoughts", "Great.");
		expect(out).toBe("# Dune\n\nSome text.\n\n## Thoughts\n\nGreat.\n");
	});

	it("does not create an empty section for empty text", () => {
		const source = "# Dune\n\nSome text.\n";
		expect(writeSection(source, "Thoughts", "  ")).toBe(source);
	});

	it("empties an existing section rather than deleting the heading", () => {
		const out = writeSection(NOTE, "Thoughts", "");
		expect(out).toContain("## Thoughts");
		expect(readSection(out, "Thoughts")).toBe("");
		expect(out).toContain("## Resources");
	});

	it("round-trips whatever it wrote", () => {
		const text = "Line one.\n\n- a bullet\n- another";
		const out = writeSection(NOTE, "Thoughts", text);
		expect(readSection(out, "Thoughts")).toBe(text);
	});

	it("leaves the note alone when given no heading", () => {
		expect(writeSection(NOTE, "  ", "x")).toBe(NOTE);
	});
});
