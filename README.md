# LeakSök Intelligence

## Morgonanalys, 14 september 2026

Öppna samma webbläsare/profil och importera Kamstrups senaste 24-timmarsexport. Historiken byggs på tidigare importer. Appen hämtar inte exporter från Kamstrup automatiskt.

- Morgonöversikten visar datum för senaste export, nya små ökningar, prioriterade mätare och datatäckning.
- 5 → 10 visas som +5 i exportvärde och +100 %. Procent av en dB-siffra är inte procent förändring av ljudintensitet. Appen använder benämningen exportvärde eftersom exportens enhet måste verifieras i källan.
- Misstänk visar automatiska signaler, inklusive ett första +50 % / +2-hopp. Bevaka är en manuell arbetslista.
- En kvarstående förhöjning vägs mot verkliga avläsningsdagar. Flera exporter av samma avläsning ger inte flera bekräftelser. Luckor över 14 dagar bryter sammanhängande beständighet.
- Samma filnamn från olika dagar bevaras. Excel-blad med omslag, CSV med rapporthuvud, svenska decimaler och saknade värden hanteras.
- Konstaterad/Lagad öppnar fältformulär även via snabbval. Sparandet måste slutföras innan formuläret stängs.
- Karta och graf delar desktopvyn. Tabellen använder hela bredden. Grafen behåller dataluckor och markerar senaste fem punkterna.
- Akustiska händelser i Aktiva händelser skiljs från flowIQ-infokoder. LEAK/BURST i infokod anger förbrukningsavvikelser att kontrollera efter mätaren. DRY är torr mätare, inte kommunikationsbortfall.
- Prioritet 0–100 är en regelbaserad rangordning, inte en läcksannolikhet. Ingen extern språkmodell får mätardata.

Verifiera med `node --test tests/*.test.js`. GitHub Actions kör sviten i UTC och Europe/Stockholm samt Chromium-test av import, fältflöde, omladdning och responsiv layout. Webbläsartestet använder syntetiska CSV- och XLSX-data; originalexporter från kommunen finns inte i repo:t.

## Delad karta och historik

Översiktskartan hålls låg. Välj en kartpunkt eller tabellrad: kartan och grafen får varsin lika stor halva på datorn. **Översikt** avmarkerar och ger mer plats åt listan. På telefon visas graf och en mindre karta under varandra. Grafen förstoras med klick eller Enter.

Grafens **Jämför** visar senaste avläsningen mot föregående eller en avläsning 7/30/90/365 dagar tillbaka. Det faktiska jämförelsedatumet visas alltid. Saknas en avläsning nära det önskade datumet visas det tydligt; inga värden interpoleras. Ett tidigare nollvärde ger ingen påhittad procent. Dessa jämförelser ändrar inte manuellt facit eller motorns klassificering.

Verifiering: `node tests/history-comparison.test.js` och `node tests/chart-render.test.js` samt befintliga motor- och flödestester.

## Gömda mätare och bedömning (2026-09-08)

- Högerklicka en markerad rad eller kartkort och välj **Göm markerade**, eller använd knappen vid massval. Mätarna försvinner från ordinarie listor och kartöversikten. **Gömda** visar dem; **Visa markerade igen** återställer synligheten. Facit, reparationsdatum och historik bevaras. Synligheten sparas med den lokala profilen.
- **Visa bara Efter mätare** är ett visningsfilter, ingen omklassificering. Byte av lista återställer detta filter.
- Motorn använder unika avläsningsdagar. Upprepade exporter av samma avläsning ökar inte beständigheten. Grafernas tidsskala följer avläsningsdatum och visar luckan fram till sista exporten.
- En ensam verklig avläsning märks internt som ny mätare. Redan efter flera avläsningar över 2–3 veckor bedöms procenthopp och beständig nivå normalt utan ett artificiellt inlärningsavdrag.
- Infokod `LEAK` är en förbrukningsavvikelse som följs upp efter mätaren; en akustisk händelse med texten Läckage anger inte läckans placering.
- **Nollställ** bedömer endast avläsningar efter nollställningstidpunkten. Efter minst tre nya avläsningsdagar kan automatiken varna igen. **Lagad** och **Konstaterad läcka** är manuella beslut.
- Vid kort historik kan upprepat hög nivå mot Excel-snitt F ge **Misstänk**, men detta är inte bevis för läckage. Låga nivåer med bestående procentökning kan också ge Misstänk.
- Bedömningen är en lokal regel- och statistikmotor, inte en ansluten språkmodell. Poängen är prioritering, inte en kalibrerad sannolikhet. Inga Excel-filer skickas till en AI-leverantör.

