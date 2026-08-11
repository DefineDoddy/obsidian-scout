import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry";
import {
	isDetailable,
	isResolvable,
	isSearchable,
	type MediaProvider,
	type Resolvable,
	type Searchable,
} from "./provider";
import type { MediaItem, MediaKind } from "./types";

/**
 * These tests exercise the open/closed claim directly: a brand-new source is
 * defined here, in the test file, and the registry routes to it without any
 * production file knowing it exists.
 */

function item(id: string, kind: MediaKind): MediaItem {
	return {
		ref: { providerId: "fake", kind, id },
		title: `Item ${id}`,
		tags: [],
		people: [],
		extra: {},
	};
}

class SearchOnlyProvider implements MediaProvider, Searchable {
	readonly kinds: readonly MediaKind[] = ["game"];
	readonly fields = [];

	constructor(
		readonly id = "fake",
		readonly name = "Fake",
		private readonly configured = true,
	) {}

	isConfigured(): boolean {
		return this.configured;
	}
	settingsSchema() {
		return [];
	}
	async search(): Promise<MediaItem[]> {
		return [item("1", "game")];
	}
}

/** No `search` method at all — the web-link shape. */
class ResolveOnlyProvider implements MediaProvider, Resolvable {
	readonly id: string = "resolver";
	readonly name = "Resolver";
	readonly kinds: readonly MediaKind[] = ["link"];
	readonly fields = [];

	isConfigured(): boolean {
		return true;
	}
	settingsSchema() {
		return [];
	}
	canResolve(url: string): boolean {
		return url.startsWith("https://example.com/");
	}
	async resolve(): Promise<MediaItem> {
		return item("resolved", "link");
	}
}

describe("ProviderRegistry", () => {
	it("routes a search to a provider it has never heard of before", async () => {
		const registry = new ProviderRegistry();
		registry.register(new SearchOnlyProvider());

		const found = registry.searchable("game");
		expect(found).toHaveLength(1);
		expect((await found[0]!.search("x", { signal: new AbortController().signal }))[0]?.title).toBe(
			"Item 1",
		);
	});

	it("rejects duplicate ids", () => {
		const registry = new ProviderRegistry();
		registry.register(new SearchOnlyProvider());
		expect(() => registry.register(new SearchOnlyProvider())).toThrow(
			/Duplicate provider id/,
		);
	});

	it("excludes unconfigured providers from search", () => {
		const registry = new ProviderRegistry();
		registry.register(new SearchOnlyProvider("a", "A", false));
		expect(registry.configured()).toHaveLength(0);
		expect(registry.searchable()).toHaveLength(0);
	});

	it("does not offer a resolve-only provider as searchable", () => {
		const registry = new ProviderRegistry();
		registry.register(new ResolveOnlyProvider());
		expect(registry.searchable()).toHaveLength(0);
		expect(registry.resolverFor("https://example.com/a")?.id).toBe("resolver");
	});

	it("picks the first provider that claims a URL, in registration order", () => {
		const registry = new ProviderRegistry();

		class CatchAll extends ResolveOnlyProvider {
			override readonly id: string = "catchall";
			override canResolve(): boolean {
				return true;
			}
		}

		registry.register(new ResolveOnlyProvider());
		registry.register(new CatchAll());

		// The specific provider wins for its own domain…
		expect(registry.resolverFor("https://example.com/x")?.id).toBe("resolver");
		// …and the catch-all takes everything else.
		expect(registry.resolverFor("https://other.test/x")?.id).toBe("catchall");
	});

	it("reports only the kinds configured providers actually offer", () => {
		const registry = new ProviderRegistry();
		registry.register(new SearchOnlyProvider());
		registry.register(new ResolveOnlyProvider());
		expect(registry.availableKinds().sort()).toEqual(["game", "link"]);
	});

	it("narrows capabilities structurally, without instanceof", () => {
		const search = new SearchOnlyProvider();
		const resolve = new ResolveOnlyProvider();

		expect(isSearchable(search)).toBe(true);
		expect(isResolvable(search)).toBe(false);
		expect(isDetailable(search)).toBe(false);

		expect(isSearchable(resolve)).toBe(false);
		expect(isResolvable(resolve)).toBe(true);
	});
});
