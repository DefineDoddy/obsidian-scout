import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { isAbortError } from "../../core/http";
import { isResolvable, isSearchable } from "../../core/provider";
import { rankResults } from "../../core/ranking";
import type { ViewMode } from "../../core/settings/store";
import {
	MEDIA_KIND_LABELS,
	type MediaItem,
	type MediaKind,
} from "../../core/types";
import { ScoutDetailModal } from "../detailModal";
import { Cover, Icon, KIND_ICONS, useLibraryEntries } from "./shared";

/**
 * One search UI for every provider.
 *
 * Nothing here knows what TMDB or Open Library are — the kind filter, the
 * source filter, and the result cards are all driven by whatever the registry
 * reports. Results already in the vault are marked, so a search doubles as a
 * "do I have this?" check.
 */

type SortBy = "relevance" | "rating-desc" | "year-desc" | "year-asc" | "title";

const SORT_LABELS: Record<SortBy, string> = {
	relevance: "Best match",
	"rating-desc": "Highest rated",
	"year-desc": "Newest first",
	"year-asc": "Oldest first",
	title: "Title (A–Z)",
};

export interface SearchModalProps {
	ctx: ScoutContext;
	/** Restricts the modal to one kind, for the per-kind commands. */
	initialKind?: MediaKind;
	onClose: () => void;
}

