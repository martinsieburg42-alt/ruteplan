# Ruteplanlægger

Åbn programmet her: **https://martinsieburg42-alt.github.io/ruteplan/**

1. Træk Excel-filen med adresserne ind (eller klik og vælg den).
2. Programmet finder adresserne på kortet og fordeler husene på arbejdsdage.
3. Tryk **Kopiér link** (eller **Send …**) og send linket til den, der skal køre. Når de trykker på linket på telefonen, ligger ruten der – uden login.
4. Hent evt. ruteplanen som Excel til dig selv.

Under **Indstillinger** på forsiden kan du ændre hjemadresse, timer pr. dag, minutter pr. hus og om der planlægges efter færrest km eller kortest køretid. Indstillingerne huskes på computeren.

## Som app på skrivebordet

Åbn adressen i Chrome eller Edge, og klik på ikonet "Installer" i adresselinjen (eller menuen ⋮ → "Installer Ruteplanlægger"). Så får du et ikon på skrivebordet, og programmet åbner i sit eget vindue. Det opdaterer sig selv, når der kommer en ny version.

## Sådan regner den

- Adresser slås op i OpenStreetMap (Nominatim, med Photon som reserve).
- Køretid og km mellem alle huse og hjemadressen hentes **ad vejene** fra OSRM. Der bruges ingen fugleflugt i planlægningen.
- Husene fordeles på dage, så den samlede kørsel (km eller tid) bliver mindst mulig, uden at en dag (kørsel + arbejde) bliver længere end det valgte antal timer. Metoden er Clarke–Wright-besparelser efterfulgt af lokal forbedring (2-opt, Or-opt, flyt/byt mellem dage) og "ruin & recreate" (se `solver.js`).
- Excel-filen forlader aldrig computeren; kun adresser og koordinater sendes til opslagstjenesterne.

## Filer

| Fil | Indhold |
|---|---|
| `index.html` | Siden |
| `app.js` | Indlæsning af Excel/CSV, adresseopslag, planlægning, kort, Excel-output |
| `solver.js` | Optimering af dage (regnes i små bidder, så siden ikke fryser) |
| `app.css` | Udseende |
| `telefon.html`, `telefon.js`, `telefon.css` | Telefonvisningen: ruten kommer i linket og gemmes på telefonen |
| `plan-link.js`, `vendor/pako*.min.js` | Pakker ruten ind i linket (pako 1.0.11, MIT) |
| `vendor/jszip.min.js` | JSZip 3.10.1 (MIT) til at læse og skrive Excel |
| `manifest.webmanifest`, `sw.js`, `icons/` | Gør siden installerbar som app |
