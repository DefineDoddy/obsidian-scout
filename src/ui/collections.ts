import { FuzzySuggestModal, Notice, type FuzzyMatch } from "obsidian";
import type { ScoutContext } from "../core/context";
import {
	admits,
	collectionMembers,
	emptyCollection,
	isMember,
	withCollection,
	withRenamed,
	type CollectionDef,
} from "../core/library/collections";
import type { LibraryEntry } from "../core/library/entry";
import { MEDIA_KIND_LABELS } from "../core/types";
import { confirmModal, promptModal } from "./confirm";

/**
 * Putting things on a shelf, by name.
 *
 * A manual collection is only worth having if filling one is quick, and until
 * now the only way in was to open each item's dialog and find the row of
 * toggles — six clicks and a scroll to add one film, which is how a feature
 * ends up unused. This is the other way round: name the collection once, then
 * type titles.
 *
 * It stays open after each pick, because nobody adds exactly one thing to a new
 * collection. What has just gone in disappears from the list — it is a member
 * now — so the list is always what is left to choose from, and closing is the
 * gesture that means "that's the lot".
 */
class CollectionPicker extends FuzzySuggestModal<LibraryEntry> {
	/** Counted so the Notice on the way out can say what happened. */
	private added = 0;

	constructor(
		private readonly ctx: ScoutContext,
		private readonly collection: CollectionDef,
	) {
		super(ctx.app);
		this.setPlaceholder(`Add to "${collection.name}" — type a title`);
		this.setInstructions([
			{ command: "↑↓", purpose: "browse" },
			{ command: "↵", purpose: "add, and keep going" },
			{ command: "esc", purpose: "done" },
		]);
	}

