import { Menu } from "obsidian";
import React, { useMemo } from "react";
import type { ScoutContext } from "../../core/context";
import {
	collectionCounts,
	collectionNames,
	emptyCollection,
	type CollectionDef,
} from "../../core/library/collections";
import type { LibraryEntry } from "../../core/library/entry";
import {
	addToCollection,
	deleteCollection,
	newCollection,
	promptRename,
} from "../collections";
import { ScoutOrganiseModal } from "../organiseModal";
import { Cover, Icon, resolveImage } from "./shared";

/**
 * The collections, as a place rather than as a row of chips.
 *
 * They used to live on the views bar, one chip each, past a divider — which
 * gave them the shape of a second tab system growing out of the first, and the
 * bar got longer with every shelf you made. A collection is a set of things
 * with artwork; a tab is a word. Given a page of their own they can show what
 * is actually in them, which is the only thing that tells two shelves apart at
 * a glance, and the bar goes back to being a row of views with one more tab on
 * it.
 *
 * Names the vault mentions but the settings do not are shown too, because a
 * note can name a collection nobody created — typed by hand, or left behind by
 * one since deleted — and a page called Collections that hides some of them is
 * lying about the vault.
 */

/** Covers on a card's stack. Four reads as a shelf; more reads as a mosaic. */
const FACES = 4;

interface Shelf {
	key: string;
	name: string;
	def: CollectionDef | undefined;
	count: number;
	faces: LibraryEntry[];
}

export interface CollectionsPageProps {
	ctx: ScoutContext;
	entries: readonly LibraryEntry[];
	/** Filters the library down to one collection and goes back to it. */
	onShow: (name: string) => void;
	/** Bumped when the settings change, so the memo re-reads the definitions. */
	version: number;
}

