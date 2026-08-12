import type { MediaKind, SeasonInfo } from "../types";

/**
 * Tracking a series episode by episode.
 *
 * A show is the one kind of thing a single status cannot describe: "Watching"
 * is true for six months and says nothing about where you are. What the note
 * needs is a marker — the episode you have watched up to — and somewhere to
 * keep what you thought of the ones worth an opinion.
 *
 * Both live in ordinary frontmatter, because everything in Scout does:
 *
 *     current_episode: S02E05
 *     episode_log:
 *       S01E01: 9
 *       S02E03: {rating: 7, note: the one on the boat}
 *
 * A bare number is a rating on its own, which is what most entries are. The
 * map form appears only once there is something to say. Reading accepts both,
 * plus a couple of spellings a person might type by hand, so a log edited in
 * the note is never thrown away.
 *
 * Pure: no Obsidian, no network, no clock.
 */

/**
 * Kinds that come in episodes at all.
 *
 * A provider being able to answer for episodes does not mean this item has any:
 * TMDB serves films and shows from the same class, so asking the provider alone
 * put a "Seasons & episodes" heading on every film in the library. The kind is
 * what actually decides it.
 */
const EPISODIC_KINDS: readonly MediaKind[] = ["tv", "anime"];

export function isEpisodicKind(kind: MediaKind): boolean {
	return EPISODIC_KINDS.includes(kind);
}

/** Where you are in a series. Season 0 is the specials, as every source has it. */
export interface EpisodeId {
	season: number;
	episode: number;
}

/** What you made of one episode. */
export interface EpisodeMark {
	rating?: number;
	note?: string;
}

export type EpisodeLog = Record<string, EpisodeMark>;

/** `S02E05` — the form every episode guide on earth uses. */
export function episodeKey(season: number, episode: number): string {
	const pad = (value: number) => String(Math.max(0, value)).padStart(2, "0");
	return `S${pad(season)}E${pad(episode)}`;
}

/**
 * `S02 E05` — the same marker, for reading rather than for storing.
 *
 * Two functions rather than one because they answer to different masters. The
 * key is a key: it names a row in the log, it goes into frontmatter, and every
 * note already written holds the closed-up form. The label is prose, and in
 * prose the two halves are two facts — the season and the episode — which the
 * eye separates faster than it separates `S02E05`. `parseEpisodeKey` reads the
 * spaced form too, so a marker typed by hand from what the dialog showed is
 * still understood.
 */
export function episodeLabel(season: number, episode: number): string {
	return episodeKey(season, episode).replace("E", " E");
}

/** Reads `S02E05`, `s2e5`, `2x05`, or `S02.E05` out of whatever the note says. */
export function parseEpisodeKey(raw: unknown): EpisodeId | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		// A plain number means an episode of a show with no seasons worth
		// naming — an anime run of 24, most often.
		return raw > 0 ? { season: 1, episode: Math.floor(raw) } : null;
	}
	if (typeof raw !== "string") return null;
	const text = raw.trim();
	if (!text) return null;

	const tagged = /^s(?:eason)?\s*(\d{1,3})\s*[.\-_ ]?\s*e(?:p(?:isode)?)?\s*(\d{1,4})$/i.exec(
		text,
	);
	if (tagged) {
		return { season: Number(tagged[1]), episode: Number(tagged[2]) };
	}

	const crossed = /^(\d{1,3})\s*[x×]\s*(\d{1,4})$/i.exec(text);
	if (crossed) {
		return { season: Number(crossed[1]), episode: Number(crossed[2]) };
	}

	const bare = /^(\d{1,4})$/.exec(text);
	if (bare) {
		const episode = Number(bare[1]);
		return episode > 0 ? { season: 1, episode } : null;
	}
	return null;
}

/** Ordering, so "watched up to here" is a comparison rather than a search. */
export function compareEpisodes(a: EpisodeId, b: EpisodeId): number {
	return a.season - b.season || a.episode - b.episode;
}

