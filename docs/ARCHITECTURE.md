# MsEe Central — arhitektura sistema

Dokument odluka. Piše **šta** i **zašto**, ne kako — kako stoji u kodu.

---

## 1. Centralna ideja

Agencija se ne vodi po modulima nego po **angažmanu**: šta radimo, za koga, po
kojoj ceni, da li je naplaćeno i da li se isplatilo.

Zato sistem ima jednu kičmu, a ne dvanaest nezavisnih stranica:

```
Kontakt  →  Prodaja  →  Transakcija  →  Provizija / Bonus
(lead)      (sale)      (transaction)
```

Svaka karika odgovara na **drugo pitanje**, i zato se ne spajaju:

| Karika | Odgovara na |
| --- | --- |
| Kontakt | ko je pokazao interesovanje i dokle smo stigli |
| Prodaja | šta je prodato, kome, po kojoj ceni i po kojoj dinamici plaćanja |
| Transakcija | koji se novac stvarno pomerio, kad i u kom smeru |
| Provizija / Bonus | ko je zaslužio deo toga, i da li mu je isplaćen |

Prodaja od 18.000 € sa 1.500 € naplaćeno su **dva različita broja**. Sistem koji
čuva samo jedan od njih — nagađa.

---

## 2. Pravilo koje sve drži: izvedeno se ne čuva

`src/api/metrics.ts` učita **jedan snimak** podataka i iz njega izvede sve:
kontrolnu tablu, analitiku, napredak ciljeva, KPI po čoveku, brojke projekta,
napredak ka bonusu, zaradu pojedinca.

Zbog toga šest ekrana nikad ne mogu da se ne slože oko prihoda. Ako je broj
pogrešan, ispravka je u zapisu iz kog je došao — nema keša koji se briše ni
noćnog posla koji se ponovo pokreće.

Iz istog razloga:

- profit se ne kuca — `prihod − trošak`
- ostatak duga se ne kuca — `balanceOf(prodaja, transakcije)`
- provizija se ne kuca — izvodi se iz naplaćenog novca i pravila partnera
- napredak projekta se ne kuca — broji se iz miljokaza
- napredak cilja i bonusa se ne kuca — broji se iz živih zapisa

Izuzeci su svesni i zapisani: **dodeljen bonus** čuva svoj iznos (ono što je
čoveku obećano ne sme da se promeni kad neko kasnije izmeni program), a **cilj
tipa „ručno"** ima vrednost koju čovek unosi jer sistem nema šta da broji.

---

## 3. Novac: dva zapisa, ne pet

Ranije su postojali knjiga poslova po klijentu, ugovori, fakture, uplate i
troškovi — pet mesta za isti novac, i pet prilika da se raziđu. Sada:

| Zapis | Šta je |
| --- | --- |
| `sales` | šta je prodato: vrednost i **struktura plaćanja** |
| `transactions` | novac koji se stvarno pomerio, sa tipom |

`transactions.type` postoji jer **nije svaki priliv prihod**. Povraćaj odlazi,
prenos ide između naših računa, i računati bilo šta od toga kao prihod znači
lagati sebe o zaradi.

Struktura plaćanja živi na prodaji i na usluzi: jednokratno, avans + ostatak,
rate, ili posebno. Iz nje i iz upisanih transakcija `balanceOf()` izvodi
vrednost, naplaćeno, ostatak i **dospeo avans**. Zato ekran ume da kaže
„Avans nije plaćen" a da niko taj status nije ukucao.

**Prodaja je arhiva, ne prognoza.** Nosi datum, kanal preko kog je došla, kanal
preko kog se komuniciralo i analizu: kako je stečena, šta je upalilo, šta nije,
šta klijent voli. Taj tekst za dve godine vredi više od iznosa.

---

## 4. Projekat nije klijent

**Jedan projekat → više klijenata.** Zajednička kampanja, događaj, paket koji
plaća troje ljudi — to je jedan posao, ne tri kopije istog.

