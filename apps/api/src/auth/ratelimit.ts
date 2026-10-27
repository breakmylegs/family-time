// Fixed-window rate limit, in memory. One api process per home, so nothing needs sharing.

export interface RateLimit {
  /** Requests allowed per window, per client address. */
  max: number;
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  /** True only for the first refusal in a window, so it is logged once, not per request. */
  firstRefusal: boolean;
}

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, limit: RateLimit): RateDecision {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= limit.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
      this.sweep(t, limit.windowMs);
    }
    w.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((w.start + limit.windowMs - t) / 1000));
    return { allowed: w.count <= limit.max, retryAfterSeconds, firstRefusal: w.count === limit.max + 1 };
  }

  /** Drops finished windows now and then, so the map cannot grow without limit. */
  private sweep(t: number, windowMs: number) {
    if (this.windows.size < 1000) return;
    for (const [key, w] of this.windows) if (t - w.start >= windowMs) this.windows.delete(key);
  }
}

/** Sign-in, invite and recovery routes. Generous for a family, useless for guessing. */
export const AUTH_RATE_LIMIT: RateLimit = { max: 30, windowMs: 60_000 };
