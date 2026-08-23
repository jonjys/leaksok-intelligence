# Läcksök Intelligence

Fristående prototyp för att analysera Kamstrup Leak Detector-exporter.

Målet är inte en snygg Excel-visare. Målet är en smart läckdomare:

1. Ladda in valfritt antal original-Excel från Leak Detector.
2. Appen hittar Kamstrup-headern automatiskt även när de första raderna innehåller rapportinfo.
3. Appen bygger historik per `Serienummer`.
4. Appen räknar automatiskt:
   - `P = (Senaste värde / Genomsnittsvärde) - 1`
   - senaste hopp
   - första till sista
   - maxvärde
   - säsongsmönster
   - ny nivå som stannar
   - låg absolut nivå med stor relativ ökning, t.ex. `3 -> 8`
   - hur många dagar och avläsningar den nya nivån har hållit
   - återgång efter lagning
5. Appen låter fältperson markera facit:
   - bekräftad läcka
   - lagad
   - säsong/känd
   - pump/störning
   - falsklarm

Facit sparas i webbläsarens localStorage och kan exporteras som JSON.

Fyra verkliga startfacit följer med motorn: Alhagsvägen 58-60 (bekräftad och lagad), Alice Tegnérs väg 23 (värmepanna/säsong), Broängsvägen 22 (lagad) och Vattravägen 8 (aktivt exempel). Ett gammalt facit blockerar inte en ny varning om mätaren senare får en ny ihållande avvikelse.

## Kamstrup-principer som motorn följer

- flowIQ 2200 använder akustisk läckagedetektering och kan upptäcka möjliga läckor före och efter mätaren.
- Leak Detector bygger på ljudkurvor över tid.
- Enligt Kamstrups noise curve assessment är absolut ljudvärde inte huvudfokus; kurvbeteende och tendens är viktigare.
- Motorn stirrar därför inte bara på värden över 50/100. Ett hopp från låg nivå, t.ex. `3 -> 8`, kan ge bevakning även om nivån fortfarande är låg.
- Ett ensamt hopp eller bara måndag till fredag blir bevakning med låg säkerhet. En ny nivå räknas som ihållande först efter minst 7 dagar, minst 3 förhöjda avläsningar och minst 75 procent förhöjda punkter efter nivåskiftet.
- En ihållande låg nivå, t.ex. `4 -> 8-9`, stannar normalt i `BEVAKA`. Den blir akut först när fler signaler stödjer läcka, exempelvis fortsatt stigning, högre nivå eller läck-/rörbrottsinfo.
- Högre läckrisk:
  - plötslig låg till hög och fortsatt hög nivå
  - långsam stigande kurva
  - okänd hög nivå som kan ha funnits innan mätaren sattes
  - återkommande läckor på samma linje
  - flera grannmätare med korrelerad tendens
- Lägre eller annan sannolikhet:
  - fladdrig kurva
  - pumpar/cirkulationspumpar
  - värmesystem
  - återkommande säsongsmönster

Ett årsmönster kräver minst två kalenderår, minst fyra jämförbara månader och tydlig korrelation mellan årens månadsformer. Antalet uppladdade filer används alltså inte som ersättning för faktisk historiklängd.

## Kör lokalt

Öppna `index.html` direkt i en webbläsare, eller kör en enkel statisk server:

```bash
python3 -m http.server 4173
```

Öppna sedan `http://localhost:4173`.

Kör motorproven med:

```bash
node tests/intelligence.test.js
node tests/app-engine.test.js
```

## Repo-status

Den här mappen är helt fristående från övriga projekt.
