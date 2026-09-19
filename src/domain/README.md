# Domain

Pure TypeScript domain kernel: no framework, no React, no Next.js runtime imports.
No Supabase imports here — persistence and transport live outside the domain.
Everything in this folder must be testable with plain Vitest in a Node environment.

`document/` holds the canonical document model: paragraph and heading (1-3) blocks with opaque UUID ids, text inline nodes with canonical bold/italic marks, plus validation, idempotent normalisation and equality.
The only F1 mutation is `REPLACE_DOCUMENT`, applied as a pure compare-and-set on the revision number.
