# LeakSök Intelligence

Morgonverktyg för Kamstrup Leak Detector-exporter: importera senaste 24-timmarsexporten, se vad som förändrats, varför det är relevant och vilka mätare som ska kontrolleras, och ta med en arbetslista i Excel ut i fält.

Allt körs lokalt i webbläsaren. Historik, beslut och kommentarer sparas i webbläsarens IndexedDB på den här enheten (namn + kod låser profilen). Inga mätardata skickas till någon språkmodell eller ny extern tjänst. Kartan slår upp adresser i OpenStreetMap Nominatim (enbart exakta husnummerträffar, cachas lokalt); saknas träff visas ingen position.

## Morgonflöde

1. **＋ Importera Excel** – en eller flera `.xlsx/.xls/.csv`. Tidigare historik behålls; samma fil två gånger räknas som dubblett.
2. **Morgonöversikten** visar senaste exportens tid, hur många som lästs av senaste dygnet och dagens nya signaler.
3. Listorna: **Nytt i dag**, **Åk ut**, **Misstänk** (automatisk upptäckt), **Bevaka** (din manuella lista), **Efter mätare**, **Aktiva läckor**, **Lagade** och under *Fler listor* Stabilt hög, Störning/tillfällig, Säsong, Kort historik, Utan färsk avläsning, Ignorerade och Gömda.
4. Klicka på en adress: graf och karta visas bredvid varandra (under varandra på telefon). **Visa underlag** fäller ut observation, möjlig förklaring, rekommenderad åtgärd, jämförelser med perioder, datakvalitet och prioritetens delar.
5. **Flytta till…** finns på ett ställe: markeringsraden, ⋯ på raden, högerklick eller långtryck. Konstaterad läcka (datum, osäkert datum) och Lagad (datum, AV/SV, ungefärligt avstånd, kommentar) öppnar formulär. Allt kan ångras direkt.
6. Markera mätare (kryssrutor gäller över sidor och filter) → **Excel (N)** eller **Lägg i arbetslista**. **Markera sidan** och **Markera alla N träffar** gäller uttryckligen aktuell sida respektive hela det filtrerade urvalet. Exporten visar antal innan nedladdning och tar aldrig med alla mätare automatiskt.

## Analysregler (src/engine.js)

- **Värden** är exportens brusvärde (Kamstrup: dagens lägsta filtrerade värde; ingen enhet anges). Procent är procent av exportvärdet – inte förändring av ljudintensitet.
- **Avläsningar, inte exporter**: kurvan byggs på avläsningsdatum. Samma avläsning i flera exporter räknas en gång. Importordning och överlappande filer påverkar inte resultatet.
- **Sedan föregående avläsning**: `(nytt / tidigare) − 1` och `nytt − tidigare`. **Mot jämförelsenivå**: mätarens egen median före fyndet, alltid med period och antal avläsningar. **P = E/F − 1** från samma rad i senaste exporten (E = Senaste värde, F = Genomsnittsvärde, G = Maxvärde); används bara som stöd när egen historik saknas. Tidigare värde 0 ger ingen procent; saknat värde är inte 0.
- **Normal variation** per mätare = robust spridning av dag-till-dag-skillnader. En förändring måste överstiga `max(2, 3 × variationen, 25 % av nivån)`.
- **Ny signal**: en avläsning utanför normal variation – ännu oklart; kontrollera nästa. **Ny nivå**: minst två avläsningar på samma sida; återgång inom fyra avläsningar gör den till **tillfällig topp** (bara när återgången faktiskt observerats). Bestående först efter ≥ 5 avläsningar under ≥ 5 dagar. **Gradvis ökning**: Theil–Sen-trend över 60 dagar.
- En höjd nivå ligger kvar som jämförelse och absorberas inte i baslinjen; **Nollställ** anger tidpunkten från vilken nya avläsningar bedöms.
- **Luckor** (> 3 dagar) är saknat underlag, aldrig observerad beständighet. Avläsning ≥ 2 dagar gammal märks; ≥ 14 dagar → *Utan färsk avläsning* (orsak okänd – saknad export bevisar inte förlorad kontakt).
- **Stabilt hög** (≥ 50 utan förändring) skiljs från ny ökning. Mätare med återkommande kortvariga toppar bedöms mot sitt eget toppmönster.
- **Säsong**: verifierat först efter minst två växlingar vinter/sommar; en vinter + en sommar = möjligt mönster. Känd störning (fjärrvärme/undercentral, manuella Säsong/Störning) dämpar men tystar inte en tydlig ny avvikelse.
- **Grannar**: samtidig ökning på samma adress/gata visas som möjlig gemensam påverkan – inte som läckans plats. Avstånd bara när båda har exakt kartposition.
- **Infokoder (flowIQ, verifierat mot Kamstrups datablad)**: LEAK = vattnet har inte stått still en sammanhängande timme senaste dygnet → Efter mätare; BURST = högt flöde i 30 min; DRY = mätaren inte vattenfylld (inte kommunikationsfel); REVERSE/TAMPER är datakvalitet, inte läcksignal. Leak Detector-händelsen *Läckage* anger inte om läckan är före eller efter mätaren.
- **Prioritet 0–100** är en regelbaserad rangordning (storlek, belägg/varaktighet, aktualitet, nivå, infokoder, störning, säsong, grannar). Samma händelse räknas en gång. Det är inte en sannolikhet för läcka.
- **Manuella beslut**: Konstaterad läcka och Lagad sätts bara manuellt; automatiken markerar aldrig lagat för att värdet sjunker. En ny ökning efter lagning visas i Misstänk. Gömda försvinner från listorna men kan återställas.

