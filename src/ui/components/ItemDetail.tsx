import { Menu, Notice } from "obsidian";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { isAbortError } from "../../core/http";
import type { LibraryEntry } from "../../core/library/entry";
import { isDetailable } from "../../core/provider";
import { releaseLine } from "../../core/library/release";
import { rankReasons, reasonIcon, type Reason } from "../../core/library/reasons";
import {
	MEDIA_KIND_LABELS,
	type MediaItem,
	type MediaKind,
	type MediaRef,
} from "../../core/types";
import { confirmModal } from "../confirm";
import { hasEpisodes } from "../episodes";
import ManagePanel, { ReplayControl, ReplayCount } from "./ManagePanel";
import { formatRating } from "./Rating";
import { EpisodeGuide, EpisodeGuideLink } from "./Episodes";
import { SeriesStrip } from "./SeriesStrip";
import {
	Cover,
	Icon,
	KIND_ICONS,
	resolveImage,
	useLibraryEntries,
} from "./shared";

/**
 * One item, in full.
 *
 * The same view serves a search result and a note already in the vault,
 * because they are the same thing at different stages: the top half is
 * whatever metadata is known, and the bottom half is the part you own — your
 * rating, your status, your notes — which appears as soon as the note exists.
 */

export interface ItemDetailProps {
	ctx: ScoutContext;
	/** A search result, when opened from the search modal. */
	item?: MediaItem;
	/** A note, when opened from the library. Kept as a path so it stays live. */
	entryPath?: string;
	/** Why the suggestion row put this up, when that is where it came from. */
	reasons?: readonly Reason[];
	onClose: () => void;
}

/** Everything the hero needs, whichever source it came from. */
interface Presented {
	title: string;
	subtitle?: string;
	kind: MediaKind;
	year?: number;
	/** As written, so a countdown can tell a known day from a bare year. */
	releaseDate?: string;
	/** The source's production status — "Planned", "In production". */
	releaseStatus?: string;
	sourceRating?: number;
	cover?: string;
	description?: string;
	tags: string[];
	people: string[];
	url?: string;
}

/**
 * Merged, not chosen between.
 *
 * The note is the user's own record and wins wherever it says anything; the
 * source fills the gaps. Picking one or the other is what made the dialog look
 * different depending on whether it was opened from a search result or from
 * the library, when it is the same item either way.
 */
function present(
	item: MediaItem | undefined,
	entry: LibraryEntry | undefined,
): Presented | null {
	const title = entry?.title ?? item?.title;
	const kind = entry?.kind ?? item?.ref.kind;
	if (!title || !kind) return null;

	const pick = <T,>(mine: T[] | undefined, theirs: T[] | undefined): T[] =>
		mine && mine.length > 0 ? mine : (theirs ?? []);

	return {
		title,
		kind,
		subtitle: item?.subtitle,
		year: entry?.year ?? item?.year,
		releaseDate: entry?.releaseDate ?? item?.releaseDate,
		releaseStatus:
			typeof item?.extra?.status === "string" ? item.extra.status : undefined,
		// The live figure when a source answered, otherwise whatever the note
		// recorded on the day it was made.
		sourceRating: item?.rating ?? entry?.sourceRating,
		cover: entry?.cover ?? item?.imageUrl ?? item?.thumbnailUrl,
		description: entry?.description ?? item?.description,
		tags: pick(entry?.tags, item?.tags),
		people: pick(entry?.people, item?.people),
		url: entry?.url ?? item?.externalUrl,
	};
}

/**
 * A synopsis is cut off in lines now, not characters, so the fold lands where
 * the text actually runs out of room — a fixed character count put it in a
 * different place for every item and, at any width but the one it was tuned
 * at, halfway through a line. How many lines is `.scout-detail-description`'s
 * business; all this side needs to know is whether the cut happened, which is
 * a question only the laid-out element can answer.
 */
