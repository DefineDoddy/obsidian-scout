import React from "react";
import type { MediaKind } from "../../core/types";
import { Cover, Icon, KIND_ICONS, KindBadge } from "./shared";

/**
 * A thing, as a card.
 *
 * One component for the library grid, the library list, the hub's rails, and
 * the series strip in the detail dialog — not because the code was duplicated
 * (it was, a little) but because the *look* was. Four hand-built cards drifted
 * into four different roundings, three different title treatments and two
 * different hover behaviours, and a shelf that looks like four shelves reads as
 * four unrelated features rather than one library seen from different angles.
 *
 * Deliberately presentational and deliberately dumb: it takes a title, some
 * artwork, and two slots. What goes in the slots — your rating, a countdown,
 * somebody else's score, the year — is the caller's business, because that is
 * the part that genuinely differs between a shelf and a suggestion.
 *
 * A `<div role="button">` rather than a `<button>`. Obsidian gives every button
 * one fixed height and a plate of its own, both of which have to be undone, and
 * a card carrying its own buttons — add, like, pass — cannot be one anyway.
 */

export interface MediaCardProps {
	title: string;
	kind: MediaKind;
	cover?: string;
	/** Tooltip. Defaults to the title, which is truncated to a line. */
	hint?: string;
	/** `scout-t-*`, from `statusClass`. Tints the scrim and the badges. */
	tone?: string;
	showCover?: boolean;
	/** The type glyph on the artwork. Off where the poster is too small for it. */
	showKindBadge?: boolean;
	favorite?: boolean;
	/** The quiet line under the title. */
	meta?: React.ReactNode;
	/** The row under that: ratings, status chips, countdowns. */
	foot?: React.ReactNode;
	/** Anything drawn over the artwork — status pills, tick marks, actions. */
	overlay?: React.ReactNode;
	className?: string;
	/** Inert: no pointer, no hover lift, no keyboard stop. Not greyed out. */
	inert?: boolean;
	onOpen?: (event?: React.MouseEvent) => void;
	onMenu?: (event: React.MouseEvent) => void;
}

export default function MediaCard({
	title,
	kind,
	cover,
	hint,
	tone = "",
	showCover = true,
	showKindBadge = true,
	favorite = false,
	meta,
	foot,
	overlay,
	className = "",
	inert = false,
	onOpen,
	onMenu,
}: MediaCardProps): React.ReactElement {
	return (
		<div
			className={`scout-entry ${className}`.trim()}
			role={inert ? undefined : "button"}
			tabIndex={inert ? undefined : 0}
			aria-label={inert ? undefined : title}
			title={hint ?? title}
			onClick={inert ? undefined : (e) => onOpen?.(e)}
			onContextMenu={onMenu ? (e) => onMenu(e) : undefined}
			onKeyDown={
				inert
					? undefined
					: (e) => {
							if (e.key !== "Enter" && e.key !== " ") return;
							e.preventDefault();
							onOpen?.();
						}
			}
		>
			{showCover && (
				// The tone lives on the artwork so the scrim and every badge on
				// it are coloured by the same status.
				<div className={`scout-entry-art${tone}`}>
					<Cover src={cover} alt="" title={title} />
					{showKindBadge && <KindBadge kind={kind} />}
					{favorite && (
						<span className="scout-entry-fav" aria-label="Favourite">
							<Icon name="heart" />
						</span>
					)}
					{overlay}
				</div>
			)}
			<div className="scout-entry-info">
				{/* Truncated to one line in the grid, so the whole title is worth
				    keeping on the element itself. */}
				<h4>{title}</h4>
				{meta !== undefined && meta !== null && (
					<p className="scout-entry-meta">
						{!showKindBadge && (
							<Icon name={KIND_ICONS[kind]} size={11} />
						)}
						{meta}
					</p>
				)}
				<div className="scout-entry-foot">{foot}</div>
			</div>
		</div>
	);
}