Projekat nosi naslovnu sliku, cilj, tim, miljokaze i budžet. Klijenti se dodaju
i uklanjaju bez diranja ostatka. Prodaja sme da pokaže na projekat; većina ne
pokazuje.

---

## 5. Partnerski program bez linkova

Nema referalnih kodova, klikova ni javnih linkova. Partner ima nalog i **jedan
otvor u sistem: unese kontakt.**

```
Partner unese kontakt → interni tim ga preuzme → prodaja → naplata →
provizija na čekanju → odobrenje → isplata
```

- Partner vidi **samo svoje** kontakte, klijente, prodaju i proviziju.
- Provizija se pravi tek kad novac stigne, i to u statusu `pending`.
- Odobravanje je **odvojena dozvola** (`commissions.approve`).
- **Niko ne odobrava svoju** — pravilo u bazi to odbija, ne interfejs.
- Partner ne može da dodeli kontakt zaposlenom, ni da dodirne iznos provizije.

Dokazano u `rules:verify`: nalog partnera sa **svim** dozvolama u sistemu i
dalje ne vidi nijedan interni zapis, jer `isInternal()` stoji pre svake provere
dozvole.

---

## 6. Bonusi: zarađeno i isplaćeno nisu isto

Program bonusa postavlja CEO: pokazatelj, publika (firma, sektor, tim, izabrani
ljudi), i **više miljokaza** sa svojom nagradom.

Nagrada ide kroz merdevine i ne preskače stepenik:

```
pending → earned → approved → paid
              ↘ rejected / cancelled
```

Dodatni rad ima svoje merdevine:

```
assigned → in_progress → submitted → approved → (bonus postaje earned)
                                   ↘ rejected / cancelled
```

Dva pravila u bazi, ne u interfejsu:

- **niko ne dodeljuje bonus sam sebi** — `employeeUid == me()` se odbija
- **nagrada se ne može napraviti već odobrena ili isplaćena** — inače bi
  merdevine bile ukras

Zaposleni sam pomera svoj rad do `submitted`. Dalje ne može.

---

## 7. Grafikon pregleda: dve grupe, nikad dve ose

Sest metrika na jednom grafikonu, svaka se pali i gasi, i uz svaku poredjenje sa
prethodnim periodom.

**Zasto dve grupe, a ne dve ose.** Prihod je novac; klijenti su broj ljudi. Na
istoj skali, cetrdeset klijenata je ravna linija po dnu grafikona ciji je vrh
osam hiljada evra. Uobicajeni izlaz je druga y-osa, i on je gori od problema:
sa dve skale **autor bira gde se linije seku**, pa se slika moze namestiti da
pokaze vezu koje u podacima nema. To je crtez, ne merenje.

Zato su metrike grupisane po tome sta jesu - novac ili aktivnost - i crta se
jedna grupa na jednoj postenoj osi. Prebacivanje je jedan klik i nista nije
sakriveno.

**Boje su izracunate, ne izabrane.** Zeleno za prihod i crveno za rashode je
ocigledan par i zamalo pogresan: udzbenicki zelena pored ove crvene razlikuje
se za dE 6 kod deuteranopije, sto daltonista ne moze da koristi. Povlacenje
zelene ka cijanu dize par na 9,4 a i dalje se cita kao novac koji ulazi. Svaki
korak je prosao kroz validator palete - opseg svetline, prag hrome,
razdvojenost pod dve simulirane deficijencije, prag za normalan vid, kontrast
prema podlozi - u obe teme i po grupama. Sve prolazi.

Boja prati metriku, nikad njen redni broj: prihod je ta zelena i kad je sam i
kad je jedan od tri. Gasenje jedne metrike ne prefarbava ostale.

---

## 8. Tabla pripada onome ko je gleda

Jedna tabla dobro služi direktoru i traći ekran svima ostalima. Prodavac hoće
svoj tok, čovek iz finansija hoće šta nije naplaćeno. Zato svako bira svoje
vidžete i njihov redosled, i to mu se pamti.

**Izbor vidžeta nikada ne proširuje ono što neko sme da vidi.** Tri sloja to
drže, i samo poslednji nešto vredi:

