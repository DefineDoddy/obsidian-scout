import { describe, expect, it } from "vitest";
import { releaseCountdown } from "./release";

/** A fixed Tuesday, so nothing here depends on when the suite runs. */
const NOW = new Date(2026, 7, 11); // 11 August 2026

const at = (raw: string | undefined) => releaseCountdown(raw, NOW);

describe("releaseCountdown", () => {
	it("says nothing about something already out", () => {
		expect(at("2026-08-10")).toBeNull();
		expect(at("1999-03-31")).toBeNull();
		expect(at("2026")).toBeNull();
		expect(at("2020")).toBeNull();
	});

	it("counts down the last fortnight a day at a time", () => {
		expect(at("2026-08-11")).toBe("Out today");
		expect(at("2026-08-12")).toBe("Out tomorrow");
		expect(at("2026-08-17")).toBe("Out in 6 days");
		expect(at("2026-08-23")).toBe("Out in 12 days");
	});

	it("switches to weeks and then months as the wait grows", () => {
		expect(at("2026-08-25")).toBe("Out in 2 weeks");
		expect(at("2026-09-20")).toBe("Out in 6 weeks");
		expect(at("2026-12-11")).toBe("Out in 4 months");
		expect(at("2027-09-11")).toBe("Out in a year");
	});

	it("gives the month when the note knows no better", () => {
		expect(at("2026-08")).toBe("Out this month");
		expect(at("2026-11")).toBe("Out in November");
		expect(at("2027-03")).toBe("Out in March 2027");
		expect(at("2026-07")).toBeNull();
	});

	it("gives the year when that is all there is", () => {
		expect(at("2027")).toBe("Out in 2027");
		// This year, with no month, is not news: it may well be out already.
		expect(at("2026")).toBeNull();
	});

	it("ignores anything that is not a date", () => {
		expect(at(undefined)).toBeNull();
		expect(at("")).toBeNull();
		expect(at("coming soon")).toBeNull();
		expect(at("2026-13-01")).toBeNull();
	});

	it("reads a full timestamp as the day it names", () => {
		expect(at("2026-08-12T00:00:00Z")).toBe("Out tomorrow");
	});
});
