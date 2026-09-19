import { describe, expect, it } from "vitest";

import {
  createOtpLimiter,
  createRateLimiter,
  OTP_BURST_CAPACITY,
  OTP_COOLDOWN_MS,
  RATE_LIMIT_MESSAGE,
  type RateLimiter,
} from "./limiter";

/** A hand-cranked clock: the limiter never reads a real one. */
function fakeClock(start = 1_000) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
    set: (ms: number) => {
      at = ms;
    },
  };
}

function limiter(
  clock: ReturnType<typeof fakeClock>,
  over: Partial<Parameters<typeof createRateLimiter>[0]> = {},
): RateLimiter {
  return createRateLimiter({
    cooldownMs: 1_000,
    bucketCapacity: 3,
    bucketRefillMs: 3_000,
    now: clock.now,
    ...over,
  });
}

describe("createRateLimiter — per-key cooldown", () => {
  it("allows a key's first attempt", () => {
    const clock = fakeClock();
    expect(limiter(clock).check("a")).toEqual({ allowed: true });
  });

  it("refuses the same key inside the cooldown and says how long to wait", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    expect(rate.check("a").allowed).toBe(true);
    clock.advance(400);

    expect(rate.check("a")).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterMs: 600,
    });
  });

  it("allows the key again once the cooldown has fully elapsed", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    rate.check("a");
    clock.advance(999);
    expect(rate.check("a").allowed).toBe(false);

    clock.advance(1);
    expect(rate.check("a")).toEqual({ allowed: true });
  });

  it("holds one key's cooldown against that key only", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    rate.check("a");
    expect(rate.check("b")).toEqual({ allowed: true });
    expect(rate.check("a").allowed).toBe(false);
  });

  it("does not extend the wait when the refused key keeps trying", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    rate.check("a");
    clock.advance(500);
    rate.check("a");
    rate.check("a");
    rate.check("a");

    // Still measured from the ALLOWED attempt, not from the last refusal.
    clock.advance(500);
    expect(rate.check("a")).toEqual({ allowed: true });
  });
});

describe("createRateLimiter — process token bucket", () => {
  it("refuses once the burst budget is spent, whatever the key", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    expect(rate.check("a").allowed).toBe(true);
    expect(rate.check("b").allowed).toBe(true);
    expect(rate.check("c").allowed).toBe(true);

    const refused = rate.check("d");
    expect(refused).toEqual({
      allowed: false,
      reason: "burst",
      retryAfterMs: 1_000,
    });
  });

  it("refills over time and lets exactly one more through per slot", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    rate.check("a");
    rate.check("b");
    rate.check("c");
    expect(rate.check("d").allowed).toBe(false);

    // 3 tokens per 3_000 ms = one token per 1_000 ms.
    clock.advance(1_000);
    expect(rate.check("d").allowed).toBe(true);
    expect(rate.check("e").allowed).toBe(false);
  });

  it("never banks more than the capacity over a long idle", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    clock.advance(10 * 60 * 1_000);

    expect(rate.check("a").allowed).toBe(true);
    expect(rate.check("b").allowed).toBe(true);
    expect(rate.check("c").allowed).toBe(true);
    expect(rate.check("d").allowed).toBe(false);
  });

  it("spends no token on an attempt the cooldown already refused", () => {
    const clock = fakeClock();
    const rate = limiter(clock);

    rate.check("a");
    rate.check("a");
    rate.check("a");

    // Two tokens must still be there for other callers.
    expect(rate.check("b").allowed).toBe(true);
    expect(rate.check("c").allowed).toBe(true);
    expect(rate.check("d").allowed).toBe(false);
  });

  it("treats a clock that jumps backwards as no elapsed time", () => {
    const clock = fakeClock(100_000);
    const rate = limiter(clock);

    rate.check("a");
    rate.check("b");
    rate.check("c");

    clock.set(1_000);
    // No tokens minted by the jump; the bucket is still empty.
    expect(rate.check("d").allowed).toBe(false);
  });
});

describe("createRateLimiter — bounded memory", () => {
  it("keeps at most maxKeys keys, evicting the oldest", () => {
    const clock = fakeClock();
    const rate = limiter(clock, {
      bucketCapacity: 100,
      bucketRefillMs: 100,
      maxKeys: 2,
    });

    rate.check("a");
    clock.advance(1);
    rate.check("b");
    clock.advance(1);
    rate.check("c"); // evicts "a"

    // "a" was forgotten, so it is allowed again inside what was its cooldown.
    expect(rate.check("a").allowed).toBe(true);
    // "c" is still tracked.
    expect(rate.check("c").allowed).toBe(false);
  });

  it("forgets keys whose cooldown has expired", () => {
    const clock = fakeClock();
    const rate = limiter(clock, { bucketCapacity: 100, bucketRefillMs: 100 });

    rate.check("a");
    clock.advance(5_000);
    rate.check("b");

    // Nothing observable but the allowance itself: "a" is gone from the map
    // and its next attempt is a first attempt.
    expect(rate.check("a")).toEqual({ allowed: true });
  });
});

describe("the OTP profile", () => {
  it("allows five sends a minute per process, one per address", () => {
    const clock = fakeClock();
    const rate = createOtpLimiter(clock.now);

    for (let i = 0; i < OTP_BURST_CAPACITY; i += 1) {
      expect(rate.check(`key-${i}`).allowed).toBe(true);
    }
    expect(rate.check("key-overflow").allowed).toBe(false);

    // The same address is held for a full minute regardless.
    clock.advance(OTP_COOLDOWN_MS - 1);
    expect(rate.check("key-0").allowed).toBe(false);
    clock.advance(1);
    expect(rate.check("key-0").allowed).toBe(true);
  });

  it("says the same Croatian sentence for both reasons", () => {
    expect(RATE_LIMIT_MESSAGE).toBe("Previše pokušaja. Pričekaj minutu.");
  });
});
