import { describe, expect, it } from "vitest";

import { acquireDocumentLock, documentLockName } from "./lock";

/**
 * A minimal Web Locks stand-in: one holder per name, `ifAvailable` returning
 * `null` to anyone else — which is the only behaviour the guard depends on.
 */
function fakeLockManager(): LockManager {
  const held = new Set<string>();

  return {
    async request(
      name: string,
      options: LockOptions | ((lock: Lock | null) => unknown),
      maybeCallback?: (lock: Lock | null) => unknown,
    ) {
      const callback = (
        typeof options === "function" ? options : maybeCallback
      ) as (lock: Lock | null) => unknown;

      if (held.has(name)) {
        return callback(null);
      }

      held.add(name);
      const lock = { name, mode: "exclusive" as const };
      try {
        await callback(lock);
      } finally {
        held.delete(name);
      }
      return undefined;
    },
    async query() {
      return { held: [], pending: [] };
    },
  } as unknown as LockManager;
}

describe("documentLockName", () => {
  it("namespaces the lock per document", () => {
    expect(documentLockName("abc")).toBe("pisac-journal:abc");
    expect(documentLockName("abc")).not.toBe(documentLockName("abd"));
  });
});

describe("acquireDocumentLock", () => {
  it("grants the lock to the first caller", async () => {
    const manager = fakeLockManager();
    const first = await acquireDocumentLock("doc", manager);
    expect(first.held).toBe(true);
    expect(first.fallback).toBe(false);
    first.release();
  });

  it("refuses a second holder instead of queueing behind the first", async () => {
    const manager = fakeLockManager();
    const first = await acquireDocumentLock("doc", manager);
    const second = await acquireDocumentLock("doc", manager);
    expect(second.held).toBe(false);
    expect(second.fallback).toBe(false);
    first.release();
  });

  it("hands the lock on once the holder releases it", async () => {
    const manager = fakeLockManager();
    const first = await acquireDocumentLock("doc", manager);
    first.release();
    // Let the manager's callback settle before asking again.
    await Promise.resolve();
    const second = await acquireDocumentLock("doc", manager);
    expect(second.held).toBe(true);
    second.release();
  });

  it("keeps different documents independent", async () => {
    const manager = fakeLockManager();
    const a = await acquireDocumentLock("doc-a", manager);
    const b = await acquireDocumentLock("doc-b", manager);
    expect(a.held).toBe(true);
    expect(b.held).toBe(true);
    a.release();
    b.release();
  });

  it("falls back to writing when the API is missing", async () => {
    const lock = await acquireDocumentLock("doc", null);
    expect(lock).toEqual({ held: true, fallback: true, release: expect.any(Function) });
  });

  it("falls back to writing when the manager rejects", async () => {
    const hostile = {
      request: () => Promise.reject(new Error("no locks here")),
    } as unknown as LockManager;
    const lock = await acquireDocumentLock("doc", hostile);
    expect(lock.held).toBe(true);
    expect(lock.fallback).toBe(true);
  });

  it("survives a repeated release", async () => {
    const manager = fakeLockManager();
    const lock = await acquireDocumentLock("doc", manager);
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  it("is a no-op release when the lock was refused", async () => {
    const manager = fakeLockManager();
    const first = await acquireDocumentLock("doc", manager);
    const second = await acquireDocumentLock("doc", manager);
    second.release();
    // The refused caller must not be able to free the real holder's lock.
    const third = await acquireDocumentLock("doc", manager);
    expect(third.held).toBe(false);
    first.release();
  });
});
