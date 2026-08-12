import { Menu, Notice } from "obsidian";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ScoutContext } from "../../core/context";
import {
	admits,
	collectionNames,
	isMember,
	withCollection,
	withoutCollection,
} from "../../core/library/collections";
import {
	allStatuses,
	ratingScaleFor,
	statusesFor,
	GROUP_LABELS,
	SORT_LABELS,
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
	type LibraryQuery,
} from "../../core/library/filter";
import { releaseCountdown } from "../../core/library/release";
import { ruleIsEmpty } from "../../core/library/rules";
import {
	emptyView,
	mergeRules,
	queryIsNarrowed,
	ruleFromQuery,
	viewEntries,
	viewFromQuery,
	type SavedView,
} from "../../core/library/views";
import {
	MEDIA_KIND_LABELS,
	MEDIA_KIND_PLURALS,
	type MediaKind,
} from "../../core/types";
import { addToCollection } from "../collections";
import { promptModal } from "../confirm";
import { ScoutDetailModal } from "../detailModal";
import { ScoutOrganiseModal } from "../organiseModal";
import { ScoutSearchModal } from "../searchModal";
import MediaCard from "./Card";
import CollectionsPage from "./Collections";
import Rating, { formatRating } from "./Rating";
import StatusBadge, {
	progressFraction,
	statusClass,
	statusIconName,
} from "./Status";
import {
	Icon,
	KIND_ICONS,
	ratingThresholds,
	resolveImage,
	useDebounced,
	useLibraryEntries,
	useRenderWindow,
	useSettingsVersion,
} from "./shared";

/**
 * The library.
 *
 * Reads entirely from the index, which reads entirely from the vault — there
 * is no separate database, so a note edited by hand, by Dataview, or on
 * another device shows up here with no sync step.
 */

const LAYOUT_ICONS: Record<LibraryLayout, string> = {
	grid: "layout-grid",
	list: "rows",
	table: "table",
};

/**
 * How many cards go in at a time.
 *
 * Comfortably more than a tall screen of the smallest grid, so the first page
 * is never the whole of what you can see — the point is that the widening
 * happens out of sight, not that the list is short.
 */
const PAGE = 120;

export interface LibraryViewProps {
	ctx: ScoutContext;
}

