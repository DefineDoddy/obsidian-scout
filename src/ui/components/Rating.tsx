import React, { useState } from "react";
import type { RatingIcon } from "../../core/library/config";

/**
 * The rating control.
 *
 * Scale, step, and icon are all settings, so the same component covers five
 * stars with halves, a score out of ten, and a plain number — the three ways
 * people actually rate things.
 *
 * How many icons there are is the caller's call, because it depends entirely
 * on the room: five in a grid card, where ten would overflow it, and one per
 * point in the dialog, where a score out of ten reads without arithmetic. A
 * hundred-point scale is five icons everywhere — a row of a hundred is absurd.
 *
 * The icon count says nothing about how precisely you can aim at them, which
 * is a separate question: each icon is divided into as many hit zones as the
 * step allows, up to four, so a scale of ten takes half points off a row of
 * five stars. Where that cannot reach every allowed value — a hundred-point
 * scale being the obvious one — or where the caller asks for it outright, the
 * readout beside the row is an editable field, and typing 87 is exact in a way
 * no pointer will ever be.
 */

const PATHS: Record<Exclude<RatingIcon, "number">, string> = {
	star: "M12 2.4l2.9 5.88 6.5.95-4.7 4.58 1.11 6.47L12 17.22l-5.81 3.06 1.11-6.47-4.7-4.58 6.5-.95L12 2.4z",
	heart: "M12 20.7l-1.34-1.22C5.9 15.16 3 12.53 3 9.3 3 6.67 5.07 4.6 7.7 4.6c1.49 0 2.91.69 3.8 1.78a4.86 4.86 0 0 1 3.8-1.78c2.63 0 4.7 2.07 4.7 4.7 0 3.23-2.9 5.86-7.66 10.19L12 20.7z",
	circle: "M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6z",
};

/** Icons in a row, unless the caller has room for more. */
const SLOTS = 5;

/**
 * Most hit zones one icon is divided into.
 *
 * Four across an eighteen-pixel star is a four-pixel target, which is about as
 * small as a pointer manages. Anything finer than this belongs in the field,
 * not under the cursor.
 */
const MAX_ZONES = 4;

/**
 * How many parts one icon splits into, given the step.
 *
 * Only divisions that land on values the step allows are offered — halves of a
 * five-point scale in whole steps would set 0.5 on a note that is supposed to
 * hold integers — so this takes the finest division that divides evenly.
 */
function zonesPerSlot(perSlot: number, step: number): number {
	if (!(step > 0)) return 1;
	for (let zones = MAX_ZONES; zones > 1; zones--) {
		const size = perSlot / zones;
		if (Math.abs(size / step - Math.round(size / step)) < 1e-9) return zones;
	}
	return 1;
}

/** Kills floating-point dust like 6.999999999999999 from the arithmetic below. */
function snap(value: number, step: number): number {
	if (!(step > 0)) return value;
	return Math.round(Math.round(value / step) * step * 1e6) / 1e6;
}

/**
 * How finely a typed score may be aimed, whatever the icons can reach.
 *
 * The step is a property of the row of stars — it says where a click may land,
 * because a click lands somewhere whether you meant it to or not. Typing has no
 * such problem: someone who writes 7.4 has said 7.4 on purpose, and rounding it
 * to the nearest half because the stars only do halves is the app overruling a
 * number the person typed with their hands.
 */
const TYPED_STEP = 0.1;

/** The finer of the two: a tenth, or the scale's own step when it is finer. */
function typedStep(step: number): number {
	return step > 0 ? Math.min(step, TYPED_STEP) : TYPED_STEP;
}

