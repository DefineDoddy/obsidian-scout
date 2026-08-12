import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { ratingScaleFor } from "../../core/library/config";
import type { LibraryEntry } from "../../core/library/entry";
import {
	countWatched,
	episodeKey,
	episodeLabel,
	isWatched,
	markUpTo,
	nextEpisode,
	toggleWatched,
	watchedUpTo,
	type EpisodeId,
	type WatchState,
} from "../../core/library/episodes";
import { isEpisodic } from "../../core/provider";
import type { EpisodeInfo, MediaItem, MediaRef, SeasonInfo } from "../../core/types";
import Rating, { formatRating } from "./Rating";
import { Icon, useProviderData } from "./shared";

/**
 * Where you are in a series.
 *
 * A season of twenty-four episodes is not something that fits under a paragraph
 * of synopsis, so the guide is a page of its own rather than a fold in the
 * middle of the dialog: the detail view carries a line saying where you are,
 * and clicking it turns the dialog over.
 *
 * Two ways of watching are both first-class here. A tick means "I have seen
 * this one", full stop — which is the only honest thing it can mean for a show
 * like Black Mirror, where episode order says nothing and people arrive at S03
 * before S01. Watching straight through is the other way, and it keeps the
 * gesture it always had: "everything up to here", one click, on its own control
 * beside the tick rather than hidden inside it.
 */

/** Past this many, the season pills become a list. Same reasoning as statuses. */
const MAX_SEASON_PILLS = 8;

function seriesCount(item: MediaItem | undefined, name: string): number {
	const value = item?.extra?.[name];
	return typeof value === "number" && value > 0 ? value : 0;
}

/** What the note holds, in the shape the pure helpers work in. */
function watchStateOf(entry: LibraryEntry | undefined): WatchState {
	return {
		marker: entry?.currentEpisode ?? null,
		extra: new Set(entry?.watchedEpisodes ?? []),
	};
}

/**
 * The line on the detail page that leads to the guide.
 *
 * Deliberately costs nothing: the counts come off the record the dialog has
 * already fetched, so opening a show does not fetch a season list somebody may
 * never look at.
 */
export function EpisodeGuideLink({
	entry,
	item,
	onOpen,
}: {
	entry?: LibraryEntry;
	item?: MediaItem;
	onOpen: () => void;
}): React.ReactElement {
	const marker = entry?.currentEpisode ?? null;
	const loose = entry?.watchedEpisodes?.length ?? 0;
	const seasons = seriesCount(item, "number_of_seasons");
	const episodes = seriesCount(item, "number_of_episodes");

	// Whichever of the two records has something to say. A series watched out
	// of order has no "up to", and saying nothing at all made the line look
	// like it was for a show nobody had started.
	const summary = marker
		? `Up to ${episodeLabel(marker.season, marker.episode)}${
				loose > 0 ? ` · ${loose} more ticked off` : ""
			}`
		: loose > 0
			? `${loose} episode${loose === 1 ? "" : "s"} ticked off`
			: [
					seasons > 0
						? `${seasons} season${seasons === 1 ? "" : "s"}`
						: null,
					episodes > 0 ? `${episodes} episodes` : null,
				]
					.filter(Boolean)
					.join(" · ");

	return (
		<button className="scout-section-link" onClick={onOpen}>
			<Icon name="list-video" size={16} />
			<span className="scout-section-title">Seasons &amp; episodes</span>
			{summary && <span className="scout-section-note">{summary}</span>}
			<Icon name="chevron-right" size={16} />
		</button>
	);
}

export interface EpisodeGuideProps {
	ctx: ScoutContext;
	source: MediaRef;
	/** The note, when there is one. Without it the page is a read-only guide. */
	entry?: LibraryEntry;
	title: string;
	onBack: () => void;
}

