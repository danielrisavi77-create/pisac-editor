# Domain

Pure TypeScript domain kernel: no framework, no React, no Next.js runtime imports.
No Supabase imports here — persistence and transport live outside the domain.
Everything in this folder must be testable with plain Vitest in a Node environment.

One import out of the folder is allowed on purpose (F1-9b): `@/lib/i18n/hr`, the Croatian date and plural rules.
It is a dependency-free leaf module, so it costs the domain none of its testability, and the alternative — a copy of the Croatian agreement rule in every file that counts something — is how the panels ended up with three of them.

`document/` holds the canonical document model: paragraph and heading (1-3) blocks with opaque UUID ids, text inline nodes with canonical bold/italic marks, plus validation, idempotent normalisation and equality.
The only F1 mutation is `REPLACE_DOCUMENT`, applied as a pure compare-and-set on the revision number.
