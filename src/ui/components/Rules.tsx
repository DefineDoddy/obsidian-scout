import React from "react";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS } from "../../core/types";
import {
	OP_LABELS,
	RULE_FIELDS,
	TONE_LABELS,
	emptyRule,
	operatorsFor,
	opTakesValue,
	type Condition,
	type RuleField,
	type RuleGroup,
	type RuleMatch,
	type RuleOp,
} from "../../core/library/rules";
import type { StatusTone } from "../../core/library/config";
import { Icon } from "./shared";
import SuggestInput from "./Suggest";

/**
 * Building a rule.
 *
 * The hard part of a condition builder is not the nesting, it is stopping the
 * thing reading like a database console. So: one sentence per row, in the order
 * you would say it out loud — field, then operator, then value — with the
 * operator list narrowed to the ones that field can answer, and the value box
 * changing shape to match. Nothing offers you "Year contains", because a year
 * cannot contain anything, and an editor that lets you write a condition that
 * can never be true is an editor that will be blamed for the empty list.
 *
 * Groups nest one level of indent each, and the "none" match is offered plainly
 * rather than hidden behind a negate checkbox: "none of the following" is how
 * people say it, and it is the arm every real filter eventually needs.
 */

export interface RuleSuggestions {
	genres: string[];
	people: string[];
	statuses: string[];
	collections: string[];
	properties: string[];
}

const MATCH_LABELS: Record<RuleMatch, string> = {
	all: "all",
	any: "any",
	none: "none",
};

export default function RuleEditor({
	rule,
	onChange,
	suggestions,
	depth = 0,
	onRemove,
}: {
	rule: RuleGroup;
	onChange: (next: RuleGroup) => void;
	suggestions: RuleSuggestions;
	depth?: number;
	onRemove?: () => void;
}): React.ReactElement {
	const patch = (next: Partial<RuleGroup>) => onChange({ ...rule, ...next });

	const setCondition = (at: number, condition: Condition) => {
		const conditions = [...rule.conditions];
		conditions[at] = condition;
		patch({ conditions });
	};

	return (
		<div className={`scout-rule${depth > 0 ? " is-nested" : ""}`}>
			<div className="scout-rule-head">
				<span>Match</span>
				<select
					aria-label="Match"
					value={rule.match}
					onChange={(e) => patch({ match: e.target.value as RuleMatch })}
				>
					{(["all", "any", "none"] as RuleMatch[]).map((value) => (
						<option key={value} value={value}>
							{MATCH_LABELS[value]}
						</option>
					))}
				</select>
				<span>of these</span>
				{onRemove && (
					<button
						className="scout-rule-drop"
						aria-label="Remove this group"
						onClick={onRemove}
					>
						<Icon name="x" size={14} />
					</button>
				)}
			</div>

			{rule.conditions.map((condition, at) => (
				<ConditionRow
					// Position is the identity here: conditions have no id, and
					// giving them one would put a field in the saved data whose
					// only job is to satisfy React.
					key={at}
					condition={condition}
					suggestions={suggestions}
					onChange={(next) => setCondition(at, next)}
					onRemove={() =>
						patch({
							conditions: rule.conditions.filter((_, i) => i !== at),
						})
					}
				/>
			))}

			{rule.groups.map((group, at) => (
				<RuleEditor
					key={at}
					rule={group}
					depth={depth + 1}
					suggestions={suggestions}
					onChange={(next) => {
						const groups = [...rule.groups];
						groups[at] = next;
						patch({ groups });
					}}
					onRemove={() =>
						patch({ groups: rule.groups.filter((_, i) => i !== at) })
					}
				/>
			))}

			<div className="scout-rule-add">
				<button
					onClick={() =>
						patch({
							conditions: [
								...rule.conditions,
								{ field: "genre", op: "has", value: "" },
							],
						})
					}
				>
					<Icon name="plus" size={13} /> Condition
				</button>
				{/* Two levels is as deep as anybody reasons reliably, and the
				    third is where a rule stops being readable back. */}
				{depth < 2 && (
					<button
						onClick={() =>
							patch({ groups: [...rule.groups, emptyRule("any")] })
						}
					>
						<Icon name="plus" size={13} /> Group
					</button>
				)}
			</div>
		</div>
	);
}

