import { describe, expect, it } from "vitest";

import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs } from "./jcs";

describe("RFC 8785 JCS", () => {
  it("matches the RFC 8785 serialization sample and an independent SHA-256 vector", async () => {
    const value = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
      string: "€$\u000f\nA'B\"\\\\\"/",
      literals: [null, true, false],
    };

    const canonical =
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\\\\\"/"}';

    expect(canonicalizeJcs(value)).toBe(canonical);
    expect(await sha256WebCrypto(canonical)).toBe(
      "2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb",
    );
  });

  it("sorts object property names by raw UTF-16 code units and never reorders arrays", () => {
    const value = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
      nested: [{ z: 1, a: 2 }, { b: 3, a: 4 }],
    };

    const canonical = canonicalizeJcs(value);
    expect(Object.keys(JSON.parse(canonical))).toEqual([
      "\r",
      "1",
      "\u0080",
      "nested",
      "\u00f6",
      "\u20ac",
      "\ud83d\ude00",
      "\ufb33",
    ]);
    expect(JSON.parse(canonical).nested).toEqual([
      { a: 2, z: 1 },
      { a: 4, b: 3 },
    ]);
  });

  it("preserves distinct Unicode normalization forms", () => {
    expect(canonicalizeJcs({ value: "é" })).not.toBe(
      canonicalizeJcs({ value: "e\u0301" }),
    );
  });

  it("fails closed on non-JSON values, non-finite numbers, lone surrogates and cycles", () => {
    expect(() => canonicalizeJcs({ x: undefined })).toThrow("unsupported value");
    expect(() => canonicalizeJcs({ x: Number.NaN })).toThrow("non-finite number");
    expect(() => canonicalizeJcs({ x: Number.POSITIVE_INFINITY })).toThrow(
      "non-finite number",
    );
    expect(() => canonicalizeJcs({ x: "\ud800" })).toThrow("lone surrogate");

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJcs(cyclic)).toThrow("cyclic value");
  });

  it("uses ECMAScript number serialization including negative zero", () => {
    expect(canonicalizeJcs({ n: -0, small: 0.000001, large: 1e30 })).toBe(
      '{"large":1e+30,"n":0,"small":0.000001}',
    );
  });
});
