# LeakSök Intelligence

Morgonverktyg för Kamstrup Leak Detector-exporter: importera senaste 24-timmarsexporten, se vad som förändrats, varför det är relevant och vilka mätare som ska kontrolleras, och ta med en arbetslista i Excel ut i fält.

Import och analys körs lokalt i webbläsaren. Historik, beslut och kommentarer sparas i IndexedDB på denna enhet. Namn och kod öppnar arbetsytan; det är inte kryptering eller ett serverkonto. Den vanliga analysen skickar inga mätardata till en språkmodell eller adressökning. Den valfria Claude-bedömningen skickar ett begränsat underlag först efter ett uttryckligt knapptryck; se nedan. Kartan hämtar hela det publika adressunderlaget från Botkyrkas webbkarta genom `/api/addresses` och matchar mätarnas adresser lokalt. Pluppen visar adressen. Gatunamn och fullständigt husnummer måste matcha, inklusive 9C. Nummer 9, 9B eller enbart gatan får aldrig ersätta 9C. Gamla ungefärliga reservträffar ignoreras. Tidigare sparade exakta adressträffar behålls om kommunens register saknar adressen.

Kartan använder bara adressen för placering. Gatunamn, hela husnumret och eventuell bokstav måste matcha; Excel-GPS och exportens visningsinställningar behövs inte. Markerade mätare ligger kvar över kategoriflikar, sökningar, områdesfilter och sidbyten. Svart ring betyder markerad; större ring med adressetikett betyder vald. Statusfärgen är samma i listan och kartans färgförklaring; normal är neutralgrå. **Visa markerade** anpassar kartan till markeringen, medan **Visa alla** även tar med listans träffar. En saknad adress visas som saknad, aldrig på en annan husadress. Kartans meny **⋯** innehåller ventil, läckpunkt, min position och rättning av kartadress.

Vid nya importer uppdateras plupparnas nivå, datum, max och status även när kategorin är oförändrad. **Mest misstänkt** är standard och sorterar efter motorns analyspoäng 0–100, oberoende av kategori. Det är en regelbaserad rangordning, inte en kalibrerad läcksannolikhet. **Arbetsordning** behåller kategoriernas arbetsordning. Menyn samlar 15 sorteringar i analys, förändring samt värden och adress. **Flest signaldagar** räknar faktiska avläsningsdagar i signalen, inte kalenderdagar över dataluckor. **Störst områdessignal** räknar separata adresser, inte flera mätare i samma hus. **Nyaste signal** använder förändringens start, även för en ny ensam avläsning; för en trend används trendperiodens början. Aktivt sorteringsmått visas i listan där det tillför ett värde. Hjälpen **i** förklarar jämförelsen. Pilknappen vänder ordningen; saknade värden ligger sist i båda riktningarna.


Adressunderlaget är begränsat till Botkyrka och hämtas gemensamt, utan mätaradresser i anropet. Ingen extern sökning görs per mätare. Om adressen saknas i registret eller inte kan matchas säkert visas den i listan över saknade adresser.

Mätarpanelen visar senaste brusvärde, förändring sedan föregående avläsning, analyspoäng, underlag och nästa steg. **Visa graf & underlag** öppnar hela grafen och utfällbara jämförelser, bedömningar och poäng. Datakvalitet visas direkt vid tunt underlag, gammal/saknad avläsning, värdekonflikt eller DRY. Grafens korta datatäckning kan utvecklas med **Så läser du grafen**; importspårningen finns kvar separat.

## Automatisk mappimport

Välj **Mer → Anslut mapp → Välj exportmapp** i Chrome eller Edge på dator. Spara Kamstrups exporter direkt i den mappen. LeakSök läser nya och ändrade `.xlsx/.xls/.csv` varje minut medan appen är synlig, öppen och upplåst, samt när du återvänder till appen. Undermappar, tomma filer och Excels tillfälliga `~$`-filer läses inte. Appen hämtar inte exporter från Kamstrup och kör inte när sidan är stängd.

Anslutningen och behandlade filers namn, storlek och ändringstid sparas med den lokala profilen. Oförändrade filer läses inte om. Dubbletter räknas inte dubbelt; ändrade metadata som infokoder, referensvärden och rang uppdateras även om själva avläsningen är oförändrad. En fil kvitteras först efter lyckad import och lagring. Oläsbara filer och misslyckad lagring visas och kan försöka igen.

