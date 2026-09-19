# Pisač — akademski uređivač (prototip)

Kod preuzet s https://prototipeditor.netlify.app/ 19. rujna 2026.
HTML, CSS i JavaScript razdvojeni su radi održavanja; logika prototipa je sačuvana.
Ovo je početni kod za novi repozitorij, a ne izvorna povijest projekta.

## Pokretanje

Potreban je Python 3. Iz korijena projekta pokreni:

```sh
python -m http.server 8080 --directory public
```

Otvori http://localhost:8080. Nema npm ovisnosti ni build koraka.
Google Fonts zahtijeva internetsku vezu; preglednik može koristiti zamjenske fontove.

## Struktura

- `public/index.html`: sučelje
- `public/assets/styles.css`: izgled
- `public/assets/app.js`: logika uređivača, provenijencije i Asistent UI
- `public/assets/ai-client.js`: browser klijent bez API ključeva
- `netlify/functions/ai-execute.mjs`: server-side AI Architect endpoint
- `.ai/`: routing, prompt, workflow, model i eval konfiguracija
- `tools/ai-architect/`: reusable AI Architect core + CLI + testovi
- `netlify.toml`: objava `public` direktorija i Functions konfiguracija

## Repozitorij i objava

Repozitorij: https://github.com/danielrisavi77-create/pisac-editor

Za automatsku objavu poveži postojeći Netlify projekt s ovim repozitorijem.
Konfiguracija `netlify.toml` objavljuje direktorij `public`, bez build koraka.
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

## AI Architect v0.2

Repo sada sadrži centralni AI planning/execution sloj u `.ai/` i `tools/ai-architect/`, te server-side Netlify funkciju za postojeći Asistent UI. Architect zasebno bira workflow, verzionirani prompt, capability/model/provider strategiju, reasoning, retrieval/verification policy, alate i budžete; high-risk taskovi failaju zatvoreno ako nedostaje dokaz ili neovisna verifikacija.

Statički Python preview i dalje radi bez API ključeva. U tom načinu Asistent koristi jasno označeni demo fallback. Za live AI deployment ključevi se postavljaju samo u Netlify server environment.

Detalji: [AI_ARCHITECT.md](AI_ARCHITECT.md) i [docs/AI_FEATURE_AUDIT.md](docs/AI_FEATURE_AUDIT.md).
