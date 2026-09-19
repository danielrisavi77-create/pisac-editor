# F1 Authoring Kernel — live state
Updated by the orchestrator after each iteration. Keep ≤80 lines.

## Done
- R0 AI Architect v0.3 reconciliation merged into this branch; router surfaces removed; tests green. (see git log)
- R1 PRs #1–#5 closed with rationale; PR #6 superseded by PR #7 (this branch). Loop routine active: hourly.

- DONE 5f51deb F1-0a Next.js 15 App Router + TS + Vitest + ESLint flat + CI; prototype served at /legacy/ (redirect in next.config.ts); Netlify targets Next.
- DONE 2f42736 F1-0b docs/F1_PLAN.md: PR→step map, sync state machine (HR labels), 15-fixture register (NOT PASS).

- DONE e49ea40 F1-1a Supabase magic-link auth (env-driven, /prijava, /workspace guard, HR UI); security review round applied (cookie carry-through on redirects, NEXT_PUBLIC_SITE_URL-pinned origin). Deferred nits: return-to after login, authed-user redirect from /prijava.

## Queue (top = next). Tags: [review] = reviewer pass required.

- TODO F1-1b [review] Personal workspace + academic project: migration `supabase/migrations/<next>_f1_workspace.sql` (workspaces, academic_projects, RLS owner-only), server actions create/list. Migration prepared, not applied.
- TODO F1-2a Canonical document model: `src/domain/document/*` — DocumentNode with opaque UUID ids, schema (paragraph, heading 1–3, text, bold, italic), REPLACE_DOCUMENT transaction type, pure validators + unit tests.
- TODO F1-2b Tiptap editor bound to the canonical model: `app/(workspace)/d/[id]/page.tsx`, editor extension set limited to F1 schema, projection editor→canonical candidate, no execCommand.
- TODO F1-3a [review] Local durable journal (Dexie): atomic tx storing snapshot + pending transaction + local sequence + sync state; state machine EDITING/SAVING_LOCAL/LOCAL_DURABLE/SYNCING/SYNCED/CONFLICT/ERROR/RECOVERY_REQUIRED as a pure reducer + tests.
- TODO F1-3b Sync status UI: status chip bound to the reducer; never shows generic "Saved"; Croatian labels.
- TODO F1-4a [review] Server sync: `documents`, `document_revisions` tables + RLS; CAS on base revision; idempotency (document_id, actor_id, client_transaction_id); server action commit.
- TODO F1-4b Pending queue drain + ACK → SYNCED; retry with backoff; lost-response replay is idempotent.
- TODO F1-5a [review] Conflict: stale base → CONFLICT; explicit rebase / explicit discard; original conflict recorded; no LWW.
- TODO F1-5b Recovery: corrupt/unavailable IndexedDB → RECOVERY_REQUIRED flow; checkpoint = named immutable snapshot (server + local).
- TODO F1-6 DOCX export: `docx` JS, explicit F1 subset, fidelity labels (SUPPORTED_EXACT/APPROXIMATED/UNKNOWN) in export manifest.
- TODO F1-7 Fixtures + Playwright E2E for the F1 fixture IDs; evidence record fixture→test→SHA.

## Blocked / questions for owner
- Q1 ANSWERED by owner 19.9.: pisac-editor gets its OWN Supabase project (option b). Migration numbering stays 2026MMDDNN.
- Q2 RESOLVED 19.9. per owner: Supabase project "Pisac" created (ref cxwxxcwrgushfkisfpxz, eu-central-1) and immediately PAUSED (free-plan slot juggling: Lekta staging briefly paused, then restored). Before F1-1b/F1-4a can apply migrations or fetch keys, the Pisac project must be RESTORED (and something else paused, or plan upgraded). Keys not yet fetched.
- Local Node is v22 while .nvmrc/engines say 24 (EBADENGINE warnings only; CI uses .nvmrc). Consider a SessionStart hook or environment Node 24.

## Notes
- AI Architect frozen during F1. Only keep its 81+ tests green.
- Public live AI endpoint stays disabled (AI_ARCHITECT_LIVE_ENABLED=false).