/** One row: field, operator, and whatever the pair of them needs typed. */
function ConditionRow({
	condition,
	suggestions,
	onChange,
	onRemove,
}: {
	condition: Condition;
	suggestions: RuleSuggestions;
	onChange: (next: Condition) => void;
	onRemove: () => void;
}): React.ReactElement {
	const type = RULE_FIELDS[condition.field].type;
	const ops = operatorsFor(condition.field);

	/** Changing the field can strand the operator, so it is re-picked. */
	const setField = (field: RuleField) => {
		const allowed = operatorsFor(field);
		const op = allowed.includes(condition.op)
			? condition.op
			: (allowed[0] ?? "is");
		onChange({ field, op, value: "", ...(field === "property" ? { key: condition.key ?? "" } : {}) });
	};

	return (
		<div className="scout-condition">
			<select
				aria-label="Field"
				value={condition.field}
				onChange={(e) => setField(e.target.value as RuleField)}
			>
				{(Object.keys(RULE_FIELDS) as RuleField[]).map((field) => (
					<option key={field} value={field}>
						{RULE_FIELDS[field].label}
					</option>
				))}
			</select>

			{condition.field === "property" && (
				<SuggestInput
					className="scout-condition-key"
					label="Property name"
					placeholder="property"
					options={suggestions.properties}
					value={condition.key ?? ""}
					onChange={(key) => onChange({ ...condition, key })}
				/>
			)}

			<select
				aria-label="Condition"
				value={condition.op}
				onChange={(e) =>
					onChange({ ...condition, op: e.target.value as RuleOp })
				}
			>
				{ops.map((op) => (
					<option key={op} value={op}>
						{OP_LABELS[op]}
					</option>
				))}
			</select>

			{opTakesValue(condition.op) && (
				<ValueInput
					condition={condition}
					type={type}
					suggestions={suggestions}
					onChange={onChange}
				/>
			)}

			<button
				className="scout-rule-drop"
				aria-label="Remove this condition"
				onClick={onRemove}
			>
				<Icon name="x" size={14} />
			</button>
		</div>
	);
}

function ValueInput({
	condition,
	type,
	suggestions,
	onChange,
}: {
	condition: Condition;
	type: string;
	suggestions: RuleSuggestions;
	onChange: (next: Condition) => void;
}): React.ReactElement {
	const set = (value: string) => onChange({ ...condition, value });

	if (type === "kind") {
		return (
			<select
				aria-label="Value"
				value={condition.value ?? ""}
				onChange={(e) => set(e.target.value)}
			>
				<option value="">Choose…</option>
				{ALL_MEDIA_KINDS.map((kind) => (
					<option key={kind} value={kind}>
						{MEDIA_KIND_LABELS[kind]}
					</option>
				))}
			</select>
		);
	}

	if (type === "tone") {
		return (
			<select
				aria-label="Value"
				value={condition.value ?? ""}
				onChange={(e) => set(e.target.value)}
			>
				<option value="">Choose…</option>
				{(Object.keys(TONE_LABELS) as StatusTone[]).map((tone) => (
					<option key={tone} value={tone}>
						{TONE_LABELS[tone]}
					</option>
				))}
			</select>
		);
	}

	if (type === "boolean") {
		return (
			<select
				aria-label="Value"
				value={condition.value ?? "true"}
				onChange={(e) => set(e.target.value)}
			>
				<option value="true">yes</option>
				<option value="false">no</option>
			</select>
		);
	}

	if (type === "number" || condition.op === "within") {
		return (
			<>
				<input
					type="number"
					aria-label="Value"
					value={condition.value ?? ""}
					onChange={(e) => set(e.target.value)}
				/>
				{condition.op === "between" && (
					<>
						<span className="scout-condition-and">and</span>
						<input
							type="number"
							aria-label="Second value"
							value={condition.value2 ?? ""}
							onChange={(e) =>
								onChange({ ...condition, value2: e.target.value })
							}
						/>
					</>
				)}
				{condition.op === "within" && (
					<span className="scout-condition-and">days</span>
				)}
			</>
		);
	}

	if (type === "date") {
		return (
			<input
				type="date"
				aria-label="Value"
				value={condition.value ?? ""}
				onChange={(e) => set(e.target.value)}
			/>
		);
	}

	// Text and lists. The suggestions are a hint, not a constraint: a genre you
	// have not got yet is a perfectly good thing to write a collection rule
	// about, and the box takes anything typed into it.
	const list =
		condition.field === "genre"
			? suggestions.genres
			: condition.field === "person"
				? suggestions.people
				: condition.field === "status"
					? suggestions.statuses
					: condition.field === "collection"
						? suggestions.collections
						: [];

	return (
		<SuggestInput
			label="Value"
			placeholder={list.length > 0 ? list[0] : "value"}
			options={list}
			value={condition.value ?? ""}
			onChange={set}
		/>
	);
}
