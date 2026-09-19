# Pisač — akademski uređivač (prototip)

Kod preuzet s https://prototipeditor.netlify.app/ 19. rujna 2026.
HTML, CSS i JavaScript razdvojeni su radi održavanja; logika prototipa je sačuvana.
Ovo je početni kod za novi repozitorij, a ne izvorna povijest projekta.

## Pokretanje

Potreban je Node 24 (vidi `.nvmrc`). Iz korijena projekta pokreni:

```sh
npm ci
npm run dev
```

Otvori http://localhost:3000. Vanilla prototip je na http://localhost:3000/legacy/.
Google Fonts zahtijeva internetsku vezu; preglednik može koristiti zamjenske fontove.

## Struktura

- `app/`: Next.js App Router (ljuska aplikacije, `layout.tsx` i `page.tsx`)
- `src/domain/`: čista domenska jezgra F1 (bez frameworka i bez Supabasea)
- `public/legacy/index.html`: sučelje vanilla prototipa, posluženo na `/legacy/`
- `public/legacy/assets/styles.css`: izgled prototipa
- `public/legacy/assets/app.js`: logika uređivača, provenijencije i Asistent UI
- `public/legacy/assets/ai-client.js`: browser klijent bez API ključeva
- `netlify/functions/ai-execute.mjs`: server-side AI Architect endpoint
- `.ai/`: routing, prompt, workflow, model i eval konfiguracija
- `tools/ai-architect/`: reusable AI Architect core + CLI + testovi
- `netlify.toml`: Next build na Netlifyju (`@netlify/plugin-nextjs`) i Functions konfiguracija

## Repozitorij i objava

Repozitorij: https://github.com/danielrisavi77-create/pisac-editor

Za automatsku objavu poveži postojeći Netlify projekt s ovim repozitorijem.
Konfiguracija `netlify.toml` pokreće `npm run build` i objavljuje Next.js izlaz (`.next`).
Prijenos na GitHub sam po sebi ne mijenja postojeću Netlify stranicu.

## Stvarni status i ograničenja

- Prototip s uređivanjem teksta, citatima, literaturom, komentarima i prikazima Student/Mentor.
- U preuzetom kodu nema localStorage/IndexedDB pohrane ni serverskog spremanja. Oznaka „zapisano” nije potvrda trajne pohrane. Ponovno učitavanje može izgubiti izmjene.
- Prikazi Student/Mentor nisu autentifikacija ni sustav ovlasti.
- Evidencija podrijetla teksta u pregledniku nije dokaz autorstva niti pouzdan detektor AI-ja.
- Demonstracijski tekst, izvori i brojčani podaci nisu provjereni akademski sadržaj.
- Uređivanje koristi document.execCommand; prije produkcije treba provjeriti ponašanje u ciljanim preglednicima.
- Paket je provjeren na sintaksu JavaScripta i identičnost izdvojenih CSS/JS blokova. Funkcionalni pregled u pregledniku nije proveden.
- Nije dodijeljena open-source licenca.

## Sljedeći razvoj

1. Trajno lokalno spremanje, oporavak dokumenta i izvoz sigurnosne kopije.
2. Jasna oznaka demo sadržaja i precizan status spremanja.
3. Provjera undo/redo, lijepljenja, citiranja i komentara u pregledniku.
4. Model dokumenta i pouzdan DOCX izvoz.
5. Autentifikacija i mentorska suradnja ako su potrebne.
6. Integracije s Lektom, Katedrom i WordReplicom kao zasebne, naknadne funkcionalnosti.

## AI Architect v0.3

Repo sada ima jedan canonical AI orchestration sustav: `AI Architect`. Model registry, provider adapteri, token/cost prediction, context budgeting, aggregate hard budgets, retry/fallback/escalation, deterministic contract verification, independent actual-model verification i outcome calibration žive unutar `tools/ai-architect/`. Paralelni `AI Router` runtime i `/api/ai-router` endpoint su superseded.

Statički Python preview i dalje radi bez API ključeva uz jasno označeni demo fallback. Javni live inference ostaje namjerno ugašen: `AI_ARCHITECT_LIVE_ENABLED=false` i `AI_ARCHITECT_USAGE_POLICY_READY=false` dok Pisač nema pouzdanu user identity, per-user kvote/budžete i distribuirani rate limit.

Detalji: [AI_ARCHITECT.md](AI_ARCHITECT.md), [docs/AI_FEATURE_AUDIT.md](docs/AI_FEATURE_AUDIT.md) i [docs/AI_ARCHITECT_V03_RECONCILIATION.md](docs/AI_ARCHITECT_V03_RECONCILIATION.md).
