import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import {
	customFieldsFor,
	ratingScaleFor,
	splitList,
	statusesFor,
	statusTone,
	type CustomField,
} from "../../core/library/config";
import { customValue, type LibraryEntry } from "../../core/library/entry";
import Rating from "./Rating";
import { progressFraction, StatusIcon, statusClass } from "./Status";
import { Icon } from "./shared";

/**
 * Editing one library note.
 *
 * Every control writes straight through to the note's frontmatter, so the note
 * stays the source of truth and Dataview, Bases, and hand edits all keep
 * working. Nothing is cached in a side database.
 */

export interface ManagePanelProps {
	ctx: ScoutContext;
	entry: LibraryEntry;
}

/** Autosave delay for the free-text areas. Long enough not to fight typing. */
const SAVE_DELAY = 700;

/** Writes are fire-and-forget: the index change re-renders with the new value. */
const set = (run: () => Promise<void>): void => void run();

export default function ManagePanel({
	ctx,
	entry,
}: ManagePanelProps): React.ReactElement {
	const config = ctx.settings.library();
	const statuses = statusesFor(config, entry.kind);
	const custom = customFieldsFor(config, entry.kind);
	const fraction = progressFraction(entry.progress, entry.progressTotal);
	/**
	 * Only while you are part-way through it.
	 *
	 * Which statuses those are is not something Scout can know from the words
	 * themselves — they are yours — so it goes by the tone the four lists under
	 * "What your statuses mean" sort each one into: started and set aside are
	 * mid-way, planned and finished and given up on are not. A note that
	 * already records a number keeps the row whatever its status, because
	 * hiding a value the note holds would be hiding your own data.
	 */
	const tone = statusTone(config, entry.status);
	const showProgress =
		entry.progress !== undefined || tone === "active" || tone === "paused";

	const scale = ratingScaleFor(config, entry.kind);
	/**
	 * One star per point where the dialog has room for it — five standing in
	 * for ten means every rating needs dividing in your head. Past ten they
	 * stop fitting, and the typed field is the better control anyway.
	 */
	const ratingSlots = scale <= 10 ? scale : 5;

	return (
		<div className="scout-manage">
			<div className="scout-manage-row">
				<span className="scout-manage-label">Your rating</span>
				<div className="scout-manage-control">
					<Rating
						value={entry.rating}
						scale={scale}
						step={config.ratingStep}
						icon={config.ratingIcon}
						slots={ratingSlots}
						size={ratingSlots > 5 ? 18 : 22}
						onChange={(value) =>
							set(() => ctx.mutator.setRating(entry, value))
						}
					/>
				</div>
			</div>

			{statuses.length > 0 && (
				<div className="scout-manage-row">
					<span className="scout-manage-label">Status</span>
					<StatusControl
						ctx={ctx}
						entry={entry}
						fraction={fraction}
					/>
				</div>
			)}

			{showProgress && <ProgressRow ctx={ctx} entry={entry} />}

			<div className="scout-manage-row">
				<span className="scout-manage-label">Dates</span>
				<div className="scout-manage-control scout-date-row">
					<label>
						<span>Started</span>
						<input
							type="date"
							value={dateValue(entry.started)}
							onChange={(e) =>
								set(() =>
									ctx.mutator.setField(
										entry,
										"started",
										e.target.value || null,
									),
								)
							}
						/>
					</label>
					<label>
						<span>Finished</span>
						<input
							type="date"
							value={dateValue(entry.finished)}
							onChange={(e) =>
								set(() =>
									ctx.mutator.setField(
										entry,
										"finished",
										e.target.value || null,
									),
								)
							}
						/>
					</label>
				</div>
			</div>

			{custom.map((field) => (
				<CustomFieldRow
					key={field.id}
					ctx={ctx}
					entry={entry}
					field={field}
				/>
			))}

			<ThoughtsEditor ctx={ctx} entry={entry} />
		</div>
	);
}

/* ------------------------------------------------------------------ status */

