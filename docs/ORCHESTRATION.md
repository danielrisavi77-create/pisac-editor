# Orchestration protocol (token-minimal improvement loop)

## Roles
- **Orchestrator** (the Claude Code session): plans, delegates, verifies, pushes, updates state. Never writes application code.
- **Worker** (one `Agent` per iteration): implements exactly one step from `docs/F1_STATE.md`, runs both test suites, commits. Model: `opus` for code/design steps, `sonnet` for mechanical steps (copying, renames, docs, fixtures).
- **Reviewer** (optional second `Agent`, `opus`, read-only): only for steps tagged `[review]` in the queue (auth, RLS, sync/CAS, conflict, export correctness). Reports findings ≤15 lines; worker fixes; no third round unless a finding is a data-loss or security bug.

## One iteration (budget target: 1 worker, ≤ ~120k tokens total)
1. Orchestrator reads `docs/F1_STATE.md` only (≤80 lines). No re-reading of dossier/PR history.
2. Picks the first `TODO` item. Splits it if it would touch >8 files or >400 LOC. Writes a worker prompt that names: files to touch, acceptance checks, test commands, commit message, "do not" list.
3. Worker implements → runs `npm test` (root) and `npm test` in `tools/ai-architect` → commits → final report ≤25 lines (counts, SHAs, blockers).
4. Orchestrator verifies with ONE shell call: `git log --oneline -3 && npm test 2>&1 | grep -E '^# (tests|pass|fail)' && (cd tools/ai-architect && npm test 2>&1 | grep -E '^# (tests|pass|fail)')`.
5. Green → push, mark item `DONE <sha>`, add the next sub-step(s) discovered, commit `docs(state): ...`. Red → one fix round with the same worker (SendMessage); still red → mark `BLOCKED <reason>`, move on.
6. Milestone (an F1 PR boundary) → one PR comment with the checklist; otherwise silence.

## Token rules
- Never paste file contents into prompts; give paths and line ranges.
- Worker reports are capped at 25 lines; orchestrator never reads worker transcripts.
- `docs/F1_STATE.md` is capped at ~80 lines: completed items collapse to one line each.
- No `Workflow` fan-out unless a step has ≥3 independent, non-overlapping file sets.
- Full dossier/reconciliation docs are read by grep/section, never whole.

## Cadence
A routine fires into this session every hour with the prompt "Run one orchestration iteration per docs/ORCHESTRATION.md". If the queue is empty or blocked on the user, the iteration ends in one line with no code changes.

## Stack decisions for F1 in this repo (assumption, flagged to owner)
Next.js App Router + TypeScript, Tiptap (ProseMirror), Dexie (IndexedDB), Supabase (auth + Postgres + RLS), Vitest + Playwright, deployed on Netlify. The legacy vanilla prototype moves to `legacy/` and stays servable until F1-2 replaces it.