1. izbornik nudi samo vidžete za koje čovek ima dozvolu
2. tabla to proverava **ponovo pri svakom crtanju** — raspored sačuvan dok je
   neko imao `finance.view` prestaje da crta novac čim mu se dozvola oduzme
3. podaci svakog vidžeta dolaze iz Firestore-a, koji istu dozvolu sprovodi u
   svojim pravilima

Prva dva čuvaju da ekran bude iskren. Treći čuva da bude bezbedan: raspored
izmenjen ručno u bazi crta prazan vidžet, ne tuđe brojke. To je dokazano
testom — nalog partnera sa **svim** dozvolama u katalogu sačuva raspored koji
imenuje finansijske vidžete i i dalje ne pročita ništa.

Dodavanje vidžeta je jedan red u `WIDGETS`, koji nosi svoju dozvolu. Izbornik,
sačuvani raspored i provera pri crtanju čitaju istu listu — nema drugog mesta
koje treba zapamtiti.

---

## 9. Učinak nema jedinstvenu ocenu

Programer i prodavac se ne mere istom osom. Prosek ta dva broja je precizan i
besmislen, i ljudi brzo nauče da rade za broj umesto za posao.

Umesto toga: **uloga nosi svoj skup KPI-jeva** (`roleKpis/{roleId}`), a svaki
čovek se prikazuje uz te pokazatelje. Čovek sa više uloga dobija uniju njihovih
pokazatelja. Sve se broji iz zapisa koje sistem već ima — niko se ne ocenjuje
podacima koje je neko o njemu ukucao.

---

## 10. Brisanje je uvek meko

`deletedAt` na zapisu, ne kopija u drugoj kolekciji. Svako čitanje ga filtrira,
korpa ga prikazuje sa preostalim danima, `RETENTION_DAYS` (30) odlučuje dokle.

**Trajno uništavanje je posebna dozvola** (`recycle_bin.purge`), namerno
odvojena od brisanja. Brisanje je svakodnevna radnja; uništavanje nije, i ne
sme da se desi zato što je neko kliknuo na naviknuto mesto.

Pravila dozvoljavaju izmenu koja dira **samo** `deletedAt`, `deletedBy`,
`deletedByName` i `updatedAt` čak i onome ko nema pravo izmene sadržaja. Odbaciti
zapis i prepravljati ga su dve različite stvari.

---

## 11. Drugi sistemi: referenca, ne veza

Klijent nosi listu `externalRefs` — u kojim još našim sistemima postoji
(StayBrain, sistem rezervacija, sajt), koji mu je id tamo i link.

**Ništa se ne sinhronizuje.** Nema API-ja između ovoga i StayBrain-a, pa je
ovo beleška koja čoveku pomaže da nađe hotel tamo. Zelena tačka koja bi
sugerisala vezu bila bi gora nego da polja nema.

Kad integracija bude napravljena, čita odavde: id-jevi su već upisani uz prave
klijente, pa njena prva verzija nema šta da migrira.

---

## 12. Prilagođena polja

Sistem ne zna sve što firma beleži. Zato `customFields` čuva definicije po
entitetu (naziv, tip, obavezno, vidljivost, podrazumevana vrednost), a vrednosti
putuju **na samom zapisu**, u `custom` torbi.

Zašto na zapisu: da bi prodaja i dalje bila jedan dokument. Vrednost u zasebnoj
kolekciji značila bi drugi upit za svaki red liste, i podatak koji preživi zapis
koji opisuje.

---

## 13. Sigurnost je u pravilima, ne u interfejsu

`firebase/firestore.rules` je granica. Sve u `src/` što proverava dozvolu radi
to radi udobnosti: da sakrije dugme, da preskoči zahtev koji bi svakako pao.

Dozvole su **po modulu i po radnji** — pregled, pregled svega, unos, izmena,
brisanje, vođenje, odobravanje, izvoz. Razlika između `view` i `view_all` se
sprovodi u pravilima kroz `ownsRecord()`, ne u upitu koji klijent pošalje.