## Excel-arbetslista (src/field-export.js, src/xlsx-writer.js)

- **Arbetslista**: Adress, Serienummer (text), Status, Senast avläst, Senaste värde, Förändring sedan föregående (värde och %), Huvudorsak, Rekommenderad kontroll, Kommentar, Utförd (Ej utförd/Klar, raden blir grön). Excel-tabell med filter, fryst rubrik, liggande utskrift en sida bred.
- **Analysunderlag**: samma mätare med jämförelsedatum, referensvärden, absoluta och procentuella förändringar, jämförelseperiod och definition, antal avläsningar, varaktighet, E/F/G/P, infokoder, datakvalitet och full motivering.
- **Definitioner**: förklaring av alla mått.
- All text skrivs som text (formelliknande värden skyddas), datum som riktiga datum och procent som tal.

## Begränsningar

- Originalexporter från kommunen finns inte i repot. Tester använder syntetiska data (`tests/fixtures/synthetic-exports.js`) med de feltyper som ska hanteras. Kör egna filer lokalt: `node tests/exports-regression.js exports/*.csv`.
- Säsongsbedömning kräver minst ett års historik i appen. Historiklängd i appen är inte mätarens installationsålder.
- Lagring är lokal per webbläsare; använd *Info → Säkerhetskopia av beslut* regelbundet.

## Utveckling och verifiering

Statisk app utan byggsteg: öppna `index.html` via en statisk server (`python3 -m http.server 4173`).

```bash
node --test tests/*.test.js          # motor, import, Excel, grafer, lagring (kör i flera tidszoner i CI)
node tests/browser-smoke.cjs         # Chromium: 3 000 mätare × 30 exporter, beslut, omladdning, desktop/mobil
node tests/download-browser.cjs      # Chromium: exakt exporturval över sidor, arbetslista, XLSX-granskning
```

Webbläsartesterna kräver Playwright. `LEAKSOK_VENDOR=<mapp>` kan peka på lokala kopior av CDN-filerna vid körning utan nät.

Moduler: `parse.js` (import) → `history.js` (avläsningar) → `engine.js` (analys) → `app.js` (lista, urval, beslut), `chart.js`, `map.js`, `worklist.js`, `field-export.js` + `xlsx-writer.js` (Excel), `storage.js` (IndexedDB), `styles.css`.
