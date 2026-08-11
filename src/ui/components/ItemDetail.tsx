import { Notice } from "obsidian";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { isAbortError } from "../../core/http";
import type { LibraryEntry } from "../../core/library/entry";
import { isDetailable } from "../../core/provider";
import { releaseCountdown } from "../../core/library/release";
import {
	MEDIA_KIND_LABELS,
	type MediaItem,
	type MediaKind,
	type MediaRef,
} from "../../core/types";
import { confirmModal } from "../confirm";
import ManagePanel from "./ManagePanel";
import { formatRating } from "./Rating";
import { Cover, Icon, resolveImage, useLibraryEntries } from "./shared";

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

const DESCRIPTION_CLAMP = 420;

export default function ItemDetail({
	ctx,
	item,
	entryPath,
	onClose,
}: ItemDetailProps): React.ReactElement {
	// Subscribing keeps the panel live: create a note and the manage controls
	// appear without reopening, edit elsewhere and the values follow.
	useLibraryEntries(ctx.library);

	const [enriched, setEnriched] = useState<MediaItem | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState(false);

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

	if (!view) {
		return <p className="scout-message">Nothing to show.</p>;
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

	const countdown = releaseCountdown(view.releaseDate);
	const long = (view.description?.length ?? 0) > DESCRIPTION_CLAMP;
	const description =
		long && !expanded
			? `${view.description?.slice(0, DESCRIPTION_CLAMP).trimEnd()}…`
			: view.description;

	return (
		<div className="scout-detail">
			<div className="scout-detail-hero">
				<Cover
					src={cover}
					alt=""
					title={view.title}
					className="scout-detail-cover"
				/>

				<div className="scout-detail-head">
					<h2>{view.title}</h2>
					{view.subtitle && view.subtitle !== view.title && (
						<p className="scout-detail-subtitle">{view.subtitle}</p>
					)}

					{/* One quiet line rather than a stack of chips: the record
					    itself is not what you came to this dialog to do. */}
					<p className="scout-detail-meta">
						<span>{MEDIA_KIND_LABELS[view.kind]}</span>
						{view.year ? <span>{view.year}</span> : null}
						{typeof view.sourceRating === "number" &&
							view.sourceRating > 0 && (
								<span title="Rating from the source">
									★ {formatRating(view.sourceRating)}/10
								</span>
							)}
						{countdown && (
							<span className="scout-detail-soon">{countdown}</span>
						)}
						{entry && (
							<span className="scout-detail-owned">
								<Icon name="check" size={13} /> In your library
							</span>
						)}
					</p>

					{/* Genres as a second quiet line rather than a row of pills.
					    Six chips under the title competed with the title. */}
					{view.tags.length > 0 && (
						<p className="scout-detail-genres">
							{view.tags.slice(0, 5).join(" · ")}
						</p>
					)}

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
						{view.url && (
							<a
								className="scout-button"
								href={view.url}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Icon name="external-link" size={15} /> Source
							</a>
						)}
						{entry && (
							<button
								className="scout-danger"
								onClick={() => void remove(ctx, entry, onClose)}
							>
								<Icon name="trash-2" size={15} /> Delete
							</button>
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
					</div>
				</div>
			</div>

			{description && (
				// The toggle sits under the text rather than after the last
				// word: inline, it landed wherever the sentence happened to end
				// and the paragraph reflowed around it on every click.
				<div className="scout-detail-description">
					<p>{description}</p>
					{long && (
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
