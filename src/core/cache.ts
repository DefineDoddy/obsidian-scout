/** Bounded, time-limited in-memory cache. Keeps repeated searches cheap. */
export class TtlCache<T> {
	private readonly entries = new Map<string, { value: T; expiresAt: number }>();

	constructor(
		private readonly maxEntries = 200,
		private readonly defaultTtlMs = 5 * 60 * 1000,
	) {}

	get(key: string): T | undefined {
		const hit = this.entries.get(key);
		if (!hit) return undefined;
		if (hit.expiresAt < Date.now()) {
			this.entries.delete(key);
			return undefined;
		}
		// Re-insert so iteration order tracks recency for the eviction below.
		this.entries.delete(key);
		this.entries.set(key, hit);
		return hit.value;
	}

	set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
		this.entries.delete(key);
		this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next();
			if (oldest.done) break;
			this.entries.delete(oldest.value);
		}
	}

	clear(): void {
		this.entries.clear();
	}
}