export interface RatingProps {
	value: number | undefined;
	scale: number;
	step: number;
	icon: RatingIcon;
	readOnly?: boolean;
	/**
	 * Icons in the row. Five everywhere space is short — a grid card, a table
	 * cell — and one per point where there is room for them, which turns a
	 * ten-point scale into ten stars you can read without arithmetic.
	 */
	slots?: number;
	/** Icon size in pixels. */
	size?: number;
	/**
	 * Always offer the typed field, even where the icons can reach every value
	 * the step allows.
	 *
	 * Ten stars in half steps *can* land on 7.5 by pointing — but landing on it
	 * means hitting a nine-pixel target, and where there is room for the field
	 * there is no reason to make anyone. Off by default, because a card has
	 * nowhere to put it.
	 */
	exact?: boolean;
	onChange?: (value: number | null) => void;
}

function Glyph({
	path,
	fraction,
	size,
}: {
	path: string;
	fraction: number;
	size: number;
}): React.ReactElement {
	const svg = (filled: boolean) => (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			aria-hidden="true"
			className={filled ? "is-filled" : "is-track"}
		>
			<path d={path} />
		</svg>
	);
	return (
		<span className="scout-rating-glyph" style={{ width: size, height: size }}>
			{svg(false)}
			<span
				className="scout-rating-fill"
				style={{ width: `${Math.round(fraction * 100)}%` }}
			>
				{svg(true)}
			</span>
		</span>
	);
}

/**
 * A score you type.
 *
 * Held locally while it is being typed, and only written when you leave the box
 * or press Enter. Writing on every keystroke looked like the field fighting
 * back, and it was: "7." is not a number, so it was read as 7, rounded to the
 * step, written to the note, and handed back as "7" — the dot you had just
 * typed gone before the tenths could be. The same went for clearing it, where
 * an empty box means "not finished typing" far more often than it means "no
 * rating".
 *
 * Escape puts back what the note says, which is the only way out of a half-
 * typed number that does not commit it.
 */
function ScoreField({
	value,
	scale,
	step,
	onCommit,
}: {
	value: number | undefined;
	scale: number;
	step: number;
	onCommit: (value: number | null) => void;
}): React.ReactElement {
	const shown = value === undefined ? "" : String(value);
	const [draft, setDraft] = useState<string | null>(null);
	const fine = typedStep(step);

	const commit = () => {
		const text = draft;
		setDraft(null);
		if (text === null) return;
		if (!text.trim()) {
			if (value !== undefined) onCommit(null);
			return;
		}
		const parsed = Number(text);
		if (!Number.isFinite(parsed)) return;
		const next = snap(Math.min(Math.max(parsed, 0), scale), fine);
		if (next !== value) onCommit(next);
	};

	return (
		<input
			type="number"
			min={0}
			max={scale}
			step={fine}
			value={draft ?? shown}
			placeholder="–"
			aria-label={`Rating out of ${scale}`}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					commit();
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					setDraft(null);
				}
			}}
		/>
	);
}

/**
 * The accessible name of a hit target.
 *
 * Deliberately text rather than an `aria-label`: Obsidian turns any element
 * carrying one into a hover tooltip, and a tooltip firing off every half-star
 * as the pointer crosses the row covered the controls underneath it.
 */
function HitLabel({
	value,
	scale,
}: {
	value: number;
	scale: number;
}): React.ReactElement {
	return (
		<span className="scout-sr-only">
			Rate {formatRating(value)} of {scale}
		</span>
	);
}

