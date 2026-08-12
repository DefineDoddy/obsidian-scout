import React, { useState } from "react";
import type { ScoutContext } from "../../core/context";
import { isSeriesAware } from "../../core/provider";
import type { MediaItem, MediaRef, Series } from "../../core/types";
import { ScoutDetailModal } from "../detailModal";
import MediaCard from "./Card";
import { Icon, resolveImage, useProviderData } from "./shared";

/**
 * The other films in the same series.
 *
 * A series is the source's fact about the item — the eight Harry Potter films,
 * the Bourne run — and it is not a collection. That word belongs to the shelves
 * you make yourself, and having both under one name meant the dialog said
 * "collection" about something you had never touched while the toolbar said it
 * about something only you could have made. They are different enough that
 * telling them apart should not require reading the paragraph underneath.
 *
 * Only rendered once the record says there is a series to fetch, so a film that
 * belongs to none costs nothing at all.
 *
 * Folded away by default. An eight-film series is a grid of eight posters, and
 * put out flat it was the largest thing in the dialog — taller than the synopsis
 * and taller than the panel you came here to edit, on a fact you already knew
 * about a film you already own. The heading says how many there are, which is
 * the part worth reading at a glance, and opening it is one click for the
 * occasion you actually want the shelf.
 */

/**
 * Whether the shelf was left open, for as long as Obsidian is running.
 *
 * Module state rather than component state, and it has to be: clicking a film in
 * the strip closes this dialog and opens another one, which is a new component
 * with a new `useState`, so the shelf you had just opened folded itself away
 * under you at the exact moment you were using it. Walking a series is the one
 * time the strip should stay where you put it.
 */
let leftOpen = false;

export interface SeriesStripProps {
	ctx: ScoutContext;
	source: MediaRef;
	/** The full record, when it has been fetched: it carries the series id. */
	previous?: MediaItem;
	/** Closes the dialog this strip is in, before opening the next one. */
	onClose: () => void;
}

export function SeriesStrip({
	ctx,
	source,
	previous,
	onClose,
}: SeriesStripProps): React.ReactElement | null {
	const provider = ctx.registry.get(source.providerId);
	const aware = provider && isSeriesAware(provider) ? provider : null;
	// `series_id` is what the record carries now; `collection_id` is the same
	// field under the name it had before the two ideas were told apart, and
	// notes and cached records written then still hold it.
	const hint = previous?.extra?.series_id ?? previous?.extra?.collection_id;
	const wanted = typeof hint === "string" || typeof hint === "number";

	const state = useProviderData<Series | null>(
		aware && wanted
			? (signal) => aware.series(source, { signal, previous })
			: null,
		`${source.providerId}:${source.id}:${wanted ? String(hint) : "none"}`,
	);

	const [expanded, setExpanded] = useState(leftOpen);
	const fold = () => {
		leftOpen = !expanded;
		setExpanded(!expanded);
	};

	const series = state.data;
	if (!series || series.items.length < 2) return null;

	const held = series.items.filter(
		(one) => ctx.library.match(one) !== undefined,
	).length;

	const open = (item: MediaItem) => {
		const owned = ctx.library.match(item);
		onClose();
		new ScoutDetailModal(
			ctx,
			owned ? { entryPath: owned.path } : { item },
		).open();
	};

	return (
		<section className={`scout-series${expanded ? " is-open" : ""}`}>
			{/* The whole heading is the control. A caret alone on the end of a
			    title is a target the width of a caret, and the thing being
			    clicked is the section. */}
			<button
				className="scout-series-toggle scout-section-title"
				aria-expanded={expanded}
				onClick={fold}
			>
				<Icon name="clapperboard" size={14} />
				{series.name}
				<span className="scout-count">
					{/* "three of five" says the one thing about a series worth
					    reading without opening it. */}
					{held > 0 && held < series.items.length
						? `${held} of ${series.items.length}`
						: series.items.length}
				</span>
				<span className="scout-series-caret">
					<Icon name={expanded ? "chevron-up" : "chevron-down"} size={15} />
				</span>
			</button>
			{/* The library's own card, at the library's own size — a series is a
			    shelf of films and had no business looking like anything else. */}
			<div
				className="scout-entries scout-entries-grid scout-series-strip"
				hidden={!expanded}
			>
				{series.items.map((item) => {
					const here = item.ref.id === source.id;
					const owned = ctx.library.match(item);
					return (
						<MediaCard
							key={`${item.ref.providerId}:${item.ref.id}`}
							className={here ? "is-here" : ""}
							title={item.title}
							kind={item.ref.kind}
							cover={resolveImage(
								ctx.app,
								item.thumbnailUrl ?? item.imageUrl,
							)}
							hint={
								here
									? `${item.title} — the one you are looking at`
									: item.title
							}
							showKindBadge={false}
							// Inert rather than disabled: a link back into the
							// dialog you are already in is a trap, but greying it
							// out said "broken" when it means "you are here".
							inert={here}
							onOpen={() => open(item)}
							meta={item.year ?? ""}
							overlay={
								owned ? (
									<span
										className="scout-series-owned"
										aria-label="In your library"
									>
										<Icon name="check" size={11} />
									</span>
								) : undefined
							}
						/>
					);
				})}
			</div>
		</section>
	);
}

export default SeriesStrip;
