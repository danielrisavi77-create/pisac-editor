import { describe, expect, it } from "vitest";

import {
  ACTION_ERROR_MESSAGES,
  DEFAULT_WORKSPACE_NAME,
  PROJECT_TITLE_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  validateProjectTitle,
  parseActionErrorCode,
  validateWorkspaceName,
} from "./types";

describe("validateWorkspaceName", () => {
  it("accepts a normal name and returns it unchanged", () => {
    expect(validateWorkspaceName("Moj radni prostor")).toEqual({
      ok: true,
      value: "Moj radni prostor",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateWorkspaceName("  Diplomski \n")).toEqual({
      ok: true,
      value: "Diplomski",
    });
  });

  it("preserves inner whitespace instead of collapsing it", () => {
    expect(validateWorkspaceName("Rad   o  Kantu")).toEqual({
      ok: true,
      value: "Rad   o  Kantu",
    });
  });

  it("rejects an empty string", () => {
    expect(validateWorkspaceName("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a whitespace-only string", () => {
    expect(validateWorkspaceName("   \t\n ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts exactly the maximum length", () => {
    const name = "a".repeat(WORKSPACE_NAME_MAX_LENGTH);
    expect(validateWorkspaceName(name)).toEqual({ ok: true, value: name });
  });

  it("rejects one character over the maximum length", () => {
    expect(validateWorkspaceName("a".repeat(WORKSPACE_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("measures length after trimming", () => {
    const padded = `  ${"a".repeat(WORKSPACE_NAME_MAX_LENGTH)}  `;
    expect(validateWorkspaceName(padded).ok).toBe(true);
  });

  it("counts unicode code points, not UTF-16 units", () => {
    // 120 astral code points are 240 UTF-16 units but still fit the limit.
    const name = "𝐀".repeat(WORKSPACE_NAME_MAX_LENGTH);
    expect(validateWorkspaceName(name)).toEqual({ ok: true, value: name });
    expect(validateWorkspaceName("𝐀".repeat(WORKSPACE_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts Croatian diacritics", () => {
    expect(validateWorkspaceName("Čitaonica — šđžćč")).toEqual({
      ok: true,
      value: "Čitaonica — šđžćč",
    });
  });

  it("accepts the default workspace name", () => {
    expect(validateWorkspaceName(DEFAULT_WORKSPACE_NAME)).toEqual({
      ok: true,
      value: DEFAULT_WORKSPACE_NAME,
    });
  });
});

describe("validateProjectTitle", () => {
  it("accepts a normal title", () => {
    expect(validateProjectTitle("Utjecaj medija na izbore")).toEqual({
      ok: true,
      value: "Utjecaj medija na izbore",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateProjectTitle("\t Seminarski rad  ")).toEqual({
      ok: true,
      value: "Seminarski rad",
    });
  });

  it("rejects an empty string", () => {
    expect(validateProjectTitle("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a whitespace-only string", () => {
    expect(validateProjectTitle("\n\n")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts exactly the maximum length", () => {
    const title = "b".repeat(PROJECT_TITLE_MAX_LENGTH);
    expect(validateProjectTitle(title)).toEqual({ ok: true, value: title });
  });

  it("rejects one character over the maximum length", () => {
    expect(validateProjectTitle("b".repeat(PROJECT_TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("has a longer limit than a workspace name", () => {
    const title = "c".repeat(WORKSPACE_NAME_MAX_LENGTH + 1);
    expect(validateProjectTitle(title).ok).toBe(true);
    expect(validateWorkspaceName(title).ok).toBe(false);
  });

  it("accepts unicode at the limit", () => {
    const title = "ž".repeat(PROJECT_TITLE_MAX_LENGTH);
    expect(validateProjectTitle(title)).toEqual({ ok: true, value: title });
  });
});

describe("parseActionErrorCode", () => {
  it("accepts every known code", () => {
    for (const code of Object.keys(ACTION_ERROR_MESSAGES)) {
      expect(parseActionErrorCode(code)).toBe(code);
    }
  });

  it("returns null for an undefined or unknown value", () => {
    expect(parseActionErrorCode(undefined)).toBeNull();
    expect(parseActionErrorCode("")).toBeNull();
    expect(parseActionErrorCode("nepoznato")).toBeNull();
  });

  it("rejects inherited Object.prototype keys", () => {
    expect(parseActionErrorCode("constructor")).toBeNull();
    expect(parseActionErrorCode("__proto__")).toBeNull();
    expect(parseActionErrorCode("toString")).toBeNull();
    expect(parseActionErrorCode("hasOwnProperty")).toBeNull();
    expect(parseActionErrorCode("valueOf")).toBeNull();
  });

  it("takes the first entry when the query parameter repeats", () => {
    expect(parseActionErrorCode(["spremanje", "citanje"])).toBe("spremanje");
  });

  it("rejects an array whose first entry is not a known code", () => {
    expect(parseActionErrorCode(["constructor"])).toBeNull();
    expect(parseActionErrorCode([])).toBeNull();
  });

  it("has a Croatian message for every code it accepts", () => {
    for (const [code, message] of Object.entries(ACTION_ERROR_MESSAGES)) {
      expect(parseActionErrorCode(code)).toBe(code);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