/**
 * Whether you have seen an episode.
 *
 * Two ways of having seen one, because there are two ways of watching. Most
 * series are watched in order, and for those a single marker — "up to S02E05" —
 * says everything in one property, survives a hand edit, and reads as a
 * sentence. Some are not: Black Mirror is a set of unrelated films with a
 * common title, and there the honest record is a list of the ones you have
 * seen. Keeping both means neither way of watching has to pretend to be the
 * other, and a person who does one and then the other is not corrected.
 */
export function isWatched(
	id: EpisodeId,
	marker: EpisodeId | null | undefined,
	extra?: WatchedSet | null,
): boolean {
	if (extra && extra.has(episodeKey(id.season, id.episode))) return true;
	if (!marker) return false;
	return compareEpisodes(id, marker) <= 0;
}

/* ------------------------------------------------------- watched out of order */

/** The ones ticked off on their own, as canonical `S02E05` keys. */
export type WatchedSet = ReadonlySet<string>;

/** Where you are in a series, both ways of saying it. */
export interface WatchState {
	/** Everything up to and including this is watched. */
	marker: EpisodeId | null;
	/** The ones outside that run. */
	extra: WatchedSet;
}

/** Reads the watched-episodes property: a list, or one comma-separated line. */
export function readWatchedSet(raw: unknown): Set<string> {
	const out = new Set<string>();
	const add = (value: unknown) => {
		const id = parseEpisodeKey(value);
		if (id) out.add(episodeKey(id.season, id.episode));
	};

	if (Array.isArray(raw)) {
		for (const item of raw) add(item);
	} else if (typeof raw === "string") {
		for (const part of raw.split(",")) add(part);
	} else if (typeof raw === "number") {
		add(raw);
	}
	return out;
}

/** Back to a frontmatter value, in order, or null when the list is empty. */
export function writeWatchedSet(set: WatchedSet): string[] | null {
	if (set.size === 0) return null;
	return [...set].sort();
}

const keyOf = (id: EpisodeId) => episodeKey(id.season, id.episode);

/** Every episode of the run, in order, as far as the season list knows. */
function runKeys(seasons: readonly SeasonInfo[]): EpisodeId[] {
	const out: EpisodeId[] = [];
	for (const season of [...seasons].sort((a, b) => a.number - b.number)) {
		if (season.number <= 0) continue;
		for (let episode = 1; episode <= (season.episodeCount ?? 0); episode++) {
			out.push({ season: season.number, episode });
		}
	}
	return out;
}

/**
 * Ticking one episode, and only that one.
 *
 * The marker is kept wherever it can be, because it is the better record when
 * it is true: watching the next one along simply moves it, and moving it takes
 * any loose ticks that now sit inside the run with it. Un-ticking something in
 * the middle is the case that cannot be said with a marker at all, so the run
 * above the hole is written out as loose ticks and the marker drops back — the
 * set you have seen is unchanged, only the way of recording it is.
 */
export function toggleWatched(
	seasons: readonly SeasonInfo[],
	state: WatchState,
	id: EpisodeId,
): WatchState {
	const key = keyOf(id);
	const extra = new Set(state.extra);

	if (!isWatched(id, state.marker, state.extra)) {
		// Specials are not part of the run, so they are always a loose tick:
		// the marker counts episodes towards a total that excludes them.
		const next = id.season > 0 ? nextEpisode(seasons, state.marker) : null;
		if (!next || compareEpisodes(next, id) !== 0) {
			extra.add(key);
			return { marker: state.marker, extra };
		}
		// Straight on from where the marker was: absorb it, and any loose ticks
		// that the run has now caught up with.
		let marker: EpisodeId = id;
		for (;;) {
			const after = nextEpisode(seasons, marker);
			if (!after || !extra.has(keyOf(after))) break;
			extra.delete(keyOf(after));
			marker = after;
		}
		return { marker, extra };
	}

	if (extra.has(key)) {
		extra.delete(key);
		return { marker: state.marker, extra };
	}

	// Covered by the marker. Everything above it that the marker was speaking
	// for has to be said out loud before the marker can move back.
	const marker = state.marker;
	if (!marker) return { marker: null, extra };
	for (const episode of runKeys(seasons)) {
		if (compareEpisodes(episode, id) <= 0) continue;
		if (compareEpisodes(episode, marker) > 0) break;
		extra.add(keyOf(episode));
	}
	return { marker: previousEpisode(seasons, id), extra };
}