/**
 * The guide, with the dialog to itself.
 *
 * Nothing here is capped or scrolled inside its own box — the page is the box.
 * A season list that runs long simply makes the dialog long, which is what a
 * page is for and what a fold in the middle of a synopsis was not.
 *
 * And nothing here is behind a fold either. Every episode shows its still, its
 * facts, and its synopsis as it stands, the way a streaming service lists them:
 * a guide exists to be read down, and a column of twenty closed drawers is a
 * list of things you have to click before it tells you anything.
 */
export function EpisodeGuide({
	ctx,
	source,
	entry,
	title,
	onBack,
}: EpisodeGuideProps): React.ReactElement {
	const provider = ctx.registry.get(source.providerId);
	const episodic = provider && isEpisodic(provider) ? provider : null;
	const marker = entry?.currentEpisode ?? null;

	const [picked, setPicked] = useState<number | null>(null);

	const key = `${source.providerId}:${source.id}`;
	const seasons = useProviderData<SeasonInfo[]>(
		episodic ? (signal) => episodic.seasons(source, { signal }) : null,
		`${key}:seasons`,
	);

	const list = useMemo(() => seasons.data ?? [], [seasons.data]);
	const fallback = list.find((season) => season.number > 0) ?? list[0];
	const wanted = picked ?? marker?.season ?? fallback?.number ?? null;
	// The marker may name a season the source no longer lists — a show
	// renumbered, or a note written by hand.
	const season =
		wanted !== null && list.some((s) => s.number === wanted)
			? wanted
			: (fallback?.number ?? null);

	const episodes = useProviderData<EpisodeInfo[]>(
		episodic && season !== null
			? (signal) => episodic.episodes(source, season, { signal })
			: null,
		`${key}:episodes:${season ?? "none"}`,
	);

	const runLength = list.reduce(
		(sum, item) => sum + (item.number > 0 ? (item.episodeCount ?? 0) : 0),
		0,
	);
	const upNext = nextEpisode(list, marker);
	const state = watchStateOf(entry);
	const seen = countWatched(list, state);

	/** Writing a new state back to the note, with the count it comes to. */
	const commit = (next: WatchState) => {
		if (!entry) return;
		void ctx.mutator.setEpisode(entry, next, countWatched(list, next));
	};

	const seasonCount = list.filter((s) => s.number > 0).length;

	return (
		<div className="scout-episodes-page">
			{/* On its own line, and only ever on the left. The counts used to sit
			    at the end of the title bar, which is exactly where the dialog's
			    own close button is — the two overlapped, and the close button
			    won. Everything that was up there is on the line below now. */}
			<div className="scout-episodes-bar">
				<button
					className="scout-back"
					aria-label="Back to the item"
					onClick={onBack}
				>
					<Icon name="chevron-left" size={16} />
					Back
				</button>
			</div>

			<div className="scout-episodes-head">
				<h2>{title}</h2>
				<p className="scout-episodes-where">
					{seasonCount > 0 && (
						<span>
							{seasonCount} season{seasonCount === 1 ? "" : "s"}
							{runLength > 0 ? ` · ${runLength} episodes` : ""}
						</span>
					)}
					{marker ? (
						<span>
							Watched up to{" "}
							<strong>
								{episodeLabel(marker.season, marker.episode)}
							</strong>
							{upNext ? ", next up " : " — that is the last one"}
							{upNext && (
								<strong>
									{episodeLabel(upNext.season, upNext.episode)}
								</strong>
							)}
						</span>
					) : (
						// Out-of-order watching has no "up to", so the count is
						// the only true thing to say about where you are.
						seen > 0 && (
							<span>
								<strong>{seen}</strong> watched
								{runLength > 0 ? ` of ${runLength}` : ""}
							</span>
						)
					)}
				</p>
			</div>

			{seasons.loading && <p className="scout-message">Loading seasons…</p>}
			{seasons.error && <p className="scout-error">{seasons.error}</p>}

			{list.length > 1 &&
				(list.length > MAX_SEASON_PILLS ? (
					<select
						className="scout-season-select"
						aria-label="Season"
						value={String(season ?? "")}
						onChange={(e) => setPicked(Number(e.target.value))}
					>
						{list.map((item) => (
							<option key={item.number} value={String(item.number)}>
								{item.name}
								{item.episodeCount ? ` (${item.episodeCount})` : ""}
							</option>
						))}
					</select>
				) : (
					<div className="scout-season-pills" role="tablist">
						{list.map((item) => (
							<button
								key={item.number}
								role="tab"
								aria-selected={item.number === season}
								className={item.number === season ? "is-on" : ""}
								onClick={() => setPicked(item.number)}
							>
								{item.number > 0
									? `Season ${item.number}`
									: item.name}
								{item.episodeCount ? (
									<span className="scout-count">
										{item.episodeCount}
									</span>
								) : null}
							</button>
						))}
					</div>
				))}

			{episodes.loading && <p className="scout-message">Loading episodes…</p>}
			{episodes.error && <p className="scout-error">{episodes.error}</p>}

			{episodes.data && episodes.data.length > 0 && (
				<ul className="scout-episode-list">
					{episodes.data.map((episode) => {
						const id = {
							season: episode.season,
							episode: episode.number,
						};
						const code = episodeKey(id.season, id.episode);
						return (
							<EpisodeRow
								key={code}
								ctx={ctx}
								entry={entry}
								episode={episode}
								code={code}
								watched={isWatched(id, state.marker, state.extra)}
								// Offered only where it would change something:
								// on a run already complete up to here it is a
								// button that does nothing, and beside a tick
								// that does, that reads as a broken tick.
								fillable={!watchedUpTo(list, state, id)}
								next={
									upNext !== null &&
									upNext.season === id.season &&
									upNext.episode === id.episode
								}
								onTick={() => commit(toggleWatched(list, state, id))}
								onFill={() => commit(markUpTo(list, state, id))}
							/>
						);
					})}
				</ul>
			)}

			{!entry && (
				<p className="scout-detail-hint">
					Add this to your library to tick off episodes, rate them, and
					write your thoughts.
				</p>
			)}
		</div>
	);
}

