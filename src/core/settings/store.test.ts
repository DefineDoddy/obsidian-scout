import { describe, expect, it } from "vitest";
import { migrate, SCHEMA_VERSION } from "./store";

/** The exact shape found in this vault's data.json before the refactor. */
const REAL_V1_DATA = {
	enableTvFeatures: true,
	enableBookFeatures: true,
	movieTemplateFilePath: "X/Templates/Media/Movie.md",
	movieOutputLocation: "Atlas/Media/Movies",
	tvShowTemplateFilePath: "X/Templates/Media/TV Show.md",
	tvShowOutputLocation: "Atlas/Media/TV Shows",
	bookTemplateFilePath: "",
	bookOutputLocation: "Atlas/Media/Books",
	lastViewMode: "grid",
	lastBookViewMode: "list",
	tvFeatures: true,
	tvTemplateFilePath: "X/Templates/Media/TV Show.md",
	tvOutputLocation: "Atlas/Media/TV Shows",
	tmdbAccessToken: "test-token",
};

describe("settings migration", () => {
	it("carries every configured path across from the real v1 blob", () => {
		const out = migrate(REAL_V1_DATA);

		expect(out.schemaVersion).toBe(SCHEMA_VERSION);
		expect(out.kinds.movie).toEqual({
			templatePath: "X/Templates/Media/Movie.md",
			outputFolder: "Atlas/Media/Movies",
		});
		expect(out.kinds.tv).toEqual({
			templatePath: "X/Templates/Media/TV Show.md",
			outputFolder: "Atlas/Media/TV Shows",
		});
		// Book template was empty, so only the folder carries over.
		expect(out.kinds.book?.outputFolder).toBe("Atlas/Media/Books");
	});

	it("moves the token into the tmdb namespace", () => {
		const out = migrate(REAL_V1_DATA);
		expect(out.providers.tmdb?.accessToken).toBe("test-token");
		expect(out.providers.tmdb?.enabled).toBe(true);
	});

	it("drops the stale duplicate keys entirely", () => {
		const out = migrate(REAL_V1_DATA) as unknown as Record<string, unknown>;
		for (const stale of [
			"enableTvFeatures",
			"tvFeatures",
			"tvTemplateFilePath",
			"lastViewMode",
			"lastBookViewMode",
		]) {
			expect(out[stale]).toBeUndefined();
		}
	});

	it("preserves the view mode preference", () => {
		expect(migrate(REAL_V1_DATA).core.defaultViewMode).toBe("grid");
	});

	it("prefers the newer tvShow* keys over the legacy tv* ones", () => {
		const out = migrate({
			tvShowOutputLocation: "New/TV",
			tvOutputLocation: "Old/TV",
		});
		expect(out.kinds.tv?.outputFolder).toBe("New/TV");
	});

	it("is idempotent — migrating twice changes nothing", () => {
		const once = migrate(REAL_V1_DATA);
		const twice = migrate(once as unknown as Record<string, unknown>);
		expect(twice).toEqual(once);
	});

	it("handles a first run with no saved data", () => {
		const out = migrate(null);
		expect(out.schemaVersion).toBe(SCHEMA_VERSION);
		expect(out.kinds).toEqual({});
		expect(out.core.collisionPolicy).toBe("prompt");
	});

	it("backfills newly added core defaults on an existing v2 blob", () => {
		const out = migrate({
			schemaVersion: 2,
			core: { collisionPolicy: "overwrite" },
			kinds: {},
			providers: {},
		});
		expect(out.core.collisionPolicy).toBe("overwrite");
		expect(out.core.openAfterCreate).toBe(true);
	});
});
