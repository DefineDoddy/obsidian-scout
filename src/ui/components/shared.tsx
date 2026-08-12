import { TFile, setIcon, type App } from "obsidian";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "../../core/http";
import type { LibraryEntry } from "../../core/library/entry";
import type { LibraryIndex } from "../../core/library/indexer";
import type { ScoutSettings } from "../../core/settings/store";
import { MEDIA_KIND_LABELS, type MediaKind } from "../../core/types";

/** Small pieces the search modal, the detail dialog, and the library all use. */

/** Renders one of Obsidian's own icons inside React. */
export function Icon({
	name,
	size,
}: {
	name: string;
	size?: number;
}): React.ReactElement {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.empty();
		setIcon(el, name);
	}, [name]);
	/**
	 * Sized through `--icon-size`, not through width and height on the `<svg>`.
	 * Obsidian sizes its icons from that variable in CSS, and a CSS rule beats a
	 * presentation attribute — so setting the attributes did nothing at all and
	 * every icon came out at the theme's default, whatever was asked for.
	 */
	return (
		<span
			className="scout-icon"
			ref={ref}
			style={
				size
					? ({ "--icon-size": `${size}px` } as React.CSSProperties)
					: undefined
			}
		/>
	);
}

/* --------------------------------------------------------------- kinds */

/**
 * A glyph per media type.
 *
 * A shelf holds films, books, and games side by side, and a poster does not
 * say which — a book cover and a game cover are the same rectangle. The word
 * is on the card already, in eleven-point grey, which is a thing you read
 * rather than a thing you see.
 *
 * All seven are icons Obsidian has shipped for years; a name it does not know
 * renders as nothing at all, which is worth more care than it looks.
 */
export const KIND_ICONS: Record<MediaKind, string> = {
	movie: "film",
	tv: "tv",
	book: "book",
	game: "gamepad-2",
	anime: "sparkles",
	manga: "book-open",
	link: "link",
};

/** The type of a thing, at a glance. Sits on the artwork in the grid. */
export function KindBadge({
	kind,
	size = 12,
	className = "",
}: {
	kind: MediaKind;
	size?: number;
	className?: string;
}): React.ReactElement {
	return (
		<span
			className={`scout-kind-badge ${className}`.trim()}
			title={MEDIA_KIND_LABELS[kind]}
			aria-label={MEDIA_KIND_LABELS[kind]}
		>
			<Icon name={KIND_ICONS[kind]} size={size} />
		</span>
	);
}

/**
 * Turns a cover value into something an `<img>` can load.
 *
 * A note's cover may be a remote URL, a data URI, a vault-relative path, or a
 * `![[embed]]` — all four are common in existing media notes, and only the
 * first works without help.
 */
export function resolveImage(
	app: App,
	value: string | undefined,
	sourcePath = "",
): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (/^(https?:|data:|app:|capacitor:)/i.test(trimmed)) return trimmed;

	const embed = /^!?\[\[(.+?)(\|.*)?\]\]$/.exec(trimmed);
	const inline = /^!\[.*?\]\((.+?)\)$/.exec(trimmed);
	const path = embed?.[1] ?? inline?.[1] ?? trimmed;
	if (/^https?:/i.test(path)) return path;

	const file =
		app.metadataCache.getFirstLinkpathDest(path, sourcePath) ??
		app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? app.vault.getResourcePath(file) : undefined;
}

/** Cover art with a graceful fallback when the image is missing or broken. */
export function Cover({
	src,
	alt,
	title,
	className = "",
}: {
	src: string | undefined;
	alt: string;
	title: string;
	className?: string;
}): React.ReactElement {
	const [failed, setFailed] = useState(false);
	if (!src || failed) {
		return (
			<div className={`scout-cover scout-cover-empty ${className}`}>
				<span>{title.slice(0, 2).toUpperCase()}</span>
			</div>
		);
	}
	return (
		<img
			className={`scout-cover ${className}`}
			src={src}
			alt={alt}
			draggable={false}
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	);
}

/* -------------------------------------------------------------------- hooks */

