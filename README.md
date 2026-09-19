# Pisač

Pisač je akademski uređivač u razvoju kao F1 Authoring Kernel: Next.js 15 (App Router) + Supabase + Tiptap + Dexie, s eksplicitnim stanjima sinkronizacije i modelom dokumenta koji čuva razliku između identiteta i autorstva.
Ovo je javni demo/prototip repozitorij — dio funkcionalnosti (autentifikacija, serversko spremanje) radi tek uz vlastiti Supabase projekt.

Kod je izvorno preuzet s https://prototipeditor.netlify.app/ 19. rujna 2026. i otad postupno zamijenjen F1 jezgrom; vanilla prototip je i dalje dostupan na `/legacy/`.

## Pokretanje

Potreban je Node 24 (vidi `.nvmrc`).

```sh
npm ci
npm run dev
```

Otvori http://localhost:3000.

- `/demo` radi bez ikakve konfiguracije — lokalni uređivač bez prijave i bez servera.
- Puna aplikacija (prijava, `/workspace`, `/d/[id]`) traži `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ opcionalno `NEXT_PUBLIC_SITE_URL` za magic-link redirect). Bez njih aplikacija poštenu obavještava korisnika umjesto da tiho pukne — vidi `.env.example` za sve varijable i objašnjenja (uključujući granice rate limitinga).

## Testovi

```sh
npm test          # Vitest (root) + AI Architect (tools/ai-architect) — 1082 + 86 testova
npm run test:e2e  # Playwright — 30 E2E testova
npm run check:bundle
```

`npm test` mora biti zelen prije svakog commita (pravilo iz `CLAUDE.md`).

## Struktura

- `app/` — rute: `/`, `/prijava`, `/workspace` (+ `/postavljanje` za neispravnu konfiguraciju), `/d/[id]`, `/demo`, `/legacy` (statični vanilla prototip)
- `src/domain/` — čista domenska logika bez frameworka: `document/`, `sync/`, `workspace/`, `docx/`, `serverSync/`
- `src/lib/` — `journal/` (Dexie), `sync/` (drain runner), `supabase/`, `i18n/`, `rate/`
- `src/editor/` — Tiptap shema i interop s kanonskim modelom dokumenta
- `supabase/migrations/` — pripremljene, **nisu primijenjene** na produkciju
- `tools/ai-architect/` — AI Architect, zamrznut tijekom F1 (dossier §30)
- `docs/` — arhitekturni dossier, F1 plan, stanje petlje (`F1_STATE.md`), performance budžet
- `e2e/` — Playwright specovi + `EVIDENCE.md`

## Stanje projekta

F1 Authoring Kernel je implementiran i testiran (kanonski model dokumenta, Tiptap uređivač, Dexie journal + sync reducer, server document store s CAS-om, eksplicitno razrješavanje konflikata, recovery flow, checkpointi, DOCX izvoz, E2E pokrivenost). Supabase migracije su pripremljene, ali čekaju aktivaciju Supabase projekta prije primjene. AI Architect je zamrznut po `docs/ARCHITECTURE_DOSSIER_2026-09-19.md` §30 — samo se održavaju njegovi testovi, bez proširenja. PR #7 je aktivna grana ovog rada.

## Deploy

Netlify (`netlify.toml`, `@netlify/plugin-nextjs`) gradi i poslužuje Next.js izlaz. Iz ove grane još nije objavljeno.
