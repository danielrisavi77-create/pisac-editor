# F1 Authoring Kernel — live state
Updated by the orchestrator after each iteration. Keep ≤80 lines.

## Done
- R0 AI Architect v0.3 reconciliation merged into this branch; router surfaces removed; tests green. (see git log)
- R1 PRs #1–#5 closed with rationale; PR #6 superseded by PR #7 (this branch). Loop routine active: hourly.

## Queue (top = next). Tags: [review] = reviewer pass required.
- IN_PROGRESS F1-0a Tooling: Next.js App Router + TypeScript scaffold in repo root (`app/`, `package.json` scripts: dev/build/test/lint), Vitest, ESLint, `.nvmrc`; move `public/index.html` + `public/assets/*` to `legacy/` and keep `netlify.toml` publishing a working site (Next on Netlify). Root `npm test` must still run `tools/ai-architect` tests plus Vitest. CI: `.github/workflows/ci.yml` (install, lint, typecheck, unit tests).
- TODO F1-0b Governance: `docs/F1_PLAN.md` mapping the 7 F1 PRs to concrete steps in this file; fixture ID list FX-FR-001-001…FX-X-SEC-001 with owner test file names (definition only, marked NOT PASS).
- TODO F1-1a [review] Supabase auth: magic-link sign-in, session refresh, protected `/workspace` route, `src/lib/supabase/{client,server}.ts`, env template. No service role in client bundle.
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
- (none)

## Notes
- AI Architect frozen during F1. Only keep its 81+ tests green.
- Public live AI endpoint stays disabled (AI_ARCHITECT_LIVE_ENABLED=false).
