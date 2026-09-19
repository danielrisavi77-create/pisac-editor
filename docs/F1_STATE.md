# F1 Authoring Kernel — live state
Updated by the orchestrator after each iteration. Keep ≤80 lines.

## Done
- R0 AI Architect v0.3 reconciliation merged into this branch; router surfaces removed; tests green. (see git log)
- R1 PRs #1–#5 closed with rationale; PR #6 superseded by PR #7 (this branch). Loop routine active: hourly.

- DONE 5f51deb F1-0a Next.js 15 App Router + TS + Vitest + ESLint flat + CI; prototype served at /legacy/ (redirect in next.config.ts); Netlify targets Next.
- DONE 2f42736 F1-0b docs/F1_PLAN.md: PR→step map, sync state machine (HR labels), 15-fixture register (NOT PASS).

- DONE e49ea40 F1-1a Supabase magic-link auth (env-driven, /prijava, /workspace guard, HR UI); security review round applied (cookie carry-through on redirects, NEXT_PUBLIC_SITE_URL-pinned origin). Deferred nits: return-to after login, authed-user redirect from /prijava.

- DONE 1b31f9b F1-1b workspace+project schema (2026091904, RLS owner-only, anon revoked, updated_at trigger; PREPARED not applied), server actions + /workspace UI; review round applied. Deferred nits: title not preserved on error, repeated getUser calls.

- DONE dd79364 F1-2a canonical document model src/domain/document/* (schema, validate 20 codes, normalize idempotent, REPLACE_DOCUMENT CAS, equality; 78 tests).

- DONE 811d03b F1-2b Tiptap editor bound to canonical model (F1-only extensions, nodeId attr, pure interop with round-trip tests, /d/[id] guarded route, HR toolbar; 57 tests).

- DONE 38cf712 F1-3a Dexie journal + sync reducer (atomic tx, sticky states persisted across reload, honest durability via onDirty/flush, Web Locks multi-tab guard, pending trim 50; review round applied). Obligations: F1-4b clearPending on ACK, F1-5a clearPending on discard.

- DONE c0f606a F1-3b sync status chip (8 HR labels per F1_PLAN, blocked precedence, a11y aria-live, dark mode, no generic Saved; LOCAL_DURABLE neutral tone vs SYNCED ok).

- DONE faab08a F1-4a server document store: definer RPCs pisac_commit_document/pisac_ensure_document (CAS+row lock, idempotency digest, too_large/txid_reused, ownership in-body), direct writes revoked, honest load failure; migration 2026091905 PREPARED not applied; review round applied.

- DONE ea33f50 F1-4b drain runner: newest-pending supersession, ACK clears pending + markSynced (SYNCED only when queue empty), backoff+jitter, single-flight, fastForwardBase for in-flight saves, stale_base halts for F1-5a.

- DONE d8b691d F1-5a explicit conflict resolution: recorded conflicts (never deleted), journal frozen in CONFLICT (3 layers), no-lockout degraded panel, rebase uses newest durable text, discard re-fetches fresh server doc; review round applied.

- DONE d9b4d32 F1-5b recovery flow (explicit salvage-local/adopt-server, resetJournalDatabase on user choice, RECOVERED carries via) + named immutable checkpoints (migration 2026091906 PREPARED, definer RPC, server-truth snapshot, honest unsynced note).

- DONE 3d5e708 F1-6 DOCX export of F1 subset: fidelity manifest (SUPPORTED_EXACT/UNKNOWN paths, PARTIAL overall), lazy docx import, honest HR labels incl. local-changes note, PK smoke verified.

## Queue (top = next). Tags: [review] = reviewer pass required.

- IN_PROGRESS F1-7 Fixtures + Playwright E2E for the F1 fixture IDs; evidence record fixture→test→SHA.

## Blocked / questions for owner
- Q1 ANSWERED by owner 19.9.: pisac-editor gets its OWN Supabase project (option b). Migration numbering stays 2026MMDDNN.
- Q2 RESOLVED 19.9. per owner: Supabase project "Pisac" created (ref cxwxxcwrgushfkisfpxz, eu-central-1) and immediately PAUSED (free-plan slot juggling: Lekta staging briefly paused, then restored). Before F1-1b/F1-4a can apply migrations or fetch keys, the Pisac project must be RESTORED (and something else paused, or plan upgraded). Keys not yet fetched.
- Local Node is v22 while .nvmrc/engines say 24 (EBADENGINE warnings only; CI uses .nvmrc). Consider a SessionStart hook or environment Node 24.

## Notes
- AI Architect frozen during F1. Only keep its 81+ tests green.
- Public live AI endpoint stays disabled (AI_ARCHITECT_LIVE_ENABLED=false).