export default function Rating({
	value,
	scale,
	step,
	icon,
	readOnly = false,
	slots = SLOTS,
	size = 18,
	exact = false,
	onChange,
}: RatingProps): React.ReactElement {
	const [hover, setHover] = useState<number | null>(null);

	if (icon === "number") {
		return (
			<span className="scout-rating scout-rating-numeric">
				{readOnly ? (
					<span className="scout-rating-value">
						{value === undefined ? "–" : formatRating(value)}
					</span>
				) : (
					<ScoreField
						value={value}
						scale={scale}
						step={step}
						onCommit={(next) => onChange?.(next)}
					/>
				)}
				<span className="scout-rating-scale">/ {scale}</span>
			</span>
		);
	}

	const path = PATHS[icon];
	const shown = hover ?? value ?? 0;
	const positions = Array.from({ length: slots }, (_, i) => i + 1);
	/** Rating units one whole icon is worth: 1 out of five, 2 out of ten. */
	const perSlot = scale / slots;
	const zones = zonesPerSlot(perSlot, step);
	/** How much of the scale one hit zone covers. */
	const zoneValue = perSlot / zones;
	/**
	 * Whether the row alone can reach every value the step allows. Out of five
	 * in halves it can; out of a hundred nothing pointed at five icons can, so
	 * the readout becomes a field you can type an exact score into.
	 *
	 * The comparison is against the zone rather than the icon, which is what
	 * lets a row of five cover a scale of ten without a field beside it — four
	 * zones an icon is a half point either way.
	 */
	const typable = !readOnly && (exact || zoneValue > step + 1e-9);

	/** The rating a given icon position stands for. */
	const valueAt = (slot: number) => snap(slot * perSlot, step);

	const commit = (slot: number) => {
		if (readOnly) return;
		const next = valueAt(slot);
		// Clicking the current value again clears it, which is the only way to
		// undo a rating without reaching for the frontmatter.
		onChange?.(value === next ? null : next);
	};

	return (
		<span
			className={`scout-rating${readOnly ? " is-readonly" : ""}`}
			onMouseLeave={() => setHover(null)}
		>
			{/* Spoken, not labelled, for the same tooltip reason as HitLabel. */}
			<span className="scout-sr-only">
				{value === undefined
					? "Not rated"
					: `Rated ${formatRating(value)} out of ${scale}`}
			</span>
			{positions.map((slot) => {
				const fraction = Math.min(
					Math.max(shown / perSlot - (slot - 1), 0),
					1,
				);
				/**
				 * The score under the pointer, over the icon it would set.
				 *
				 * Half a star of a ten-point scale is a four-pixel target that
				 * looks identical to the four pixels either side of it, so
				 * without this the only way to find out what you were about to
				 * commit to was to commit to it. Drawn rather than left to the
				 * platform's own tooltip, which arrives a second late — long
				 * after the pointer has moved on to a different value.
				 */
				const tip =
					hover !== null &&
					hover > (slot - 1) * perSlot + 1e-9 &&
					hover <= slot * perSlot + 1e-9
						? hover
						: null;
				return (
					<span key={slot} className="scout-rating-slot">
						{tip !== null && (
							<span className="scout-rating-tip" role="presentation">
								{formatRating(tip)}
								<span className="scout-rating-scale">
									/{scale}
								</span>
							</span>
						)}
						<Glyph path={path} fraction={fraction} size={size} />
						{!readOnly &&
							// One button per hit zone: two of them out of five,
							// four out of ten, so half points come off the same
							// row of stars rather than a separate control.
							Array.from({ length: zones }, (_, zone) => {
								const at = slot - (zones - 1 - zone) / zones;
								return (
									<button
										key={zone}
										type="button"
										className="scout-rating-hit"
										style={{
											left: `${(zone / zones) * 100}%`,
											width: `${100 / zones}%`,
										}}
										onMouseEnter={() => setHover(valueAt(at))}
										onClick={() => commit(at)}
									>
										<HitLabel
											value={valueAt(at)}
											scale={scale}
										/>
									</button>
								);
							})}
					</span>
				);
			})}
			{typable ? (
				/* The readout, made editable rather than a second control put
				   beside it: it is already showing the number, and on a scale
				   of a hundred typing is the only way to say 87. */
				<span className="scout-rating-entry">
					<ScoreField
						value={value}
						scale={scale}
						step={step}
						onCommit={(next) => onChange?.(next)}
					/>
					<span className="scout-rating-scale">/{scale}</span>
				</span>
			) : (
				value !== undefined && (
					<span className="scout-rating-value">
						{formatRating(value)}
						{/* Out of five the icons say it already; out of ten they do not. */}
						{scale !== slots && (
							<span className="scout-rating-scale">/{scale}</span>
						)}
					</span>
				)
			)}
		</span>
	);
}

/** Drops a trailing ".0" so "4" does not read as "4.0". */
export function formatRating(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