/**
 * How many shelves stay as buttons.
 *
 * The segmented control is the better thing to look at and the faster thing to
 * click, and it wraps onto a second line without looking broken — so this is
 * not about what fits. It is about a control that would take four rows of the
 * dialog to show every shelf: past this many, the same choice reads better as
 * a list, and a list has no limit, which the buttons never will.
 */
const MAX_INLINE_STATUSES = 7;

function StatusControl({
	ctx,
	entry,
	fraction,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	fraction: number | undefined;
}): React.ReactElement {
	const config = ctx.settings.library();
	const statuses = statusesFor(config, entry.kind);
	const current = entry.status ?? "";
	const isCurrent = (status: string) =>
		current.toLowerCase() === status.toLowerCase();

	// A status the note carries that is not in the vocabulary — an older word,
	// or one the settings have since dropped — still has to be selectable, or
	// the control would silently show the note as having no status at all.
	const options = current && !statuses.some(isCurrent)
		? [...statuses, current]
		: statuses;

	if (options.length > MAX_INLINE_STATUSES) {
		return (
			<div className="scout-manage-control scout-status-picker">
				<StatusIcon
					config={config}
					status={current}
					progress={fraction}
					size={14}
				/>
				<select
					className={statusClass(config, current).trim()}
					aria-label="Status"
					value={current}
					onChange={(e) =>
						set(() =>
							ctx.mutator.setStatus(entry, e.target.value || null),
						)
					}
				>
					<option value="">No status</option>
					{options.map((status) => (
						<option key={status} value={status}>
							{status}
						</option>
					))}
				</select>
			</div>
		);
	}

	return (
		<div className="scout-status-group">
			{options.map((status) => {
				const active = isCurrent(status);
				const foreign = !statuses.some(
					(s) => s.toLowerCase() === status.toLowerCase(),
				);
				return (
					<button
						key={status}
						className={`scout-status${statusClass(config, status)}${
							active ? " is-on" : ""
						}${foreign ? " is-foreign" : ""}`}
						aria-pressed={active}
						title={status}
						onClick={() =>
							set(() =>
								ctx.mutator.setStatus(
									entry,
									active ? null : status,
								),
							)
						}
					>
						<StatusIcon
							config={config}
							status={status}
							progress={active ? fraction : undefined}
						/>
						<span className="scout-status-label">{status}</span>
					</button>
				);
			})}
		</div>
	);
}

/* ---------------------------------------------------------------- progress */

