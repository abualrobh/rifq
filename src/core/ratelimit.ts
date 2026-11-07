// RQ-002 AC8 and D-058. The browser counter gives the 30-per-minute message; the Worker limit is
// the backstop. The counter keeps send times only, never query text. It uses sessionStorage, so it
// ends with the tab, and falls back to memory when storage is blocked.
export const LIMIT = 30;
// D-061: the server backstop is per network address, so shared mobile addresses get more room.
export const SERVER_LIMIT = 120;
export const WINDOW_MS = 60_000;
export const RL_KEY = 'rifq.rl';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

export class SearchCounter {
  private mem: number[] = [];
  private store: Store;
  private now: () => number;
  constructor(store: Store, now: () => number = Date.now) { this.store = store; this.now = now; }

  private read(): number[] {
    if (this.store) {
      try {
        const v = JSON.parse(this.store.getItem(RL_KEY) ?? '[]');
        if (Array.isArray(v)) return v.filter((x) => Number.isFinite(x)).slice(-LIMIT);
      } catch { /* fall back to memory */ }
    }
    return this.mem;
  }

  private save(a: number[]) {
    this.mem = a;
    if (this.store) { try { this.store.setItem(RL_KEY, JSON.stringify(a)); } catch { /* memory only */ } }
  }

  // Returns 0 when a search may be sent now (and records it), otherwise the seconds to wait.
  take(): number {
    const t = this.now();
    const recent = this.read().filter((x) => x > t - WINDOW_MS && x <= t);
    if (recent.length >= LIMIT) {
      this.save(recent);
      return Math.max(1, Math.ceil((recent[0] + WINDOW_MS - t) / 1000));
    }
    recent.push(t);
    this.save(recent);
    return 0;
  }
}

// Server backstop used when the Workers rate limit binding is absent (for example in unit tests).
// It is per isolate and approximate, like the binding. Keys are kept in memory only, for one window.
export class MemoryLimiter {
  private hits = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;
  private now: () => number;
  constructor(limit = LIMIT, windowMs = WINDOW_MS, now: () => number = Date.now) { this.limit = limit; this.windowMs = windowMs; this.now = now; }
  allow(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) this.hits.clear();
    const a = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (a.length >= this.limit) { this.hits.set(key, a); return false; }
    a.push(t);
    this.hits.set(key, a);
    return true;
  }
}