/**
 * "I have watched everything up to here" — the convenience that made the marker
 * worth having, kept as its own gesture now that a tick means one episode.
 *
 * Loose ticks the run swallows are dropped, because they are now what the
 * marker says; the ones above it stay exactly as they were.
 */
export function markUpTo(
	seasons: readonly SeasonInfo[],
	state: WatchState,
	id: EpisodeId,
): WatchState {
	if (id.season <= 0) return toggleWatched(seasons, state, id);
	const extra = new Set<string>();
	for (const key of state.extra) {
		const parsed = parseEpisodeKey(key);
		if (!parsed || compareEpisodes(parsed, id) > 0) extra.add(key);
	}
	return { marker: id, extra };
}

/** Whether the run up to an episode is already complete — nothing to fill in. */
export function watchedUpTo(
	seasons: readonly SeasonInfo[],
	state: WatchState,
	id: EpisodeId,
): boolean {
	if (id.season <= 0) return isWatched(id, state.marker, state.extra);
	for (const episode of runKeys(seasons)) {
		if (compareEpisodes(episode, id) > 0) break;
		if (!isWatched(episode, state.marker, state.extra)) return false;
	}
	return true;
}

/* --------------------------------------------------------------- the log */

function asRating(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") {
		// `Number("")` is 0, which would turn every blank score into a nought.
		const text = value.trim();
		if (!text) return undefined;
		const parsed = Number(text);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function asNote(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

/** What separates the three parts of a written line. */
const PART = " | ";

/**
 * One line of the log: `S02E05 | 8 | the boat one`.
 *
 * Either of the last two parts may be empty. The note is everything after the
 * second separator rather than the third field of a split, so a note with a
 * pipe in it comes back whole.
 */
function parseLine(raw: string): [string, EpisodeMark] | null {
	const first = raw.indexOf("|");
	const key = (first === -1 ? raw : raw.slice(0, first)).trim();
	const id = parseEpisodeKey(key);
	if (!id) return null;
	if (first === -1) return null;

	const second = raw.indexOf("|", first + 1);
	const middle = (second === -1 ? raw.slice(first + 1) : raw.slice(first + 1, second)).trim();
	const rest = second === -1 ? "" : raw.slice(second + 1).trim();

	// With one separator, a number is a score and anything else is a note —
	// `S01E02 | 8` and `S01E02 | brilliant` both being things people write.
	const rating = asRating(middle);
	const note = asNote(rest) ?? (rating === undefined ? asNote(middle) : undefined);
	if (rating === undefined && !note) return null;

	// Built up rather than declared with holes: an `undefined` note is a key
	// the log does not have, and leaving one behind shows up as a difference.
	const mark: EpisodeMark = {};
	if (rating !== undefined) mark.rating = rating;
	if (note) mark.note = note;
	return [episodeKey(id.season, id.episode), mark];
}

/**
 * Reads the log property into a map keyed by the canonical `S02E05`.
 *
 * Two shapes are accepted, because Scout used to write the other one: a list of
 * lines, which is what it writes now, and a map of episode to score or to
 * `{rating, note}`, which every note made before this release holds. Keys are
 * re-normalized either way, so `2x05` typed by hand and `S02E05` written by
 * Scout are the same episode rather than two entries that both half-work.
 */
export function readEpisodeLog(raw: unknown): EpisodeLog {
	if (!raw || typeof raw !== "object") return {};
	const out: EpisodeLog = {};

	if (Array.isArray(raw)) {
		for (const line of raw) {
			if (typeof line !== "string") continue;
			const parsed = parseLine(line);
			if (parsed) out[parsed[0]] = parsed[1];
		}
		return out;
	}

	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const id = parseEpisodeKey(key);
		if (!id) continue;

		let mark: EpisodeMark | null = null;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const record = value as Record<string, unknown>;
			mark = {
				rating: asRating(record.rating ?? record.score),
				note: asNote(record.note ?? record.thoughts ?? record.comment),
			};
		} else {
			const rating = asRating(value);
			const note = asNote(value);
			// A string that is not a number is a note, which is what someone
			// jotting "brilliant" into the log means by it.
			mark = rating !== undefined ? { rating } : note ? { note } : null;
		}

		if (mark && (mark.rating !== undefined || mark.note)) {
			out[episodeKey(id.season, id.episode)] = mark;
		}
	}
	return out;
}

