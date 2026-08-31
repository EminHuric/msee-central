# MsEe Central — arhitektura sistema

Dokument odluka. Piše **šta** i **zašto**, ne kako — kako stoji u kodu.

---

## 1. Audit zatečenog stanja

63 fajla, ~16.400 linija, 588 linija sigurnosnih pravila, 31 dozvola, 32 testa
protiv živih pravila.

**Radi i povezano je:** prijavljivanje · registracija · odobravanje ·
profili zaposlenih sa privatnošću po polju · imenik · uloge i dozvole ·
vlasnik i suvlasnici · zaposleni vs affiliate · sektori i pozicije ·
revizioni dnevnik · pretraga · klijenti sa dosijeom i knjigom poslova.

### Tri stvarna problema

**a) `/requests` je vodio na prazan ekran.** Odobravanje je bilo napravljeno
kao kartica unutar Zaposlenih. Meni i kontrolna tabla su vodili na vrata koja
ne postoje. *Popravljeno: Zahtevi imaju svoju stranicu, Zaposleni sadrže samo
zaposlene.*

**b) Novac se vodi na dva mesta.** Postoje kolekcije `income` i `expenses`, i
istovremeno `clients/{id}/work` gde jedna stavka nosi i uloženo i prihod. To je
moje dupliranje — dva načina da se upiše isti podatak znače da će se pre ili
kasnije razići.

**c) `projects` i `services` imaju tipove, kolekcije i pravila — ali nemaju ni
API ni ekran.** Mrtva struktura koja izgleda kao funkcija.

---

## 2. Centralna ideja

Agencija se ne vodi po modulima nego po **angažmanu**: šta radimo, za koga, po
kojoj ceni, da li je naplaćeno i da li se isplatilo.

Zato je centar sistema **knjiga poslova** (`work`), a ne „Finansije" kao
zaseban modul. Svaka stavka nosi klijenta, uloženo, prihod, rok i status. Iz
nje se izvode i profit, i potraživanja, i provizija, i izveštaji.

Sve ostalo je kontekst oko te knjige.

---

## 3. Model podataka

### Rešenje dupliranja

| Odluka | Razlog |
| --- | --- |
| `clients/{id}/work` je **jedini** zapis novca vezanog za klijenta | Jedan red nosi i trošak i prihod; profit se izvodi, ne kuca |
| `expenses` ostaje, ali **samo za režijske troškove** | Alat, plata, kancelarija — trošak koji nije ničiji projekat |
| `income` se **briše** | Potpuno pokriveno knjigom poslova |

### Entiteti

```
users / employees / userPermissions      ✅ postoji
roles / permissions                       ✅ postoji
departments / positions                   ✅ postoji
registrationRequests                      ✅ postoji
auditLogs                                 ✅ postoji

clients                                   ✅ postoji
  ├── work          knjiga poslova        ✅ postoji
  ├── services      šta klijent koristi   ✅ model, ✅ pravila
  ├── instalments   rate                  ✅ model, ✅ pravila
  ├── offers        posebni uslovi        ✅ model, ✅ pravila
  ├── activities    komunikacija          ✅ postoji
  └── notes         interne beleške       ✅ postoji

leads                                     ⬜ novo
projects                                  🟡 tip + pravila, bez ekrana
tasks                                     ⬜ novo
services (katalog)                        🟡 tip + pravila, bez ekrana
expenses (režija)                         🟡 pravila, bez ekrana
notifications/{uid}/items                 ⬜ novo
documents                                 ⬜ traži Firebase Storage (Blaze)
```

### Veze

```
Lead ──(won)──▶ Client ──▶ Project ──▶ Task ──▶ Employee
                  │           │
                  ├──▶ Work ──┘        novac uvek visi o klijentu
                  ├──▶ Service
                  ├──▶ Instalment
                  └──▶ Activity / Note
```

Pravilo bez izuzetka: **novac se vezuje za klijenta.** Projekat i usluga su
oznake na stavci, ne zasebne knjige.

---

## 4. Navigacija

```
Kontrolna tabla

RAD
  Potencijalni klijenti     lead pipeline
  Klijenti                  dosije + knjiga poslova
  Projekti                  veći poslovi
  Zadaci                    ko šta radi

NOVAC
  Finansije                 prihod, režija, potraživanja
  Usluge                    cenovnik

TIM
  Zaposleni
  Zahtevi

SISTEM
  Uloge i dozvole · Organizacija · Revizioni dnevnik · Podešavanja
```

Obaveštenja su u gornjoj traci sa brojačem, plus svoja stranica.

### Šta bih izbacio

**Chat** — već izbačen, i to je bila dobra odluka. **Analitika** kao zasebna
stavka — to su Izveštaji. **Affiliate program** kao modul — provizija je već u
dosijeu klijenta, zaseban ekran bi dupirao isti podatak. **Ugovori** — to je
dokument, ide u Dokumente kad Storage bude dostupan.

---

## 5. Automatizacije koje se isplate

Samo one koje sistem može da izvede iz podataka koje već ima:

- rok prošao, nije plaćeno → obaveštenje
- rok za 3 dana → podsetnik
- lead bez kontakta 7 dana → zadatak
- lead „dobijen" → predlog da se otvori klijent sa već unetim podacima
- zadatak kasni → obaveštenje izvršiocu i njegovom nadređenom

Ne pravim automatizacije koje traže da korisnik prvo podesi pravila. To je
proizvod za kasnije, ne za V1.

---

## 6. Plan do V1

| Faza | Sadržaj |
| --- | --- |
| **1** ✅ | Zahtevi razdvojeni od Zaposlenih |
| **2** | Uklanjanje dupliranja: `income` gasim, knjiga poslova ostaje jedina |
| **3** | Usluge — katalog sa cenama, veže se na stavke |
| **4** | Projekti — ekran, vezani za klijenta, sa knjigom i zadacima |
| **5** | Zadaci — moji / danas / kasne, vezani za klijenta i projekat |
| **6** | Finansije — prihod, režija, potraživanja, filteri |
| **7** | Leads — pipeline i prelazak u klijenta |
| **8** | Obaveštenja — izvedena iz rokova i zadataka |
| **9** | Kontrolna tabla kao komandni centar |
| **10** | Izveštaji — po mesecu, klijentu, usluzi |
| **11** | Pretraga proširena na sve entitete |
| **12** | Završni pregled: prazni ekrani, mrtve veze, mobilni |

Dokumenti i materijali čekaju Firebase Storage, koji traži Blaze plan. To je
odluka o novcu, ne o kodu — ostavljam je za kad se sistem koristi.

---

## 7. Pravila koja se ne krše

1. **Sigurnost je u `firestore.rules`,** nikad u interfejsu. Provera u `src/`
   postoji radi udobnosti.
2. **Svaka nova kolekcija dobija pravilo i test** pre nego što dobije ekran.
3. **Novac su celi minor jedinici,** nikad decimale.
4. **Izvedeni broj se nikad ne kuca** — profit, provizija, zbirovi.
5. **Ništa se ne briše ako nosi istoriju.** Status, arhiva, ne brisanje.
6. **Nijedan tekst u komponenti** — sve kroz i18n, oba jezika.
