import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";
import type { ScoutContext } from "../../core/context";
import {
	collectionCounts,
	collectionMembers,
	collectionMode,
	emptyCollection,
	trespassers,
	withMode,
	withoutCollection,
	type CollectionDef,
	type CollectionMode,
} from "../../core/library/collections";
import {
	allStatuses,
	GROUP_LABELS,
	LAYOUT_LABELS,
	SORT_LABELS,
	type LibraryConfig,
	type LibraryGroupBy,
	type LibrarySort,
} from "../../core/library/config";
import { collectTags } from "../../core/library/filter";
import { describeRule, ruleIsEmpty } from "../../core/library/rules";
import { emptyView, type SavedView } from "../../core/library/views";
import {
	addToCollection,
	deleteCollection,
	renameCollection,
} from "../collections";
import { confirmModal } from "../confirm";
import RuleEditor, { type RuleSuggestions } from "./Rules";
import { Icon, useLibraryEntries, useSettingsVersion } from "./shared";

/**
 * Views and collections, in one dialog.
 *
 * They are two answers to one question — "show me a part of my library" — and
 * they are built out of the same conditions, so they are managed in the same
 * place rather than in two dialogs the user has to learn separately. The
 * difference is only what happens to the answer: a view shows it, a collection
 * remembers it in the notes.
 *
 * Edits save as you make them. A dialog with an OK button has to hold a draft
 * and decide what happens if you close it, and none of the answers to that are
 * ones anybody wants to think about while naming a shelf.
 */

export interface OrganiseProps {
	ctx: ScoutContext;
	tab?: "views" | "collections";
	/** Opens straight into one item's editor, from its own menu. */
	select?: string;
	onClose: () => void;
}

export default function Organise({
	ctx,
	tab = "views",
	select,
	onClose,
}: OrganiseProps): React.ReactElement {
	useSettingsVersion(ctx.settings);
	const entries = useLibraryEntries(ctx.library);
	const config = ctx.settings.library();
	const [page, setPage] = useState<"views" | "collections">(tab);
	const [picked, setPicked] = useState<string | null>(select ?? null);

	const suggestions = useMemo<RuleSuggestions>(() => {
		const people = new Map<string, string>();
		const properties = new Set<string>();
		for (const entry of entries) {
			for (const person of entry.people) {
				const key = person.toLowerCase();
				if (!people.has(key)) people.set(key, person);
			}
			for (const key of Object.keys(entry.frontmatter)) properties.add(key);
		}
		return {
			genres: collectTags(entries),
			people: [...people.values()].sort((a, b) => a.localeCompare(b)),
			statuses: allStatuses(config),
			collections: ctx.settings.collections().map((c) => c.name),
			properties: [...properties].sort((a, b) => a.localeCompare(b)),
		};
	}, [entries, config, ctx.settings]);

	return (
		<div className="scout-organise">
			<div className="scout-organise-tabs" role="tablist">
				<button
					role="tab"
					aria-selected={page === "views"}
					className={page === "views" ? "is-on" : ""}
					onClick={() => {
						setPage("views");
						setPicked(null);
					}}
				>
					<Icon name="list-filter" size={14} /> Views
				</button>
				<button
					role="tab"
					aria-selected={page === "collections"}
					className={page === "collections" ? "is-on" : ""}
					onClick={() => {
						setPage("collections");
						setPicked(null);
					}}
				>
					<Icon name="layers" size={14} /> Collections
				</button>
			</div>

			{/* The one line that keeps the two from looking like the same
			    feature twice. They overlap in what they can show and differ in
			    what they are: a view is a way of looking at the library and
			    writes nothing; a collection is a set the notes themselves
			    remember, which is why it can hold three unrelated things for a
			    reason no rule could state. */}
			<p className="scout-organise-lede">
				{page === "views"
					? "A saved way of looking at the library — filters, sort, grouping, layout. Nothing is written to your notes; switching away puts it back."
					: "A set remembered in the notes themselves, under a property. Either manual — it holds exactly what you add — or smart, where a rule keeps it filled as the library grows."}
			</p>

			{page === "views" ? (
				<Views
					ctx={ctx}
					config={config}
					picked={picked}
					onPick={setPicked}
					suggestions={suggestions}
				/>
			) : (
				<Collections
					ctx={ctx}
					picked={picked}
					onPick={setPicked}
					suggestions={suggestions}
				/>
			)}

			<div className="scout-organise-foot">
				<button onClick={onClose}>Done</button>
			</div>
		</div>
	);
}

/* ----------------------------------------------------------------- views */

