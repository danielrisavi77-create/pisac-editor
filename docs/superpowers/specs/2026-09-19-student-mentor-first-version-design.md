# Pisač: prva povezana studentska i mentorska verzija

Datum: 19. rujna 2026.
Status: PISANI DIZAJN ZA PREGLED — implementacija nije započela.
Repozitorij: `danielrisavi77-create/pisac-editor`
Pregledani početni commit: `e2cef926f7a7bb8eb4af9e749ec3a693c74cd359`

## 1. Cilj i prihvaćeni opseg

Student se prijavi, otvori rad, piše uz pouzdano spremanje, izradi dvije verzije i podijeli ih s mentorom. Mentor vidi razlike, pregled evidentiranih umetanja i ostavi komentar. Student odgovori, doradi rad i podijeli novu verziju. Završetak ciklusa omogućuje zamrznutu predaju unutar Pisača i DOCX izvoz.

Fakultetu ovaj proces može pružiti podatke za procjenu samostalnosti. Aplikacija prikazuje zabilježene događaje i ograničenja evidencije; ne donosi zaključak o ljudskom autorstvu, korištenju vanjskog AI-ja ili akademskom prekršaju.

Korisnik je u razgovoru prihvatio ovaj funkcionalni smjer. Ovaj dokument konkretizira tehnički dizajn. Odabir podijeljenih verzija, početni skup podržanih struktura i opisani postupak konflikta predstavljaju prijedloge za pregled.

## 2. Početno stanje i odnos prema ranijem planu

Repozitorij sadrži šest datoteka statičkog prototipa. `public/assets/app.js` koristi `contenteditable`, `document.execCommand`, unaprijed pripremljene AI odgovore, demonstracijske događaje i pragove 15 % nepoznatog podrijetla / 10 % AI doprinosa. Nema autentifikacije, trajne pohrane ni serverske autorizacije. Te pragove, simulirane odgovore i demonstracijsku povijest ne prenosimo u stvarne korisničke projekte.

Postojeći izgled služi kao vizualna osnova. Izvorni demo ostaje dostupan kao jasno označena, odvojena demonstracija; nije migracija stvarnih radova. Ne prikazujemo demonstracijske nalaze u stvarnom mentorskom pregledu.

Prethodno razmatrani Foundation F1 plan odvajao je jezgru uređivanja od kasnijeg mentorstva. Ova prva povezana verzija obuhvaća minimalnu jezgru i usko definirano mentorstvo. To ne znači da je cijeli raniji F2 realiziran ili da su prethodni službeni testni zahtjevi ispunjeni.

Aktualni cilj je postojeći `pisac-editor`, a ne novi repozitorij `Pisac`. Repozitorij je pri pregledu javan. Ovaj dokument sadrži dizajn proizvoda, bez kopiranja privatnih Drive dokumenata, korisničkih radova, vjerodajnica ili internih zapisa odobravanja. Promjena vidljivosti repozitorija nije dio ove izmjene.

## 3. Granice prve verzije

Uključeno:

- stvarni trajni korisnički računi, prijava, odjava i oporavak pristupa;
- privatni akademski projekt s jednim autorom i jednim dokumentom;
- strukturirano pisanje i osnovno oblikovanje;
- automatska lokalna pohrana, serverska sinkronizacija, oporavak i eksplicitni konflikti;
- provjerljiva povijest verzija i oznake načina unosa;
- imenovane verzije, dijeljenje odabranih verzija i opoziv pristupa;
- mentorska usporedba, komentari, odgovori i razrješenje komentara;
- pregled podataka prije predaje, nepromjenjiva predana verzija i DOCX izvoz.

Kasnije: ugrađeni AI, detektor AI-ja, institucionalna pravila i službene fakultetske predaje, automatske ocjene, više istodobnih autora, puni DOCX uvoz, PDF/A, napredne tablice/slike/jednadžbe, LMS/SSO, naplata i prezentacijska stranica. Osnovni bibliografski tekst može se pisati ručno; automatsko citiranje nije uvjet ovog prvog ciklusa.

Prvo okruženje koristi sintetičke testne račune i radove. Uvođenje stvarnih korisnika zaseban je korak nakon tehničkih i privatnosnih provjera.

## 4. Korisnički tokovi

### Student