export default function LibraryView({
	ctx,
}: LibraryViewProps): React.ReactElement {
	/**
	 * The config object is edited in place, so its identity says nothing about
	 * whether it has changed — the version counter is what the memos and the
	 * cards below hang on instead.
	 */
	const version = useSettingsVersion(ctx.settings);
	const entries = useLibraryEntries(ctx.library);
	const config = ctx.settings.library();

	const [query, setQuery] = useState<LibraryQuery>(() => emptyQuery(config));
	const [text, setText] = useState("");
	const debouncedText = useDebounced(text, 180);

	const effective = useMemo<LibraryQuery>(
		() => ({ ...query, text: debouncedText }),
		[query, debouncedText],
	);

	/**
	 * The view being looked through, if any.
	 *
	 * A view owns which entries appear, and how they are ordered and drawn. The
	 * toolbar stays live on top of it rather than being locked out, because the
	 * first thing anybody does with a saved view is narrow it a bit further —
	 * and that narrowing is temporary until it is folded in from the tab's menu.
	 */
	const views = ctx.settings.views();
	const [activeId, setActiveId] = useState<string | null>(null);
	const active = views.find((view) => view.id === activeId) ?? null;
	const layout = active?.layout ?? config.layout;
	/**
	 * Narrowed beyond what the tab itself says.
	 *
	 * Shown on All as well as on a saved view, and it is arguably more useful
	 * there: on a view the dot means "there is something here you could fold
	 * in", and on All it means "this is not saved and will not be here next
	 * time" — which is exactly the thing somebody who has just filtered the
	 * whole library needs to know before they walk away from it.
	 */
	const dirty = queryIsNarrowed(effective);

	/**
	 * Collections have a tab of their own rather than a chip each on the bar.
	 * They are the other page of the library, not a second row of views.
	 */
	const [page, setPage] = useState<"library" | "collections">("library");

	/**
	 * What is written down, and what is not.
	 *
	 * Sort, grouping and layout are settings: changed on a view they belong to
	 * that view, changed on All they are the library's own defaults, and either
	 * way they are saved as you set them. They describe how you like to look at
	 * things, and asking again every session would be tedious.
	 *
	 * Filters — the box, the three dropdowns, the favourites toggle — are not,
	 * and on All they never can be. They are a question you are asking right
	 * now, and a question that answers itself again tomorrow is a library that
	 * has quietly hidden most of itself. A view is where a narrowing is meant
	 * to be kept, which is what "New view" and the tab menu's fold are for; All
	 * is the one tab that must always mean the whole library when you open it.
	 */
	const applyView = (view: SavedView | null) => {
		setActiveId(view?.id ?? null);
		setPage("library");
		setText("");
		setQuery(
			view
				? { ...emptyQuery(config), sortBy: view.sortBy, groupBy: view.groupBy }
				: emptyQuery(config),
		);
	};

	/**
	 * Re-ordering a view in the organise dialog moves the library underneath it.
	 *
	 * The rule needs no help — it is read straight from the settings on every
	 * render — but the sort and the grouping are toolbar state, so without this
	 * they would not change until you switched tabs and back, which reads as the
	 * edit not having saved.
	 */
	const order = active ? `${active.sortBy}/${active.groupBy}` : null;
	const lastOrder = useRef<string | null>(null);
	useEffect(() => {
		if (!active || order === null) {
			lastOrder.current = null;
			return;
		}
		if (lastOrder.current !== order) {
			const first = lastOrder.current === null;
			lastOrder.current = order;
			if (!first) {
				setQuery((current) => ({
					...current,
					sortBy: active.sortBy,
					groupBy: active.groupBy,
				}));
			}
		}
	}, [active, order]);

	/** The view's rule, then whatever the toolbar is narrowing on top of it. */
	const visible = useMemo(
		() =>
			viewEntries(
				filterEntries(entries, effective, config),
				{
					rule: active?.rule ?? { match: "all", conditions: [], groups: [] },
					sortBy: effective.sortBy,
					...(active?.limit ? { limit: active.limit } : {}),
				},
				config,
			),
		[entries, effective, config, version, active],
	);

	const groups = useMemo(
		() => groupEntries(visible, effective.groupBy, config),
		[visible, effective.groupBy, config, version],
	);

	/**
	 * Only as much of it as anybody is looking at.
	 *
	 * The window widens as you reach the bottom; the shelf headings keep their
	 * real counts, because "Horror 59" is a fact about the library and not about
	 * how far down the page you have got.
	 */
	const [limit, sentinel] = useRenderWindow(groups, PAGE);
	const shelves = useMemo(() => {
		const out: {
			key: string;
			label: string;
			total: number;
			entries: LibraryEntry[];
		}[] = [];
		let room = limit;
		for (const group of groups) {
			if (room <= 0) break;
			out.push({
				key: group.key,
				label: group.label,
				total: group.entries.length,
				entries:
					group.entries.length <= room
						? group.entries
						: group.entries.slice(0, room),
			});
			room -= group.entries.length;
		}
		return out;
	}, [groups, limit]);
	const drawn = shelves.reduce((sum, shelf) => sum + shelf.entries.length, 0);
	const held = groups.reduce((sum, group) => sum + group.entries.length, 0);

	const stats = useMemo(
		() => libraryStats(visible, config),
		[visible, config, version],
	);

	const tags = useMemo(() => collectTags(entries).slice(0, 60), [entries]);
	const collections = useMemo(
		() => collectionNames(entries, ctx.settings.collections()),
		[entries, ctx.settings, version],
	);

	/** Only the number, for the tab. The page itself works the rest out. */
	const shelfCount = collections.length;

	/**
	 * The starter views, once.
	 *
	 * The library used to open with a row of type pills — All, Films, TV,
	 * Books — which was a views bar that could not be named, reordered, given
	 * conditions or thrown away. They are seeded as ordinary views instead, for
	 * the types the vault actually holds, and from then on they are yours: two
	 * of them deleted stay deleted.
	 */
	useEffect(() => {
		if (ctx.settings.viewsSeeded() || entries.length === 0) return;
		const counts = new Map<MediaKind, number>();
		for (const entry of entries) {
			counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		}
		const seeds = [...counts.entries()]
			.filter(([, count]) => count > 0)
			.sort((a, b) => b[1] - a[1])
			.map(([kind]) => ({
				...emptyView(config, MEDIA_KIND_PLURALS[kind]),
				icon: KIND_ICONS[kind],
				rule: {
					match: "all" as const,
					conditions: [{ field: "kind" as const, op: "is" as const, value: kind }],
					groups: [],
				},
			}));
		// One type is no choice at all, and a bar with a single tab on it says
		// less than no bar.
		ctx.settings.seedViews(seeds.length > 1 ? seeds : []);
	}, [entries, config, ctx.settings]);

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
	}, [config, entries, version]);

	const patch = (next: Partial<LibraryQuery>) =>
		setQuery((current) => ({ ...current, ...next }));

	/**
	 * A view that pins a layout owns the toggle while it is on: switching would
	 * otherwise write a preference the next click of the view tab undoes.
	 */
	const setLayout = (next: LibraryLayout) => {
		if (active?.layout) ctx.settings.saveView({ ...active, layout: next });
		else ctx.settings.setLibrary("layout", next);
	};

	/**
	 * The same bargain for the sort and the grouping, which a view always owns:
	 * changed while one is on, it is the view that has been re-ordered, not the
	 * library. Otherwise it is the library's own default being set.
	 */
	const setOrder = (next: { sortBy?: LibrarySort; groupBy?: LibraryGroupBy }) => {
		if (active) {
			ctx.settings.saveView({ ...active, ...next });
			return;
		}
		if (next.sortBy) ctx.settings.setLibrary("sortBy", next.sortBy);
		if (next.groupBy) ctx.settings.setLibrary("groupBy", next.groupBy);
	};

	/** A new view, made out of however the library is set right now. */
	const newView = async () => {
		const name = await promptModal(ctx.app, {
			title: "New view",
			placeholder: "On the go, Films to watch, Best of the year…",
			confirmText: "Create",
		});
		if (!name) return;
		const view = viewFromQuery(effective, layout, name);
		ctx.settings.saveView(view);
		setActiveId(view.id);
	};

	const rename = async (view: SavedView) => {
		const name = await promptModal(ctx.app, {
			title: "Rename view",
			value: view.name,
			confirmText: "Rename",
		});
		if (!name || name === view.name) return;
		ctx.settings.saveView({ ...view, name });
	};

	/**
	 * A tab's own menu.
	 *
	 * On the right-click, and on a second click of the tab you are already on —
	 * because a right-click is not a gesture a phone has, and clicking the tab
	 * you are looking at otherwise does nothing at all.
	 */
	const viewMenu = (view: SavedView, event: React.MouseEvent) => {
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Rename…")
				.setIcon("pencil")
				.onClick(() => void rename(view)),
		);
		// Only offered when there is something to fold: on a view showing what
		// it always shows, "save the filters" is a menu item that does nothing.
		if (view.id === activeId && dirty) {
			menu.addItem((i) =>
				i
					.setTitle("Add these filters to this view")
					.setIcon("save")
					.onClick(() => {
						ctx.settings.saveView({
							...view,
							rule: mergeRules(view.rule, ruleFromQuery(effective)),
						});
						// Cleared, because they are the view's now: leaving them
						// on would filter for the same thing twice and make the
						// "changed" dot lie.
						setText("");
						setQuery({
							...emptyQuery(config),
							sortBy: effective.sortBy,
							groupBy: effective.groupBy,
						});
						new Notice(`Added to "${view.name}".`);
					}),
			);
		}
		menu.addItem((i) =>
			i
				.setTitle("Conditions and layout…")
				.setIcon("settings-2")
				.onClick(() =>
					new ScoutOrganiseModal(ctx, {
						tab: "views",
						select: view.id,
					}).open(),
				),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Delete view")
				.setIcon("trash-2")
				.onClick(() => {
					ctx.settings.removeView(view.id);
					if (activeId === view.id) applyView(null);
				}),
		);
		menu.showAtMouseEvent(event.nativeEvent);
	};

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

		// Checked rather than two lists of "add to" and "remove from": the
		// question is which shelves this is on, and the answer is one glance.
		const defined = ctx.settings.collections();
		if (defined.length > 0) {
			menu.addSeparator();
			for (const collection of defined) {
				const on = isMember(entry, collection);
				// A collection with a rule is a shelf with a doorman: you still
				// pick what goes on it, but only from what the rule allows.
				const allowed = on || admits(entry, collection, config);
				menu.addItem((i) =>
					i
						.setTitle(
							allowed
								? collection.name
								: `${collection.name} — does not qualify`,
						)
						.setIcon(collection.icon)
						.setChecked(on)
						.setDisabled(!allowed)
						.onClick(() => {
							void ctx.mutator.setCollections(
								entry,
								on
									? withoutCollection(entry, collection)
									: withCollection(entry, collection),
							);
							// A rule cannot put back what you took out by hand.
							if (on && collection.auto) {
								ctx.settings.saveCollection({
									...collection,
									excluded: [
										...new Set([
											...collection.excluded,
											entry.path,
										]),
									],
								});
							}
						}),
				);
			}
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
		// The background refresh gets round to everything eventually; this is
		// for when you know something has changed and would rather not wait.
		menu.addItem((i) =>
			i
				.setTitle("Refresh from source")
				.setIcon("refresh-cw")
				.setDisabled(!entry.ref)
				.onClick(() => void refreshOne(ctx, entry)),
		);

		menu.showAtMouseEvent(event.nativeEvent);
	};

	/**
	 * The two handlers every card is given, as one identity for the life of the
	 * view.
	 *
	 * Both close over half the component, so they are rebuilt on every render —
	 * and a card handed a new function is a card React has to draw again, which
	 * is the whole library redrawn because somebody typed a letter. The ref is
	 * what lets the cards hold still while the handlers stay current.
	 */
	const handlers = useRef({ open: openEntry, menu: contextMenu });
	handlers.current.open = openEntry;
	handlers.current.menu = contextMenu;
	const onOpen = useCallback(
		(entry: LibraryEntry, event?: React.MouseEvent) =>
			handlers.current.open(entry, event),
		[],
	);
	const onMenu = useCallback(
		(entry: LibraryEntry, event: React.MouseEvent) =>
			handlers.current.menu(entry, event),
		[],
	);

	const filtersActive =
		effective.text.length > 0 ||
		effective.kinds.length > 0 ||
		effective.statuses.length > 0 ||
		effective.tags.length > 0 ||
		effective.collections.length > 0 ||
		effective.favoritesOnly ||
		effective.minRating > 0;

	return (
		<div className="scout-library">
			{/* The views bar. One tab per saved question, and the library itself
			    is the first of them — "All" is a view like any other, it just
			    happens to be the one nobody had to make. */}
			<div className="scout-view-bar" role="tablist" aria-label="Views">
				<button
					role="tab"
					aria-selected={active === null}
					className={active === null ? "is-on" : ""}
					title={
						active === null && filtersActive
							? "The whole library — click again to clear the filters. Nothing here is saved; use “New view” to keep it."
							: "The whole library"
					}
					onClick={() => applyView(null)}
				>
					<Icon name="library-big" size={14} />
					All
					{/* The same dot a narrowed view gets, and here it is doing
					    more work: on All it is the only thing that says the
					    filters are temporary. */}
					{page === "library" && active === null && dirty && (
						<span
							className="scout-view-dirty"
							aria-label="Filtered, and not saved"
							title="These filters are not saved — press “New view” to keep them"
						/>
					)}
				</button>
				{views.map((view) => (
					<button
						key={view.id}
						role="tab"
						aria-selected={view.id === activeId}
						className={view.id === activeId ? "is-on" : ""}
						title={
							view.id === activeId
								? `${view.name} — click again to rename or edit`
								: ruleIsEmpty(view.rule)
									? view.name
									: `${view.name} — with conditions`
						}
						onClick={(event) =>
							view.id === activeId
								? viewMenu(view, event)
								: applyView(view)
						}
						onContextMenu={(event) => viewMenu(view, event)}
					>
						<Icon name={view.icon} size={14} />
						{view.name}
						{view.id === activeId && dirty && (
							<span
								className="scout-view-dirty"
								aria-label="Narrowed further by the filters"
								title="The filters are narrowing this further"
							/>
						)}
					</button>
				))}
				<button
					className="scout-view-save"
					title="Keep the library as it stands as a new view"
					onClick={() => void newView()}
				>
					<Icon name="plus" size={14} />
					New view
				</button>
				{/* One tab, past the divider, rather than a chip per collection.
				    A shelf you made is worth as much of the screen as a rule is
				    — but as a row of chips they turned the views bar into two
				    tab systems sharing a line, and the line grew with every
				    shelf. They get a page instead. */}
				<span className="scout-view-split" aria-hidden="true" />
				<button
					role="tab"
					aria-selected={page === "collections"}
					className={`scout-view-shelves${
						page === "collections" ? " is-on" : ""
					}`}
					title="Sets you keep by hand, or by rule"
					onClick={() => setPage("collections")}
				>
					<Icon name="layers" size={14} />
					Collections
					{shelfCount > 0 && (
						<span className="scout-count">{shelfCount}</span>
					)}
				</button>
				<button
					className="scout-view-manage"
					aria-label="Views and collections"
					title="Views and collections"
					onClick={() => new ScoutOrganiseModal(ctx).open()}
				>
					<Icon name="settings-2" size={14} />
				</button>
			</div>

			{page === "collections" ? (
				<CollectionsPage
					ctx={ctx}
					entries={entries}
					version={version}
					onShow={(name) => {
						// Straight back to the shelf, showing that collection and
						// nothing else — which is what clicking one is asking for.
						setPage("library");
						setActiveId(null);
						setText("");
						setQuery({ ...emptyQuery(config), collections: [name] });
					}}
				/>
			) : (
				<>
				{/* One strip: the box you type in, the dropdowns that narrow it, and
				    the two controls that are not filters at all, pushed to the far
				    end. The dropdowns used to have a line of their own, which spent a
				    whole row on five controls that fit beside the search box. */}
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
								setOrder({ sortBy });
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
								setOrder({ groupBy });
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

					<button
						className="mod-cta scout-add"
						onClick={() => new ScoutSearchModal(ctx).open()}
					>
						<Icon name="plus" />
						<span className="scout-add-label">Add</span>
					</button>

					<div className="scout-layout-toggle" role="group" aria-label="Layout">
						{(["grid", "list", "table"] as LibraryLayout[]).map(
							(option) => (
								<button
									key={option}
									className={layout === option ? "is-on" : ""}
									aria-pressed={layout === option}
									aria-label={`${option} layout`}
									onClick={() => setLayout(option)}
								>
									<Icon name={LAYOUT_ICONS[option]} />
								</button>
							),
						)}
					</div>
				</div>

				<div className="scout-library-body">
					{entries.length === 0 ? (
						<EmptyLibrary ctx={ctx} />
					) : visible.length === 0 ? (
						<p className="scout-message">
							Nothing matches those filters.
						</p>
					) : (
						shelves.map((group) => (
							<section key={group.key} className="scout-group">
								{group.label && (
									<h3 className="scout-group-title">
										{group.label}
										<span className="scout-count">
											{group.total}
										</span>
									</h3>
								)}
								{layout === "table" ? (
									<EntryTable
										ctx={ctx}
										entries={group.entries}
										onOpen={onOpen}
										onMenu={onMenu}
									/>
								) : (
									<div
										className={`scout-entries scout-entries-${layout}`}
										style={
											layout === "grid"
												? {
														gridTemplateColumns: `repeat(auto-fill, minmax(${
															active?.cardSize ??
															config.cardSize
														}px, 1fr))`,
													}
												: undefined
										}
									>
										{group.entries.map((entry) => (
											<EntryCard
												key={entry.path}
												ctx={ctx}
												entry={entry}
												version={version}
												onOpen={onOpen}
												onMenu={onMenu}
											/>
										))}
									</div>
								)}
							</section>
						))
					)}
					{/* Re-keyed so a fresh observer watches it after each widening. */}
					{drawn < held && (
						<div
							key={limit}
							ref={sentinel}
							className="scout-more"
							aria-hidden="true"
						/>
					)}
				</div>

				{/* Under the list, not over it. Four small numbers about what you are
				    looking at are worth having and worth nobody's first glance; at
				    the top they sat between the controls and the shelf. */}
				{config.showStats && entries.length > 0 && (
					<div className="scout-stats scout-stats-foot">
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
			</>
			)}
		</div>
	);
}

/** One note, asked about now. Says what happened, because nothing else will. */
async function refreshOne(
	ctx: ScoutContext,
	entry: LibraryEntry,
): Promise<void> {
	const controller = new AbortController();
	const outcome = await ctx.refresher.refreshOne(entry, controller.signal);
	new Notice(
		outcome === "updated"
			? `Updated "${entry.title}" from its source.`
			: outcome === "unchanged"
				? `"${entry.title}" is already up to date.`
				: `Could not reach the source for "${entry.title}".`,
	);
}

/* ------------------------------------------------------------------- cards */

interface EntryProps {
	ctx: ScoutContext;
	entry: LibraryEntry;
	onOpen: (entry: LibraryEntry, event?: React.MouseEvent) => void;
	onMenu: (entry: LibraryEntry, event: React.MouseEvent) => void;
}

/**
 * `version` is the settings counter, and it is a prop for one reason: the card
 * reads the config for itself, and the config object is edited in place. Given
 * only the entry, a memoized card would keep its covers after you turned covers
 * off. Given the counter, it redraws exactly when the settings say something
 * different — and not when you type a letter into the filter box.
 */
const EntryCard = React.memo(function EntryCard({
	ctx,
	entry,
	onOpen,
	onMenu,
}: EntryProps & { version: number }): React.ReactElement {
	const config = ctx.settings.library();
	// Undefined unless the note actually records how far through it is — that
	// is what decides between a ring and a plain glyph on the status badge, and
	// since the ring says it, the artwork needs no bar underneath saying it
	// again three pixels further down.
	const fraction = progressFraction(entry.progress, entry.progressTotal);
	const countdown = releaseCountdown(entry.releaseDate);
	const score = (entry.sourceRating ?? 0) > 0;
	/**
	 * No date at all, which on something nobody has scored either is what an
	 * announcement looks like — a film with a name and nothing else yet. A year
	 * on its own is enough to rule it out, because a year in the past means it
	 * happened whatever else the note is missing.
	 */
	const undated = entry.year === undefined;
	// On the poster in the grid, where the type is otherwise a guess from the
	// artwork; in the metadata line everywhere the poster is too small for it.
	const chipOnArt = config.showCovers && config.layout === "grid";

	return (
		<MediaCard
			title={entry.title}
			kind={entry.kind}
			cover={resolveImage(ctx.app, entry.cover, entry.path)}
			tone={statusClass(config, entry.status)}
			showCover={config.showCovers}
			showKindBadge={chipOnArt}
			favorite={entry.favorite}
			onOpen={(e) => onOpen(entry, e)}
			onMenu={(e) => onMenu(entry, e)}
			overlay={
				// Over the artwork in the grid, where there is room for it;
				// CSS moves it back down beside the rating in list view.
				config.showStatus && entry.status ? (
					<StatusBadge
						config={config}
						status={entry.status}
						progress={fraction}
						className="scout-entry-status"
						size={11}
					/>
				) : undefined
			}
			meta={
				<>
					{MEDIA_KIND_LABELS[entry.kind]}
					{entry.year ? ` · ${entry.year}` : ""}
					{entry.progress !== undefined
						? ` · ${entry.progress}${
								entry.progressTotal
									? `/${entry.progressTotal}`
									: ""
							}`
						: ""}
				</>
			}
			foot={
				<>
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
						) : score ? (
							// Nothing of your own to show yet, which is most of a
							// backlog: what everyone else made of it is the next
							// most useful thing, and it is already in the note.
							<SourceRating ctx={ctx} entry={entry} />
						) : undated ? (
							// Last of all, and the quietest: no score, no date,
							// nothing to count down to. Saying so beats a blank.
							<span className="scout-entry-countdown is-vague">
								<Icon name="calendar-clock" size={12} />
								Release date TBA
							</span>
						) : null)}
					{config.showStatus && entry.status && (
						<StatusBadge
							config={config}
							status={entry.status}
							progress={fraction}
							className="scout-chip-status"
							size={11}
						/>
					)}
				</>
			}
		/>
	);
});

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
							<td>
								<span className="scout-table-kind">
									<Icon
										name={KIND_ICONS[entry.kind]}
										size={12}
									/>
									{MEDIA_KIND_LABELS[entry.kind]}
								</span>
							</td>
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

