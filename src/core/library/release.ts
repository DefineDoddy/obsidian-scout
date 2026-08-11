/**
 * How long until something comes out.
 *
 * A library holds a fair amount of things that do not exist yet — a film with
 * a date next spring, a sequel announced for a year and nothing more — and for
 * those the only interesting fact is when. Notes record the date at whatever
 * precision the source knew it, so the answer has to degrade with it: a day
 * gives a countdown, a month gives a month, a bare year gives the year.
 *
 * Deliberately free of Obsidian and of `Date.now()`: the clock is a parameter,
 * so every branch of this is testable.
 */

/** How precisely a note pins the release down. */
type Precision = "day" | "month" | "year";

interface ParsedDate {
	precision: Precision;
	/** Midnight local time at the start of the period. */
	at: Date;
	year: number;
	month: number;
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** Reads `2027-04-18`, `2027-04`, or `2027` out of whatever the note says. */
function parse(raw: string | undefined): ParsedDate | null {
	if (!raw) return null;
	const match = /(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw.trim());
	if (!match) return null;

	const year = Number(match[1]);
	if (!(year >= 1000 && year <= 3000)) return null;
	const month = match[2] ? Number(match[2]) : undefined;
	const day = match[3] ? Number(match[3]) : undefined;
	if (month !== undefined && (month < 1 || month > 12)) return null;
	if (day !== undefined && (day < 1 || day > 31)) return null;

	return {
		precision: day ? "day" : month ? "month" : "year",
		// Local midnight, so "out today" means today where the user is rather
		// than wherever UTC happens to be.
		at: new Date(year, (month ?? 1) - 1, day ?? 1),
		year,
		month: month ?? 1,
	};
}

/** Whole days from `from` to `to`, ignoring the time of day. */
function daysBetween(from: Date, to: Date): number {
	const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
	return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function inDays(days: number): string {
	if (days === 0) return "Out today";
	if (days === 1) return "Out tomorrow";
	if (days < 14) return `Out in ${days} days`;
	if (days < 60) {
		const weeks = Math.round(days / 7);
		return `Out in ${weeks} weeks`;
	}
	const months = Math.round(days / 30);
	return months >= 12 ? "Out in a year" : `Out in ${months} months`;
}

/**
 * The line to show on something that has not come out, or null when it has.
 *
 * `raw` is the note's own release property — the whole string, not the year
 * Scout parsed out of it, because "2027-04-18" and "2027" mean different
 * things here and only the original says which one this is.
 */
export function releaseCountdown(
	raw: string | undefined,
	now: Date = new Date(),
): string | null {
	const parsed = parse(raw);
	if (!parsed) return null;

	if (parsed.precision === "day") {
		const days = daysBetween(now, parsed.at);
		return days >= 0 ? inDays(days) : null;
	}

	if (parsed.precision === "month") {
		// A month is only in the future once it is past the one we are in.
		const ahead =
			(parsed.year - now.getFullYear()) * 12 +
			(parsed.month - 1 - now.getMonth());
		if (ahead < 0) return null;
		if (ahead === 0) return "Out this month";
		const name = MONTHS[parsed.month - 1];
		return parsed.year === now.getFullYear()
			? `Out in ${name}`
			: `Out in ${name} ${parsed.year}`;
	}

	// A bare year, which says nothing about where in it we are: this year is
	// no longer news, so only a later one is worth a line.
	return parsed.year > now.getFullYear() ? `Out in ${parsed.year}` : null;
}