1. Prijava i popis vlastitih projekata.
2. Novi rad: naslov, vrsta rada i opcionalni opis. Početak je prazan dokument, bez demo podataka.
3. Kratka obavijest: bilježe se promjene u dokumentu; mentor vidi samo izričito podijeljene verzije i pripadajući odabrani sažetak.
4. Pisanje uz uvijek vidljiv status pohrane i dostupnu povijest.
5. Spremanje imenovane verzije iz serverski potvrđenog stanja.
6. Pregled točnog sadržaja i sažetka koji će se podijeliti; odabir primatelja i potvrda dijeljenja.
7. Odgovor na mentorski komentar, dorada privatnog nacrta i zasebno dijeljenje sljedeće verzije.
8. Pregled predaje, zamrzavanje odabrane verzije i DOCX preuzimanje.

### Mentor

1. Prijava istim sustavom računa; naziv uloge sam po sebi ne daje pristup radovima.
2. Popis radova za koje postoji prihvaćen i aktivan poziv.
3. Otvaranje podijeljene verzije, sažetka i komentara.
4. Usporedba dviju verzija koje su obje izričito podijeljene s tim mentorom.
5. Komentar uz odlomak ili cijelu verziju; čitanje odgovora i nove podijeljene verzije.

Mentor nema pristup privatnom trenutnom nacrtu, svim međukoracima uređivanja, obrisanim privatnim tekstovima, lokalnom recovery spremištu ili drugim projektima studenta.

## 5. Tehnološki smjer i granice modula

Predložena osnova nastavlja ranije odabrani smjer: Next.js/React/TypeScript, Tiptap/ProseMirror adapter, IndexedDB za lokalnu trajnost te Supabase Auth/Postgres za identitet, pohranu i autorizaciju. DOCX serializer prima strukturiranu spremljenu verziju.

Točne verzije biblioteka provjeravaju se u provedbenom planu i vežu lockfileom. Verzije navedene u starijim dokumentima ne preuzimaju se bez provjere dostupnosti i kompatibilnosti.

Moduli:

- `domain`: struktura dokumenta, operacije, revizije i validacija;
- `editor`: prilagodba naredbi uređivača na domenski model;
- `persistence`: lokalni zapis, red sinkronizacije, oporavak i konflikt;
- `sharing`: pozivi, prava, podijeljene verzije i opoziv;
- `review`: usporedbe, komentari i odgovori;
- `submission`: pregled, zamrzavanje i potvrda predaje;
- `export-docx`: determinističko preslikavanje podržane strukture u DOCX.

DOM nije izvor istine. Postojeći demo nije autentificirana aplikacija. Razvojna verzija dobiva zaseban preview; postojeći Netlify demo ne zamjenjuje se automatski objavom ovog dizajna.

## 6. Struktura dokumenta i evidencija promjena

Dokument ima `schema_version`, stabilne identifikatore blokova i uređene tekstualne segmente. Početni podržani elementi: odlomci, naslovi dvije razine, podebljano, kurziv, numerirani i nenumerirani popisi te blok-citat. Naslov rada također je dio verzioniranog stanja.

Kanonske operacije obuhvaćaju umetanje/brisanje/zamjenu teksta, umetanje/brisanje/pomicanje bloka i promjenu oznaka oblikovanja. Jedna logička radnja može sadržavati više uređenih operacija koje se prihvaćaju atomarno. Undo/redo stvaraju nove operacije; ne brišu povijest. Vraćanje stare verzije stvara novu reviziju s referencom na obnovljenu verziju.

Svaka transakcija sadrži jedinstveni `client_transaction_id`, `document_id`, `base_revision_id`, verziju sheme operacija, uređene operacije i oznaku načina unosa. Server sam postavlja prihvaćenog korisnika, vrijeme primitka, redoslijed i novu reviziju. Korisnički ID iz zahtjeva ne određuje autora serverskog zapisa.

Oznake načina unosa: `editor_input`, `paste`, `import`, `format`, `restore`, `unknown`. Metapodaci preglednika opisuju klijentsko opažanje; server ih ne pretvara u dokaz fizičkog tipkanja. Ako način unosa nije poznat, ostaje `unknown`. Diktiranje, IME i pristupačni alati ne dobivaju oznaku prekršaja.

Za prvu verziju podržan je uvoz običnog UTF-8 `.txt` teksta do 1 MiB, kroz eksplicitni pregled i potvrdu. DOCX/PDF uvoz nije ponuđen kao funkcionalan. Lijepljeni HTML normalizira se u podržane strukture ili običan tekst, bez izvršavanja aktivnog sadržaja. Prevelik unos odbija se prije izmjene dokumenta, uz jasnu poruku; nema tihog skraćivanja.