export default function CollectionsPage({
	ctx,
	entries,
	onShow,
	version,
}: CollectionsPageProps): React.ReactElement {
	const shelves = useMemo<Shelf[]>(() => {
		const defined = ctx.settings.collections();
		const byName = new Map(
			defined.map((def) => [def.name.toLowerCase(), def]),
		);
		const counts = collectionCounts(entries);
		const faces = new Map<string, LibraryEntry[]>();
		// One pass for every card's artwork: a pass per collection is the whole
		// library walked once per shelf, which on a big vault is felt.
		for (const entry of entries) {
			for (const name of entry.collections) {
				const key = name.trim().toLowerCase();
				if (!key) continue;
				const got = faces.get(key);
				if (!got) faces.set(key, [entry]);
				else if (got.length < FACES) got.push(entry);
			}
		}
		return collectionNames(entries, defined).map((name) => {
			const key = name.toLowerCase();
			return {
				key,
				name,
				def: byName.get(key),
				count: counts.get(key) ?? 0,
				faces: faces.get(key) ?? [],
			};
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entries, ctx.settings, version]);

	/** Which collection to put something in, when the page is asked in general. */
	const addAnywhere = (event: React.MouseEvent) => {
		const defined = ctx.settings.collections();
		const menu = new Menu();
		for (const def of defined) {
			menu.addItem((i) =>
				i
					.setTitle(def.name)
					.setIcon(def.icon)
					.onClick(() => addToCollection(ctx, def)),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("New collection…")
				.setIcon("plus")
				.onClick(() => void create()),
		);
		menu.showAtMouseEvent(event.nativeEvent);
	};

	const create = async () => {
		const made = await newCollection(ctx);
		// Straight into filling it, because an empty collection is not the
		// thing anybody wanted — it is the step before it.
		if (made) addToCollection(ctx, made);
	};

	const cardMenu = (shelf: Shelf, event: React.MouseEvent) => {
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Show these")
				.setIcon("library-big")
				.onClick(() => onShow(shelf.name)),
		);
		if (shelf.def) {
			const def = shelf.def;
			menu.addItem((i) =>
				i
					.setTitle("Add items…")
					.setIcon("plus")
					.onClick(() => addToCollection(ctx, def)),
			);
			menu.addItem((i) =>
				i
					.setTitle("Rename…")
					.setIcon("pencil")
					.onClick(() => void promptRename(ctx, def)),
			);
			menu.addItem((i) =>
				i
					.setTitle("Conditions and description…")
					.setIcon("settings-2")
					.onClick(() =>
						new ScoutOrganiseModal(ctx, {
							tab: "collections",
							select: def.id,
						}).open(),
					),
			);
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Delete collection")
					.setIcon("trash-2")
					.onClick(() => void deleteCollection(ctx, def)),
			);
		} else {
			// A name only the notes know about. There is no definition to edit,
			// so the one useful thing is to make it into one.
			menu.addItem((i) =>
				i
					.setTitle("Make this a collection")
					.setIcon("plus")
					.onClick(() => adopt(shelf.name)),
			);
		}
		menu.showAtMouseEvent(event.nativeEvent);
	};

	/** Gives a name the notes already use a definition of its own. */
	const adopt = (name: string) => {
		ctx.settings.saveCollection(emptyCollection(name));
	};

	return (
		<div className="scout-collections-page">
			<div className="scout-collections-head">
				<div>
					<h3>Collections</h3>
					<p className="scout-collections-lede">
						Sets you keep by hand, or by rule. Membership is written
						in the notes themselves, so it survives anything.
					</p>
				</div>
				<div className="scout-collections-actions">
					<button onClick={addAnywhere}>
						<Icon name="plus-circle" size={15} />
						Add an item
					</button>
					<button className="mod-cta" onClick={() => void create()}>
						<Icon name="plus" size={15} />
						New collection
					</button>
				</div>
			</div>

			{shelves.length === 0 ? (
				<div className="scout-empty">
					<Icon name="layers" />
					<h3>No collections yet</h3>
					<p>
						A collection is a shelf you decide the contents of —
						“Comfort rewatches”, “Bond, in order”, “For the flight”.
						Make one and put things on it, or give it a rule and let it
						fill itself.
					</p>
					<button className="mod-cta" onClick={() => void create()}>
						<Icon name="plus" /> New collection
					</button>
				</div>
			) : (
				<div className="scout-collection-cards">
					{shelves.map((shelf) => (
						<div
							key={shelf.key}
							className="scout-collection-card"
							role="button"
							tabIndex={0}
							title={
								shelf.def?.description ||
								`${shelf.count} in ${shelf.name}`
							}
							onClick={() => onShow(shelf.name)}
							onContextMenu={(event) => cardMenu(shelf, event)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onShow(shelf.name);
								}
							}}
						>
							<div className="scout-collection-faces">
								{shelf.faces.length === 0 ? (
									<span className="scout-collection-blank">
										<Icon
											name={shelf.def?.icon || "layers"}
											size={20}
										/>
									</span>
								) : (
									shelf.faces.map((entry) => (
										<Cover
											key={entry.path}
											src={resolveImage(
												ctx.app,
												entry.cover,
												entry.path,
											)}
											alt=""
											title={entry.title}
											className="scout-collection-face"
										/>
									))
								)}
							</div>

							<div className="scout-collection-line">
								<Icon
									name={shelf.def?.icon || "layers"}
									size={14}
								/>
								<span className="scout-collection-name">
									{shelf.name}
								</span>
								{shelf.def?.auto && (
									<span
										className="scout-collection-smart"
										title="Smart — a rule keeps this filled"
									>
										<Icon name="wand-sparkles" size={11} />
									</span>
								)}
								<span className="scout-count">{shelf.count}</span>
							</div>

							{shelf.def?.description ? (
								<p className="scout-collection-note">
									{shelf.def.description}
								</p>
							) : null}

							{/* The one action worth a button rather than a menu:
							    a collection you have just made is empty, and
							    filling it is the only thing you want. */}
							<div className="scout-collection-card-actions">
								{shelf.def && (
									<button
										aria-label={`Add items to ${shelf.name}`}
										title="Add items"
										onClick={(event) => {
											event.stopPropagation();
											addToCollection(ctx, shelf.def!);
										}}
									>
										<Icon name="plus" size={14} />
									</button>
								)}
								<button
									aria-label={`More actions for ${shelf.name}`}
									title="More"
									onClick={(event) => {
										event.stopPropagation();
										cardMenu(shelf, event);
									}}
								>
									<Icon name="more-horizontal" size={14} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