interface EpisodeRowProps {
	ctx: ScoutContext;
	entry: LibraryEntry | undefined;
	episode: EpisodeInfo;
	code: string;
	watched: boolean;
	/** Whether "everything up to here" would actually fill anything in. */
	fillable: boolean;
	next: boolean;
	onTick: () => void;
	onFill: () => void;
}

/**
 * One episode, all of it.
 *
 * Still, number, title, facts, and synopsis on the row itself — the shape every
 * streaming service settled on, and for the same reason: the thing you are
 * scanning for is "which one is this again", and no drawer answers that until
 * after you have opened it.
 *
 * The one thing still folded away is your own note, and only when you have not
 * written one. That is not content to be scanned, it is a text area, and twenty
 * empty ones down a page is a form rather than a guide.
 */
function EpisodeRow({
	ctx,
	entry,
	episode,
	code,
	watched,
	fillable,
	next,
	onTick,
	onFill,
}: EpisodeRowProps): React.ReactElement {
	const config = ctx.settings.library();
	const mark = entry?.episodeLog[code];
	// The key addresses the log; the label is what a person is told.
	const said = episodeLabel(episode.season, episode.number);
	const scale = entry ? ratingScaleFor(config, entry.kind) : config.ratingScale;
	const note = mark?.note ?? "";
	const [noting, setNoting] = useState(false);

	const write = (rating: number | null | undefined, text: string | undefined) => {
		if (!entry) return;
		void ctx.mutator.setEpisodeMark(entry, code, {
			rating: rating ?? undefined,
			note: text,
		});
	};

	const facts = [
		episode.airDate ? airDate(episode.airDate) : null,
		episode.runtime ? `${episode.runtime} min` : null,
	].filter(Boolean);

	return (
		<li
			className={`scout-episode${watched ? " is-watched" : ""}${
				next ? " is-next" : ""
			}`}
		>
			<span className="scout-episode-no">{episode.number}</span>

			<div className="scout-episode-art">
				{episode.stillUrl ? (
					<img
						className="scout-episode-still"
						src={episode.stillUrl}
						alt=""
						loading="lazy"
						draggable={false}
					/>
				) : (
					<span className="scout-episode-still is-blank" />
				)}
				{entry && (
					/* Two gestures, two controls. One tick used to mean both
					   "seen it" and "seen everything before it", which is fine
					   until the two disagree — and for an anthology they always
					   do. The tick is the one you reach for; the second button
					   appears only when there is a gap behind you to fill. */
					<div className="scout-episode-marks">
						<button
							className={`scout-episode-tick${watched ? " is-on" : ""}`}
							aria-pressed={watched}
							aria-label={
								watched
									? `Mark ${said} as unwatched`
									: `Mark ${said} as watched`
							}
							title={
								watched
									? "Watched — click to un-tick this episode"
									: "Tick this episode off"
							}
							onClick={onTick}
						>
							<Icon name="check" size={14} />
						</button>
						{fillable && (
							<button
								className="scout-episode-fill"
								aria-label={`Mark everything up to ${said} as watched`}
								title="Mark everything up to here as watched"
								onClick={onFill}
							>
								<Icon name="chevrons-up" size={13} />
							</button>
						)}
					</div>
				)}
			</div>

			<div className="scout-episode-text">
				<div className="scout-episode-line">
					<span className="scout-episode-title">
						{episode.title}
						{next && <span className="scout-episode-flag">Up next</span>}
					</span>
					<span className="scout-episode-meta">
						{facts.join(" · ")}
						{episode.rating !== undefined && (
							<span className="scout-source-rating">
								<Icon name="star" size={11} />
								{formatRating(episode.rating)}
							</span>
						)}
					</span>
				</div>

				{episode.overview ? (
					<p className="scout-episode-overview">{episode.overview}</p>
				) : (
					<p className="scout-episode-overview scout-episode-blank">
						No synopsis for this one.
					</p>
				)}

				{entry && (
					<div className="scout-episode-yours">
						<Rating
							value={mark?.rating}
							scale={scale}
							step={config.ratingStep}
							icon={config.ratingIcon}
							size={14}
							onChange={(value) => write(value, note || undefined)}
						/>
						{!note && !noting && (
							<button
								className="scout-link-button"
								onClick={() => setNoting(true)}
							>
								Add a note
							</button>
						)}
					</div>
				)}

				{entry && (note || noting) && (
					<EpisodeNote
						value={note}
						autoFocus={noting && !note}
						onSave={(text) => {
							write(mark?.rating, text || undefined);
							if (!text) setNoting(false);
						}}
					/>
				)}
			</div>
		</li>
	);
}