	getItems(): LibraryEntry[] {
		const config = this.ctx.settings.library();
		const collection = this.current();
		return this.ctx.library
			.all()
			.filter(
				(entry) =>
					!isMember(entry, collection) &&
					// A rule is a doorman: what it refuses is not offered, rather
					// than accepted here and quietly dropped on the next pass.
					admits(entry, collection, config),
			)
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	getItemText(entry: LibraryEntry): string {
		// The year and the type are searchable as well as shown: two films of
		// the same name are told apart by exactly those.
		return `${entry.title} ${entry.year ?? ""} ${MEDIA_KIND_LABELS[entry.kind]}`;
	}

	renderSuggestion(match: FuzzyMatch<LibraryEntry>, el: HTMLElement): void {
		const entry = match.item;
		el.addClass("scout-pick-row");
		el.createDiv({ cls: "scout-pick-title", text: entry.title });
		el.createDiv({
			cls: "scout-pick-meta",
			text: [MEDIA_KIND_LABELS[entry.kind], entry.year, entry.status]
				.filter(Boolean)
				.join(" · "),
		});
	}

	/**
	 * Chosen, but not finished with.
	 *
	 * `selectSuggestion` is what closes the dialog; overriding it is the only
	 * way to keep one open across several picks. The query is re-run afterwards
	 * so the row that was just added goes away and the next title can be typed
	 * straight over the last one.
	 */
	selectSuggestion(
		match: FuzzyMatch<LibraryEntry>,
		event: MouseEvent | KeyboardEvent,
	): void {
		void this.add(match.item, event);
	}

	private async add(
		entry: LibraryEntry,
		_event: MouseEvent | KeyboardEvent,
	): Promise<void> {
		const collection = this.current();
		const ok = await this.ctx.mutator.setCollections(
			entry,
			withCollection(entry, collection),
			true,
		);
		if (!ok) {
			new Notice(`Could not add "${entry.title}".`);
			return;
		}
		this.added++;
		// A collection that stopped putting things back is the one thing a
		// manual removal has to survive; adding it again is the user saying so.
		if (collection.excluded.includes(entry.path)) {
			this.ctx.settings.saveCollection({
				...collection,
				excluded: collection.excluded.filter((path) => path !== entry.path),
			});
		}
		this.inputEl.value = "";
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.focus();
	}

	// Never reached — `selectSuggestion` handles the choice — but the base class
	// declares it abstract.
	onChooseItem(): void {}

	/** The stored definition, which the adds above keep editing. */
	private current(): CollectionDef {
		return (
			this.ctx.settings
				.collections()
				.find((one) => one.id === this.collection.id) ?? this.collection
		);
	}

	onClose(): void {
		super.onClose();
		if (this.added > 0) {
			new Notice(
				`Added ${this.added} ${this.added === 1 ? "note" : "notes"} to "${
					this.collection.name
				}".`,
			);
		}
	}
}

/** Opens the picker for one collection. */
export function addToCollection(
	ctx: ScoutContext,
	collection: CollectionDef,
): void {
	new CollectionPicker(ctx, collection).open();
}

/* ------------------------------------------------------------------ making */

/**
 * A new collection, named and ready.
 *
 * Optionally with something already in it, which is the case from an item's own
 * dialog: "put this in a new collection" is one thought, and making the user
 * create an empty one and then go and find the item again splits it into two.
 */
export async function newCollection(
	ctx: ScoutContext,
	seed?: LibraryEntry,
): Promise<CollectionDef | null> {
	const name = await promptModal(ctx.app, {
		title: "New collection",
		placeholder: "Comfort rewatches, Bond in order, For the flight…",
		confirmText: "Create",
	});
	if (!name) return null;

	const taken = ctx.settings
		.collections()
		.some((one) => one.name.toLowerCase() === name.trim().toLowerCase());
	if (taken) {
		new Notice(`There is already a collection called "${name.trim()}".`);
		return null;
	}

	const made = emptyCollection(name.trim());
	ctx.settings.saveCollection(made);
	if (seed) {
		await ctx.mutator.setCollections(seed, withCollection(seed, made), true);
	}
	return made;
}

/* --------------------------------------------------------------- renaming */

/**
 * Renaming, notes and all.
 *
 * The name is the membership token — it is the value written in every member's
 * frontmatter — so renaming the definition on its own silently empties the
 * collection: the notes go on naming something that no longer exists, and the
 * chip that used to say twelve says nothing. Every member is rewritten first,
 * and the definition follows, so the two are never out of step for longer than
 * the write takes.
 *
 * Returns how many notes were touched, or -1 when the name was refused.
 */
export async function renameCollection(
	ctx: ScoutContext,
	collection: CollectionDef,
	to: string,
): Promise<number> {
	const name = to.trim();
	if (!name || name === collection.name) return 0;

	const clash = ctx.settings
		.collections()
		.some(
			(one) =>
				one.id !== collection.id &&
				one.name.toLowerCase() === name.toLowerCase(),
		);
	if (clash) {
		new Notice(`There is already a collection called "${name}".`);
		return -1;
	}

	const members = collectionMembers(ctx.library.all(), collection);
	for (const entry of members) {
		await ctx.mutator.setCollections(
			entry,
			withRenamed(entry, collection.name, name),
			true,
		);
	}
	ctx.settings.saveCollection({ ...collection, name });
	return members.length;
}

/** The same, from a menu: asks for the name, then says what it did. */
export async function promptRename(
	ctx: ScoutContext,
	collection: CollectionDef,
): Promise<void> {
	const name = await promptModal(ctx.app, {
		title: "Rename collection",
		value: collection.name,
		confirmText: "Rename",
	});
	if (name === null) return;
	const touched = await renameCollection(ctx, collection, name);
	if (touched > 0) {
		new Notice(
			`Renamed, and updated ${touched} ${touched === 1 ? "note" : "notes"}.`,
		);
	}
}

/* --------------------------------------------------------------- deleting */

/**
 * Forgets the definition, leaving the notes alone.
 *
 * Deliberate: deleting a collection should not go and edit fifty notes, and
 * re-creating one under the same name finds its members waiting. Said out loud
 * in the dialog, because "delete" that leaves something behind is only
 * reassuring if you know it.
 */
export async function deleteCollection(
	ctx: ScoutContext,
	collection: CollectionDef,
): Promise<boolean> {
	const ok = await confirmModal(ctx.app, {
		title: "Delete collection",
		body: `Delete "${collection.name}"? The notes in it keep the property, so nothing is lost from the vault and re-creating the collection under the same name finds them again.`,
		confirmText: "Delete",
		danger: true,
	});
	if (!ok) return false;
	ctx.settings.removeCollection(collection.id);
	return true;
}
