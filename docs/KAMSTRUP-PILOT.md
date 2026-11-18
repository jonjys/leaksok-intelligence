# LeakSök – pilot som komplement till Leak Detector

Värdet att prova är ett tydligt arbetsflöde från exporterad signal till en motiverad kontroll och ett registrerat fältutfall. Detta är ett fristående komplement, inte en officiell Kamstrup-integration eller ett bevis på kommersiell färdighet.

## Implementerat

- Dagliga Excel-importer med avläsningsdatum, deduplicering, datakvalitet och egen historik.
- Relativa förändringar mot egen nivå, historiska årstidsmönster och separata kundsidans LEAK/BURST-kontroller.
- Adresskarta och lokalt markerade fall över filter och flikar.
- Serverberäknade belägg från samma regelmotor, med månadsvärden, tidigare år och registrerade läck-/lagdatum.
- Claude som tolkningsstöd för en mätare eller en prioriterad kortlista på högst 24 fall, med validerade beläggshänvisningar och kontrollordning.
- Minne mellan dagar i den dagliga planen: plats i föregående plan och beslut som registrerats sedan dess följer med per fall-ID, utan adresser, serienummer eller kommentarer. Föregående plan läses från enhetens egen dagjournal.
- Export av kontrollplan med osäkerheter, tidsstämpel, modell, analysversion och fingeravtryck. Spara arbetsytans säkerhetskopia tillsammans med rapporten för reproduktion.

## Fältpilot och acceptans

1. Frys importurval, regelversion, modell och promptversion innan bedömningen. Registrera vilka datum/data som faktiskt finns.
2. Granska avidentifierade kända fall och separata nya fall. Inbyggda exempel och fall som användes för att ställa in regler ska inte räknas som oberoende testfall.
3. Kontrollera särskilt låg egen nivå som stiger (till exempel 8 till 14, +75 %), hög oförändrad nivå, start/stopp av värme, avvikelse från föregående års säsong, dataluckor och synkrona områdesförändringar.
4. Fältpersonal registrerar utfall, konstaterad/lagad tid, osäkra datum och AV/SV. Logga även falsklarm, oavgjorda fall, uteblivna kontroller och drift-/spolningsorsaker.
5. Jämför ordinarie arbetsmetod med kompletterande kontrollplan: granskningstid, genomförda kontroller, bekräftade fynd per kontroll och missade fynd när en tillräcklig referens finns. Redovisa nämnare och okända utfall. Ingen träffsäkerhet eller vattenbesparing ska påstås utan uppmätt underlag.

## Fortfarande inte verifierat eller byggt för kommersiell fleranvändardrift

- Oberoende precision/återkallning, tidsvinst, besparing och leverantörsnytta.
- Direkt READy-/Leak Detector-API och licens-/distributionsavtal. Nu används egna exporter.
- Organisationer, användarkonton, roller, beständig revisionslogg och central lagring.
- Gemensam distribuerad kvot/kostnadsbudget. Nu finns en serverkod, anropsgränser per instans och rekommenderat Anthropic-utgiftstak.
- Automatisk ledningskoppling eller lokalisering på huvudledning. Kartpunkter är adresser; geografisk närhet är inte topologi.

## Tillverkarunderlag

Kamstrups *Leak Detector noise curve assessment*, FILE100004503_A_EN_08.2024, beskriver kvalitativa mönster, värme-/pumpstörning samt kontroll av spolning och kundsidans installation. Appens numeriska trösklar är egna regler. Brusvärden utan exporterad fysisk enhet ska inte märkas som dB eller räknas om till läckflöde.

https://kamstrup-delivery.sitecorecontenthub.cloud/api/public/content/61955-downloadOriginal?v=21d57698
