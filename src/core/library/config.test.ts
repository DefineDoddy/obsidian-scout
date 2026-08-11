import { describe, expect, it } from "vitest";
import {
	defaultLibraryConfig,
	normalizeLibraryConfig,
	ratingFraction,
	ratingScaleFor,
	statusTone,
} from "./config";

const config = defaultLibraryConfig();

describe("statusTone", () => {
	it("sorts the default vocabulary into its four groups", () => {
		expect(statusTone(config, "Watching")).toBe("active");
		expect(statusTone(config, "Read")).toBe("done");
		expect(statusTone(config, "On hold")).toBe("paused");
		expect(statusTone(config, "Dropped")).toBe("dropped");
	});

	it("ignores case and surrounding space", () => {
		expect(statusTone(config, "  wATCHED ")).toBe("done");
	});

	it("treats anything unlisted as not started yet", () => {
		expect(statusTone(config, "To watch")).toBe("planned");
		expect(statusTone(config, "Wishlist")).toBe("planned");
	});

	it("has no tone for no status", () => {
		expect(statusTone(config, undefined)).toBeNull();
		expect(statusTone(config, "   ")).toBeNull();
	});

	it("follows the user's own lists rather than the words", () => {
		const custom = { ...config, inProgressStatuses: "Currently enjoying" };
		expect(statusTone(custom, "Currently enjoying")).toBe("active");
		// No longer listed as started, so it falls through to planned.
		expect(statusTone(custom, "Watching")).toBe("planned");
	});
});

describe("ratingScaleFor", () => {
	it("falls back to the default scale", () => {
		expect(ratingScaleFor(config, "movie")).toBe(config.ratingScale);
	});

	it("prefers a per-kind override", () => {
		const mixed = { ...config, ratingScales: { movie: 10 } };
		expect(ratingScaleFor(mixed, "movie")).toBe(10);
		expect(ratingScaleFor(mixed, "book")).toBe(5);
	});
});

describe("ratingFraction", () => {
	it("divides by the kind's own scale", () => {
		const mixed = { ...config, ratingScales: { movie: 10 } };
		expect(ratingFraction(mixed, "movie", 8)).toBeCloseTo(0.8);
		expect(ratingFraction(mixed, "book", 4)).toBeCloseTo(0.8);
	});

	it("clamps a rating that overshoots its scale", () => {
		expect(ratingFraction(config, "book", 9)).toBe(1);
	});

	it("is undefined for an unrated entry", () => {
		expect(ratingFraction(config, "book", undefined)).toBeUndefined();
	});
});

describe("normalizeLibraryConfig", () => {
	it("fills in settings a stored config predates", () => {
		const stored = { ratingScale: 10 } as Record<string, unknown>;
		const out = normalizeLibraryConfig(stored);
		expect(out.ratingScale).toBe(10);
		expect(out.pausedStatuses).toBe(config.pausedStatuses);
		expect(out.ratingScales).toEqual({});
	});

	it("drops rating overrides that are not usable scales", () => {
		const out = normalizeLibraryConfig({
			ratingScales: { movie: 10, book: 0, game: NaN },
		});
		expect(out.ratingScales).toEqual({ movie: 10 });
	});
});
