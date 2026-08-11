import { TFile, setIcon, type App } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import type { LibraryEntry } from "../../core/library/entry";
import type { LibraryIndex } from "../../core/library/indexer";
import type { ScoutSettings } from "../../core/settings/store";

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
export function useLibraryEntries(index: LibraryIndex): LibraryEntry[] {
	const [, setVersion] = useState(0);
	useEffect(() => index.subscribe(() => setVersion((v) => v + 1)), [index]);
	return index.all();
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

/** A value that lags its input, for search boxes. */
export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
