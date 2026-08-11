import { Menu } from "obsidian";
import React, { useMemo, useState } from "react";
import type { ScoutContext } from "../../core/context";
import {
	allStatuses,
	ratingScaleFor,
	statusesFor,
	type LibraryGroupBy,
	type LibraryLayout,
	type LibrarySort,
} from "../../core/library/config";
import type { LibraryEntry } from "../../core/library/entry";
import {
	collectTags,
	emptyQuery,
	filterEntries,
	groupEntries,
	libraryStats,
	sortEntries,
	type LibraryQuery,
} from "../../core/library/filter";
import { releaseCountdown } from "../../core/library/release";
import {
	MEDIA_KIND_LABELS,
	type MediaKind,
} from "../../core/types";
import { ScoutDetailModal } from "../detailModal";
import { ScoutSearchModal } from "../searchModal";
import Rating, { formatRating } from "./Rating";
import StatusBadge, {
	progressFraction,
	statusClass,
	statusIconName,
} from "./Status";
import {
	Cover,
	Icon,
	resolveImage,
	useDebounced,
	useLibraryEntries,
	useSettingsVersion,
} from "./shared";

/**
 * The library.
 *
 * Reads entirely from the index, which reads entirely from the vault — there
 * is no separate database, so a note edited by hand, by Dataview, or on
 * another device shows up here with no sync step.
 */

const SORT_LABELS: Record<LibrarySort, string> = {
	recent: "Recently updated",
	added: "Recently added",
	title: "Title (A–Z)",
	"title-desc": "Title (Z–A)",
	"rating-desc": "Highest rated",
	"rating-asc": "Lowest rated",
	"year-desc": "Newest first",
	"year-asc": "Oldest first",
	status: "Status",
	progress: "Furthest along",
};

const GROUP_LABELS: Record<LibraryGroupBy, string> = {
	none: "No grouping",
	kind: "By type",
	status: "By status",
	genre: "By genre",
	"genre-main": "By main genre",
	person: "By person",
	rating: "By rating",
	favorite: "By favourite",
	decade: "By decade",
	year: "By year",
};

const LAYOUT_ICONS: Record<LibraryLayout, string> = {
	grid: "layout-grid",
	list: "rows",
	table: "table",
};

export interface LibraryViewProps {
	ctx: ScoutContext;
}

