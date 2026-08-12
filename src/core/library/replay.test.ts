import { describe, expect, it } from "vitest";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { replayPatch, timesFinished } from "./replay";

const config = defaultLibraryConfig();
const TODAY = "2026-08-11";

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
	return {
		path: "Media/Arrival.md",
		basename: "Arrival",
		title: "Arrival",
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

describe("timesFinished", () => {
	it("counts the run you are on along with the ones before it", () => {
		expect(timesFinished(entry())).toBe(0);
		expect(timesFinished(entry({ finished: "2026-01-01" }))).toBe(1);
		expect(
			timesFinished(
				entry({ history: ["2020-01-01", "2023-06-01"], finished: "2026-01-01" }),
			),
		).toBe(3);
	});

	// Part-way through a second time: two runs exist, one is finished.
	it("does not count a run still in progress", () => {
		expect(timesFinished(entry({ history: ["2020-01-01"] }))).toBe(1);
	});
});

describe("replayPatch", () => {
	it("files the finish date away and starts today", () => {
		const patch = replayPatch(
			config,
			entry({ status: "Watched", started: "2025-12-20", finished: "2026-01-01" }),
			TODAY,
		);

		expect(patch.history).toEqual(["2026-01-01"]);
		expect(patch.started).toBe(TODAY);
		expect(patch.finished).toBeNull();
		expect(patch.status).toBe("Watching");
	});

	it("keeps the dates it was already holding, oldest first", () => {
		const patch = replayPatch(
			config,
			entry({ history: ["2020-01-01"], finished: "2026-01-01" }),
			TODAY,
		);
		expect(patch.history).toEqual(["2020-01-01", "2026-01-01"]);
	});

	// Pressing it twice should not stack up two of the same day.
	it("does not record the same date twice", () => {
		const patch = replayPatch(
			config,
			entry({ history: ["2026-01-01"], finished: "2026-01-01" }),
			TODAY,
		);
		expect(patch.history).toEqual(["2026-01-01"]);
	});

	// The counters describe the run you are on; the history is what remembers
	// that you got to the end of the last one.
	it("resets what described the last time through", () => {
		const patch = replayPatch(
			config,
			entry({ kind: "tv", progress: 62, finished: "2026-01-01" }),
			TODAY,
		);
		expect(patch.progress).toBeNull();
		expect(patch.current_episode).toBeNull();
	});

	it("writes the user's own word for started, whatever it is", () => {
		const shouty = {
			...config,
			statuses: { ...config.statuses, movie: "Backlog, ON IT, Seen" },
			inProgressStatuses: "ON IT",
		};
		const patch = replayPatch(shouty, entry({ finished: "2026-01-01" }), TODAY);
		expect(patch.status).toBe("ON IT");
	});

	// Nothing in the vocabulary means "started", so there is no word to write —
	// which is better than inventing one.
	it("leaves the status alone when the kind has no started shelf", () => {
		const none = {
			...config,
			statuses: { ...config.statuses, movie: "Backlog, Seen" },
		};
		const patch = replayPatch(none, entry({ finished: "2026-01-01" }), TODAY);
		expect(patch).not.toHaveProperty("status");
	});

	it("uses the property names the vault actually uses", () => {
		const renamed = {
			...config,
			fields: { ...config.fields, history: "rewatched_on", finished: "done_on" },
		};
		const patch = replayPatch(
			renamed,
			entry({ finished: "2026-01-01" }),
			TODAY,
		);
		expect(patch.rewatched_on).toEqual(["2026-01-01"]);
		expect(patch.done_on).toBeNull();
	});
});