export default function SearchModal({
	ctx,
	initialKind,
	onClose,
}: SearchModalProps): React.ReactElement {
	const { registry, settings, factory, library } = ctx;
	useLibraryEntries(library);

	const [query, setQuery] = useState("");
	const [items, setItems] = useState<MediaItem[]>([]);
	/** The query these `items` answer — `query` itself runs ahead of the debounce. */
	const [resultQuery, setResultQuery] = useState("");
	const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
	const [errorText, setErrorText] = useState("");
	const [kind, setKind] = useState<MediaKind | "all">(initialKind ?? "all");
	const [sourceId, setSourceId] = useState<string>("all");
	const [sortBy, setSortBy] = useState<SortBy>("relevance");
	const [viewMode, setViewMode] = useState<ViewMode>(
		settings.core("defaultViewMode"),
	);
	const [busyId, setBusyId] = useState<string | null>(null);

	const inputRef = useRef<HTMLInputElement>(null);
	/** Cancels the previous search so a slow response cannot overwrite a fast one. */
	const inFlight = useRef<AbortController | null>(null);
	const debounce = useRef<number | null>(null);

	const availableKinds = useMemo(
		() =>
			initialKind
				? [initialKind]
				: registry
						.all()
						.filter((p) => settings.isProviderEnabled(p.id))
						.flatMap((p) => p.kinds)
						.filter((k, i, arr) => arr.indexOf(k) === i),
		[registry, settings, initialKind],
	);

	const availableSources = useMemo(
		() =>
			registry
				.all()
				.filter((p) => settings.isProviderEnabled(p.id))
				.filter((p) => isSearchable(p))
				.filter((p) => kind === "all" || p.kinds.includes(kind)),
		[registry, settings, kind],
	);

	useEffect(() => {
		inputRef.current?.focus();
		return () => {
			inFlight.current?.abort();
			if (debounce.current) window.clearTimeout(debounce.current);
		};
	}, []);

	useEffect(() => {
		settings.setCore("defaultViewMode", viewMode);
	}, [viewMode, settings]);

	const runSearch = useCallback(
		async (text: string) => {
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;

			const trimmed = text.trim();
			if (!trimmed) {
				setItems([]);
				setResultQuery("");
				setStatus("idle");
				return;
			}

			setStatus("loading");
			setErrorText("");

			// A pasted URL skips search entirely and resolves directly.
			const resolver = /^https?:\/\//i.test(trimmed)
				? registry
						.configured()
						.filter((p) => settings.isProviderEnabled(p.id))
						.filter(isResolvable)
						.find((p) => p.canResolve(trimmed))
				: undefined;

			try {
				if (resolver) {
					const item = await resolver.resolve(trimmed, {
						signal: controller.signal,
					});
					if (controller.signal.aborted) return;
					setItems([item]);
					setResultQuery(item.title);
					setStatus("idle");
					return;
				}

				const sources = availableSources.filter(
					(p) => sourceId === "all" || p.id === sourceId,
				);
				if (sources.length === 0) {
					setItems([]);
					setStatus("error");
					setErrorText(
						"No sources are enabled and configured for this media type. Check Scout's settings.",
					);
					return;
				}

				// Query every eligible source at once; one failing source must not
				// take the others down with it.
				const settled = await Promise.allSettled(
					sources.map((p) =>
						p.search(trimmed, {
							signal: controller.signal,
							kind: kind === "all" ? undefined : kind,
						}),
					),
				);
				if (controller.signal.aborted) return;

				const merged = settled.flatMap((r) =>
					r.status === "fulfilled" ? r.value : [],
				);
				const failures = settled.filter((r) => r.status === "rejected");

				setItems(merged);
				setResultQuery(trimmed);
				if (merged.length === 0 && failures.length > 0) {
					setStatus("error");
					const reason = (failures[0] as PromiseRejectedResult).reason;
					setErrorText(
						reason instanceof Error
							? reason.message
							: "Search failed. Check your connection and API token.",
					);
				} else {
					setStatus("idle");
				}
			} catch (err) {
				if (isAbortError(err) || controller.signal.aborted) return;
				setStatus("error");
				setErrorText(
					err instanceof Error ? err.message : "Something went wrong.",
				);
			}
		},
		[availableSources, kind, registry, settings, sourceId],
	);

	const onQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setQuery(value);
		if (debounce.current) window.clearTimeout(debounce.current);
		debounce.current = window.setTimeout(() => void runSearch(value), 400);
	};

	// Re-run when a filter changes, so results match the controls.
	useEffect(() => {
		if (!query.trim()) return;
		void runSearch(query);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [kind, sourceId]);

	const visible = useMemo(() => {
		const filtered = items.filter(
			(i) =>
				(kind === "all" || i.ref.kind === kind) &&
				// No artwork is a reliable sign of a stub record — a
				// duplicate, a regional re-listing, or something nobody has
				// filled in — and a wall of blank placeholders is harder to
				// read than a shorter list of real results.
				Boolean(i.thumbnailUrl ?? i.imageUrl),
		);
		// Rank first in every mode: it also drops the near-misses providers pad
		// their responses with, which no sort order should resurface.
		const sorted = rankResults(filtered, resultQuery);
		switch (sortBy) {
			case "rating-desc":
				sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
				break;
			case "year-desc":
				sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
				break;
			case "year-asc":
				sorted.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
				break;
			case "title":
				sorted.sort((a, b) => a.title.localeCompare(b.title));
				break;
			default:
				// `rankResults` has already ordered by relevance.
				break;
		}
		return sorted;
	}, [items, kind, sortBy, resultQuery]);

	/** Straight to a note, no detail view — the fast path for a known title. */
	const create = async (item: MediaItem) => {
		const key = `${item.ref.providerId}:${item.ref.id}`;
		if (busyId) return;
		setBusyId(key);
		const controller = new AbortController();
		try {
			const outcome = await factory.create(item, controller.signal);
			if (outcome) onClose();
		} catch (err) {
			new Notice(
				`Could not create the note: ${
					err instanceof Error ? err.message : "unknown error"
				}`,
			);
		} finally {
			setBusyId(null);
		}
	};

	const activate = (item: MediaItem) => {
		if (settings.core("resultAction") === "create" && !library.match(item)) {
			void create(item);
			return;
		}
		new ScoutDetailModal(ctx, { item }).open();
	};

	const showKindFilter = !initialKind && availableKinds.length > 1;
	const showSourceFilter = availableSources.length > 1;

	return (
		<div className="scout-modal-content">
			<input
				ref={inputRef}
				type="text"
				className="scout-search-input"
				placeholder="Search by title, or paste a link…"
				value={query}
				onChange={onQueryChange}
				aria-label="Search query"
			/>

			<div className="scout-controls">
				{showKindFilter && (
					<select
						aria-label="Media type"
						value={kind}
						onChange={(e) =>
							setKind(e.target.value as MediaKind | "all")
						}
					>
						<option value="all">All types</option>
						{availableKinds.map((k) => (
							<option key={k} value={k}>
								{MEDIA_KIND_LABELS[k]}
							</option>
						))}
					</select>
				)}

				{showSourceFilter && (
					<select
						aria-label="Source"
						value={sourceId}
						onChange={(e) => setSourceId(e.target.value)}
					>
						<option value="all">All sources</option>
						{availableSources.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				)}

				<select
					aria-label="Sort order"
					value={sortBy}
					onChange={(e) => setSortBy(e.target.value as SortBy)}
				>
					{Object.entries(SORT_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>

				<button
					className="scout-view-toggle"
					onClick={() =>
						setViewMode(viewMode === "list" ? "grid" : "list")
					}
					aria-label={
						viewMode === "list"
							? "Switch to grid view"
							: "Switch to list view"
					}
				>
					<Icon name={viewMode === "list" ? "layout-grid" : "rows"} />
				</button>
			</div>

			<div className="scout-results-container">
				{status === "loading" && <p className="scout-message">Searching…</p>}

				{status === "error" && (
					<p className="scout-message scout-error">{errorText}</p>
				)}

				{status === "idle" && query.trim() && visible.length === 0 && (
					<p className="scout-message">No results found.</p>
				)}

				{visible.length > 0 && (
					<div className={`scout-results scout-results-${viewMode}`}>
						{visible.map((item) => {
							const key = `${item.ref.providerId}:${item.ref.kind}:${item.ref.id}`;
							const busy =
								busyId === `${item.ref.providerId}:${item.ref.id}`;
							const owned = library.match(item);
							return (
								<div
									key={key}
									className={`scout-result${busy ? " is-busy" : ""}${
										owned ? " is-owned" : ""
									}`}
									role="button"
									tabIndex={0}
									aria-label={`${item.title}${owned ? ", already in your library" : ""}`}
									onClick={() => activate(item)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											activate(item);
										}
									}}
								>
									<div className="scout-result-art-wrap">
										<Cover
											src={item.thumbnailUrl ?? item.imageUrl}
											alt=""
											title={item.title}
											className="scout-result-art"
										/>
										{owned && (
											<span
												className="scout-owned-badge"
												title="Already in your library"
											>
												<Icon name="check" size={13} />
											</span>
										)}
									</div>
									<div className="scout-result-info">
										<h3>{item.title}</h3>
										<p className="scout-result-meta">
											{/* The same glyph the library
											    cards carry: a result and the
											    card it becomes should look
											    like the same kind of thing. */}
											<Icon
												name={KIND_ICONS[item.ref.kind]}
												size={11}
											/>
											{MEDIA_KIND_LABELS[item.ref.kind]}
											{item.year ? ` · ${item.year}` : ""}
											{typeof item.rating === "number" &&
											item.rating > 0
												? ` · ★ ${item.rating.toFixed(1)}`
												: ""}
										</p>
										{viewMode === "list" && item.description && (
											<p className="scout-result-desc">
												{item.description.slice(0, 160)}
												{item.description.length > 160
													? "…"
													: ""}
											</p>
										)}
									</div>
									{!owned && (
										<button
											className="scout-quick-add"
											aria-label={`Add ${item.title} to your library`}
											title="Add without opening the details"
											onClick={(e) => {
												e.stopPropagation();
												void create(item);
											}}
										>
											<Icon name="plus" size={15} />
										</button>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