function Views({
	ctx,
	config,
	picked,
	onPick,
	suggestions,
}: {
	ctx: ScoutContext;
	config: LibraryConfig;
	picked: string | null;
	onPick: (id: string | null) => void;
	suggestions: RuleSuggestions;
}): React.ReactElement {
	const views = ctx.settings.views();
	const view = views.find((item) => item.id === picked) ?? null;

	const save = (next: SavedView) => ctx.settings.saveView(next);

	/**
	 * A blank one, showing the whole library.
	 *
	 * The other way in — "+ New view" in the library, which keeps whatever the
	 * toolbar is set to — is the quicker one and the one most people will use.
	 * This is here because a dialog that can edit a thing and not make one
	 * sends you somewhere else to start.
	 */
	const create = () => {
		const made = emptyView(config, `View ${views.length + 1}`);
		save(made);
		onPick(made.id);
	};

	return (
		<div className="scout-organise-body">
			<ul className="scout-organise-list">
				{views.map((item, at) => (
					<li key={item.id} className={item.id === picked ? "is-on" : ""}>
						<button
							className="scout-organise-pick"
							onClick={() => onPick(item.id === picked ? null : item.id)}
						>
							<Icon name={item.icon} size={14} />
							<span className="scout-organise-name">{item.name}</span>
						</button>
						<button
							aria-label="Move up"
							title="Move up"
							disabled={at === 0}
							onClick={() => ctx.settings.moveView(item.id, -1)}
						>
							<Icon name="chevron-up" size={14} />
						</button>
						<button
							aria-label="Move down"
							title="Move down"
							disabled={at === views.length - 1}
							onClick={() => ctx.settings.moveView(item.id, 1)}
						>
							<Icon name="chevron-down" size={14} />
						</button>
						<button
							className="scout-danger"
							aria-label={`Delete ${item.name}`}
							title="Delete"
							onClick={() => {
								ctx.settings.removeView(item.id);
								if (picked === item.id) onPick(null);
							}}
						>
							<Icon name="trash-2" size={14} />
						</button>
					</li>
				))}
				<li className="scout-organise-new">
					<button onClick={create}>
						<Icon name="plus" size={14} /> New view
					</button>
				</li>
			</ul>

			{view ? (
				<div className="scout-organise-edit">
					<Identity
						name={view.name}
						icon={view.icon}
						onName={(name) => save({ ...view, name })}
						onIcon={(icon) => save({ ...view, icon })}
					/>

					{/* One place where what it shows is written down. The filter
					    row in the library says the same things in fewer clicks,
					    and pressing "add these filters to this view" writes them
					    here as conditions rather than keeping a second copy. */}
					<div className="scout-organise-rule">
						<h4>What it shows</h4>
						<p className="scout-organise-note">{describeRule(view.rule)}</p>
						<RuleEditor
							rule={view.rule}
							suggestions={suggestions}
							onChange={(rule) => save({ ...view, rule })}
						/>
					</div>

					<div className="scout-organise-section">
						<h4>Order and layout</h4>
						<Field label="Sort by">
							<select
								value={view.sortBy}
								onChange={(e) =>
									save({
										...view,
										sortBy: e.target.value as LibrarySort,
									})
								}
							>
								{Object.entries(SORT_LABELS).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</Field>
						<Field label="Grouping">
							<select
								value={view.groupBy}
								onChange={(e) =>
									save({
										...view,
										groupBy: e.target.value as LibraryGroupBy,
									})
								}
							>
								{Object.entries(GROUP_LABELS).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</Field>
						<Field label="Layout">
							<select
								value={view.layout ?? ""}
								onChange={(e) =>
									save({
										...view,
										layout:
											(e.target.value as SavedView["layout"]) ||
											null,
									})
								}
							>
								<option value="">The library's own</option>
								{Object.entries(LAYOUT_LABELS).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</Field>
						{view.layout !== "list" && view.layout !== "table" && (
							<Field label="Card width">
								<input
									type="number"
									min={0}
									step={10}
									placeholder="Default"
									value={view.cardSize ?? ""}
									onChange={(e) => {
										const cardSize = Number(e.target.value);
										const next = { ...view };
										if (cardSize > 0) next.cardSize = cardSize;
										else delete next.cardSize;
										save(next);
									}}
								/>
							</Field>
						)}
						<Field label="Show at most">
							<input
								type="number"
								min={0}
								placeholder="Everything"
								value={view.limit ?? ""}
								onChange={(e) => {
									const limit = Number(e.target.value);
									const next = { ...view };
									if (limit > 0) next.limit = limit;
									else delete next.limit;
									save(next);
								}}
							/>
						</Field>
					</div>
				</div>
			) : (
				<p className="scout-message">
					{views.length === 0
						? "No views yet. Make one here, or set the library up the way you want it and press “New view” in the toolbar."
						: "Pick a view to edit it."}
				</p>
			)}
		</div>
	);
}

/**
 * The name and the glyph, on one line.
 *
 * Two short boxes, and stacking them cost two rows of a dialog that had too
 * many. The icon is the narrow one because four characters of "film" is the
 * usual answer.
 */
function Identity({
	name,
	icon,
	onName,
	onIcon,
}: {
	name: string;
	icon: string;
	onName: (value: string) => void;
	onIcon: (value: string) => void;
}): React.ReactElement {
	/**
	 * The name is committed on the way out, not per keystroke.
	 *
	 * For a view that only saved a dozen times instead of once. For a
	 * collection it was a bug you could watch happen: the name is the value
	 * written in every member note, so saving on each keystroke renamed the
	 * collection to "B", then "Bo", then "Bon" — none of which any note names —
	 * and by the third letter the shelf was empty. One commit, one rename, and
	 * the notes come with it.
	 */
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		const next = draft;
		setDraft(null);
		if (next !== null && next.trim() && next !== name) onName(next.trim());
	};

	return (
		<div className="scout-organise-identity">
			<div className="scout-organise-field">
				<label>Name</label>
				<input
					type="text"
					value={draft ?? name}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							setDraft(null);
						}
					}}
				/>
			</div>
			<div className="scout-organise-field scout-organise-icon">
				<label>Icon</label>
				<input
					type="text"
					// The hint that used to sit under the label; the example is
					// the explanation, and it takes no room.
					placeholder="film"
					title="Any Lucide glyph name"
					value={icon}
					onChange={(e) => onIcon(e.target.value)}
				/>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------ collections */

function Collections({
	ctx,
	picked,
	onPick,
	suggestions,
}: {
	ctx: ScoutContext;
	picked: string | null;
	onPick: (id: string | null) => void;
	suggestions: RuleSuggestions;
}): React.ReactElement {
	const entries = useLibraryEntries(ctx.library);
	const config = ctx.settings.library();
	const collections = ctx.settings.collections();
	const collection = collections.find((item) => item.id === picked) ?? null;
	const counts = useMemo(() => collectionCounts(entries), [entries]);
	const [busy, setBusy] = useState(false);

	/** Whether this one has a working rule, and who is inside it improperly. */
	const mode = collection ? collectionMode(collection) : "manual";
	const gated = collection !== null && !ruleIsEmpty(collection.rule);
	const outside = useMemo(
		() => (collection ? trespassers(entries, collection, config) : []),
		[entries, collection, config],
	);
	/** What a manual one actually holds, which is the only thing to show for it. */
	const members = useMemo(
		() =>
			collection ? collectionMembers(entries, collection) : [],
		[entries, collection],
	);

	const save = (next: CollectionDef) => ctx.settings.saveCollection(next);

	/** Removes the members a tightened rule would no longer let in. */
	const evict = async (def: CollectionDef) => {
		const ok = await confirmModal(ctx.app, {
			title: "Take them out",
			body: `Remove ${outside.length} ${outside.length === 1 ? "note" : "notes"} from "${def.name}"? Only the collections property changes; the notes themselves are untouched.`,
			confirmText: "Take out",
			danger: true,
		});
		if (!ok) return;
		for (const entry of outside) {
			await ctx.mutator.setCollections(
				entry,
				withoutCollection(entry, def),
				true,
			);
		}
		new Notice(
			`Removed ${outside.length} from "${def.name}".`,
		);
	};

	const create = () => {
		const made = emptyCollection(`Collection ${collections.length + 1}`);
		save(made);
		onPick(made.id);
	};

	/** Runs the rule now, rather than waiting for the standing order to notice. */
	const fill = async (def: CollectionDef) => {
		setBusy(true);
		try {
			const added = await ctx.collector.fill(def);
			new Notice(
				added === 0
					? `Nothing new qualifies for "${def.name}".`
					: `Added ${added} ${added === 1 ? "note" : "notes"} to "${def.name}".`,
			);
		} finally {
			setBusy(false);
		}
	};

	const remove = async (def: CollectionDef) => {
		if (await deleteCollection(ctx, def)) {
			if (picked === def.id) onPick(null);
		}
	};

	return (
		<div className="scout-organise-body">
			<ul className="scout-organise-list">
				{collections.map((item) => (
					<li key={item.id} className={item.id === picked ? "is-on" : ""}>
						<button
							className="scout-organise-pick"
							onClick={() => onPick(item.id === picked ? null : item.id)}
						>
							<Icon name={item.icon} size={14} />
							<span className="scout-organise-name">{item.name}</span>
							<span className="scout-count">
								{counts.get(item.name.toLowerCase()) ?? 0}
							</span>
							{item.auto && (
								<span className="scout-organise-auto">
									<Icon name="wand-sparkles" size={12} />
									smart
								</span>
							)}
						</button>
						<button
							className="scout-danger"
							aria-label={`Delete ${item.name}`}
							title="Delete"
							onClick={() => void remove(item)}
						>
							<Icon name="trash-2" size={14} />
						</button>
					</li>
				))}
				<li className="scout-organise-new">
					<button onClick={create}>
						<Icon name="plus" size={14} /> New collection
					</button>
				</li>
			</ul>

			{collection && (
				<div className="scout-organise-edit">
					{/* Renaming rewrites the member notes as well as the
					    definition — see `renameCollection`. Doing it here rather
					    than in `save` keeps the icon and description edits as the
					    cheap settings writes they are. */}
					<Identity
						name={collection.name}
						icon={collection.icon}
						onName={(name) =>
							void renameCollection(ctx, collection, name)
						}
						onIcon={(icon) => save({ ...collection, icon })}
					/>
					<div className="scout-organise-field">
						<label>Description</label>
						<input
							type="text"
							placeholder="What is in it, and why"
							value={collection.description}
							onChange={(e) =>
								save({ ...collection, description: e.target.value })
							}
						/>
					</div>

					{/* One choice, made once, rather than a rule box and a
					    checkbox that between them had four states and only two
					    meanings. A collection either holds what you put in it or
					    it holds what a rule describes. */}
					<div className="scout-organise-modes" role="radiogroup">
						{(["manual", "smart"] as CollectionMode[]).map((option) => (
							<button
								key={option}
								role="radio"
								aria-checked={mode === option}
								className={mode === option ? "is-on" : ""}
								onClick={() => save(withMode(collection, option))}
							>
								<Icon
									name={
										option === "manual"
											? "hand"
											: "wand-sparkles"
									}
									size={14}
								/>
								<span className="scout-organise-mode-name">
									{option === "manual" ? "Manual" : "Smart"}
								</span>
								<span className="scout-organise-mode-note">
									{option === "manual"
										? "Holds exactly what you add"
										: "Fills itself from a rule"}
								</span>
							</button>
						))}
					</div>

					{mode === "manual" ? (
						<div className="scout-organise-section">
							<h4>What is in it</h4>
							<p className="scout-organise-note">
								{members.length === 0
									? "Nothing yet. Add titles here, or tick the collection in any item's dialog or right-click menu."
									: `${members.length} ${members.length === 1 ? "note" : "notes"}: ${members
											.slice(0, 6)
											.map((one) => one.title)
											.join(", ")}${members.length > 6 ? "…" : ""}`}
							</p>
							<div className="scout-organise-actions">
								<button
									className="mod-cta"
									onClick={() =>
										addToCollection(ctx, collection)
									}
								>
									<Icon name="plus" size={14} /> Add items…
								</button>
							</div>
						</div>
					) : (
					<div className="scout-organise-rule">
						<h4>What goes in</h4>
						<p className="scout-organise-note">
							{gated
								? `Anything that is ${describeRule(collection.rule).toLowerCase()}, as it arrives. Nothing else can be put in by hand.`
								: "No conditions yet, so nothing qualifies. Add one below, or switch back to manual."}
						</p>
						<RuleEditor
							rule={collection.rule}
							suggestions={suggestions}
							onChange={(rule) => save({ ...collection, rule })}
						/>

						{outside.length > 0 && (
							<p className="scout-organise-note">
								{outside.length}{" "}
								{outside.length === 1 ? "note is" : "notes are"} in this
								collection but would not be let in now
								{outside.length <= 4
									? `: ${outside.map((e) => e.title).join(", ")}.`
									: "."}{" "}
								They stay until you take them out.
							</p>
						)}

						<div className="scout-organise-actions">
							<button
								className="mod-cta"
								disabled={busy || !gated}
								onClick={() => void fill(collection)}
							>
								<Icon name="wand-sparkles" size={14} />
								{busy ? "Adding…" : "Add everything that qualifies"}
							</button>
							{outside.length > 0 && (
								<button
									className="scout-danger"
									onClick={() => void evict(collection)}
								>
									Take out the {outside.length} that no longer{" "}
									{outside.length === 1 ? "qualifies" : "qualify"}
								</button>
							)}
							{collection.excluded.length > 0 && (
								<button
									onClick={() =>
										save({ ...collection, excluded: [] })
									}
								>
									Forget {collection.excluded.length} manual
									removal
									{collection.excluded.length === 1 ? "" : "s"}
								</button>
							)}
						</div>
					</div>
					)}
				</div>
			)}
		</div>
	);
}

/* ----------------------------------------------------------------- shared */

/**
 * One control and its name.
 *
 * No hint line: a second, fainter line under every label turned a column of
 * fields into a wall of small print. What the hint used to say is either a
 * placeholder ("Everything", "film") or nothing, because the label and the
 * options already said it.
 */
function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div className="scout-organise-field">
			<label>{label}</label>
			{children}
		</div>
	);
}
