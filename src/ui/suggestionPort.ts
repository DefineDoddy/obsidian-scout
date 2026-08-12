import type { ScoutContext } from "../core/context";
import type { SuggestionPort } from "../core/library/engine";
import type { RegistryFacts } from "../core/library/strategies";
import {
	isDiscoverable,
	isRecommendable,
	isSeriesAware,
} from "../core/provider";
import type { MediaKind } from "../core/types";

/**
 * The engine, wired to this vault.
 *
 * Everything Obsidian-shaped is here so that `engine.ts` stays a plain object
 * a test can drive. It is also the one place that remembers a source can be
 * *switched off* as well as unconfigured — `registry.discoverable()` only ever
 * checked credentials, so a source the user had disabled in settings was still
 * being asked for suggestions.
 */
export function suggestionPort(ctx: ScoutContext): SuggestionPort {
	const enabled = (id: string) => ctx.settings.isProviderEnabled(id);

	const facts: RegistryFacts = {
		recommendable: (kind) =>
			ctx.registry
				.recommendable(kind)
				.filter((p) => enabled(p.id))
				.map((p) => p.id),
		discoverable: (kind) =>
			ctx.registry
				.discoverable(kind)
				.filter((p) => enabled(p.id))
				.map((p) => p.id),
		seriesAware: (kind) =>
			ctx.registry
				.seriesAware(kind)
				.filter((p) => enabled(p.id))
				.map((p) => p.id),
	};

	return {
		facts,
		similar: (providerId, ref, signal) => {
			const provider = ctx.registry.get(providerId);
			if (!provider || !isRecommendable(provider)) return Promise.resolve([]);
			return provider.similar(ref, { signal });
		},
		discover: (providerId, query, signal) => {
			const provider = ctx.registry.get(providerId);
			if (!provider || !isDiscoverable(provider)) return Promise.resolve([]);
			return provider.discover(query, { signal });
		},
		series: async (providerId, ref, signal) => {
			const provider = ctx.registry.get(providerId);
			if (!provider || !isSeriesAware(provider)) return [];
			const series = await provider.series(ref, { signal });
			// The gaps only. A series call returns the whole set including the
			// film you already have, and "you have three of five" is a
			// suggestion about the other two.
			return (series?.items ?? []).filter(
				(one) => ctx.library.match(one) === undefined,
			);
		},
		owned: (item) => ctx.library.match(item) !== undefined,
	};
}

/** Kinds some configured, enabled source can be asked to browse. */
export function discoverableKinds(ctx: ScoutContext): MediaKind[] {
	const out = new Set<MediaKind>();
	for (const provider of ctx.registry.configured()) {
		if (!ctx.settings.isProviderEnabled(provider.id)) continue;
		if (!isDiscoverable(provider)) continue;
		for (const kind of provider.kinds) out.add(kind);
	}
	return [...out];
}
