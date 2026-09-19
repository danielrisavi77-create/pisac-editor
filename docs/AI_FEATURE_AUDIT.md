# Pisač — AI feature audit (AI Architect v0.2)

## Stvarno postoji u repozitoriju

Pisač je trenutačno statički akademski uređivač s odvojenim Student/Mentor prikazima, citatima i literaturom, komentarima, zapisnikom događaja i provenijencijom teksta. AI doprinosi već imaju posebne događaje i oznake (`ai_query`, `ai_accept`, `ai_inserted`, heuristički `ai_matched`).

Asistent UI već postoji u desnom railu. Korisnik bira svrhu (`explain`, `brainstorm`, `language`, `translate`, `restructure`, `generate`), upisuje prompt te može odgovor umetnuti ili kopirati.

## UI postoji, ali u v0.1 nije postojao pravi AI backend

Prije v0.2 klik na **Pošalji** nije radio mrežni AI poziv. Odgovor se uzimao iz lokalnog objekta `CANNED`. U repozitoriju nije postojao OpenAI/Anthropic/Gemini/OpenRouter SDK ni `fetch` prema AI servisu.

v0.2 zadržava CANNED odgovore samo kao **jasno označen demo fallback** za lokalni statički preview ili kada live AI infrastruktura nije dostupna. Takav fallback nikad se ne označava kao live uspjeh.

## v0.2 stvarni execution path

```text
Asistent UI
  -> public/assets/ai-client.js
  -> /.netlify/functions/ai-execute
  -> AIArchitect.plan()
  -> classification + risk + complexity
  -> ProjectProfile + routing policy
  -> versioned prompt + workflow
  -> provider/model candidate selection
  -> provider abstraction
  -> output validation
  -> independent verification when required
  -> privacy-safe outcome record
  -> response to UI
```

API ključevi postoje samo u server-side runtimeu. Browser ne dobiva OpenRouter/OpenAI/Anthropic/Gemini ključ.

## Buduće AI funkcije koje v0.2 samo priprema

Sljedeće nisu lažno predstavljene kao gotove funkcije:

- automatsko web/source retrieval izvršavanje za research;
- stvarna bibliografska/DOI verifikacija preko vanjskih baza;
- automatski DOCX/OOXML repair iz editora;
- trajni production outcome store iz kojeg serverless runtime uči između deployeva;
- autentifikacija i prava Student/Mentor;
- trajno spremanje rada;
- integracije s Lektom, Katedrom i WordReplicom.

Architect već može planirati te taskove i za high-risk task ih blokira ako nema potreban dokaz/tooling, umjesto da model nagađa.

## Granica povjerenja

- **Planiranje** može raditi potpuno lokalno.
- **Live inference** zahtijeva barem jedan server-side provider ključ.
- **Research/citation verification** zahtijeva retrieval evidence.
- **High-risk success** zahtijeva neovisnu verifikaciju.
- **Adaptive learning** koristi samo ishode koji imaju stvarni quality/eval score; sama niska cijena ne može učiniti neevaluirani model pobjednikom.
- Telemetrija po defaultu čuva hash i duljinu taska/outputa, ne njihov puni sadržaj.
