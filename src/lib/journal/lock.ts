/**
 * Single-writer guard for the local journal (F1-3a).
 *
 * IndexedDB is shared by every tab on the origin and `saveLocal` replaces the
 * snapshot row outright, so two tabs on the same document would overwrite each
 * other with no conflict ever surfacing — a silent last-write-wins inside the
 * local journal, which the constitution forbids just as much as one on the
 * server. A Web Lock, held for as long as the tab has the document open, makes
 * exactly one tab the writer.
 *
 * `ifAvailable: true` means the request never queues: a second tab is told
 * immediately that it is not the writer instead of hanging until the first
 * tab closes.
 */

/** The lock name for one document. Namespaced so it cannot collide. */
export function documentLockName(documentId: string): string {
  return `pisac-journal:${documentId}`;
}

export type DocumentLock = {
  /**
   * True when this tab may journal. Also true when the Web Locks API is
   * absent — see `fallback`.
   */
  held: boolean;
  /**
   * True when the lock could not be requested at all because the environment
   * has no Web Locks API. The caller keeps writing (refusing would lose the
   * author's text outright), and the multi-tab gap stays open until the
   * server CAS closes it in F1-4b. Callers must not report `fallback` as a
   * held lock in anything the author reads.
   */
  fallback: boolean;
  /** Releases the lock. Idempotent; safe to call when nothing is held. */
  release: () => void;
};

const NO_LOCK_MANAGER: DocumentLock = {
  held: true,
  fallback: true,
  release: () => {},
};

function lockManager(): LockManager | null {
  try {
    return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}

/**
 * Takes the writer lock for `name` if it is free.
 *
 * The lock is held until `release` is called: the callback handed to the Lock
 * Manager returns a promise that only settles then, which is how the Web Locks
 * API expresses "hold this for the lifetime of my tab".
 *
 * Never throws and never hangs: an unavailable manager, or a manager that
 * rejects, degrades to the documented fallback.
 *
 * `manager` is injectable so the behaviour is testable without a browser.
 */
export async function acquireDocumentLock(
  name: string,
  manager: LockManager | null = lockManager(),
): Promise<DocumentLock> {
  if (!manager) {
    return NO_LOCK_MANAGER;
  }

  return new Promise<DocumentLock>((resolve) => {
    let settled = false;
    const settle = (lock: DocumentLock) => {
      if (!settled) {
        settled = true;
        resolve(lock);
      }
    };

    let release = () => {};
    const heldUntil = new Promise<void>((done) => {
      release = () => done();
    });

    void manager
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          // Another tab is the writer.
          settle({ held: false, fallback: false, release: () => {} });
          return undefined;
        }
        settle({ held: true, fallback: false, release });
        return heldUntil;
      })
      .catch(() => {
        // A manager that refuses is treated like a missing one: the author's
        // text matters more than the guard, and the gap is documented.
        settle(NO_LOCK_MANAGER);
      });
  });
}