/**
 * A line about one episode.
 *
 * Saved on the way out rather than as you type: a note per episode is a note
 * per keystroke otherwise, and each one rewrites the whole frontmatter block.
 */
function EpisodeNote({
	value,
	autoFocus = false,
	onSave,
}: {
	value: string;
	autoFocus?: boolean;
	onSave: (note: string) => void;
}): React.ReactElement {
	const [text, setText] = useState(value);
	const saved = useRef(value);

	// Follows the note when it changes underneath — an edit in the file, or the
	// row being reused for a different episode.
	useEffect(() => {
		setText(value);
		saved.current = value;
	}, [value]);

	return (
		<textarea
			className="scout-episode-note"
			value={text}
			rows={2}
			// eslint-disable-next-line jsx-a11y/no-autofocus -- asked for by
			// clicking "Add a note"; the caret belongs where the click was.
			autoFocus={autoFocus}
			placeholder="What did you make of this one?"
			aria-label="Your note on this episode"
			onChange={(e) => setText(e.target.value)}
			onBlur={() => {
				const next = text.trim();
				if (next === saved.current.trim()) return;
				saved.current = next;
				onSave(next);
			}}
		/>
	);
}

/** `12 Mar 2016` — shorter than the ISO date and read at a glance. */
function airDate(raw: string): string {
	const parsed = new Date(`${raw}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return raw;
	return parsed.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export default EpisodeGuide;