Povijest mora rekonstruirati isto strukturirano stanje od početne verzije. Materijalizirane verzije ubrzavaju čitanje, ali ne zamjenjuju test rekonstrukcije. Izvještaj pokazuje događaje i razlike; ne prikazuje postotke preživjelog AI/lijepljenog teksta dok poseban model praćenja podrijetla i njegovi testovi nisu izrađeni.

## 7. Lokalno spremanje, sinkronizacija i oporavak

Lokalni zapisi odvojeni su po korisniku, projektu i dokumentu. Transakcija i stanje lokalnog reda upisuju se atomarno u IndexedDB. Uređivač smije pokazati novu trajno spremljenu projekciju tek nakon uspješnog lokalnog commita; tijekom kratkog upisa naredbe se serijaliziraju uz očuvanje selekcije i IME sastavljanja. Ponašanje tog prijelaza mora biti ispitano u stvarnom pregledniku.

Statusi u sučelju:

| Status | Značenje |
|---|---|
| Spremanje… | Lokalna trajnost još nije potvrđena |
| Spremljeno na ovom uređaju | Lokalna pohrana uspjela, server nije potvrdio sve promjene |
| Sinkroniziranje… | Promjene se šalju |
| Spremljeno na serveru | Sve lokalne transakcije imaju potvrđene serverske revizije |
| Sukob verzija | Server ima različitu osnovnu reviziju; obje verzije sačuvane |
| Spremanje nije uspjelo | Nema tvrdnje o uspješnoj pohrani; ponuđeno preuzimanje dostupnog lokalnog teksta |

Mrežni prekid ne blokira uređivanje prethodno otvorenog projekta dok račun i lokalni kontekst ostaju poznati. Novi login, poziv mentoru, dijeljenje, predaja i kanonski DOCX izvoz zahtijevaju mrežu i važeću autorizaciju. Nakon isteka sesije lokalni nacrt ostaje sačuvan; slanje čeka ponovnu prijavu istog korisnika.

Server u jednoj transakciji provjerava pristup, idempotentnost i očekivanu reviziju te sprema promjenu. Ponovljena ista transakcija vraća izvorni rezultat; isti identifikator s drugim sadržajem odbija se. Lokalni red serijalizira ovisne izmjene i sljedeću povezuje s potvrđenom revizijom prethodne.

Konflikt ne koristi silent last-writer-wins. Korisnik dobiva usporedbu lokalne i serverske verzije. Može izvesti lokalnu kopiju ili pripremiti novu verziju na aktualnoj osnovi. Nova izmjena mora ponovno proći provjeru aktualne revizije. Nema tihog odbacivanja lokalnog reda.

Druge kartice prepoznaju aktivnog lokalnog pisca i prelaze u prikaz za čitanje; server ostaje konačna zaštita ako to ograničenje zakaže. Više uređaja obrađuje se istim postupkom konflikta. Pri ponovnom otvaranju reproduciraju se potvrđena osnova i lokalni nepotvrđeni red.

Odjava s nesinkroniziranim radom nudi sinkronizaciju ili preuzimanje prije uklanjanja lokalnog sadržaja. Odjava bez lokalnih promjena čisti korisničko spremište. Drugi prijavljeni račun nikada ne dobiva prethodne lokalne radove. Browser storage nije jamstvo preživljavanja ručnog brisanja podataka, gubitka uređaja ili browser evictiona; serverska kopija i preuzimanje ostaju zaštita za te slučajeve.

## 8. Identitet, pohrana i autorizacija

Account authority je `auth.users.id`; akademski projekt treba slijediti postojeći Academic Suite ugovor `academic_projects.id`. Prije implementacije provjerava se stvarna shema i vlasništvo projekata. Ne uvodi se druga konkurentska tablica identiteta radi bržeg scaffolding-a.

Razvoj i testovi koriste izolirano neprodukcijsko okruženje. Postojeća produkcijska baza ne služi testiranju. Promjene zajedničke produkcijske sheme slijede postojeću migracijsku nadležnost Lekta repozitorija; konkretna SQL migracija nastaje tek nakon pregleda aktualne sheme. Ovaj dizajn ne izvršava migracije niti stvara naplatne resurse.

Domenske cjeline pohrane:

