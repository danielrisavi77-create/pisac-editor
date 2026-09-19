# Performance budget (F1-11)

Measured on this machine, `next build` (Next 15.5.25). kB = 1000 gzipped bytes, the unit Next
prints. No ceiling had to be raised: every route is already inside the one named for it.

| Route | First Load JS | Ceiling |
| --- | --- | --- |
| `/d/[id]` | 255.8 kB | 270 kB |
| `/demo` | 250.7 kB | 270 kB |
| `/` | 106.3 kB | 110 kB |
| `/postavljanje`, `/workspace`, `/prijava` | 106.3 kB | 130 kB |
| `/_not-found` | 103.7 kB | 130 kB |
| `/auth/callback` | 102.8 kB | 130 kB |

**Lazy panels.** `conflict-panel` and `recovery-panel` render only in CONFLICT /
RECOVERY_REQUIRED, so they moved behind `next/dynamic` (`ssr: false`). `/d/[id]`: First Load JS
256.2 → 255.8 kB, route-own size 7.13 → 6.72 kB. Honest reading: 0.4 kB, both 256 kB once Next
rounds — the panels are small and most of what they import is on the route anyway. Kept because
the split is structural (a 1.3 kB chunk, fetched only when a panel renders), not because it
moved the number. `/demo` unchanged at 250.7 kB: it has no panels.

**Latency** — `src/editor/interop.bench.test.ts`, 200 blocks × 50 iterations, p50 < 25 ms and
p95 < 60 ms. Two orders of magnitude of headroom: a quadratic-regression tripwire, not a target.
The storage tripwire is in `journal.test.ts` (10 saves of a 200-paragraph doc, ceiling 2 s).

| Measurement | p50 | p95 |
| --- | --- | --- |
| `tiptapToCanonical(canonicalToTiptap(doc))` | 1.17 ms | 3.35 ms |
| `normalizeDocument(doc)` | 0.14 ms | 0.51 ms |

**Re-measure.** `npm run build && npm run check:bundle`. The check recomputes First Load JS from
`.next/app-build-manifest.json` by gzipping each JS chunk a route pulls in — the arithmetic Next
prints, read from a stable file rather than from stdout — and exits 1 on the first route over its
ceiling. Ceilings live in `scripts/check-bundle-budget.mjs`; CI runs it in the `e2e` job, right
after the build it measures. Latency: add `--reporter=verbose` to see the `[perf]` lines.