**Dokazano, ne tvrđeno:** `npm run rules:verify` napada živa pravila pravim
klijentom kroz tri faze — stranac koji je sam napravio nalog, suvlasnik sa svim
dozvolama, partner sa svim dozvolama. **67 provera, 0 padova.**

Ono što se time dokazuje:

- osnivač je nedodirljiv čak i za suvlasnika sa svim dozvolama
- partner sa **svim** dozvolama i dalje ne vidi nijedan interni podatak
- partner sme da unese kontakt i da pročita svoj — tuđi ne
- stranac sa nalogom bez pristupnog dokumenta ne može ništa
- provizija se ne može napraviti već odobrena
- niko ne dodeljuje bonus sam sebi
- nagrada se ne može napraviti već isplaćena

### Poznato ograničenje

Klijent piše revizioni dnevnik i obaveštenja. Pravila mogu da odbiju
falsifikovan zapis, ali ne mogu da **nateraju** da zapis bude napisan. Neko ko
radi direktno protiv API-ja mogao bi da uradi nešto i preskoči beleženje. Sve
kroz aplikaciju se beleži. Rupa se zatvara Cloud Functions-om, što je predviđen
sledeći korak.

---

## 14. Navigacija

```
PREGLED     Kontrolna tabla · Moj prostor
POSLOVANJE  Klijenti · Kontakti · Projekti · Prodaja · Usluge ·
            Partnerski program · Finansije
TIM         Zaposleni · Ciljevi i KPI · Bonusi · Učinak
ALATI       Kalendar · Analitika
SISTEM      Podešavanja
```

Obaveštenja su na zvoncu u gornjoj traci, ne kao stavka menija.

Administracija (uloge, organizacija, prilagođena polja, korpa, revizioni
dnevnik) živi **unutar Podešavanja**. To su stvari koje se
podese jednom; pored svakodnevnog posla samo su produžavale meni.

**Na telefonu nema sidebar-a.** Cetiri odredista stoje stalno na dnu, na dohvat
palca, a sve ostalo je iza "Vise" - koje otvara isti sidebar, pa postoji jedan
meni a ne dva koja mogu da se raziju. Podignuto dugme u sredini pravi novo:
to je jedina kontrola tamo koja nije odrediste.

**Niko se ne prijavljuje sam.** Naloge pravi direktor i predaje ih. Time je
nestao i jedini javni upis u sistem: `registrationRequests` je sada zatvoren
(`allow read, write: if false`), a ne samo sužen.

Vredi biti jasan oko čega to **ne** menja: svako ko ima veb API ključ i dalje
može da napravi Firebase Auth nalog, na ovom projektu kao i na svakom drugom, i
nijedno uklanjanje forme to ne sprečava. Ono što pravila mogu jeste da takvom
nalogu ne daju ništa — i upravo to se testira.

**Zadaci nisu zaseban modul.** Beleške sa rokom i kvačicom stoje uz zapis na koji
se odnose — uz klijenta, uz projekat, uz kontakt. Poseban ekran za zadatke značio
bi drugo mesto na koje se ide da bi se saznalo isto.

---

## 15. Automatizacije

Rade same, iz podataka koje sistem već ima. Nema šta da se podešava i nema šta
da tiho prestane da radi:

- predaja kontakta → obaveštenje novom vlasniku
- rok plaćanja prošao → upozorenje dok se ne naplati
- avans dospeo a nije plaćen → prodaja to sama pokazuje
- upisana uplata → provizija partneru, na čekanju
- dostignut miljokaz bonusa → nagrada u statusu `pending`
- predat dodatni rad → obaveštenje onome ko odobrava
- objava → stiže svima kojima je poslata
- zapis pred istek u korpi → vidi se koliko mu je ostalo

Obaveštenja izvedena iz datuma se **ne čuvaju**. Pojave se kad postanu tačna,
nestanu kad se stvar reši, i ne mogu da se nagomilaju kao ustajali redovi o
roku koji je odavno ispoštovan.

---

## 16. Alati koji čuvaju sistem