Om webbläsaren behöver läsbehörighet igen visas **Tillåt läsning**. Mappen läses bara; inget skrivs till den. **Koppla från** behåller historiken. Rensning av importer stoppar även mappimporten. På mobil och i webbläsare utan mappstöd fungerar vanlig flerfilsimport och dra-och-släpp.

**Mer → Säkerhetskopiera hela arbetsytan** sparar historik, beslut, kommentarer och arbetslista i en versionerad JSON-fil. **Återställ säkerhetskopia** validerar filen och visar innehållets antal innan den läggs till. Befintliga exporter behålls, dubbletter undviks och nyare beslut, kommentarer och synlighetsändringar jämförs separat. Äldre beslutskopior stöds också. Profilkod och mappbehörigheter ingår inte. Återställningen lagras i en transaktion innan arbetsytan byts.

## Morgonflöde

**Adress och markeringar på kartan:** varje plupp kommer från mätarens adress, inte GPS-fält eller vattenmätarens fysiska placering. Markerade mätare ligger kvar på kartan när flik, sökning, område eller sida ändras. Ett klick på en adress, även i arbetslistan, fokuserar den adressen. Om flera adresser är markerade zoomas utsnittet ut så att deras pluppar ryms samtidigt som den valda adressen ligger i centrum. **Visa alla träffar** omfattar både nuvarande träffar och kvarvarande markeringar. **Avmarkera** släpper de kvarvarande markeringarna.

1. **Anslut mapp** för återkommande import, eller **＋ Importera Excel** – en eller flera `.xlsx/.xls/.csv`. Tidigare historik behålls; samma fil två gånger räknas som dubblett.
2. **Morgonöversikten** visar senaste exportens tid, hur många som lästs av senaste dygnet och dagens nya signaler.
3. Listorna: **Nytt i dag**, **Åk ut**, **Misstänk** (automatisk upptäckt), **Bevaka** (din manuella lista), **Efter mätare**, **Aktiva läckor**, **Lagade** och under *Fler listor* Stabilt hög, Glest underlag, Störning/tillfällig, Säsong, Kort historik, Utan färsk avläsning, Ignorerade och Gömda.
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
- **Luckor** i importerad historik är saknat underlag, inte bevis på att Kamstrup saknar avläsningar. Graf och medianlinje bryts när en mellanliggande dag saknas; motorns tolerans för analys av beständighet är fortfarande högst 3 dagar mellan punkter. Avläsning ≥ 2 dagar gammal märks; ≥ 14 dagar → *Utan färsk avläsning* (orsak okänd – saknad export bevisar inte förlorad kontakt).
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
- Lagring är lokal per webbläsare; använd *Mer → Säkerhetskopiera hela arbetsytan* regelbundet.

## Valfri Claude-bedömning

Välj en mätare → **Claude**, eller öppna grafens underlag → **Claude-bedömning**. Dialogen visar exakt JSON-underlag före sändning. Endast de senaste högst 180 faktiska avläsningsdagarna, totalantal dagar, exportdatum, kodflaggor, antal separata adresser i områdessignal, minimiflöde med datum och lokal poäng/underlagsstyrka ingår. Adress, serienummer, GPS, egna kommentarer och hela Excel-filer skickas inte. Servern avvisar extra fält och räknar datatäckningen själv.

Claude Sonnet 5.5 ger observationer, möjliga förklaringar, nästa kontroller och osäkerheter. Svaret ändrar aldrig status, poäng, sortering, manuella beslut eller historik. Ingen schemalagd massanalys sker. Ett oförändrat underlag återanvänder svaret i den öppna arbetsytan; serverinstansen cachar upp till 32 svar i tio minuter. AI-resultat och åtkomstkod lagras bara i minnet och rensas vid låsning/omladdning.

Konfigurera hemliga servervariabler i samma Vercel-projekt, i de miljöer där AI ska användas, och gör en ny deployment:

| Variabel | Innehåll |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic-nyckeln, aldrig i webbkoden |
| `LEAKSOK_AI_ACCESS_CODE` | En separat stark åtkomstkod med minst 24 tecken, som användaren också anger i Claude-dialogen |

Den lokala profilkoden är inte serverautentisering. Saknas någon av servervariablerna är betalda anrop avstängda. API-nyckeln lämnar aldrig servern; åtkomstkoden kontrolleras där med konstantlång hashjämförelse. Skicka aldrig API-nyckeln som åtkomstkod. Inga fria användarprompter, verktyg, modellval eller godtyckliga upstream-URL:er accepteras. Endast anrop från samma ursprung tillåts i webbläsaren.

