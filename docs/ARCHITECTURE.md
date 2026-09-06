# MsEe Central — arhitektura sistema

Dokument odluka. Piše **šta** i **zašto**, ne kako — kako stoji u kodu.

---

## 1. Centralna ideja

Agencija se ne vodi po modulima nego po **angažmanu**: šta radimo, za koga, po
kojoj ceni, da li je naplaćeno i da li se isplatilo.

Zato sistem ima jednu kičmu, a ne dvanaest nezavisnih stranica:

```
Kontakt  →  Posao  →  Ugovor  →  Faktura  →  Uplata  →  Provizija
(lead)     (sale)    (contract) (invoice)   (payment)  (commission)
```

Svaka karika odgovara na **drugo pitanje**, i zato se ne spajaju:

| Karika | Odgovara na |
| --- | --- |
| Posao | šta očekujemo da dobijemo i koliko je verovatno |
| Ugovor | šta je dogovoreno i do kada |
| Faktura | šta smo stvarno tražili da nam se plati |
| Uplata | šta je stvarno stiglo |

Ugovor od 18.000 € sa 1.500 € fakturisano i 0 € plaćeno su **tri različita
broja**. Sistem koji čuva samo jedan od njih — nagađa.

---

## 2. Pravilo koje sve drži: izvedeno se ne čuva

`src/api/metrics.ts` učita **jedan snimak** podataka i iz njega izvede sve:
kontrolnu tablu, analitiku, napredak ciljeva, KPI po čoveku, brojke projekta.

Zbog toga četiri ekrana nikad ne mogu da se ne slože oko prihoda. Ako je broj
pogrešan, ispravka je u zapisu iz kog je došao — nema keša koji se briše ni
noćnog posla koji se ponovo pokreće.

Iz istog razloga:

- profit se ne kuca — `prihod − trošak`
- provizija se ne kuca — izvodi se iz uplate i pravila partnera
- napredak projekta se ne kuca — broji se iz miljokaza ili zadataka
- napredak cilja se ne kuca — broji se iz živih zapisa

Izuzeci su svesni i zapisani: **faktura** čuva svoj iznos (dokument koji je
poslat ne sme da se promeni kad neko kasnije izmeni stavku), a **cilj tipa
„ručno"** ima vrednost koju čovek unosi jer sistem nema šta da broji.

---

## 3. Novac visi o klijentu

| Zapis | Šta je |
| --- | --- |
| `clients/{id}/work` | knjiga poslova — jedan red nosi i trošak i prihod |
| `invoices` | šta je fakturisano, sastavljeno od stavki iz knjige |
| `payments` | novac koji se stvarno pomerio, sa tipom |
| `expenses` | režija — trošak koji nije ničiji projekat |

`payments.type` postoji jer **nije svaki priliv prihod**. Povraćaj odlazi,
prenos ide između naših računa, i računati bilo šta od toga kao prihod znači
lagati sebe o zaradi.

Kolekcija `income` je obrisana. Dva mesta za isti podatak su dva mesta da se
raziđu.

---

## 4. Provizija ide za novcem koji je stigao

```
Preporuka → Kontakt → Posao → Uplata stigla → Provizija odobrena → Isplata
```

- **Klik ne donosi ništa.** Zato klik i sme da bude javan.
- Provizija se pravi tek kad se upiše uplata, i to u statusu `pending`.
- Odobravanje je **odvojena dozvola** (`commissions.approve`).
- **Niko ne odobrava svoju** — pravilo u bazi to odbija, ne interfejs.

Javni link `/ref/:code` piše jedan dokument oblika `{code, at}` u
`referralClicks`. Ne čita ništa: ime partnera, kontakt i pravila provizije
ostaju privatni.

---

## 5. Učinak nema jedinstvenu ocenu

Programer i prodavac se ne mere istom osom. Prosek ta dva broja je precizan i
besmislen, i ljudi brzo nauče da rade za broj umesto za posao.

Umesto toga: **uloga nosi svoj skup KPI-jeva** (`roleKpis/{roleId}`), a svaki
čovek se prikazuje uz te pokazatelje. Sve se broji iz zapisa koje sistem već
ima — niko se ne ocenjuje podacima koje je neko o njemu ukucao.

---

## 6. Sigurnost je u pravilima, ne u interfejsu

`firebase/firestore.rules` je granica. Sve u `src/` što proverava dozvolu radi
to radi udobnosti: da sakrije dugme, da preskoči zahtev koji bi svakako pao.

