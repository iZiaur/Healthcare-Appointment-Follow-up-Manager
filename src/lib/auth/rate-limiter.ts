// ============================================================================
// Rate Limiter — Sliding-window in-memory rate limiter for auth endpoints
// ============================================================================
//
// Uses a Map<ip, timestamp[]> approach. For each IP, we track the timestamps
// of recent requests within the window. On each request, we prune old entries
// and check if the count exceeds the limit.
//
// This is suitable for single-instance deployments (Vercel serverless has
// per-instance memory, so this acts as a best-effort limiter). For production
// multi-instance setups, swap this for Redis-based rate limiting.
// ============================================================================

interface RateLimitConfig {
  windowMs: number;    // Time window in milliseconds
  maxRequests: number; // Max requests per window per key
}

interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Periodic cleanup of stale entries every 60s
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Don't prevent Node from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a request from the given key (usually IP) should be allowed.
   * Returns { allowed: boolean, remaining: number, resetIn: number }
   */
  check(key: string): {
    allowed: boolean;
    remaining: number;
    resetInMs: number;
  } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    // Prune timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.config.maxRequests) {
      // Rate limited
      const oldestInWindow = entry.timestamps[0]!;
      const resetInMs = oldestInWindow + this.config.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Math.max(0, resetInMs),
      };
    }

    // Allow and record
    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.timestamps.length,
      resetInMs: this.config.windowMs,
    };
  }

  /**
   * Remove stale entries that have no timestamps in the current window.
   */
  private cleanup(): void {
    const windowStart = Date.now() - this.config.windowMs;
    for (const [key, entry] of this.store.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Destroy the rate limiter and clear the cleanup timer.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  /**
   * Reset limits for a specific key (useful for testing).
   */
  reset(key: string): void {
    this.store.delete(key);
  }
}

// ── Pre-configured instances ──

/**
 * Auth endpoints: 10 requests per 15 minutes per IP.
 * Prevents brute-force login/registration attacks.
 */
export const authRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
});

/**
 * Refresh endpoint: 5 requests per 15 minutes per IP.
 * Tighter limit since refresh should happen infrequently.
 */
export const refreshRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
});