Regression: `node tests/visibility.test.js`, `node tests/smart-engine.test.js` och befintliga tester. `tests/exports-regression.js` läser JSON med `{name, table}` per arbetsbok från stdin för att kontrollera originalexporternas parser och fullständiga motor. Råa mätarfiler ingår inte i repo:t.

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
   - konstaterad läcka som flyttar markerade mätare till `Aktiva läckor`
   - hittad läcka med datum och osäkert datum
   - lagad med datum, AV/SV och cirka meter från mätaren
   - efter mätare/kundsida som egen lista för `Kontakta FÄ`
   - flytta mätare direkt till Åk ut, Misstänk, Bevaka, Säsong, Ignorera eller Nollställ

Om dagens Excel innehåller en mätare vars senaste riktiga avläsning är gammal avslutas mätkurvan på avläsningsdatumet. Tiden fram till dagens export visas streckad som `Inga avläsningar` och ska inte tolkas som fortsatta mätvärden.

Facit och tolkade mätvärden sparas i webbläsarens IndexedDB och kan återanvändas utan att originalfilerna laddas upp på nytt. En enkel namn- och kodruta fungerar som enhetslås. Det är lokal lagring på samma webbläsare, inte molnsynk eller en serverbaserad säker inloggning.

Fyra verkliga startfacit följer med motorn: Alhagsvägen 58-60 (bekräftad och lagad), Alice Tegnérs väg 23 (värmepanna/säsong), Broängsvägen 22 (lagad) och Vattravägen 8 (aktivt exempel). Lagad och aktiva läckor är manuella listor. Appen ska inte automatiskt lägga något som lagat bara för att värdet går ner.

Flera starkt korrelerade kurvor på samma husnummer markeras som möjlig gemensam servis före mätarna. `LEAK` i infokod följs upp i Efter mätare. Texten Läckage i akustiska händelser anger inte vilken sida om mätaren läckan finns på. `DRY` betyder torr mätare; orsaken måste kontrolleras.

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


## Listor och flyttflöde

Vänstermenyn visar de viktigaste arbetslistorna först: `Alla mätare`, `Åk ut`, `Misstänk`, `Bevaka`, `Efter mätare`, `Aktiva läckor` och `Lagad`. Mindre använda listor ligger hopfällda under `Fler listor`.

`Flytta till` visar fältbeslut i första ledet. Störningsorsaker hålls inne i facitdialogen, så rullgardinen inte blir en lång blandning av beslut och orsakstyper. Markerade mätare visas samtidigt i kartan med tydligare pluppar.

### Layout och historikgrafer (9 september 2026)

Arbetsvyn använder `styles.css` för grundkomponenter och `workspace-v3.css` med `desk-layout.css` för morgonöversikten och responsiva justeringar. De äldre layout- och presentationsfilerna laddas inte längre av sidan. Karta/lista, filter och sidval delar samma arbetsyta; en vald mätare öppnar karta och graf bredvid varandra på dator och staplat på telefon.

Grafen ritas med verkliga avläsningsdatum och uppmätta SVG-dimensioner. Luckor över 14 dagar visas som saknat underlag i både minigraf och detaljgraf. Inga mätvärden interpoleras över sådana luckor. Grå yta efter sista avläsningen visar hur länge nya värden saknas fram till sista exportdatumet. Förändringstal jämför observerade värden; tidigare nollvärde ger ingen påhittad procentsats. Diagrammet zoomar inte vid vanlig scroll.

Kontroll: `TZ=UTC node tests/chart-render.test.js`, `node tests/ui-structure.test.js` och den befintliga import-/motorsviten.


## Ladda ner – separat exporturval

Markera mätare och välj **Flytta till Ladda ner**, eller välj **Ladda ner** i radens Flytta-meny. Öppna listan från sidomenyn eller toppfältet. Markeringarna i exportlistan är separata från huvudtabellens markeringar och återställs när listan öppnas. **Markera alla i listan** omfattar endast dess sparade rader. Excel och kopiering inkluderar endast kryssade rader; noll markeringar ger ingen export. Knappen visar exakt antal.

Tidigare åklistor bevaras. Ta bort markerade eller töm listan för att rensa gamla exportposter utan att ändra mätardata, facit eller historik. Listan sparas i befintlig lokal profil. `node tests/download-browser.cjs` verifierar 2 900 importerade mätare, urval, återläst XLSX, omladdning, dubbletter och tidigare stora åklistor.