/**
 * Re-renders whenever the index changes, and hands back the current entries.
 *
 * A version counter rather than `useSyncExternalStore`, because `all()` builds
 * a fresh array every call and so can never be a stable snapshot.
 */
export function useLibraryEntries(index: LibraryIndex): readonly LibraryEntry[] {
	const [, setVersion] = useState(0);
	useEffect(() => index.subscribe(() => setVersion((v) => v + 1)), [index]);
	return index.all();
}

/**
 * How much of a long list to actually put in the page.
 *
 * A library of a few thousand items is a few thousand cards, each with an
 * image, an icon or two and a handful of nodes — enough DOM to make scrolling
 * stutter on a phone and to hold a great deal of memory for rows nobody has
 * looked at. So the list renders a screenful or three and grows when the
 * bottom comes into view, which is a scroll nobody notices.
 *
 * `reset` is anything that means "a different list now" — a new filter, a new
 * view — and puts the window back to the first page.
 */
export function useRenderWindow(
	reset: unknown,
	step: number,
): [number, (el: HTMLElement | null) => void] {
	const [limit, setLimit] = useState(step);
	useEffect(() => setLimit(step), [reset, step]);

	const observer = useRef<IntersectionObserver | null>(null);
	useEffect(() => () => observer.current?.disconnect(), []);

	/**
	 * The sentinel is re-keyed on every widening, so React hands this a new
	 * element and the observer starts again. An observer left watching a
	 * sentinel that is *still* on screen never fires a second time, which would
	 * stop the list one page short of wherever you had scrolled to.
	 */
	const sentinel = useCallback(
		(el: HTMLElement | null) => {
			observer.current?.disconnect();
			observer.current = null;
			if (!el) return;
			const io = new IntersectionObserver(
				(records) => {
					if (records.some((record) => record.isIntersecting)) {
						setLimit((current) => current + step);
					}
				},
				// Well before the bottom, so the next page is there by the time
				// the scroll reaches it.
				{ rootMargin: "800px 0px" },
			);
			io.observe(el);
			observer.current = io;
		},
		[step],
	);

	return [limit, sentinel];
}

/** Bumps a counter whenever settings change, to re-read config in a render. */
export function useSettingsVersion(settings: ScoutSettings): number {
	const [version, setVersion] = useState(0);
	useEffect(
		() => settings.onChange(() => setVersion((v) => v + 1)),
		[settings],
	);
	return version;
}

/** Sensible "N and above" steps for whatever scale is configured. */
export function ratingThresholds(scale: number): number[] {
	if (scale <= 5) return [1, 2, 3, 4, 5];
	if (scale <= 10) return [2, 4, 6, 7, 8, 9];
	return [20, 40, 60, 70, 80, 90];
}

/* ------------------------------------------------------------ provider calls */

export interface Async<T> {
	data: T | null;
	loading: boolean;
	error: string | null;
}

/**
 * Runs a provider call, keyed by a string.
 *
 * By value rather than by function identity: the loader closes over props that
 * are rebuilt on every render — an entry is a fresh object after each write —
 * so keying on the closure would refetch forever.
 */
export function useProviderData<T>(
	load: ((signal: AbortSignal) => Promise<T>) | null,
	key: string,
): Async<T> {
	const [state, setState] = useState<Async<T>>({
		data: null,
		loading: false,
		error: null,
	});
	const latest = useRef(load);
	latest.current = load;

	useEffect(() => {
		const run = latest.current;
		if (!run) {
			setState({ data: null, loading: false, error: null });
			return;
		}
		const controller = new AbortController();
		setState({ data: null, loading: true, error: null });

		run(controller.signal)
			.then((data) => {
				if (!controller.signal.aborted) {
					setState({ data, loading: false, error: null });
				}
			})
			.catch((err: unknown) => {
				if (isAbortError(err) || controller.signal.aborted) return;
				console.warn("Scout: provider fetch failed", err);
				setState({
					data: null,
					loading: false,
					error:
						err instanceof Error
							? err.message
							: "Could not load this from the source.",
				});
			});

		return () => controller.abort();
	}, [key]);

	return state;
}

/** A value that lags its input, for search boxes. */
export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
