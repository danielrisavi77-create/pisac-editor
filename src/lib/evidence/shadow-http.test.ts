import { describe, expect, it } from "vitest";

import {
  isPinnedSameOrigin,
  readJsonBodyLimited,
} from "./shadow-http";

describe("Evidence shadow HTTP guards", () => {
  it("requires the exact pinned Origin", () => {
    expect(
      isPinnedSameOrigin(
        new Request("https://pisac.example/api", {
          headers: { origin: "https://pisac.example" },
        }),
        "https://pisac.example",
      ),
    ).toBe(true);

    expect(
      isPinnedSameOrigin(
        new Request("https://pisac.example/api", {
          headers: { origin: "https://attacker.example" },
        }),
        "https://pisac.example",
      ),
    ).toBe(false);

    expect(
      isPinnedSameOrigin(
        new Request("https://pisac.example/api"),
        "https://pisac.example",
      ),
    ).toBe(false);
  });

  it("parses a bounded UTF-8 JSON body", async () => {
    const request = new Request("https://pisac.test", {
      method: "POST",
      body: JSON.stringify({ value: "Pisač" }),
      headers: { "content-type": "application/json" },
    });
    await expect(readJsonBodyLimited(request, 1024)).resolves.toEqual({
      ok: true,
      value: { value: "Pisač" },
    });
  });

  it("rejects declared or streamed oversized bodies before JSON use", async () => {
    const declared = new Request("https://pisac.test", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "9999" },
    });
    await expect(readJsonBodyLimited(declared, 100)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });

    const actual = new Request("https://pisac.test", {
      method: "POST",
      body: JSON.stringify({ x: "a".repeat(200) }),
    });
    await expect(readJsonBodyLimited(actual, 100)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("https://pisac.test", {
      method: "POST",
      body: "{",
    });
    await expect(readJsonBodyLimited(request, 100)).resolves.toEqual({
      ok: false,
      status: 400,
      reason: "invalid JSON body",
    });
  });
});
