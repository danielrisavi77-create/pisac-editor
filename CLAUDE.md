# Pisač — pisac-editor (public demo/prototype)

Read `docs/ORCHESTRATION.md` (loop protocol) and `docs/F1_STATE.md` (current step) before any work.
Architecture source of truth: `docs/ARCHITECTURE_DOSSIER_2026-09-19.md` (grep the section you need; do not read it whole).
AI subsystem source of truth: `docs/AI_ARCHITECT_V03_RECONCILIATION.md`. The AI Architect is FROZEN during F1 (dossier §30 "Do not build yet"): do not extend it, only keep its tests green.

## Hard rules
- Tests: `npm test` (root) and `npm test` in `tools/ai-architect` must be green before every commit. Never delete a test without an equivalent replacement. Never skip/quarantine a test.
- Scope: one bounded step per commit, as named in `docs/F1_STATE.md`. No drive-by refactors.
- Constitution invariants (never violate): identity ≠ authorship; evidence ≠ judgment; no "AI %" or misconduct score; no keylogger (no per-keystroke logging); local durable state ≠ canonical server state; never a generic "Saved" label (use the 8 sync states); no silent last-write-wins on conflict.
- Secrets: provider keys and Supabase service role are server-only. Never commit `.env`. Migrations are prepared, never auto-applied to production.
- Git: `git add <paths>` (never `-A`). Conventional commit prefixes (`feat(f1-3):`, `fix:`, `test:`, `docs:`). Do not push unless the orchestrator says so.
- Language: user-facing UI strings in Croatian; code, identifiers, commits, docs in English unless the file is already Croatian.
