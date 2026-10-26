/**
 * Remembers recently seen event ids, to drop duplicate or replayed webhook deliveries. In-memory and
 * bounded: use a shared store (database, Redis) when several instances receive webhooks.
 */
export class ReplayGuard {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: { ttlSeconds?: number; maxEntries?: number; now?: () => number } = {}) {
    this.#ttlMs = (options.ttlSeconds ?? 4 * 3600) * 1000;
    this.#maxEntries = options.maxEntries ?? 100_000;
    this.#now = options.now ?? Date.now;
  }

  /** Returns true the first time an id is seen within the TTL, false for a duplicate or replay. */
  firstSeen(id: string): boolean {
    const now = this.#now();
    for (const [key, at] of this.#seen) {
      if (now - at <= this.#ttlMs && this.#seen.size <= this.#maxEntries) break;
      this.#seen.delete(key);
    }
    if (this.#seen.has(id)) return false;
    this.#seen.set(id, now);
    return true;
  }
}
