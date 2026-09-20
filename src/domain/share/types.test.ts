import { describe, expect, it } from "vitest";

import {
  mentorCanSeeRevision,
  reissueSharePackage,
  revokeSharePackage,
  validateSharePackage,
} from "./types";

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  documentId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  authorId: "44444444-4444-4444-8444-444444444444",
  recipientId: "55555555-5555-4555-8555-555555555555",
  revisionIds: ["66666666-6666-4666-8666-666666666666"],
  visibility: "mentor-comment",
  scope: "comments+suggestions",
  state: "active",
  createdAt: "2026-09-20T17:00:00.000Z",
  revokedAt: null,
};

describe("validateSharePackage", () => {
  it("accepts a well-formed active package", () => {
    const result = validateSharePackage(BASE);
    expect(result.ok).toBe(true);
  });

  it("rejects sharing with yourself", () => {
    expect(
      validateSharePackage({ ...BASE, recipientId: BASE.authorId }),
    ).toEqual({ ok: false, code: "self_share" });
  });

  it("rejects an empty revision pin", () => {
    expect(validateSharePackage({ ...BASE, revisionIds: [] })).toEqual({
      ok: false,
      code: "empty_revisions",
    });
  });

  it("rejects a revoked package without revokedAt", () => {
    expect(validateSharePackage({ ...BASE, state: "revoked" })).toEqual({
      ok: false,
      code: "revoked_without_timestamp",
    });
  });
});

describe("mentorCanSeeRevision", () => {
  it("sees only pinned active revisions", () => {
    const pkg = validateSharePackage(BASE);
    if (!pkg.ok) throw new Error("setup");
    expect(mentorCanSeeRevision(pkg.value, BASE.revisionIds[0])).toBe(true);
    expect(
      mentorCanSeeRevision(pkg.value, "77777777-7777-4777-8777-777777777777"),
    ).toBe(false);
  });

  it("sees nothing after revoke", () => {
    const pkg = validateSharePackage(BASE);
    if (!pkg.ok) throw new Error("setup");
    const revoked = revokeSharePackage(pkg.value, "2026-09-20T18:00:00.000Z");
    if (!revoked.ok) throw new Error("revoke");
    expect(mentorCanSeeRevision(revoked.value, BASE.revisionIds[0])).toBe(false);
  });
});

describe("reissueSharePackage", () => {
  it("does not mutate the previous package; new id + new pins", () => {
    const pkg = validateSharePackage(BASE);
    if (!pkg.ok) throw new Error("setup");
    const nextRev = "88888888-8888-4888-8888-888888888888";
    const next = reissueSharePackage({
      previous: pkg.value,
      newId: "99999999-9999-4999-8999-999999999999",
      revisionIds: [nextRev],
      createdAt: "2026-09-20T19:00:00.000Z",
    });
    if (!next.ok) throw new Error("reissue");
    expect(next.value.id).not.toBe(pkg.value.id);
    expect(mentorCanSeeRevision(pkg.value, nextRev)).toBe(false);
    expect(mentorCanSeeRevision(next.value, nextRev)).toBe(true);
    expect(mentorCanSeeRevision(next.value, BASE.revisionIds[0])).toBe(false);
  });
});