**Dokazano, ne tvrđeno:** `npm run rules:verify` napada živa pravila pravim
klijentom kroz tri faze — neodobreni nalog, suvlasnik sa svim dozvolama,
affiliate sa svim dozvolama. **60 provera, 0 padova.**

Ono što se time dokazuje:

- osnivač je nedodirljiv čak i za suvlasnika sa svim dozvolama
- affiliate sa **svim** dozvolama i dalje ne vidi nijedan interni podatak
- provizija se ne može napraviti već odobrena
- ugovor se ne može obrisati
- klik na preporuku ne može da ponese ništa osim koda i vremena, i ne može da
  se pročita nazad

### Poznato ograničenje

Klijent piše revizioni dnevnik i obaveštenja. Pravila mogu da odbiju
falsifikovan zapis, ali ne mogu da **nateraju** da zapis bude napisan. Neko ko
radi direktno protiv API-ja mogao bi da uradi nešto i preskoči beleženje. Sve
kroz aplikaciju se beleži. Rupa se zatvara Cloud Functions-om, što je predviđen
sledeći korak.

---

## 7. Navigacija

```
PREGLED     Kontrolna tabla · Moj prostor
POSLOVANJE  Klijenti · Kontakti · Projekti · Zadaci · Prodaja · Usluge ·
            Partnerski program · Ugovori · Finansije
TIM         Zaposleni · Ciljevi i KPI · Učinak
ALATI       Kalendar · Poruke · Analitika
SISTEM      Zahtevi · Podešavanja
```

Obaveštenja su na zvoncu u gornjoj traci, ne kao stavka menija.

Administracija (uloge, organizacija, revizioni dnevnik) živi **unutar
Podešavanja**. To su stvari koje se podese jednom; pored svakodnevnog posla
samo su produžavale meni.

---

## 8. Automatizacije

Rade same, iz podataka koje sistem već ima. Nema šta da se podešava i nema šta
da tiho prestane da radi:

- dodela zadatka → obaveštenje izvršiocu
- predaja kontakta → obaveštenje novom vlasniku
- rok plaćanja prošao → upozorenje dok se ne naplati
- ugovor pred istek → pojavi se 45 dana unapred
- upisana uplata → provizija partneru, na čekanju
- završen ponavljajući zadatak → otvara se sledeći, završeni ostaje
- obaveštenje → stiže svima kojima je poslato

Obaveštenja izvedena iz datuma se **ne čuvaju**. Pojave se kad postanu tačna,
nestanu kad se stvar reši, i ne mogu da se nagomilaju kao ustajali redovi o
roku koji je odavno ispoštovan.

---

## 9. Alati koji čuvaju sistem

| Komanda | Šta hvata |
| --- | --- |
| `npm run type-check` | tipove |
| `npm run build` | greške u šablonu — **type-check ih ne hvata** |
| `npm run i18n:check` | razliku između kataloga, duple ključeve, ključ koji se koristi a ne postoji, dozvolu bez objašnjenja |
| `npm run links:check` | vezu koja vodi na rutu koja ne postoji |
| `npm run rules:verify` | 60 tvrdnji o sigurnosti, protiv živih pravila |
| `npm run permissions:sync` | katalog dozvola u bazi |
| `npm run rules:publish` | objavljivanje pravila |

Svaka od ovih provera postoji jer je odgovarajuća greška **već napravljena**
bar jednom. Nijedna nije dodata preventivno.

---

## 10. Pravila koja se ne krše

1. **Sigurnost je u `firestore.rules`,** nikad u interfejsu.
2. **Svaka nova kolekcija dobija pravilo i test** pre nego što dobije ekran.
3. **Novac su celi minor jedinici,** nikad decimale. Kurs se zamrzava po datumu.
4. **Izvedeni broj se nikad ne kuca.**
5. **Ništa se ne briše ako nosi istoriju.** Status, arhiva, otkazivanje.
6. **Nijedan tekst u komponenti** — sve kroz i18n, oba jezika.
7. **Nijedna stavka menija bez odredišta.**

---

## 11. Šta namerno nije napravljeno

**Dokumenti i materijali** traže Firebase Storage, koji traži Blaze plan. To je
odluka o novcu, ne o kodu. Ugovor za sada nosi link na potpisan dokument.

**Motor za pravila automatizacije** koji korisnik sam podešava. Automatizacija
koju niko nije podesio gora je od nikakve; ovih sedam gore rade bez podešavanja.

**Jedinstvena ocena učinka.** Vidi sekciju 5.
