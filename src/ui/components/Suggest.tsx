import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * A text box that suggests, without a `<datalist>`.
 *
 * The native element looked like the right answer — one attribute, no state,
 * the browser's own popup — and it is the wrong one here for three reasons.
 * Obsidian's mobile app does not render it at all, so half the app got no
 * suggestions. Its popup is drawn outside the page, so it ignores the theme and
 * cannot be reached by the styles that keep a long list to a sensible height.
 * And a vault with two hundred genres in it produced two hundred rows with no
 * way to get down them.
 *
 * So: an ordinary input, an ordinary list under it, filtered as you type, its
 * height capped and its overflow scrolled. Still a hint and not a constraint —
 * anything can be typed, including a genre the library has not got yet, which
 * is a perfectly reasonable thing to write a rule about.
 */

export interface SuggestInputProps {
	value: string;
	onChange: (value: string) => void;
	options: readonly string[];
	placeholder?: string;
	label?: string;
	className?: string;
	/** Shown as the whole list before anything has been typed. */
	max?: number;
}

/** Substring, case- and accent-insensitively, with prefixes first. */
export function rankSuggestions(
	options: readonly string[],
	needle: string,
	max: number,
): string[] {
	// Decomposed, then stripped of the combining-mark block (U+0300–U+036F), so
	// that typing "inarritu" finds Iñárritu.
	const fold = (value: string) =>
		value
			.normalize("NFD")
			.replace(/[̀-ͯ]/gu, "")
			.toLowerCase();
	const query = fold(needle.trim());
	if (!query) return options.slice(0, max);

	const starts: string[] = [];
	const holds: string[] = [];
	for (const option of options) {
		const folded = fold(option);
		if (folded.startsWith(query)) starts.push(option);
		else if (folded.includes(query)) holds.push(option);
		if (starts.length >= max) break;
	}
	return [...starts, ...holds].slice(0, max);
}

export default function SuggestInput({
	value,
	onChange,
	options,
	placeholder,
	label,
	className,
	max = 60,
}: SuggestInputProps): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [at, setAt] = useState(0);
	const wrap = useRef<HTMLDivElement | null>(null);
	const list = useRef<HTMLUListElement | null>(null);

	const shown = useMemo(
		() => rankSuggestions(options, value, max),
		[options, value, max],
	);

	// A click anywhere else is a dismissal. Listening on the document rather
	// than using blur, because blur fires before the click that caused it and
	// would close the list out from under the row being picked.
	useEffect(() => {
		if (!open) return;
		const away = (event: MouseEvent) => {
			if (!wrap.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", away);
		return () => document.removeEventListener("mousedown", away);
	}, [open]);

	/** Keeps the highlighted row inside the scrolled box. */
	useEffect(() => {
		if (!open) return;
		const row = list.current?.children[at];
		if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
	}, [at, open]);

	const pick = (option: string) => {
		onChange(option);
		setOpen(false);
	};

	const keys = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			if (open) event.stopPropagation();
			setOpen(false);
			return;
		}
		if (!open) {
			if (event.key === "ArrowDown") {
				setOpen(true);
				setAt(0);
				event.preventDefault();
			}
			return;
		}
		if (event.key === "ArrowDown") {
			setAt((i) => (shown.length === 0 ? 0 : (i + 1) % shown.length));
			event.preventDefault();
		} else if (event.key === "ArrowUp") {
			setAt((i) =>
				shown.length === 0 ? 0 : (i - 1 + shown.length) % shown.length,
			);
			event.preventDefault();
		} else if (event.key === "Enter") {
			const option = shown[at];
			// Enter with nothing highlighted leaves what was typed alone; the
			// list is a shortcut, not a vocabulary.
			if (option !== undefined) {
				pick(option);
				event.preventDefault();
			} else {
				setOpen(false);
			}
		}
	};

	return (
		<div className={`scout-combo${className ? ` ${className}` : ""}`} ref={wrap}>
			<input
				type="text"
				role="combobox"
				aria-expanded={open}
				aria-autocomplete="list"
				aria-label={label}
				placeholder={placeholder}
				value={value}
				onChange={(e) => {
					onChange(e.target.value);
					setAt(0);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onKeyDown={keys}
			/>
			{open && shown.length > 0 && (
				<ul className="scout-combo-list" ref={list} role="listbox">
					{shown.map((option, i) => (
						<li
							key={option}
							role="option"
							aria-selected={i === at}
							className={i === at ? "is-on" : ""}
							onMouseEnter={() => setAt(i)}
							// Down rather than click: the input is about to lose
							// focus, and mousedown lands first.
							onMouseDown={(e) => {
								e.preventDefault();
								pick(option);
							}}
						>
							{option}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