| Komanda | Šta hvata |
| --- | --- |
| `npm run type-check` | tipove |
| `npm run build` | greške u šablonu — **type-check ih ne hvata** |
| `npm run i18n:check` | razliku između kataloga, duple ključeve, ključ koji se koristi a ne postoji, dozvolu bez objašnjenja |
| `npm run links:check` | vezu koja vodi na rutu koja ne postoji, kroz ugnežđene rute |
| `npm run rules:verify` | 67 tvrdnji o sigurnosti, protiv živih pravila |
| `npm run buttons:check` | dugme ili link koji ne radi ništa |
| `npm run data:check` | zapis bez pečata i referencu koja ne vodi nigde — **čita bazu, ne kod** |
| `npm run permissions:sync` | katalog dozvola u bazi (`-- --prune` briše zastarele) |
| `npm run rules:publish` | objavljivanje pravila |
| `npm run migrate` | prevođenje postojećih zapisa na novi oblik (`-- --dry`) |

Svaka od ovih provera postoji jer je odgovarajuća greška **već napravljena**
bar jednom. Nijedna nije dodata preventivno.

`data:check` je jedina koja čita **bazu** umesto koda, i postoji zbog greške
koju nijedna druga nije mogla da vidi: `write()` je zaključivao da je zapis nov
po tome da li mu je prosleđen id — a klijent svoj id dobija kao slug pre upisa,
pa je svaki novi klijent sačuvan sa `createdBy: ''`. Pravila po tom polju
odlučuju ko sme da pročita tuđi zapis, pa je onaj ko ga je upravo napravio bio
odbijen. Sačuvano, pa nije tu — što izgleda tačno kao neuspelo čuvanje.

`migrate` se sme pokrenuti više puta: svaki korak proverava da li je već urađen,
a ništa ne briše — povučene kolekcije ostaju netaknute, a zapisi koji nemaju
mesto u novom modelu idu u korpu, gde ih čovek pogleda pre nego što nestanu.

---

## 17. Pravila koja se ne krše

1. **Sigurnost je u `firestore.rules`,** nikad u interfejsu.
2. **Svaka nova kolekcija dobija pravilo i test** pre nego što dobije ekran.
3. **Novac su celi minor jedinici,** nikad decimale. Kurs se zamrzava po datumu.
4. **Izvedeni broj se nikad ne kuca.**
5. **Ništa se ne uništava odmah.** Meko brisanje, korpa, pa tek onda kraj.
6. **Niko ne odobrava sam sebi** ni proviziju, ni bonus, ni svoj rad.
7. **Nijedan tekst u komponenti** — sve kroz i18n, oba jezika.
8. **Nijedna stavka menija bez odredišta.**

---

## 18. Šta namerno nije napravljeno

**AI sloj.** Doći će posebno, iznad ovoga. Zato je sve ovde napravljeno tako da
se može čitati: jedan snimak podataka, izvedene brojke bez keša, analiza prodaje
u tekstu, i dnevnik aktivnosti koji kaže šta se kad promenilo. AI koji analizira
sistem u kom je isti broj upisan na tri mesta ne analizira ništa.

**Dokumenti i materijali** traže Firebase Storage, koji traži Blaze plan. To je
odluka o novcu, ne o kodu. Prodaja i projekat za sada nose link.

**Motor za pravila automatizacije** koji korisnik sam podešava. Automatizacija
koju niko nije podesio gora je od nikakve; ove gore rade bez podešavanja.

**Interne poruke.** Postojale su i uklonjene su: firma od nekoliko ljudi već ima
gde da se dopisuje, a poruka u sistemu koji niko ne drži otvoren je poruka koja
nije stigla. Ono što mora da stigne ide kroz obaveštenja.

**Prava integracija sa StayBrain-om i sistemom rezervacija.** Nema API-ja među
njima. Vidi sekciju 11: sistem beleži referencu, i ne pretvara se da je to veza.

**Telegram i eksterni izveštaji.** Traže server koji čuva token. Bot token u
frontend kodu je token koji je javan, pa dok backend ne postoji, ovoga nema.

**Jedinstvena ocena učinka.** Vidi sekciju 9.
