import {
	isDiscoverable,
	isRecommendable,
	isResolvable,
	isSearchable,
	isSeriesAware,
} from "./provider";
import type {
	Discoverable,
	MediaProvider,
	Recommendable,
	Resolvable,
	Searchable,
	SeriesAware,
} from "./provider";
import type { MediaKind } from "./types";

/**
 * The open/closed seam. Adding a source means registering one object here —
 * no edits to the modal, the settings tab, or the commands.
 */
export class ProviderRegistry {
	private readonly providers = new Map<string, MediaProvider>();

	register(provider: MediaProvider): void {
		if (this.providers.has(provider.id)) {
			throw new Error(`Duplicate provider id: ${provider.id}`);
		}
		this.providers.set(provider.id, provider);
	}

	get(id: string): MediaProvider | undefined {
		return this.providers.get(id);
	}

	all(): MediaProvider[] {
		return [...this.providers.values()];
	}

	/** Providers whose credentials are satisfied. */
	configured(): MediaProvider[] {
		return this.all().filter((p) => p.isConfigured());
	}

	/** Configured providers that can run a text search, optionally for one kind. */
	searchable(kind?: MediaKind): (MediaProvider & Searchable)[] {
		return this.configured()
			.filter(isSearchable)
			.filter((p) => !kind || p.kinds.includes(kind));
	}

	/** Configured providers that can be asked for titles by description. */
	discoverable(kind: MediaKind): (MediaProvider & Discoverable)[] {
		return this.configured()
			.filter(isDiscoverable)
			.filter((p) => p.kinds.includes(kind));
	}

	/** Configured providers that can answer "what else is like this one". */
	recommendable(kind: MediaKind): (MediaProvider & Recommendable)[] {
		return this.configured()
			.filter(isRecommendable)
			.filter((p) => p.kinds.includes(kind));
	}

	/** Configured providers that know when something belongs to a larger set. */
	seriesAware(kind: MediaKind): (MediaProvider & SeriesAware)[] {
		return this.configured()
			.filter(isSeriesAware)
			.filter((p) => p.kinds.includes(kind));
	}

	/** The first configured provider that recognizes this URL. */
	resolverFor(url: string): (MediaProvider & Resolvable) | undefined {
		return this.configured()
			.filter(isResolvable)
			.find((p) => p.canResolve(url));
	}

	/** Every kind offered by at least one configured provider. */
	availableKinds(): MediaKind[] {
		const kinds = new Set<MediaKind>();
		for (const p of this.configured()) for (const k of p.kinds) kinds.add(k);
		return [...kinds];
	}
}