- dokument i njegova trenutačna serverska revizija;
- prihvaćene transakcije i nepromjenjive revizije;
- imenovane verzije;
- pozivi i aktivna prava suradnika;
- objavljeni paketi verzija za mentora;
- komentari, odgovori i događaji razrješenja;
- zamrznute predaje i zapis izvoza.

Sve izložene tablice imaju RLS. API i baza provjeravaju stvarnog korisnika i odnos prema konkretnom objektu. Mentorovo čitanje odnosi se na pakete dijeljenja, bez prava na bazne privatne tablice revizija i transakcija. Klijent ne dobiva service-role ključ. Autorizacija se ne temelji na korisnički promjenjivom nazivu uloge ili na skrivenim gumbima.

## 9. Dijeljenje i privatnost

Početni poziv namijenjen je konkretnom već registriranom i potvrđenom računu, odabranom punom e-mail adresom. Sustav ne nudi javni imenik korisnika. Nepostojeći primatelj dobiva neutralan ishod bez otkrivanja stanja registracije. Poziv se prikazuje u aplikaciji; slanje e-mail obavijesti nije potrebno za prvi ciklus.

Student odabire jednu ili više imenovanih serverski potvrđenih verzija, vidi točan pregled sadržaja i sažetka te potvrđuje dijeljenje. Primatelj prihvaća poziv nakon prijave. Poziv nije dokaz službenog fakultetskog mentorstva.

Paket dijeljenja sadrži odabrane verzije i sažetak izračunan isključivo za te verzije i odobreni prikaz. Usporedba prikazuje sadržaj razlika između dvije podijeljene verzije. Sažetak može prikazati da je dio objavljenog sadržaja povezan s evidentiranim lijepljenjem/uvozom, kada je ta veza pouzdano dostupna; inače navodi da segmentna veza nije dostupna. Nikada ne izvozi skrivene međurevizije ili njihove obrisane tekstove.

Mentorski API vraća već filtriran sadržaj. Privatni podaci se ne šalju pregledniku radi naknadnog skrivanja. Student prije dijeljenja koristi isti serverski generator prikaza kao mentor; različit je korisnički kontekst, ne pravila oblikovanja paketa.

Opoziv odmah blokira buduće serverske zahtjeve i komentiranje. Mentorski prikaz ne podržava offline kopije; nakon gubitka autorizacije uklanja podatke iz aktivnog sučelja. Nije moguće opozvati sadržaj koji je primatelj ranije preuzeo ili snimio. Nova verzija ne postaje automatski dostupna ranijim primateljima.

## 10. Komentari i usporedba

Komentar se veže uz `shared_revision_id`, stabilni `block_id` i opcionalni raspon teksta u toj točnoj verziji. U ovoj verziji ne premješta se automatski na izmijenjeni tekst. U novoj verziji može se prikazati izvorni kontekst i veza na doradu koju student odabere; to nije automatska potvrda da je primjedba riješena.

Mentor i vlasnik rada mogu odgovarati u dostupnoj niti. Vlasnik može označiti da je doradio rad; autor komentara može ga označiti riješenim ili ponovno otvoriti. Razrješenje ne briše prethodne poruke. Pravo komentiranja ne daje pravo izmjene dokumenta, dijeljenja s trećima ili predaje u ime studenta.

Usporedba se računa prema strukturiranom modelu i stabilnim identifikatorima blokova. Pokazuje dodano, uklonjeno, promijenjeno i premješteno. Rezultat opisuje razliku sadržaja dviju verzija, a ne uzrok nastanka teksta.

## 11. Predaja i DOCX

Predaja u prvoj verziji znači predaju unutar Pisača odabranom suradniku. Nema tvrdnje o službenoj fakultetskoj predaji.

Student odabire serverski potvrđenu verziju, primatelje i pregled podataka. Server atomarno zamrzava reviziju, paket vidljivosti i vrijeme predaje uz provjeru vlasništva. Ponovljeni zahtjev ne stvara duplikat. Kasnije pisanje ne mijenja predanu verziju; ponovna predaja stvara novu povezanu predaju.

DOCX nastaje iz odabrane serverske revizije, nikad iz trenutačnog DOM-a. Podržava samo strukture iz odjeljka 6. Nepodržana struktura proizvodi eksplicitnu pogrešku ili upozorenje prije izvoza, bez tihog gubitka. Komentari i privatna povijest ne ulaze u DOCX prema zadanim postavkama.

