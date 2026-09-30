# LeakSök Intelligence

Morgonverktyg för Kamstrup Leak Detector-exporter: importera senaste 24-timmarsexporten, se vad som förändrats, varför det är relevant och vilka mätare som ska kontrolleras, och ta med en arbetslista i Excel ut i fält.

Allt körs lokalt i webbläsaren. Historik, beslut och kommentarer sparas i webbläsarens IndexedDB på den här enheten (namn + kod låser profilen). Inga mätardata skickas till någon språkmodell eller ny extern tjänst. Kartan slår upp adresser i OpenStreetMap Nominatim (enbart exakta husnummerträffar, cachas lokalt); saknas träff visas ingen position.

## Morgonflöde

1. **＋ Importera Excel** – en eller flera `.xlsx/.xls/.csv`. Tidigare historik behålls; samma fil två gånger räknas som dubblett.
2. **Morgonöversikten** visar senaste exportens tid, hur många som lästs av senaste dygnet och dagens nya signaler.
3. Listorna: **Nytt i dag**, **Åk ut**, **Misstänk** (automatisk upptäckt), **Bevaka** (din manuella lista), **Efter mätare**, **Aktiva läckor**, **Lagade** och under *Fler listor* Stabilt hög, Störning/tillfällig, Säsong, Kort historik, Utan färsk avläsning, Ignorerade och Gömda.
4. Klicka på en adress: graf och karta visas bredvid varandra (under varandra på telefon). Avdelaren mellan dem kan dras (eller flyttas med piltangenterna) och fördelningen sparas på enheten. Arbetsytan fyller hela fönstret: på bred skärm får adress, motivering och 60-dagarsgraf mer plats och raderna blir tätare, utan att text förstoras. **Visa underlag** fäller ut observation, möjlig förklaring, rekommenderad åtgärd, jämförelser med perioder, datakvalitet och prioritetens delar.
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

- Varje mätare behöver minst tre tidigare avläsningsdagar. Ökningen ska vara minst 2 värdeenheter, 25 % och två gånger uppskattad variation. Baslinjen är medianen av upp till 14 föregående avläsningsdagar. Procent avser exportvärdet, inte akustisk energi eller läckflöde.
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

- Originalexporter från kommunen finns inte i repot. Tester använder syntetiska och anonymiserade data. Kör egna filer lokalt: `node tests/exports-regression.js exports/*.csv`.
- Tröskelvärdena (25 %, 50 % för enskild avläsning, 50 för stabilt hög, 5 avläsningar/5 dagar för Åk ut) är hypoteser. De kan bara kalibreras mot fältfacit: registrera Konstaterad läcka och Lagad för att bygga det underlaget.
- Säsongsbedömning kräver minst ett års historik i appen. Historiklängd i appen är inte mätarens installationsålder.
- Lagring är lokal per webbläsare; använd *Info → Säkerhetskopia av beslut* regelbundet.

## Utveckling och verifiering

Statisk app utan byggsteg: öppna `index.html` via en statisk server (`python3 -m http.server 4173`).

```bash
node --test tests/*.test.js          # motor, import, Excel, grafer, lagring (kör i flera tidszoner i CI)
node tests/browser-smoke.cjs         # Chromium: 3 000 mätare × 30 exporter, beslut, omladdning, desktop/mobil
node tests/download-browser.cjs      # Chromium: exakt exporturval över sidor, arbetslista, XLSX-granskning
node tests/legacy-browser.cjs        # Chromium: gammal profil, XLSX-datum, ett års historik
node tests/layout-browser.cjs        # Chromium: 1366–3440 px, mobil, storleksbyte, dragbar avdelare
```

Webbläsartesterna kräver Playwright. `LEAKSOK_VENDOR=<mapp>` kan peka på lokala kopior av CDN-filerna vid körning utan nät.

Moduler: `parse.js` (import) → `history.js` (avläsningar) → `engine.js` (analys) → `app.js` (lista, urval, beslut), `chart.js`, `map.js`, `worklist.js`, `field-export.js` + `xlsx-writer.js` (Excel), `storage.js` (IndexedDB), `styles.css`.
