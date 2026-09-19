/**
 * An app-layer rate limiter: a per-key cooldown plus one global token bucket
 * (F1-10).
 *
 * WHAT THIS IS NOT. It is per process and in memory. On a serverless platform
 * (this app deploys to Netlify) every cold start begins with an empty map and
 * a full bucket, and several instances serve the same origin at the same
 * time, so an attacker who can spread requests across instances gets a
 * multiple of these limits. Nothing here is a security boundary, and nothing
 * here should be described as one. The real limits belong where the requests
 * are counted once: Supabase Auth's own per-hour e-mail limits, and an
 * edge/WAF rule in front of the site. See the `RATE LIMITS` note in
 * `.env.example`.
 *
 * WHAT IT IS FOR. It makes the cheap, honest half true: one browser cannot sit
 * on the "send me a magic link" button and have this process mail a person
 * dozens of messages, and one instance cannot be walked through a thousand
 * addresses a minute. That is a real improvement over no limit at all, and
 * saying exactly how far it goes is the point.
 *
 * Pure: no timers, no globals, no IO, no crypto. The clock is injected, so
 * every branch below is a unit test and not a `setTimeout`. Keys are opaque
 * strings — the OTP caller passes a HASH of the e-mail address, never the
 * address, so a heap dump or a log line cannot give up who tried to sign in.
 */

/** Milliseconds since some fixed epoch. `Date.now` in production. */
export type Clock = () => number;

export type RateRefusalReason =
  /** This key asked again too soon. */
  | "cooldown"
  /** The whole process is over its budget for the moment. */
  | "burst";

export type RateDecision =
  | { allowed: true }
  | { allowed: false; reason: RateRefusalReason; retryAfterMs: number };

export type RateLimiterOptions = {
  /** Minimum gap between two allowed attempts for one key. */
  cooldownMs: number;
  /** Attempts the whole process may allow in a burst. */
  bucketCapacity: number;
  /** Time in which a spent bucket refills completely. */
  bucketRefillMs: number;
  /** Bounded memory: the map is capped, oldest entry evicted first. */
  maxKeys?: number;
  now?: Clock;
};

export type RateLimiter = {
  /**
   * Decides, and — only when it allows — records the attempt. A refusal
   * costs nothing: it neither consumes a token nor pushes the key's cooldown
   * further out, so hammering the button cannot extend the wait.
   */
  check(key: string): RateDecision;
};

/** Default ceiling on tracked keys. Distinct addresses are attacker-chosen. */
const DEFAULT_MAX_KEYS = 5_000;

const allowed: RateDecision = { allowed: true };

function refuse(reason: RateRefusalReason, retryAfterMs: number): RateDecision {
  return { allowed: false, reason, retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) };
}

/**
 * The per-key map and the process bucket, together.
 *
 * `Map` preserves insertion order, which is what makes the eviction below
 * "oldest first" without a second structure: a key is deleted before it is
 * re-inserted, so its position always reflects its last allowed attempt.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const cooldownMs = Math.max(0, options.cooldownMs);
  const capacity = Math.max(1, options.bucketCapacity);
  const refillMs = Math.max(1, options.bucketRefillMs);
  const maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
  /** Tokens per millisecond. */
  const rate = capacity / refillMs;

  const lastAllowedAt = new Map<string, number>();
  let tokens = capacity;
  let refilledAt = now();

  /** Drops entries whose cooldown has expired; they can no longer refuse. */
  function prune(at: number): void {
    for (const [key, when] of lastAllowedAt) {
      if (at - when >= cooldownMs) {
        lastAllowedAt.delete(key);
      } else {
        // Insertion order is chronological, so the first key still inside its
        // cooldown ends the sweep.
        break;
      }
    }
  }

  function refill(at: number): void {
    // A clock that jumps backwards (NTP correction, a test) must not mint
    // tokens or freeze the bucket: treat it as no elapsed time.
    const elapsed = Math.max(0, at - refilledAt);
    refilledAt = at;
    tokens = Math.min(capacity, tokens + elapsed * rate);
  }

  return {
    check(key: string): RateDecision {
      const at = now();
      prune(at);

      const last = lastAllowedAt.get(key);
      if (last !== undefined) {
        const waited = at - last;
        if (waited < cooldownMs) {
          return refuse("cooldown", cooldownMs - waited);
        }
      }

      refill(at);
      if (tokens < 1) {
        return refuse("burst", (1 - tokens) / rate);
      }
      tokens -= 1;

      lastAllowedAt.delete(key);
      lastAllowedAt.set(key, at);
      while (lastAllowedAt.size > maxKeys) {
        const oldest = lastAllowedAt.keys().next();
        if (oldest.done === true) {
          break;
        }
        lastAllowedAt.delete(oldest.value);
      }

      return allowed;
    },
  };
}

/* ------------------------------------------------------------- OTP profile */

/** One magic link per address per minute. */
export const OTP_COOLDOWN_MS = 60_000;
/** Five sends per minute for this whole process, across all addresses. */
export const OTP_BURST_CAPACITY = 5;
export const OTP_BURST_REFILL_MS = 60_000;

/**
 * The one sentence an author sees. Deliberately the SAME for both reasons:
 * telling an anonymous caller whether it was *their* address or the whole
 * process that ran out would turn this into an account-existence oracle.
 */
export const RATE_LIMIT_MESSAGE = "Previše pokušaja. Pričekaj minutu.";

/** The OTP limiter, configured. One per process; the clock stays injectable. */
export function createOtpLimiter(now?: Clock): RateLimiter {
  return createRateLimiter({
    cooldownMs: OTP_COOLDOWN_MS,
    bucketCapacity: OTP_BURST_CAPACITY,
    bucketRefillMs: OTP_BURST_REFILL_MS,
    now,
  });
}
