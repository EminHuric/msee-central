# MsEe Central

Interni sistem za upravljanje poslovanjem kompanije MsEe.
*Internal business management system for MsEe.*

Ovo nije javni SaaS proizvod. To je interna platforma koju koriste CEO i zaposleni.

---

## Tehnologije

| Sloj | Izbor | Zašto |
| --- | --- | --- |
| Frontend | Vue 3 + TypeScript + Vite | Tipizirani ključevi permisija i statusa se proveravaju pri kompajliranju |
| Prijavljivanje | Firebase Auth | Gotov, testiran sistem za lozinke i sesije — ne pišemo svoj |
| Baza | Cloud Firestore | Deli isti nalog sa ostalim MsEe sistemima (StayBrain) |
| Autorizacija | Firestore Security Rules | Sprovodi Google na serveru, ne može se zaobići iz pregledača |
| Jezici | vue-i18n (en / sr) | Engleski je podrazumevani |

---

## Prvo pokretanje

### 1. Instaliraj zavisnosti

```bash
npm install
```

### 2. Napravi Firebase projekat

1. Otvori [console.firebase.google.com](https://console.firebase.google.com) i napravi projekat
2. **Authentication → Sign-in method →** uključi **Email/Password**
3. **Firestore Database →** napravi bazu, izaberi **europe-west** region
4. **Project settings → General → Your apps →** dodaj **Web app** (`</>`)

### 3. Popuni `.env`

```bash
cp .env.example .env
```

Prepiši vrednosti iz Firebase konzole (`Project settings → General → SDK setup and configuration`).

> Ove vrednosti **nisu tajne.** Firebase web konfiguracija se nalazi u svakom
> pregledaču koji otvori aplikaciju i to je normalno. Podatke čuvaju sigurnosna
> pravila, ne skrivanje ovih ključeva.
>
> **Service account ključ jeste tajna** i nikad ne ide u `.env` niti u `src/`.

### 4. Objavi sigurnosna pravila

**Uradi ovo pre nego što u bazu uđe ijedan podatak.** Ako si bazu napravio u
*test mode*, otvorena je za bilo koga na internetu narednih 30 dana.

Firebase konzola → **Firestore Database** → tab **Rules** → obriši sve →
nalepi ceo sadržaj `firebase/firestore.rules` → **Publish**.

Ili, kad se prijaviš na CLI:

```bash
npx firebase login
npm run rules:deploy
```

Provera da je stvarno zaključano — ovo mora da vrati `PERMISSION_DENIED`:

```bash
curl "https://firestore.googleapis.com/v1/projects/TVOJ-PROJEKAT/databases/(default)/documents/employees"
```

### 5. Napravi prvi CEO nalog

Preuzmi service account ključ: **Project settings → Service accounts →
Generate new private key**, pa ga snimi kao `tools/serviceAccount.json`.

> Taj fajl je **prava tajna** — za razliku od vrednosti u `.env`. Daje pun
> pristup projektu i zaobilazi sva pravila. Već je u `.gitignore`.

```bash
npm run setup:ceo
```

Skripta pita za email, ime, prezime i lozinku. Lozinka se ne ispisuje dok je
kucaš i ne ostaje u istoriji terminala.

Zašto skriptom a ne iz aplikacije: pravila zabranjuju **svakome** da piše svoj
`userPermissions` dokument — to sprečava zaposlenog da sam sebe proglasi za
CEO-a. Važi i za CEO-a. Skripta to zaobilazi spolja preko Admin SDK-a, pa u
pravilima ne postoji rupa za prvi nalog.

### 6. Pokreni

```bash
npm run dev
```

Ako `.env` nije popunjen, aplikacija to jasno kaže i navede koje vrednosti nedostaju — neće se prikazati beo ekran.

---

## Komande

| Komanda | Šta radi |
| --- | --- |
| `npm run dev` | Razvojni server na `localhost:5173` |
| `npm run build` | Produkcijski build u `dist/` |
| `npm run type-check` | Provera tipova bez build-a |
| `npm run preview` | Pregled produkcijskog build-a |
| `npm run setup:ceo` | Pravi prvi CEO nalog i osnovne podatke |
| `npm run rules:deploy` | Objavljuje `firebase/firestore.rules` |
| `npm run rules:verify` | Napada živa pravila i dokazuje da drže |
| `npm run i18n:check` | Proverava da se srpski i engleski poklapaju |

---

## Struktura

```
src/
├── types/          Domen: statusi, permisije, modeli dokumenata
│   ├── permissions.ts   Katalog svih dozvola u sistemu
│   └── domain.ts        Oblik svakog dokumenta u Firestore-u
├── lib/            Firebase inicijalizacija
├── api/            Sav pristup podacima (jedini sloj koji dodiruje bazu)
├── stores/         Pinia: sesija i dozvole, stanje interfejsa
├── i18n/           Prevodi (sr / en) — nijedan tekst nije u komponentama
├── router/         Rute i kapija pristupa
├── layouts/        Ljuska aplikacije, bočni meni, gornja traka
├── components/     Deljene komponente
├── views/          Ekrani
└── styles/         Dizajn sistem (tokeni, osnova, komponente)

firebase/
└── firestore.rules  Prava bezbednosna granica
```

### Zašto je `api/` odvojen

Nijedna komponenta ne poziva Firestore direktno. Sve ide kroz `src/api/`.
Ako jednog dana pređeš na PostgreSQL ili svoj server, menjaš taj folder — ne
celu aplikaciju.

---

## Bezbednosni model

Podaci o zaposlenom su podeljeni po osetljivosti, jer Firestore pravilo
štiti **ceo dokument**, nikad pojedinačno polje:

| Dokument | Ko sme da čita |
| --- | --- |
| `employees/{uid}` | Zaposleni sa dozvolom `employees.view` |
| `employees/{uid}/visibility/everyone` | Zaposleni sa dozvolom `employees.view` |
| `employees/{uid}/visibility/management` | On sam + `employees.view_private_info` |
| `employees/{uid}/visibility/private` | Samo on i CEO |
| `employees/{uid}/notes/{id}` | Samo `employee_notes.view` — nikad sam zaposleni |
| `userPermissions/{uid}` | On sam (čitanje) — **piše samo `roles.assign`** |

Poslednji red je najvažniji. `userPermissions` je dokument koji odlučuje šta
neko sme; korisnik ga nikad ne sme pisati sam sebi, inače se može sam
unaprediti u CEO-a.

**Pravilo koje se ne krši:** skrivanje dugmeta u interfejsu nije bezbednost.
Svaka provera u `src/` postoji radi udobnosti; pravu granicu drži
`firebase/firestore.rules`.

### Provera da pravila stvarno drže

```bash
npm run rules:verify
```

Pravi privremeni nalog, ponaša se kao neodobreni zaposleni i **napada
sopstvenu bazu** običnim klijentskim SDK-om, isto kao što bi to radio
pregledač. Proverava da takav nalog ne može da:

- odobri sam sebe
- dodeli sebi dozvole ili se proglasi za CEO-a
- pročita imenik, tuđe kontakte, CEO beleške ili revizioni dnevnik
- upiše lažan zapis u revizioni dnevnik

Nalog i svi dokumenti se brišu na kraju. Pokreni posle **svake** izmene
`firestore.rules`.

### Poznato ograničenje

Revizioni dnevnik piše klijent. Pravila odbijaju falsifikovan ili izmenjen
zapis, ali ne mogu da **nateraju** da se zapis upiše — neko ko radi direktno
protiv API-ja može izvesti radnju i preskočiti beleženje. Sve što se radi kroz
aplikaciju se beleži. Potpuno zatvaranje traži Cloud Functions (Blaze plan),
što je predviđen sledeći korak.

---

## Status razvoja

- [x] **Faza 1** — Postavka projekta, ljuska aplikacije, dvojezični sistem
- [x] **Faza 2** — Prijavljivanje
- [x] **Faza 3** — Zahtevi za registraciju
- [ ] **Faza 4** — CEO centar za odobravanje
- [x] **Faza 5** — Profili zaposlenih i imenik
- [x] **Faza 7** — Kontrole privatnosti (po polju)
- [ ] **Faza 6** — Uloge i dozvole
- [ ] **Faza 8** — Privatne CEO beleške
- [ ] **Faza 9** — Revizioni dnevnik
- [ ] **Faza 10** — CEO kontrolna tabla

Moduli koji dolaze kasnije (CRM, klijenti, prodaja, projekti, finansije,
marketing, dokumenti, analitika, StayBrain integracija) **nisu** deo verzije 1.
Arhitektura je postavljena tako da se dodaju bez prepravljanja postojećeg.