function ProgressRow({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement {
	const total = entry.progressTotal;
	const current = entry.progress ?? 0;
	const percent = total ? Math.min(100, (current / total) * 100) : 0;

	const step = (delta: number) => {
		const next = Math.max(0, current + delta);
		void ctx.mutator.setProgress(entry, next === 0 ? null : next);
	};

	return (
		<div className="scout-manage-row">
			<span className="scout-manage-label">Progress</span>
			<div className="scout-manage-control scout-progress">
				{/* One segmented control, the same shape as the status row: the
				    two buttons, the value, and the total it counts towards are
				    one thing, not four loose parts sharing a line. */}
				<span className="scout-stepper">
					<button
						aria-label="Decrease progress"
						onClick={() => step(-1)}
						disabled={current <= 0}
					>
						<Icon name="minus" size={14} />
					</button>
					<input
						type="number"
						min={0}
						value={entry.progress ?? ""}
						placeholder="0"
						aria-label="Progress"
						onChange={(e) => {
							const text = e.target.value;
							void ctx.mutator.setProgress(
								entry,
								text ? Number(text) : null,
							);
						}}
					/>
					<button aria-label="Increase progress" onClick={() => step(1)}>
						<Icon name="plus" size={14} />
					</button>
					{total ? (
						<span className="scout-stepper-total">of {total}</span>
					) : null}
				</span>
				{total ? (
					<>
						<span
							className="scout-progress-bar"
							role="progressbar"
							aria-valuenow={current}
							aria-valuemin={0}
							aria-valuemax={total}
						>
							<span style={{ width: `${percent}%` }} />
						</span>
						<span className="scout-progress-percent">
							{Math.round(percent)}%
						</span>
					</>
				) : null}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------ custom fields */

function CustomFieldRow({
	ctx,
	entry,
	field,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	field: CustomField;
}): React.ReactElement {
	const raw = customValue(entry, field.key);
	const write = (value: string | number | boolean | null) =>
		void ctx.mutator.setCustom(entry, field, value);

	let control: React.ReactElement;
	switch (field.type) {
		case "checkbox":
			control = (
				<input
					type="checkbox"
					checked={raw === true || raw === "true"}
					onChange={(e) => write(e.target.checked ? true : null)}
				/>
			);
			break;
		case "number":
			control = (
				<input
					type="number"
					value={typeof raw === "number" ? raw : (raw as string) ?? ""}
					onChange={(e) =>
						write(e.target.value ? Number(e.target.value) : null)
					}
				/>
			);
			break;
		case "date":
			control = (
				<input
					type="date"
					value={dateValue(typeof raw === "string" ? raw : undefined)}
					onChange={(e) => write(e.target.value || null)}
				/>
			);
			break;
		case "select":
			control = (
				<select
					value={typeof raw === "string" ? raw : ""}
					onChange={(e) => write(e.target.value || null)}
				>
					<option value="">—</option>
					{splitList(field.options).map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			);
			break;
		default:
			control = (
				<input
					type="text"
					value={typeof raw === "string" ? raw : String(raw ?? "")}
					onChange={(e) => write(e.target.value || null)}
				/>
			);
	}

	return (
		<div className="scout-manage-row">
			<span className="scout-manage-label">{field.label || field.key}</span>
			<div className="scout-manage-control">{control}</div>
		</div>
	);
}

/* ---------------------------------------------------------------- thoughts */

function ThoughtsEditor({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement {
	const heading = ctx.settings.library().thoughtsHeading;
	const [text, setText] = useState("");
	const [state, setState] = useState<"loading" | "clean" | "dirty" | "saved">(
		"loading",
	);
	const timer = useRef<number | null>(null);
	/**
	 * The entry object is replaced on every index update — including the ones
	 * this panel's own writes cause — so the load effect keys off the path
	 * alone and reads the current entry through a ref. Keying off the object
	 * would reload from disk mid-sentence and discard what was being typed.
	 */
	const current = useRef(entry);
	current.current = entry;

	useEffect(() => {
		let cancelled = false;
		setState("loading");
		void ctx.mutator.readThoughts(current.current).then((value) => {
			if (cancelled) return;
			setText(value);
			setState("clean");
		});
		return () => {
			cancelled = true;
		};
	}, [ctx.mutator, entry.path]);

	const save = useCallback(
		async (value: string) => {
			await ctx.mutator.writeThoughts(current.current, value);
			setState("saved");
		},
		[ctx.mutator],
	);

	// Flush a pending edit when the panel goes away, so closing does not lose it.
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);

	const onChange = (value: string) => {
		setText(value);
		setState("dirty");
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			void save(value);
		}, SAVE_DELAY);
	};

	return (
		<div className="scout-thoughts">
			<div className="scout-thoughts-head">
				<span className="scout-manage-label">{heading}</span>
				<span className="scout-thoughts-state">
					{state === "dirty"
						? "Saving…"
						: state === "saved"
							? "Saved"
							: ""}
				</span>
			</div>
			<textarea
				value={text}
				disabled={state === "loading"}
				placeholder={`What did you make of it? Saved to the "${heading}" section of the note.`}
				aria-label={heading}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => {
					if (timer.current !== null) {
						window.clearTimeout(timer.current);
						timer.current = null;
						void save(text);
					}
				}}
			/>
		</div>
	);
}

/** `<input type="date">` only accepts `YYYY-MM-DD`. */
function dateValue(value: string | undefined): string {
	if (!value) return "";
	const match = /\d{4}-\d{2}-\d{2}/.exec(value);
	return match ? match[0] : "";
}