/**
 * The log back as a frontmatter value, or null when nothing is left in it.
 *
 * A list of lines rather than a map, and the reason is Obsidian rather than
 * YAML: a nested map is perfectly valid frontmatter and Dataview reads it
 * happily, but Obsidian's own property editor has no type for one — it shows
 * `{"S01E03":{"note":"…"}}` as raw JSON under a question mark, which looks
 * exactly like a note whose data has been corrupted. A list of strings is a
 * type it does have, so the log shows up as a column of readable lines you can
 * edit by hand.
 */
export function writeEpisodeLog(log: EpisodeLog): string[] | null {
	const out: string[] = [];

	for (const key of Object.keys(log).sort()) {
		const mark = log[key];
		if (!mark) continue;
		const { rating, note } = mark;
		if (rating === undefined && !note) continue;
		out.push(
			note
				? `${key}${PART}${rating ?? ""}${PART}${note}`
				: `${key}${PART}${rating}`,
		);
	}
	return out.length > 0 ? out : null;
}

/* ------------------------------------------------------------- counting */

/**
 * How many episodes of the whole run sit at or before an episode.
 *
 * This is what keeps the marker and the progress property honest with each
 * other: setting the marker to S02E05 of a show whose first season had ten
 * episodes means fifteen watched, which is the number the progress bar and
 * every existing sort already understand.
 *
 * Specials are left out of the count. They are numbered season zero by every
 * source and are not part of the run anyone means by "how far through".
 */
export function watchedCount(
	seasons: readonly SeasonInfo[],
	marker: EpisodeId,
): number {
	if (marker.season <= 0) return 0;
	let total = 0;
	for (const season of seasons) {
		if (season.number <= 0) continue;
		if (season.number < marker.season) total += season.episodeCount ?? 0;
	}
	return total + marker.episode;
}

/**
 * How many episodes you have seen, both ways of having seen them counted.
 *
 * This is the number that goes into the ordinary progress property, so the bar
 * on the card and the "furthest along" sort keep reading what they always have.
 * Loose ticks inside the run are already in the marker's count, so only the
 * ones above it are added; specials are left out of both, as they always were.
 */
export function countWatched(
	seasons: readonly SeasonInfo[],
	state: WatchState,
): number {
	const base = state.marker ? watchedCount(seasons, state.marker) : 0;
	let loose = 0;
	for (const key of state.extra) {
		const id = parseEpisodeKey(key);
		if (!id || id.season <= 0) continue;
		if (!state.marker || compareEpisodes(id, state.marker) > 0) loose++;
	}
	return base + loose;
}

/**
 * The episode before one, or null when it is the first of the run.
 *
 * What un-ticking means: clicking an episode you have already seen says you
 * have watched up to the one before it.
 */
export function previousEpisode(
	seasons: readonly SeasonInfo[],
	id: EpisodeId,
): EpisodeId | null {
	if (id.episode > 1) return { season: id.season, episode: id.episode - 1 };

	const earlier = seasons
		.filter((season) => season.number > 0 && season.number < id.season)
		.sort((a, b) => b.number - a.number)[0];
	if (!earlier) return null;
	return {
		season: earlier.number,
		episode: Math.max(1, earlier.episodeCount ?? 1),
	};
}

/** The episode after the marker, given what the seasons hold. */
export function nextEpisode(
	seasons: readonly SeasonInfo[],
	marker: EpisodeId | null | undefined,
): EpisodeId | null {
	const run = seasons.filter((season) => season.number > 0);
	const first = run[0];
	if (!marker) return first ? { season: first.number, episode: 1 } : null;

	const current = run.find((season) => season.number === marker.season);
	if (current && marker.episode < (current.episodeCount ?? 0)) {
		return { season: marker.season, episode: marker.episode + 1 };
	}
	const following = run.find((season) => season.number > marker.season);
	return following ? { season: following.number, episode: 1 } : null;
}