Nesinkronizirane izmjene blokiraju izvoz trenutačnog rada kao spremljene verzije. Odvojena funkcija hitnog TXT preuzimanja služi spašavanju lokalnog teksta i jasno je označena. Izvoz se može ponoviti iz iste revizije; za tvrdnju o jednakim bajtovima potrebni su fiksni metapodaci i stvarni test ponovne generacije. Hash datoteke potvrđuje njezin identitet, ne autorstvo.

## 12. Sučelje i pristupačnost

Zadržava se miran izgled prototipa: struktura lijevo, dokument u sredini i kontekst desno. Studentska desna ploča u prvoj verziji daje komentare, verzije i dijeljenje. Lažni AI asistent i pragovi integriteta uklanjaju se iz produkcijskog toka.

Mentorsko sučelje otvara popis dijeljenih radova pa odabranu verziju s usporedbom i komentarima. Ne otvara se administrativni pregled svih studenata.

Osnovni tokovi moraju biti izvedivi tipkovnicom, imati vidljiv fokus i tekstualna objašnjenja statusa. Razlike nisu označene samo bojom. IME, diktiranje i čitači zaslona ne smiju automatski dobivati sumnjive oznake. Početno se provjerava Chromium desktop; drugi preglednici dobivaju potvrdu tek nakon stvarnog testiranja.

## 13. Provjere prije tvrdnje da je prvi ciklus dovršen

| Scenarij | Očekivani rezultat |
|---|---|
| Student A i student B | B ne može čitati ili mijenjati A-ov projekt, ni izravnim API zahtjevom |
| Spremanje i ponovno otvaranje | Isti tekst, blokovi i oblikovanje nakon lokalnog commita i nakon serverskog potvrđivanja |
| Prekid mreže i ponovno spajanje | Lokalni rad ostaje, sinkronizacija ga ne udvostručuje |
| Pad lokalnog spremišta / kvota | Nema lažne oznake spremljeno; dostupan tekst može se preuzeti |
| Gubitak odgovora nakon server commita | Retry vraća istu reviziju |
| Dvije kartice / uređaja | Konflikt ne prepisuje tuđi ili lokalni rad |
| Undo, paste, uvoz i restore | Rekonstrukcija odgovara prikazanom dokumentu, oznake ostaju poštene |
| Istek sesije / promjena računa | Nema slanja tuđih lokalnih transakcija niti otkrivanja tuđeg cachea |
| Dvije podijeljene verzije | Mentor vidi točne razlike, bez skrivenog međunacrta |
| Izravan pristup privatnoj reviziji | Server/baza odbijaju zahtjev mentora |
| Opoziv pristupa | Sljedeće čitanje i komentar odbijeni |
| Komentar i dorada | Izvorni anchor sačuvan; studentski odgovor i nova verzija dostupni u dopuštenom opsegu |
| Pregled dijeljenja/predaje | Student vidi točno paket koji će mentor dobiti |
| Predaja pa daljnje uređivanje | Predana verzija ostaje ista |
| DOCX | Sadržaj i podržano oblikovanje odgovaraju odabranoj reviziji |
| Tastatura, IME i oporavak | Nema gubitka unosa ili nedostupnih ključnih radnji |

Unit testovi pokrivaju operacije i rekonstrukciju. Integracijski testovi pokrivaju pohranu, idempotentnost i stvarna pravila pristupa. Browser test koristi dva odvojena prijavljena konteksta (student/mentor) za cijeli ciklus. Mockirani backend ili ručno prebacivanje gumba Student/Mentor nisu dokaz te funkcionalnosti.

Kriterij uspjeha: student napiše V1 i V2, podijeli obje, mentor usporedi i komentira V2, student izradi i podijeli V3, mentor vidi odgovor i doradu, a student preda V3 i preuzme pripadajući DOCX. Uz to moraju proći scenariji gubitka mreže, konflikta i zabrane pristupa.

## 14. Granica sljedećeg koraka

Ovaj dokument ne tvrdi da postoje login, baza, sinkronizacija, mentorska suradnja ili izvršeni runtime testovi. Nije provedbeni plan s popisom kodnih zadataka.

Nakon pregleda pisanog dizajna izrađuje se provedbeni plan po manjim promjenama: projektna osnova i auth; model dokumenta i lokalna trajnost; server i oporavak; dijeljenje i pregled; komentari; predaja/izvoz; integracijska provjera cijelog ciklusa. Detaljne verzije ovisnosti, aktualna shema baze i konfiguracija razvojnog okruženja provjeravaju se tada prije odgovarajuće implementacije.