export default function LibraryView({
	ctx,
}: LibraryViewProps): React.ReactElement {
	useSettingsVersion(ctx.settings);
	const entries = useLibraryEntries(ctx.library);
	const config = ctx.settings.library();

	const [query, setQuery] = useState<LibraryQuery>(() => emptyQuery(config));
	const [text, setText] = useState("");
	const debouncedText = useDebounced(text, 180);

	const effective = useMemo<LibraryQuery>(
		() => ({ ...query, text: debouncedText }),
		[query, debouncedText],
	);

	const kinds = useMemo(() => {
		const counts = new Map<MediaKind, number>();
		for (const entry of entries) {
			counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1]);
	}, [entries]);

	const visible = useMemo(
		() =>
			sortEntries(
				filterEntries(entries, effective, config),
				effective.sortBy,
				config,
			),
		[entries, effective, config],
	);

	const groups = useMemo(
		() => groupEntries(visible, effective.groupBy, config),
		[visible, effective.groupBy, config],
	);

	const stats = useMemo(
		() => libraryStats(visible, config),
		[visible, config],
	);

	const tags = useMemo(() => collectTags(entries).slice(0, 60), [entries]);
	const statuses = useMemo(() => {
		const configured = allStatuses(config);
		const seen = new Set(configured.map((s) => s.toLowerCase()));
		// Statuses written by hand belong in the filter too, or the entries
		// carrying them cannot be found.
		for (const entry of entries) {
			if (entry.status && !seen.has(entry.status.toLowerCase())) {
				seen.add(entry.status.toLowerCase());
				configured.push(entry.status);
			}
		}
		return configured;
	}, [config, entries]);

	const patch = (next: Partial<LibraryQuery>) =>
		setQuery((current) => ({ ...current, ...next }));

	const setLayout = (layout: LibraryLayout) =>
		ctx.settings.setLibrary("layout", layout);

	const openEntry = (entry: LibraryEntry, event?: React.MouseEvent) => {
		const modifier = event?.ctrlKey || event?.metaKey;
		if (modifier || !config.openDetailOnClick) {
			void ctx.mutator.open(entry, modifier ? true : undefined);
			return;
		}
		new ScoutDetailModal(ctx, { entryPath: entry.path }).open();
	};

	const contextMenu = (entry: LibraryEntry, event: React.MouseEvent) => {
		event.preventDefault();
		const menu = new Menu();

		menu.addItem((i) =>
			i
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => void ctx.mutator.open(entry)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Open in new tab")
				.setIcon("plus-square")
				.onClick(() => void ctx.mutator.open(entry, true)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Show details")
				.setIcon("info")
				.onClick(() =>
					new ScoutDetailModal(ctx, { entryPath: entry.path }).open(),
				),
		);

		menu.addSeparator();
		for (const status of statusesFor(config, entry.kind)) {
			const on =
				(entry.status ?? "").toLowerCase() === status.toLowerCase();
			menu.addItem((i) =>
				i
					.setTitle(status)
					// The same glyph the badge uses, so a status is recognisable
					// here without reading the word.
					.setIcon(statusIconName(config, status))
					.setChecked(on)
					// Picking the status already set clears it, matching what the
					// buttons in the detail dialog do.
					.onClick(() =>
						void ctx.mutator.setStatus(entry, on ? null : status),
					),
			);
		}

		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(
					entry.favorite
						? "Remove from favourites"
						: "Add to favourites",
				)
				.setIcon("heart")
				.onClick(() => void ctx.mutator.toggleFavorite(entry)),
		);

		menu.showAtMouseEvent(event.nativeEvent);
	};

	const filtersActive =
		effective.text.length > 0 ||
		effective.kinds.length > 0 ||
		effective.statuses.length > 0 ||
		effective.tags.length > 0 ||
		effective.favoritesOnly ||
		effective.minRating > 0;

	return (
		<div className="scout-library">
			<div className="scout-library-toolbar">
				<div className="scout-search-wrap">
					<Icon name="search" />
					<input
						type="text"
						className="scout-library-search"
						placeholder="Filter your library…"
						value={text}
						aria-label="Filter the library"
						onChange={(e) => setText(e.target.value)}
					/>
					{text && (
						<button
							className="scout-clear"
							aria-label="Clear filter"
							onClick={() => setText("")}
						>
							<Icon name="x" />
						</button>
					)}
				</div>

				<button
					className="mod-cta scout-add"
					onClick={() => new ScoutSearchModal(ctx).open()}
				>
					<Icon name="plus" /> Add
				</button>

				<div className="scout-layout-toggle" role="group" aria-label="Layout">
					{(["grid", "list", "table"] as LibraryLayout[]).map(
						(layout) => (
							<button
								key={layout}
								className={
									config.layout === layout ? "is-on" : ""
								}
								aria-pressed={config.layout === layout}
								aria-label={`${layout} layout`}
								onClick={() => setLayout(layout)}
							>
								<Icon name={LAYOUT_ICONS[layout]} />
							</button>
						),
					)}
				</div>
			</div>

			{/* One row: the selects sit on the left and the type pills close it
			    off on the right, rather than each taking a line of its own. */}
			<div className="scout-library-filters">
				<div className="scout-filter-controls">
					<select
						aria-label="Status"
						value={effective.statuses[0] ?? ""}
						onChange={(e) =>
							patch({
								statuses: e.target.value ? [e.target.value] : [],
							})
						}
					>
						<option value="">Any status</option>
						{statuses.map((status) => (
							<option key={status} value={status}>
								{status}
							</option>
						))}
					</select>

					<select
						aria-label="Genre"
						value={effective.tags[0] ?? ""}
						onChange={(e) =>
							patch({ tags: e.target.value ? [e.target.value] : [] })
						}
					>
						<option value="">Any genre</option>
						{tags.map((tag) => (
							<option key={tag} value={tag}>
								{tag}
							</option>
						))}
					</select>

					<select
						aria-label="Minimum rating"
						value={String(effective.minRating)}
						onChange={(e) =>
							patch({ minRating: Number(e.target.value) })
						}
					>
						<option value="0">Any rating</option>
						{ratingThresholds(config.ratingScale).map((value) => (
							<option key={value} value={String(value)}>
								{value}+
							</option>
						))}
					</select>

					<select
						aria-label="Sort by"
						value={effective.sortBy}
						onChange={(e) => {
							const sortBy = e.target.value as LibrarySort;
							patch({ sortBy });
							ctx.settings.setLibrary("sortBy", sortBy);
						}}
					>
						{Object.entries(SORT_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>

					<select
						aria-label="Group by"
						value={effective.groupBy}
						onChange={(e) => {
							const groupBy = e.target.value as LibraryGroupBy;
							patch({ groupBy });
							ctx.settings.setLibrary("groupBy", groupBy);
						}}
					>
						{Object.entries(GROUP_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>

					<button
						className={`scout-toggle${
							effective.favoritesOnly ? " is-on" : ""
						}`}
						aria-pressed={effective.favoritesOnly}
						aria-label="Favourites only"
						onClick={() =>
							patch({ favoritesOnly: !effective.favoritesOnly })
						}
					>
						<Icon name="heart" size={15} />
					</button>

					{filtersActive && (
						<button
							className="scout-reset"
							onClick={() => {
								setText("");
								setQuery(emptyQuery(config));
							}}
						>
							Reset
						</button>
					)}
				</div>

				<div className="scout-kind-pills">
					<button
						className={effective.kinds.length === 0 ? "is-on" : ""}
						onClick={() => patch({ kinds: [] })}
					>
						All
						<span className="scout-count">{entries.length}</span>
					</button>
					{kinds.map(([kind, count]) => {
						const on = effective.kinds.includes(kind);
						return (
							<button
								key={kind}
								className={on ? "is-on" : ""}
								aria-pressed={on}
								onClick={() => {
									const next = on
										? effective.kinds.filter(
												(k) => k !== kind,
											)
										: [...effective.kinds, kind];
									// Every type lit is the same view as none, so
									// it collapses back to All rather than
									// leaving the whole row selected.
									patch({
										kinds:
											next.length === kinds.length
												? []
												: next,
									});
								}}
							>
								{MEDIA_KIND_LABELS[kind]}
								<span className="scout-count">{count}</span>
							</button>
						);
					})}
				</div>
			</div>

			{config.showStats && entries.length > 0 && (
				<div className="scout-stats">
					<span>
						<strong>{stats.total}</strong> shown
					</span>
					{stats.inProgress > 0 && (
						<span>
							<strong>{stats.inProgress}</strong> in progress
						</span>
					)}
					{stats.finished > 0 && (
						<span>
							<strong>{stats.finished}</strong> finished
						</span>
					)}
					{stats.averageRating !== null && (
						<span>
							<strong>
								{formatRating(
									Math.round(stats.averageRating * 10) / 10,
								)}
							</strong>{" "}
							/ {config.ratingScale} average
						</span>
					)}
					{stats.favorites > 0 && (
						<span>
							<strong>{stats.favorites}</strong> favourites
						</span>
					)}
				</div>
			)}

			<div className="scout-library-body">
				{entries.length === 0 ? (
					<EmptyLibrary ctx={ctx} />
				) : visible.length === 0 ? (
					<p className="scout-message">
						Nothing matches those filters.
					</p>
				) : (
					groups.map((group) => (
						<section key={group.key} className="scout-group">
							{group.label && (
								<h3 className="scout-group-title">
									{group.label}
									<span className="scout-count">
										{group.entries.length}
									</span>
								</h3>
							)}
							{config.layout === "table" ? (
								<EntryTable
									ctx={ctx}
									entries={group.entries}
									onOpen={openEntry}
									onMenu={contextMenu}
								/>
							) : (
								<div
									className={`scout-entries scout-entries-${config.layout}`}
									style={
										config.layout === "grid"
											? {
													gridTemplateColumns: `repeat(auto-fill, minmax(${config.cardSize}px, 1fr))`,
												}
											: undefined
									}
								>
									{group.entries.map((entry) => (
										<EntryCard
											key={entry.path}
											ctx={ctx}
											entry={entry}
											onOpen={openEntry}
											onMenu={contextMenu}
										/>
									))}
								</div>
							)}
						</section>
					))
				)}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------- cards */

interface EntryProps {
	ctx: ScoutContext;
	entry: LibraryEntry;
	onOpen: (entry: LibraryEntry, event?: React.MouseEvent) => void;
	onMenu: (entry: LibraryEntry, event: React.MouseEvent) => void;
}

function EntryCard({
	ctx,
	entry,
	onOpen,
	onMenu,
}: EntryProps): React.ReactElement {
	const config = ctx.settings.library();
	const cover = resolveImage(ctx.app, entry.cover, entry.path);
	// Undefined unless the note actually records how far through it is — that
	// is what decides between a ring and a plain glyph on the status badge.
	const fraction = progressFraction(entry.progress, entry.progressTotal);
	const percent = (fraction ?? 0) * 100;
	const countdown = releaseCountdown(entry.releaseDate);

	return (
		<div
			className="scout-entry"
			role="button"
			tabIndex={0}
			aria-label={entry.title}
			onClick={(e) => onOpen(entry, e)}
			onContextMenu={(e) => onMenu(entry, e)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen(entry);
				}
			}}
		>
			{config.showCovers && (
				// The tone lives on the artwork so the scrim, the badge, and the
				// progress bar are all coloured by the same status.
				<div
					className={`scout-entry-art${statusClass(config, entry.status)}`}
				>
					<Cover src={cover} alt="" title={entry.title} />
					{entry.favorite && (
						<span className="scout-entry-fav" aria-label="Favourite">
							<Icon name="heart" />
						</span>
					)}
					{/* Over the artwork in the grid, where there is room for it;
					    CSS moves it back down beside the rating in list view. */}
					{config.showStatus && entry.status && (
						<StatusBadge
							config={config}
							status={entry.status}
							progress={fraction}
							className="scout-entry-status"
							size={11}
						/>
					)}
					{percent > 0 && (
						<span className="scout-entry-progress">
							<span style={{ width: `${percent}%` }} />
						</span>
					)}
				</div>
			)}
			<div className="scout-entry-info">
				{/* Truncated to one line in the grid, so the full title is worth
				    keeping on the element itself. */}
				<h4 title={entry.title}>{entry.title}</h4>
				<p className="scout-entry-meta">
					{MEDIA_KIND_LABELS[entry.kind]}
					{entry.year ? ` · ${entry.year}` : ""}
					{entry.progress !== undefined
						? ` · ${entry.progress}${
								entry.progressTotal
									? `/${entry.progressTotal}`
									: ""
							}`
						: ""}
				</p>
				<div className="scout-entry-foot">
					{config.showRatings &&
						(entry.rating !== undefined ? (
							<Rating
								value={entry.rating}
								scale={ratingScaleFor(config, entry.kind)}
								step={config.ratingStep}
								icon={config.ratingIcon}
								size={13}
								readOnly
							/>
						) : countdown ? (
							// Nothing has an opinion on a film nobody has seen.
							// When it arrives is the only fact worth the row.
							<span className="scout-entry-countdown">
								<Icon name="calendar-clock" size={12} />
								{countdown}
							</span>
						) : (
							// Nothing of your own to show yet, which is most of a
							// backlog: what everyone else made of it is the next
							// most useful thing, and it is already in the note.
							<SourceRating ctx={ctx} entry={entry} />
						))}
					{config.showStatus && entry.status && (
						<StatusBadge
							config={config}
							status={entry.status}
							progress={fraction}
							className="scout-chip-status"
							size={11}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * The source's score, for an item you have not rated.
 *
 * Deliberately unlike the rating control — one small glyph and a number, in the
 * faint colour — because it is not your rating and should never be mistaken for
 * it. Renders nothing when the note records no source score.
 */
function SourceRating({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement | null {
	// Zero is not a score, it is a source with nobody having voted yet — which
	// is most unreleased items, and "★ 0" reads as a verdict.
	if (entry.sourceRating === undefined || entry.sourceRating <= 0) return null;
	const source = entry.ref
		? ctx.registry.get(entry.ref.providerId)?.name
		: undefined;
	return (
		<span
			className="scout-source-rating"
			title={`${source ?? "Source"} rating, out of 10`}
		>
			<Icon name="star" size={12} />
			{formatRating(entry.sourceRating)}
		</span>
	);
}

function EntryTable({
	ctx,
	entries,
	onOpen,
	onMenu,
}: {
	ctx: ScoutContext;
	entries: LibraryEntry[];
	onOpen: (entry: LibraryEntry, event?: React.MouseEvent) => void;
	onMenu: (entry: LibraryEntry, event: React.MouseEvent) => void;
}): React.ReactElement {
	const config = ctx.settings.library();
	return (
		<div className="scout-table-wrap">
			<table className="scout-table">
				<thead>
					<tr>
						<th>Title</th>
						<th>Type</th>
						<th>Rating</th>
						<th>Status</th>
						<th>Year</th>
					</tr>
				</thead>
				<tbody>
					{entries.map((entry) => (
						<tr
							key={entry.path}
							tabIndex={0}
							onClick={(e) => onOpen(entry, e)}
							onContextMenu={(e) => onMenu(entry, e)}
							onKeyDown={(e) => {
								if (e.key === "Enter") onOpen(entry);
							}}
						>
							<td>
								{entry.favorite && (
									<span className="scout-table-fav">
										<Icon name="heart" size={12} />
									</span>
								)}
								{entry.title}
							</td>
							<td>{MEDIA_KIND_LABELS[entry.kind]}</td>
							<td>
								{entry.rating !== undefined ? (
									`${formatRating(entry.rating)} / ${ratingScaleFor(config, entry.kind)}`
								) : (entry.sourceRating ?? 0) > 0 ? (
									<SourceRating ctx={ctx} entry={entry} />
								) : (
									"—"
								)}
							</td>
							<td>
								{entry.status ? (
									<StatusBadge
										config={config}
										status={entry.status}
										progress={progressFraction(
											entry.progress,
											entry.progressTotal,
										)}
									/>
								) : (
									"—"
								)}
							</td>
							<td>{entry.year ?? "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/* ------------------------------------------------------------- empty state */

function EmptyLibrary({ ctx }: { ctx: ScoutContext }): React.ReactElement {
	const config = ctx.settings.library();
	return (
		<div className="scout-empty">
			<Icon name="library-big" />
			<h3>Your library is empty</h3>
			<p>
				Scout lists any note whose <code>{config.fields.kind}</code>{" "}
				property names a media type — <code>movie</code>,{" "}
				<code>book</code>, <code>tv</code>, and so on. Notes it creates
				have one already.
			</p>
			<p className="scout-empty-hint">
				Using different property names? Map them under{" "}
				<strong>Settings → Scout → Library</strong>.
			</p>
			<button
				className="mod-cta"
				onClick={() => new ScoutSearchModal(ctx).open()}
			>
				<Icon name="search" /> Find something to add
			</button>
		</div>
	);
}

/** Sensible "N and above" steps for whatever scale is configured. */
function ratingThresholds(scale: number): number[] {
	if (scale <= 5) return [1, 2, 3, 4, 5];
	if (scale <= 10) return [2, 4, 6, 7, 8, 9];
	return [20, 40, 60, 70, 80, 90];
}
