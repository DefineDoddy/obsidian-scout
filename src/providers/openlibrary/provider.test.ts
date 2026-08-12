import { describe, expect, it } from "vitest";
import type { HttpClient } from "../../core/http";
import type { SettingsScope } from "../../core/settings/types";
import { OpenLibraryProvider } from "./provider";

/**
 * The query, and one clause that must never come back.
 *
 * Every book the row could have suggested went missing for the same reason, and
 * nothing anywhere said so: Open Library's search answers `500` to a query
 * carrying a range on both `ratings_count` and `ratings_average`, either one
 * alone being fine. `discoverPlans` always sets `minRating`, so every book
 * request threw, and the engine's own "one source being unreachable must not
 * empty the row" quietly absorbed it. The hub showed films and television, the
 * user asked why there were never any books, and there was nothing in the code
 * that looked wrong.
 *
 * So the URL is asserted on directly. A test that only checked "does discover
 * return items" would have passed against a stub for as long as the bug lived.
 */

/** Captures the URL asked for, and answers with nothing. */
function spy(): { urls: string[]; http: HttpClient } {
	const urls: string[] = [];
	const http = {
		getJson: async (url: string) => {
			urls.push(url);
			return { docs: [] };
		},
	};
	return { urls, http: http as unknown as HttpClient };
}

const settings: SettingsScope = {
	get: <T>(_key: string, fallback: T) => fallback,
	set: async () => {},
};

/**
 * The URL asked for, and its query separately.
 *
 * `ratings_average` is also one of the fields the response is asked to carry, so
 * a check against the whole URL would find it whether or not it is being filtered
 * on — which is the difference between the bug and the fix.
 */
const ask = async (query: Parameters<OpenLibraryProvider["discover"]>[0]) => {
	const { urls, http } = spy();
	const provider = new OpenLibraryProvider({ http, settings });
	await provider.discover(query, { signal: new AbortController().signal });
	const url = new URL(urls[0] ?? "https://example.invalid");
	return { url: decodeURIComponent(url.search), q: url.searchParams.get("q") ?? "" };
};

describe("OpenLibraryProvider.discover", () => {
	it("never puts a second range clause beside the ratings count", async () => {
		const { q } = await ask({
			kind: "book",
			genres: ["science fiction"],
			minRating: 6.8,
			page: 1,
		});
		expect(q).toContain("ratings_count:[20 TO *]");
		expect(q).not.toContain("ratings_average");
	});

	it("still asks for the subjects, and for the best of them first", async () => {
		const { q, url } = await ask({
			kind: "book",
			genres: ["horror", "thriller"],
			minRating: 6.8,
			page: 2,
		});
		expect(q).toContain('subject:"horror"');
		expect(q).toContain('subject:"thriller"');
		// The floor `minRating` used to be is honoured by the ordering instead.
		expect(url).toContain("sort=rating");
		expect(url).toContain("page=2");
	});

	it("keeps what it is asked to leave out", async () => {
		const { q } = await ask({
			kind: "book",
			genres: ["horror"],
			without: ["romance"],
			minRating: 6.8,
			page: 1,
		});
		expect(q).toContain('NOT subject:"romance"');
	});
});