function useOverflowing(
	ref: React.RefObject<HTMLElement | null>,
	live: boolean,
	deps: unknown[],
): boolean {
	const [cut, setCut] = useState(false);
	useEffect(() => {
		const el = ref.current;
		// Once unfolded the element is its full height and would measure as
		// fitting, which would take away the control that unfolded it.
		if (!el || !live) return;
		setCut(el.scrollHeight - el.clientHeight > 2);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [live, ...deps]);
	return cut;
}

export default function ItemDetail({
	ctx,
	item,
	entryPath,
	reasons,
	onClose,
}: ItemDetailProps): React.ReactElement {
	// Subscribing keeps the panel live: create a note and the manage controls
	// appear without reopening, edit elsewhere and the values follow.
	useLibraryEntries(ctx.library);

	const [enriched, setEnriched] = useState<MediaItem | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState(false);
	/**
	 * The dialog turns over rather than growing a fold.
	 *
	 * A season of twenty-four episodes cannot share a dialog with a synopsis
	 * and an edit panel without one of the three being squeezed into a strip,
	 * so the guide takes the whole thing and gives it back on the way out.
	 */
	const [page, setPage] = useState<"detail" | "episodes">("detail");

	const entry = entryPath
		? ctx.library.byPath(entryPath)
		: item
			? ctx.library.match(item)
			: undefined;

	const shown = enriched ?? item;
	const view = present(shown, entry);

	/**
	 * Search results carry only what the search endpoint returned, which for
	 * most sources means no cast and no genres. Opening the detail view is an
	 * explicit request for the full record, so fetch it once — for a note that
	 * records where it came from as much as for a result, or the two would show
	 * different things about the same item.
	 */
	const source = item?.ref ?? entry?.ref;
	/**
	 * Keyed by value. The index hands back a rebuilt entry on every change,
	 * including the ones this dialog's own writes cause, so keying the effect
	 * on `entry.ref` itself would refetch forever.
	 */
	const sourceKey = source
		? `${source.providerId}:${source.kind}:${source.id}`
		: "";
	const latest = useRef<{ ref?: MediaRef; item?: MediaItem }>({});
	latest.current = { ref: source, item };

	useEffect(() => {
		const { ref: mediaRef, item: previous } = latest.current;
		if (!mediaRef) return;
		const provider = ctx.registry.get(mediaRef.providerId);
		if (!provider || !isDetailable(provider)) return;

		const controller = new AbortController();
		void provider
			.details(mediaRef, { signal: controller.signal, previous })
			.then((full) => {
				if (!controller.signal.aborted) setEnriched(full);
			})
			.catch((err) => {
				if (!isAbortError(err)) {
					console.warn("Scout: detail fetch failed", err);
				}
			});
		return () => controller.abort();
	}, [ctx.registry, sourceKey]);

	const cover = useMemo(
		() => resolveImage(ctx.app, view?.cover, entry?.path ?? ""),
		[ctx.app, view?.cover, entry?.path],
	);

	const synopsis = useRef<HTMLParagraphElement>(null);
	const long = useOverflowing(synopsis, !expanded, [view?.description]);

	if (!view) {
		return <p className="scout-message">Nothing to show.</p>;
	}

	const episodic = hasEpisodes(ctx, source, view.kind);

	if (page === "episodes" && source && episodic) {
		return (
			<EpisodeGuide
				ctx={ctx}
				source={source}
				entry={entry}
				title={view.title}
				onBack={() => setPage("detail")}
			/>
		);
	}

	const create = async () => {
		if (!shown || busy) return;
		setBusy(true);
		const controller = new AbortController();
		try {
			await ctx.factory.create(shown, controller.signal);
		} catch (err) {
			new Notice(
				`Could not create the note: ${
					err instanceof Error ? err.message : "unknown error"
				}`,
			);
		} finally {
			setBusy(false);
		}
	};

	const soon = releaseLine(view.releaseDate, view.year, view.releaseStatus);
	const description = view.description;

	return (
		<div className="scout-detail">
			<div className="scout-detail-hero">
				{/* The count rides on the artwork rather than in the line of
				    facts. It is the least urgent thing the dialog knows, and in
				    the line it was a fifth clause that pushed the row onto two. */}
				<div className="scout-detail-art">
					<Cover
						src={cover}
						alt=""
						title={view.title}
						className="scout-detail-cover"
					/>
					{entry && <ReplayCount entry={entry} />}
				</div>

				<div className="scout-detail-head">
					<h2>{view.title}</h2>
					{view.subtitle && view.subtitle !== view.title && (
						<p className="scout-detail-subtitle">{view.subtitle}</p>
					)}

					{/* One quiet line rather than a stack of chips: the record
					    itself is not what you came to this dialog to do. */}
					<p className="scout-detail-meta">
						{/* The glyph the cards carry, so a dialog opened from
						    one is recognisably about the same thing. */}
						<span className="scout-detail-kind">
							<Icon name={KIND_ICONS[view.kind]} size={13} />
							{MEDIA_KIND_LABELS[view.kind]}
						</span>
						{view.year ? <span>{view.year}</span> : null}
						{typeof view.sourceRating === "number" &&
							view.sourceRating > 0 && (
								<span title="Rating from the source">
									★ {formatRating(view.sourceRating)}/10
								</span>
							)}
						{soon && <span className="scout-detail-soon">{soon}</span>}
						{/* On the end of the same line rather than a line of
						    their own. Two greys stacked under a title are not a
						    hierarchy — they are one block of small text with a
						    fold in it, and the eye reads neither. */}
						{view.tags.length > 0 && (
							<span className="scout-detail-genres">
								{view.tags.slice(0, 3).join(", ")}
							</span>
						)}
						{/* "In your library" used to sit here. A dialog offering
						    to open the note, delete it and rate it has already
						    said so twice; the badge was the third time. */}
					</p>

					<div className="scout-detail-actions">
						{!entry && shown && (
							<button
								className="mod-cta"
								disabled={busy}
								onClick={() => void create()}
							>
								<Icon name="plus" size={15} />
								{busy ? "Creating…" : "Add to library"}
							</button>
						)}
						{entry && (
							<button
								className="mod-cta"
								onClick={() => {
									void ctx.mutator.open(entry);
									onClose();
								}}
							>
								<Icon name="file-text" size={15} /> Open note
							</button>
						)}
						{/* Among the things you can *do* to the item, which is
						    what it is. Tucked onto the end of the dates row it
						    read as a third date field, and it was the one
						    control down there that rearranges the others. The
						    count that used to travel with it is a fact, and has
						    gone onto the poster. */}
						{entry && <ReplayControl ctx={ctx} entry={entry} />}
						{/* Nothing to open a menu for yet, so the one link a
						    search result has stays a button. */}
						{!entry && view.url && (
							<a
								className="scout-button"
								href={view.url}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Icon name="external-link" size={15} /> Source
							</a>
						)}
						{/* Beside the other things you can do to the item, rather
						    than hanging off the end of the rating row where it
						    read as part of the score. */}
						{entry && (
							<button
								className={`scout-fav${entry.favorite ? " is-on" : ""}`}
								aria-pressed={entry.favorite}
								aria-label={
									entry.favorite
										? "Remove from favourites"
										: "Add to favourites"
								}
								onClick={() =>
									void ctx.mutator.toggleFavorite(entry)
								}
							>
								<Icon name="heart" size={16} />
							</button>
						)}
						{/* The rest behind one glyph. Five buttons wrapped onto
						    two rows and gave equal weight to opening the note and
						    deleting it; these two are the ones you reach for
						    rarely and never by accident. */}
						{entry && (
							<button
								className="scout-more-actions"
								aria-label="More actions"
								title="More"
								onClick={(event) =>
									moreMenu(ctx, entry, view.url, onClose, event)
								}
							>
								<Icon name="more-horizontal" size={16} />
							</button>
						)}
					</div>
				</div>
			</div>

			{description && (
				// The toggle sits under the text rather than after the last
				// word: inline, it landed wherever the sentence happened to end
				// and the paragraph reflowed around it on every click.
				<div
					className={`scout-detail-description${
						expanded ? " is-open" : ""
					}`}
				>
					<p ref={synopsis}>{description}</p>
					{(long || expanded) && (
						<button
							className="scout-link-button"
							onClick={() => setExpanded(!expanded)}
						>
							{expanded ? "Show less" : "Show more"}
						</button>
					)}
				</div>
			)}

			{view.people.length > 0 && (
				<p className="scout-detail-people">
					<strong>People:</strong> {view.people.slice(0, 12).join(", ")}
				</p>
			)}

			<WhyThis reasons={reasons} />

			{/* Both sit above the panel you edit: they are about the thing
			    itself, and the panel ends in a text area nobody should have to
			    scroll past to find out what is in a series. */}
			{episodic && (
				<EpisodeGuideLink
					entry={entry}
					item={shown}
					onOpen={() => setPage("episodes")}
				/>
			)}
			{source && (
				<SeriesStrip
					ctx={ctx}
					source={source}
					previous={shown}
					onClose={onClose}
				/>
			)}

			{entry ? (
				<ManagePanel ctx={ctx} entry={entry} />
			) : (
				<p className="scout-detail-hint">
					Add this to your library to rate it, track its status, and
					write your thoughts.
				</p>
			)}
		</div>
	);
}

/**
 * Why the row put this up, in full.
 *
 * A rail card has room for one reason of about twenty characters, so the model
 * would work out four things it recognised and then say one of them — and the
 * one it said was ellipsed. This is where the room is. Marks against it are
 * shown too, and deliberately: a recommender that will only tell you what it
 * likes about a suggestion is one you cannot check, and "it is a Musical and
 * you have turned those down" is exactly the sentence that makes an otherwise
 * baffling row make sense.
 */
function WhyThis({
	reasons,
}: {
	reasons: readonly Reason[] | undefined;
}): React.ReactElement | null {
	if (!reasons || reasons.length === 0) return null;
	const ranked = rankReasons(reasons, 6);
	return (
		<section className="scout-detail-why">
			<h3 className="scout-section-title">
				<Icon name="wand-sparkles" size={14} />
				Why this is here
			</h3>
			<ul>
				{ranked.map((one) => (
					<li
						key={`${one.kind}:${one.label}`}
						className={one.against ? "is-against" : undefined}
					>
						<Icon name={reasonIcon(one.kind)} size={13} />
						<span>{one.label}</span>
						{one.against && (
							<span className="scout-detail-why-mark">against</span>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

/** The occasional things: the source page, and deleting the note. */
function moreMenu(
	ctx: ScoutContext,
	entry: LibraryEntry,
	url: string | undefined,
	onClose: () => void,
	event: React.MouseEvent,
): void {
	const menu = new Menu();
	if (url) {
		menu.addItem((i) =>
			i
				.setTitle("Open source page")
				.setIcon("external-link")
				.onClick(() => window.open(url, "_blank", "noopener")),
		);
	}
	menu.addItem((i) =>
		i
			.setTitle("Open note in new tab")
			.setIcon("plus-square")
			.onClick(() => void ctx.mutator.open(entry, true)),
	);
	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle("Delete note")
			.setIcon("trash-2")
			.onClick(() => void remove(ctx, entry, onClose)),
	);
	menu.showAtMouseEvent(event.nativeEvent);
}

/** Confirms before trashing, unless the user has turned the prompt off. */
async function remove(
	ctx: ScoutContext,
	entry: LibraryEntry,
	onClose: () => void,
): Promise<void> {
	if (ctx.settings.library().confirmDelete) {
		const ok = await confirmModal(ctx.app, {
			title: "Delete note",
			body: `Move "${entry.title}" to the trash? This uses Obsidian's own delete, so it follows whatever you have set under Files and links.`,
			confirmText: "Delete",
			danger: true,
		});
		if (!ok) return;
	}
	await ctx.mutator.trash(entry);
	onClose();
}