Varje anrop begränsas till 24 kB indata, 180 avläsningsdagar, 1 600 genererade token och 45 sekunder. Ingen automatisk återförsökning sker. En varm serverinstans tillåter en samtidig körning, minst tio sekunder mellan nya anrop och högst tjugo anrop per timme. **Detta är inte ett globalt kostnadstak:** flera instanser eller nya deploymenter har egna räknare. Sätt ett hårt utgiftstak i Anthropic-arbetsytan för gemensamt kostnadsskydd. En avbruten webbläsarförfrågan kan redan ha kostat token hos Anthropic.

Källor: [Anthropic-autentisering](https://platform.claude.com/docs/en/manage-claude/authentication), [strukturerade svar](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview). Anrop går direkt till Anthropic så att den konfigurerade nyckelns krediter används; ingen separat AI Gateway-kredit krävs.

## Utveckling och verifiering

### Kamstrups mätare av intresse

Importen läser `Mätare av intresse` (även `Meters of interest`) som positiv heltalsrang, separat från infokoder och Följ. En aktuell rekommendation visas i **Misstänk** även om den egna exporthistoriken börjar efter en möjlig ökning. Den skapar varken konstaterad läcka, automatisk Åk ut, påhittad referensnivå eller områdessignal. LeakSöks egen jämförelse och prioritet behålls; källa och rang visas i listan, analysen och Excel-exporten.

Både avläsningen och exporten måste vara färska (högst en kalenderdag gamla jämfört med senaste exportdatum), senaste rad måste ha giltigt värde/datum, och DRY får inte förekomma. Äldre eller uteblivna avläsningar prioriteras inte upp av rangen. LEAK/BURST ligger fortsatt i Efter mätare. Manuella beslut går före. Nollställning använder endast nya avläsningar efter nollställningstidpunkten.

Filer som importerades innan kolumnen stöddes behöver importeras igen, normalt räcker den senaste exporten. Samma avläsningar uppdateras då på plats med ranginformationen, utan dubbla filer eller historikpunkter. En tom rang i senaste exporten tar bort rekommendationen. En dubblett utan rangkolumn raderar inte redan inläst metadata.

Kamstrups beskrivning: [Meters of interest ranking, release 1.5.1](https://kamstrup-delivery.sitecorecontenthub.cloud/api/public/content/59293-downloadOriginal?v=e110f267). Rangen är leverantörens rekommendation, inte en riskprocent eller en uppgift om var läckan sitter.

Frontend utan byggsteg och Vercel Node-funktioner för det offentliga adressregistret och den valfria Claude-bedömningen. En statisk server (`python3 -m http.server 4173`) räcker för import/analys och redan cachade kartpunkter. För nya adresspunkter behövs `/api/addresses`, exempelvis genom `vercel dev` eller Vercel-deployen. Ingen Anthropic-nyckel behövs för analys, kartadresser eller sortering.

```bash
node --test tests/*.test.js          # motor, import, Excel, grafer, lagring (kör i flera tidszoner i CI)
node tests/ai-review-browser.cjs     # Chromium: explicit AI-sändning, fel kod, anonymiserat underlag, cache och låsning
node tests/browser-smoke.cjs         # Chromium: 3 000 mätare × 30 exporter, beslut, omladdning, desktop/mobil
node tests/download-browser.cjs      # Chromium: exakt exporturval över sidor, arbetslista, XLSX-granskning
node tests/legacy-browser.cjs        # Chromium: gammal profil, XLSX-datum, ett års historik
node tests/layout-browser.cjs        # Chromium: 1366–3440 px, mobil, storleksbyte, kompakt grafpanel
node tests/import-source-browser.cjs # Chromium: mappimport, ändrade infokoder, omladdning och full återställning
```

Webbläsartesterna kräver Playwright. `LEAKSOK_VENDOR=<mapp>` kan peka på lokala kopior av CDN-filerna vid körning utan nät.

Moduler: `parse.js` (import) → `history.js` (avläsningar) → `engine.js` (analys) → `app.js` (lista, urval, beslut), `chart.js`, `meter-view.js` (gemensamma statusfärger och sortering), `address-index.js` (lokal adressmatchning), `api/addresses.js` (offentligt adressunderlag), `map.js`, `worklist.js`, `field-export.js` + `xlsx-writer.js` (Excel), `storage.js` (IndexedDB), `styles.css`.


## Dolda grupper och registrerade läckfall

Efter mätare, Störning/tillfällig, Säsong och Ignorerade är dolda i arbetslistorna som standard. **Visa dolda grupper** visar valda grupper igen. **Fler listor → Dolda** samlar dessa och manuellt gömda mätare; grupperna har inga egna menyflikar. Högerklick visar Åk ut, Bevaka, Läcka och Lagad direkt; mindre vanliga beslut ligger under **Övriga beslut**. Markeringsrutan visar antal, Flytta till och Excel; Markera sidan/alla, arbetslista, göm och avmarkera ligger under **Mer**.

**Läcka** har datum konstaterad, AV (huvudledning), SV (servis) eller Vet ej, samt valfritt lagdatum. Lagdatum flyttar fallet till Lagade. När ett aktivt fall markeras Lagad bevaras läckdatum och ledningstyp. Vid ett nytt läckfall bevaras tidigare avslutade fall.

Lokal jämförelse använder mätares dagliga exportvärden före läckdatum, under läckan och efter lagdatum. Före/efter använder högst 14 dagar; lagdagen undantas eftersom den kan innehålla båda nivåerna. Minst tre avläsningsdagar utan luckor över tre dagar behövs i varje period, tillsammans med en tydlig ökning och återgång efter lagning. Exakta kartpunkter inom 250 m används för närliggande mätare. När jämförelseperioderna har tillräckligt med data matchas grannarna mot samma lokala adressregister. Adressnärhet på samma gata visas preliminärt, utan att påstå ett uppmätt avstånd eller lära ett grannmönster. Okänd ledningstyp, osäkert läckdatum, efter-mätare-/DRY-infokoder och tunt underlag ger ingen inlärning.

**Visa underlag** visar median, antal dagar och bedömning per mätare. En senare förhöjning under minst tre avläsningsdagar efter jämförelseperioden kan matchas mot samma mätares tidigare verifierade respons. En sådan match ger högst sex extra prioritetspoäng inom befintlig automatisk Misstänk/Åk ut; den ändrar inga manuella beslut och konstaterar aldrig en ny läcka. Närhet bevisar inte ledningskoppling; nivåerna har exportens enhet, inte dB. Underlaget sparas lokalt med profilen och räknas om när nya exporter eller kartpositioner tillkommer.




## Glest underlag och jämförelse med Kamstrup

En dagsexport med Senaste värde innehåller en aktuell ögonblicksbild, inte hela råkurvan i Kamstrup. Många dagsexporter av samma tidsstämpel skapar därför inte nya mätpunkter. Historiska värden som aldrig funnits i de importerade raderna kan inte återskapas genom interpolation eller flytt till exportdatum.

Glest utspridda liknande värden får inte beskrivas som kontinuerligt stabil nivå. Om en annars oförändrad jämförelseperiod har mindre än 60 % representerade avläsningsdagar eller ett intervall över 3 dagar mellan punkterna används **Glest underlag**, med tunt analysunderlag och rekommendation att kontrollera råkurvan i Kamstrup. De reglerna är egna försiktighetsregler för underlag, inte tillverkarens läckalgoritm. En säker uppgång behålls som signal; ett glest baslinjeunderlag ger inte automatisk Åk ut. Manuella beslut och Kamstrups aktuella rang behåller företräde.

Grafen anger antal importerade avläsningsdagar och antal kalenderdagar i den valda perioden. Grå områden heter ”saknas i importen”. Medianen är tydligt märkt som en beräkning och löper inte genom dataluckor. Detsamma gäller minigrafen. **Visa importspårning** i detaljvyn redovisar exportrader, återexporter, saknade/odaterade rader, konflikter samt de högst 30 senaste avläsningsdagarnas värden och första/senaste export. Excel-underlaget använder samma osäkra bedömning.

Ett anonymiserat regressionsexempel återskapar 306 dagsexporter med endast 9 olika avläsningsdagar och median 384. Det ger Glest underlag, behåller senaste värdet 394 och de faktiska datumen, och skapar inga mätpunkter för luckorna. Ett separat webbläsartest kontrollerar status, graf, importspårning och mobilvisning (`node tests/sparse-history-browser.cjs`). Detta bevisar inte att användarens nuvarande fullständiga Excel-arkiv har granskats; bara en äldre exempelfil fanns tillgänglig vid felsökningen.
