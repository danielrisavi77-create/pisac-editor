# F2 — Mentor / Collaboration slice (bounded)

Source: Architecture Dossier §10, §22. Not a Constitution amendment.

## Goal

Asynchronous share of an **exact named revision**, not live draft, not institution-wide visibility.

```
Private draft
→ Named Revision / Checkpoint
→ SharePackage
→ Mentor projection
→ comment / suggestion
→ Student private revision
→ New SharePackage (explicit)
```

## Invariants

- A new student revision is **not** automatically mentor-visible.
- Mentor role alone does not grant edit, submit, private history, or institution-wide visibility.
- SharePackage pins: recipient, revision IDs, visibility, comment/suggestion scope, created/revoked.
- Revoke is a new state transition; history of the package remains.
- Comments attach to a pinned revision + optional nodeId, never to "whatever is on screen now".
- F2 does not introduce CRDT, realtime multiplayer, AI tutor, citations, LMS, or billing.

## Delivered this iteration

Domain module `src/domain/share/*`:

- SharePackage schema + validation
- comment / suggestion records
- revoke / new-package-from-revision transitions
- unit tests

UI and server persistence are F2-1b (after F1-8 env is live).
