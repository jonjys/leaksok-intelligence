# Utrymme för Claudes svar (max_tokens)

Gäller `api/ai-review.js`, funktionen `maxTokens()`. Kontrollerat mot Anthropics dokumentation 2026-11-16.

## Vad dokumentationen säger

- `max_tokens` är ett hårt tak för tänkande och svarstext tillsammans. Tänkandet räknas även när det inte visas.
- `effort` är en mjuk styrning, inget tokentak. Även på `low` kan modellen tänka på svåra underlag.
- Claude Sonnet 5.5 tänker adaptivt som standard, kan inte stängas av med `disabled`, och har 128 000 som högsta utdata.
- Vid `stop_reason: max_tokens` kan JSON-svaret vara ofullständigt. LeakSök kastar då hela planen, men anropet är betalt.
- Anthropic anger inget rekommenderat tal. Rådet är att ge rum för både tänkande och svar, och höja taket om svar kapas.

## Uträkning för den dagliga planen (24 fall)

Ett syntetiskt fall som följer promptens regler mättes i JSON:

| Fall | Tecken | Token vid 2,5 tecken/token | Token vid 2,0 tecken/token |
|---|---|---|---|
| Typiskt (39 ord, 1 hypotes, 1 kontroll) | 830 | 332 | 415 |
| Ordrikt (50 ord, 1 hypotes, 3 kontroller) | 1 182 | 473 | 591 |

Planens gemensamma del (sammanfattning, ordning, gemensamma kontroller) är cirka 1 400 tecken, 560 till 700 token.
Tecken per token för svensk JSON är en uppskattning, inte uppmätt mot modellens tokeniserare. Därför räknas båda.

| | Typiskt svar | Ordrikt svar |
|---|---|---|
| Svar, 24 fall | 8 500 till 10 700 | 11 900 till 14 900 |
| Gammalt tak 3 200 + 24 × 350 = 11 600: kvar till tänkande | 900 till 3 100 | inget, svaret kapas |
| Nytt tak 6 000 + 24 × 625 = 21 000: kvar till tänkande | 10 300 till 12 500 | 6 100 till 9 100 |

Det nya taket ger alltså minst cirka 6 000 token till tänkande även i det sämsta räknade fallet.
Taket 21 000 ligger under de 21 333 där Anthropics SDK kräver strömning.

Detaljerad granskning (version 2, högst 8 fall, `medium`): 5 000 + 2 000 per fall, högst 21 000.

## Kostnad och tid

- Taket är ingen kostnad i sig. Bara token som faktiskt skrivs debiteras. Ett svar som tidigare kapades och kastades blir nu ett användbart svar.
- Ett längre svar tar längre tid. Tidsgränsen mot Anthropic är höjd från 90 till 140 sekunder och funktionens `maxDuration` från 120 till 150. Appen väntar redan 150 sekunder.
- Modellens hastighet är inte uppmätt. Loggraden `ai-review-complete` visar nu antal fall, tak, utdata, tänkande och sekunder. Den innehåller inga mätvärden. Läs den efter första riktiga körningen och justera `BUDGET` om tänkandet ligger nära marginalen.
