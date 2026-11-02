# LeakSök Intelligence

Morgonverktyg för Kamstrup Leak Detector-exporter: importera senaste 24-timmarsexporten, se vad som förändrats, varför det är relevant och vilka mätare som ska kontrolleras, och ta med en arbetslista i Excel ut i fält.

Allt körs lokalt i webbläsaren. Historik, beslut och kommentarer sparas i webbläsarens IndexedDB på den här enheten. Namn + kod öppnar arbetsytan; det är inte kryptering eller ett serverkonto. Inga mätardata skickas till någon språkmodell. Kartan skickar adresser till OpenStreetMap Nominatim och cachar träffarna lokalt. Pluppen visar adressen, inte vattenmätarens exakta position. Ett klick på mätaren öppnar kartan och zoomar till adressen. Gatunamn och hela husnumret måste stämma, inklusive bokstav som 9C eller nummerintervall. Enbart en gatuträff, nummer 9 eller 9B får inte ersätta 9C. Gamla ungefärliga reservträffar ignoreras och adressen söks på nytt. Om adressen saknas i kartunderlaget visas att den inte kunde hittas; ingen plupp placeras på fel hus. Den valda adressen prioriteras före köade bakgrundssökningar; varje nätanrop avbryts efter 10 sekunder så att en otillgänglig tjänst inte låser hela kön.

Kartan använder bara adressen för placering. Gatunamn, hela husnumret och eventuell bokstav måste matcha; Excel-GPS och exportens visningsinställningar behövs inte. Markerade mätare ligger kvar över kategoriflikar, sökningar, områdesfilter och sidbyten. Svart ring betyder markerad; större ring med adressetikett betyder vald. Statusfärgen är samma i listan och kartans färgförklaring; normal är neutralgrå. **Visa markerade** anpassar kartan till markeringen, medan **Visa alla träffar** även tar med listans träffar. En saknad adress visas som saknad, aldrig på en annan husadress.

Vid nya importer uppdateras kartplupparnas nivå, datum, max och status även när kategorin är oförändrad. Plupparna uppdateras på plats när du sorterar. Sortering kan vändas med pilknappen; procentuell förändring och förändring i nivå har egna val. Saknade värden ligger sist i båda riktningarna. När jämförelsenivå väljs visar även listans förändringsvärde den jämförelsen.


Adressökningen är begränsad till Botkyrka. Den publika tjänstens [användningspolicy](https://operations.osmfoundation.org/policies/nominatim/) gäller: högst en förfrågan per sekund för hela appen, cache och begränsad användning; regelbunden massgeokodning är starkt avrådd. Appens lokala kö begränsar bara en webbläsare. Vid återkommande stora importer eller flera användare behövs en annan tjänst eller befintliga adresskoordinater.

## Automatisk mappimport

Välj **Anslut mapp → Välj exportmapp** i Chrome eller Edge på dator. Spara Kamstrups exporter direkt i den mappen. LeakSök läser nya och ändrade `.xlsx/.xls/.csv` varje minut medan appen är synlig, öppen och upplåst, samt när du återvänder till appen. Undermappar, tomma filer och Excels tillfälliga `~$`-filer läses inte. Appen hämtar inte exporter från Kamstrup och kör inte när sidan är stängd.

Anslutningen och behandlade filers namn, storlek och ändringstid sparas med den lokala profilen. Oförändrade filer läses inte om. Dubbletter räknas inte dubbelt; ändrade metadata som infokoder, referensvärden och rang uppdateras även om själva avläsningen är oförändrad. En fil kvitteras först efter lyckad import och lagring. Oläsbara filer och misslyckad lagring visas och kan försöka igen.

Om webbläsaren behöver läsbehörighet igen visas **Tillåt läsning**. Mappen läses bara; inget skrivs till den. **Koppla från** behåller historiken. Rensning av importer stoppar även mappimporten. På mobil och i webbläsare utan mappstöd fungerar vanlig flerfilsimport och dra-och-släpp.

**Info → Säkerhetskopiera hela arbetsytan** sparar historik, beslut, kommentarer och arbetslista i en versionerad JSON-fil. **Återställ säkerhetskopia** validerar filen och visar innehållets antal innan den läggs till. Befintliga exporter behålls, dubbletter undviks och nyare beslut, kommentarer och synlighetsändringar jämförs separat. Äldre beslutskopior stöds också. Profilkod och mappbehörigheter ingår inte. Återställningen lagras i en transaktion innan arbetsytan byts.

## Morgonflöde

**Adress och markeringar på kartan:** varje plupp kommer från mätarens adress, inte GPS-fält eller vattenmätarens fysiska placering. Markerade mätare ligger kvar på kartan när flik, sökning, område eller sida ändras. Ett klick på en adress, även i arbetslistan, fokuserar den adressen. Om flera adresser är markerade zoomas utsnittet ut så att deras pluppar ryms samtidigt som den valda adressen ligger i centrum. **Visa alla träffar** omfattar både nuvarande träffar och kvarvarande markeringar. **Avmarkera** släpper de kvarvarande markeringarna.

1. **Anslut mapp** för återkommande import, eller **＋ Importera Excel** – en eller flera `.xlsx/.xls/.csv`. Tidigare historik behålls; samma fil två gånger räknas som dubblett.
2. **Morgonöversikten** visar senaste exportens tid, hur många som lästs av senaste dygnet och dagens nya signaler.
3. Listorna: **Nytt i dag**, **Åk ut**, **Misstänk** (automatisk upptäckt), **Bevaka** (din manuella lista), **Efter mätare**, **Aktiva läckor**, **Lagade** och under *Fler listor* Stabilt hög, Störning/tillfällig, Säsong, Kort historik, Utan färsk avläsning, Ignorerade och Gömda.
4. I **Karta** ligger en egen rullande mätarlista till vänster om kartan. Vänstermenyn fälls ut ovanpå arbetsytan vid hovring eller tangentbordsfokus. Klicka på en adress för att zooma till den valda pluppen och visa en kompakt graf: bredvid kartan på stora skärmar, under den på mindre skärmar. X stänger grafpanelen. Övriga pluppar finns kvar och **Visa alla träffar** visar hela sökurvalet. **Lista** visar en tabell; klick öppnar grafen i en separat dialog. På telefon staplas panelerna och listan visas som kort. **i** fäller ut underlaget. Klick på **Nivå** växlar mellan högst och lägst först.
5. **Flytta till…** finns på ett ställe: markeringsraden, ⋯ på raden, högerklick eller långtryck. Konstaterad läcka (datum, osäkert datum) och Lagad (datum, AV/SV, ungefärligt avstånd, kommentar) öppnar formulär. Allt kan ångras direkt.
6. Markera mätare (kryssrutor gäller över sidor och filter) → **Excel (N)** eller **Lägg i arbetslista**. **Markera sidan** och **Markera alla N träffar** gäller uttryckligen aktuell sida respektive hela det filtrerade urvalet. Exporten visar antal innan nedladdning och tar aldrig med alla mätare automatiskt.

## Analysregler (src/engine.js)

- **Värden** är exportens brusvärde (Kamstrup: dagens lägsta filtrerade värde; ingen enhet anges). Procent är procent av exportvärdet – inte förändring av ljudintensitet.
- **Avläsningar, inte exporter**: kurvan byggs på avläsningsdatum. Samma avläsning i flera exporter räknas en gång. Importordning och överlappande filer påverkar inte resultatet.
- **Sedan föregående avläsning**: `(nytt / tidigare) − 1` och `nytt − tidigare`. **Mot jämförelsenivå**: mätarens egen median före fyndet, alltid med period och antal avläsningar. **P = E/F − 1** från samma rad i senaste exporten (E = Senaste värde, F = Genomsnittsvärde, G = Maxvärde); används bara som stöd när egen historik saknas. Tidigare värde 0 ger ingen procent; saknat värde är inte 0.
- **Normal variation** per mätare = robust spridning av dag-till-dag-skillnader. Med färre än 8 jämförbara avläsningspar används en schablon på 8 % av nivån (medianen av dag-till-dag-förändringar i de verkliga exporterna), så att ett enda stort hopp inte blåser upp variationen. En nivåförändring måste överstiga `max(2, 3 × variationen, 25 % av nivån)`.
- **Ny signal**: en enda avläsning som överstiger `max(3, 3 × variationen, 50 % av nivån)` – ännu oklart; kontrollera nästa. Det striktare kravet för en ensam avläsning bygger på de verkliga exporterna: vid nivå 4–7 är 99:e percentilen av uppgångar mellan avläsningar 3, vid 10–14 är den 8. Mindre förändringar visas som förändring men lyfts inte som signal. **Ny nivå**: minst två avläsningar på samma sida; återgång inom fyra avläsningar gör den till **tillfällig topp** (bara när återgången faktiskt observerats). Bestående först efter ≥ 5 avläsningar under ≥ 5 dagar. **Gradvis ökning**: Theil–Sen-trend över 60 dagar.
- En höjd nivå ligger kvar som jämförelse och absorberas inte i baslinjen; **Nollställ** anger tidpunkten från vilken nya avläsningar bedöms.
- **Luckor** (> 3 dagar) är saknat underlag, aldrig observerad beständighet. Avläsning ≥ 2 dagar gammal märks; ≥ 14 dagar → *Utan färsk avläsning* (orsak okänd – saknad export bevisar inte förlorad kontakt).
- **Kamstrups snitt F vid kort egen historik** (< 30 dagar): en ökning som stannar under F dämpas bara om mätarens egen historik före ökningen aldrig nått F – då speglar F en längre period som appen inte sett. En mätare vars median av de senaste avläsningarna ligger på minst dubbla F (och minst F + 5) lyfts till Misstänk med texten *Över Kamstrups snitt – kort egen historik*; när nivån ändrades går inte att se.
- **Stabilt hög** (≥ 50 utan förändring) skiljs från ny ökning. Mätare med återkommande kortvariga toppar bedöms mot sitt eget toppmönster.
- **Säsong**: verifierat först efter minst två växlingar vinter/sommar; en vinter + en sommar = möjligt mönster. Känd störning (fjärrvärme/undercentral, manuella Säsong/Störning) dämpar men tystar inte en tydlig ny avvikelse.
- **Grannar**: samtidig ökning på samma adress/gata visas som möjlig gemensam påverkan – inte som läckans plats. Avstånd bara när båda har exakt kartposition.
- **Infokoder (flowIQ, verifierat mot Kamstrups datablad)**: LEAK = vattnet har inte stått still en sammanhängande timme senaste dygnet → Efter mätare; BURST = högt flöde i 30 min; DRY = mätaren inte vattenfylld (inte kommunikationsfel); REVERSE/TAMPER är datakvalitet, inte läcksignal. Leak Detector-händelsen *Läckage* anger inte om läckan är före eller efter mätaren; *Ej fastställt* och *Annat brus* visas som händelser, inte som läcka. Stängda händelser och Kamstrups *Följ*-markering visas som information.
- **Prioritet 0–100** är en regelbaserad rangordning (storlek, belägg/varaktighet, aktualitet, nivå, infokoder, störning, säsong, grannar). Samma händelse räknas en gång. Det är inte en sannolikhet för läcka.
- **Manuella beslut**: Konstaterad läcka och Lagad sätts bara manuellt; automatiken markerar aldrig lagat för att värdet sjunker. En ny ökning efter lagning visas i Misstänk. Gömda försvinner från listorna men kan återställas.

## Områdessignaler (src/area-signals.js)

Ett separat analyslager söker samtidiga ökningar på minst tre olika adresser. Exempel: 9 → 23 på tre närliggande adresser ger en möjlig gemensam källa och en föreslagen startadress för områdeskontroll. Det bevisar varken huvudledningsläcka eller en viss läckplats; ledningsnätets topologi finns inte i appen.

- Normalt behövs minst tre tidigare avläsningsdagar. Ökningen ska vara minst 2 värdeenheter, 25 % och två gånger uppskattad variation. Med endast två tidigare dagar kan en stabil referens och starkare ökning ändå ge en **Preliminär områdessignal**: minst 3 värdeenheter, 50 % och tre gånger uppskattad variation. En sådan grupp förblir preliminär även efter flera förhöjda avläsningar. En enda tidigare dag räcker aldrig. Baslinjen är medianen av upp till 14 föregående avläsningsdagar. Procent avser exportvärdet, inte akustisk energi eller läckflöde.
- Ökningarna ska börja inom tre dagar från varandra och under de senaste 14 dagarna. Luckor över tre dagar och avläsningar äldre än en dag mot senaste exporten utesluts. Samma dags upprepade exporter räknas en gång.
- Alla par av kartpunkter ska ligga högst 250 meter från varandra. Utan fullständiga kartpositioner används samma gata/ort och högst 20 husnummer i spann; då anges uttryckligen att fysisk närhet inte är verifierad. Kartpunkter är adresspositioner, inte ledningsdata. Flera mätare i samma byggnad eller vid samma kartpunkt räknas inte som flera oberoende adresser.
- En enda förhöjd avläsningsdag ger **Preliminär**; minst två per mätare ger **Upprepad ökning**. Återgång efter en topp, kundsidans LEAK/BURST, DRY, gömda, ignorerade och lagade mätare bildar inte en grupp. Nollställningens historikgräns respekteras.
- Känd störmiljö och omfattande samtidiga förändringar i importurvalet ger extra reservation om drift/säsong. Trösklarna är transparenta hypoteser, ännu inte kalibrerade mot kommunens fältfacit.

Öppna den kompakta raden **områdessignaler** i morgonanalysen och välj **Markera och visa området**. Befintliga markeringar behålls. Mätarens utvecklade rad visar gruppens baslinjer, ökningar och referensdatum. Gruppen följer med i arbetslistans motivering och kontrollförslag, men exporten innehåller fortfarande endast det valda urvalet. Individuell prioritet, kategori, manuella beslut och grafer ändras inte av det nya analyslagret. Kartpositioner som tillkommer kan förfina eller avfärda en adressbaserad grupp.

## Excel-arbetslista (src/field-export.js, src/xlsx-writer.js)

- **Arbetslista**: Adress, Serienummer (text), Status, Senast avläst, Senaste värde, Förändring sedan föregående (värde och %), Huvudorsak, Rekommenderad kontroll, Kommentar, Utförd (Ej utförd/Klar, raden blir grön). Excel-tabell med filter, fryst rubrik, liggande utskrift en sida bred.
- **Analysunderlag**: samma mätare med jämförelsedatum, referensvärden, absoluta och procentuella förändringar, jämförelseperiod och definition, antal avläsningar, varaktighet, E/F/G/P, infokoder, datakvalitet och full motivering.
- **Definitioner**: förklaring av alla mått.
- All text skrivs som text (formelliknande värden skyddas), datum som riktiga datum och procent som tal.

## Verifiering mot verkliga exporter (lokalt, september 2026)

Fem exporter (22, 23, 24, 25 och 28 sep) granskades lokalt; filerna finns inte i repot. Varje export innehåller bara senaste avläsningen per mätare: 3 012 mätare, 16 utan värde och datum, 1 972 återexporterade rader (räknas en gång), 0 konflikter. Mätare med 5/4/3/2/1/0 unika avläsningsdagar: 1 960/420/214/120/282/16. 26–27 sep saknas helt eftersom ingen export gjordes. Import i olika ordning, i omgångar och omimport ger identiskt resultat. Mönstren finns anonymiserade i `tests/real-patterns.test.js`.

Materialet räcker inte för gradvis trend (kräver ≥ 8 avläsningar över 14 dagar), säsong eller *Åk ut* (≥ 5 avläsningar under ≥ 5 dagar efter en förändring). De fallen täcks av syntetiska tester. Inga läckor är bekräftade av fältfacit i materialet utöver appens inbyggda facit.

## Begränsningar

- **Minimiflöde** läses tillsammans med Minimum flödesdatum när kolumnerna finns. Tomma värden är okända, aldrig noll. Ett färskt daterat positivt minimiflöde ger förslag om kontroll efter mätaren, inte en bekräftad läcka; legitim kontinuerlig förbrukning är också möjlig. Saknat/gammalt/framtida datum, DRY eller saknad aktuell brusavläsning styr inte om en akustisk varning. Uppgifterna visas i analysunderlaget och Excel-exporten. Det är ett observerat flöde, inte mätarens tekniska Q1/minimiflödesgräns.
- Filerna kan inte avslöja mätarmodell, Q3/storlek, rörmaterial, tryck, nätets kopplingar eller andra READy-data om dessa uppgifter inte exporteras. Appen jämför mätaren med dess egen brusnivå och räknar inte fram ett läckflöde ur brusvärdet.

Tillverkarkällor: [flowIQ 2200, svensk produktinformation](https://www.kamstrup.com/se-se/product-centre/flowiq-2200), [datablad KWM2230/KWM2231/KWM3230, augusti 2026](https://kamstrup-delivery.sitecorecontenthub.cloud/api/public/content/59081-downloadOriginal?v=c3c00f17), [bedömning av bruskurvor](https://kamstrup-delivery.sitecorecontenthub.cloud/api/public/content/61955-downloadOriginal?v=21d57698) och [Leak Detector 1.5.3: minimiflöde i export](https://kamstrup-delivery.sitecorecontenthub.cloud/api/public/content/121718-downloadOriginal?v=1b05f0ff). Appens numeriska detektionströsklar är egna hypoteser, inte Kamstrups interna algoritm.

- Originalexporter från kommunen finns inte i repot. Tester använder syntetiska och anonymiserade data. Kör egna filer lokalt: `node tests/exports-regression.js exports/*.csv`.
- Tröskelvärdena (25 %, 50 % för enskild avläsning, 50 för stabilt hög, 5 avläsningar/5 dagar för Åk ut) är hypoteser. De kan bara kalibreras mot fältfacit: registrera Konstaterad läcka och Lagad för att bygga det underlaget.
- Säsongsbedömning kräver minst ett års historik i appen. Historiklängd i appen är inte mätarens installationsålder.
- Lagring är lokal per webbläsare; använd *Info → Säkerhetskopiera hela arbetsytan* regelbundet.

## Utveckling och verifiering

### Kamstrups mätare av intresse

Importen läser `Mätare av intresse` (även `Meters of interest`) som positiv heltalsrang, separat från infokoder och Följ. En aktuell rekommendation visas i **Misstänk** även om den egna exporthistoriken börjar efter en möjlig ökning. Den skapar varken konstaterad läcka, automatisk Åk ut, påhittad referensnivå eller områdessignal. LeakSöks egen jämförelse och prioritet behålls; källa och rang visas i listan, analysen och Excel-exporten.

Både avläsningen och exporten måste vara färska (högst en kalenderdag gamla jämfört med senaste exportdatum), senaste rad måste ha giltigt värde/datum, och DRY får inte förekomma. Äldre eller uteblivna avläsningar prioriteras inte upp av rangen. LEAK/BURST ligger fortsatt i Efter mätare. Manuella beslut går före. Nollställning använder endast nya avläsningar efter nollställningstidpunkten.

Filer som importerades innan kolumnen stöddes behöver importeras igen, normalt räcker den senaste exporten. Samma avläsningar uppdateras då på plats med ranginformationen, utan dubbla filer eller historikpunkter. En tom rang i senaste exporten tar bort rekommendationen. En dubblett utan rangkolumn raderar inte redan inläst metadata.

Kamstrups beskrivning: [Meters of interest ranking, release 1.5.1](https://kamstrup-delivery.sitecorecontenthub.cloud/api/public/content/59293-downloadOriginal?v=e110f267). Rangen är leverantörens rekommendation, inte en riskprocent eller en uppgift om var läckan sitter.

Statisk app utan byggsteg: öppna `index.html` via en statisk server (`python3 -m http.server 4173`).

```bash
node --test tests/*.test.js          # motor, import, Excel, grafer, lagring (kör i flera tidszoner i CI)
node tests/browser-smoke.cjs         # Chromium: 3 000 mätare × 30 exporter, beslut, omladdning, desktop/mobil
node tests/download-browser.cjs      # Chromium: exakt exporturval över sidor, arbetslista, XLSX-granskning
node tests/legacy-browser.cjs        # Chromium: gammal profil, XLSX-datum, ett års historik
node tests/layout-browser.cjs        # Chromium: 1366–3440 px, mobil, storleksbyte, kompakt grafpanel
node tests/import-source-browser.cjs # Chromium: mappimport, ändrade infokoder, omladdning och full återställning
```

Webbläsartesterna kräver Playwright. `LEAKSOK_VENDOR=<mapp>` kan peka på lokala kopior av CDN-filerna vid körning utan nät.

Moduler: `parse.js` (import) → `history.js` (avläsningar) → `engine.js` (analys) → `app.js` (lista, urval, beslut), `chart.js`, `meter-view.js` (gemensamma statusfärger och sortering), `map.js`, `worklist.js`, `field-export.js` + `xlsx-writer.js` (Excel), `storage.js` (IndexedDB), `styles.css`.


## Dolda grupper och registrerade läckfall

Efter mätare, Störning/tillfällig, Säsong och Ignorerade är dolda i arbetslistorna som standard. **Visa dolda grupper** visar valda grupper igen. **Fler listor → Dolda** samlar dessa och manuellt gömda mätare; grupperna har inga egna menyflikar. Högerklick visar Åk ut, Bevaka, Läcka och Lagad direkt; mindre vanliga beslut ligger under **Övriga beslut**. Markeringsrutan visar antal, Flytta till och Excel; Markera sidan/alla, arbetslista, göm och avmarkera ligger under **Mer**.

**Läcka** har datum konstaterad, AV (huvudledning), SV (servis) eller Vet ej, samt valfritt lagdatum. Lagdatum flyttar fallet till Lagade. När ett aktivt fall markeras Lagad bevaras läckdatum och ledningstyp. Vid ett nytt läckfall bevaras tidigare avslutade fall.

Lokal jämförelse använder mätares dagliga exportvärden före läckdatum, under läckan och efter lagdatum. Före/efter använder högst 14 dagar; lagdagen undantas eftersom den kan innehålla båda nivåerna. Minst tre avläsningsdagar utan luckor över tre dagar behövs i varje period, tillsammans med en tydlig ökning och återgång efter lagning. Exakta kartpunkter inom 250 m används för närliggande mätare. När jämförelseperioderna har tillräckligt med data hämtas saknade exakta adressträffar för grannarna automatiskt, i små grupper via kartans begränsade sökkö. Adressnärhet på samma gata visas preliminärt, utan att påstå ett uppmätt avstånd eller lära ett grannmönster. Okänd ledningstyp, osäkert läckdatum, efter-mätare-/DRY-infokoder och tunt underlag ger ingen inlärning.

**Visa underlag** visar median, antal dagar och bedömning per mätare. En senare förhöjning under minst tre avläsningsdagar efter jämförelseperioden kan matchas mot samma mätares tidigare verifierade respons. En sådan match ger högst sex extra prioritetspoäng inom befintlig automatisk Misstänk/Åk ut; den ändrar inga manuella beslut och konstaterar aldrig en ny läcka. Närhet bevisar inte ledningskoppling; nivåerna har exportens enhet, inte dB. Underlaget sparas lokalt med profilen och räknas om när nya exporter eller kartpositioner tillkommer.


