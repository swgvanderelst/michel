# De Michel

Web-app (geen build, geen framework) om per feestje bij te houden wie wat nam en wanneer er bijgepakt mag worden.
Vanilla ES modules; backend is Firebase Realtime Database, lokaal een dev-server zonder dependencies.
In de app heet de admin van een feestje **De Michel**.

## Lokaal draaien
```bash
npm install                 # alleen puppeteer-core (voor tools/)
npm run dev                 # http://localhost:8787
MICHEL_SEED=1 npm run dev   # met het feestje AWAKENINGS ADE 2026 (met een gegenereerde uitnodigingslink, die de server bij het starten print; vrienden Sanne, Joris, Fem, Daan, Bart)
```
- Op `localhost` / `127.0.0.1` gebruikt de app altijd de dev-server en raakt de echte database nooit; `?prod=1` forceert Firebase.
- De dev-server bewaart data in `.devdata.json` (gitignored); `DEV_PERSIST=0` zet dat uit. `MICHEL_CREATORS=uid1,uid2` dwingt de creators-lijst af (zonder: iedereen mag feestjes maken).
- De testhook `?devuid=` en het vaste `dev-admin-secret` werken alleen op localhost; op andere hosts gebruikt de app altijd Firebase.
- Elke browser is een eigen "telefoon": `POST /api/session` geeft een uid + geheim (in localStorage). Testhook: `?devuid=dev-admin` (het seed-feestje is van `dev-admin`, geheim `dev-admin-secret`).
- `?safe` achter de URL simuleert de iPhone-safe-areas (voor screenshots in een desktopbrowser).

## Tests
```bash
npm test                                      # logic, dev-server, sw en rules (parity + aanvallen)
node --test --experimental-test-coverage      # met coverage
node tools/smoke.mjs                          # browsertest (Edge), lokaal
node tools/shots.mjs <map>                    # screenshots van alle schermen
MICHEL_LINK='https://…/?p=TOKEN' node tools/firebase-smoke.mjs # tegen de ECHTE Firebase, pas draaien als de rules staan
```
`test/parity.test.js` draait dezelfde scenario's tegen de dev-server en tegen `database.rules.json`
(via de mini rules-evaluator in `test/rules-eval.js`) en eist identieke toe-/afwijzingen.

## Overstappen op Firebase
1. Firebase-project met **Realtime Database** (europe-west1) en **Authentication > Anonymous** aan. De config staat al in `firebase-config.js`.
2. Plak `database.rules.json` in de console (Realtime Database > Rules) en publiceer.
   (Het bestand wordt gegenereerd door `node scripts/gen-rules.mjs`; pas dat script aan, niet het JSON-bestand.)
3. **Wie feestjes mag maken:** zet in de console `creators/<uid>: true`. Het uid staat in de app onder OPTIES > "Jouw telefoon-ID" (en klein op het startscherm). Clients kunnen `creators` niet lezen of schrijven.
4. Zet de map op GitHub Pages (of elke statische host). De SDK komt van `https://www.gstatic.com/firebasejs/12.0.0/`; `sw.js` zet de app, de fonts en de SDK in de offline cache (alleen op https, niet op localhost). Verhoog `VERSION` in `sw.js` bij elke release.

## Meedoen
Geen pincodes: iedereen komt binnen met de **link** of door de **QR** op de telefoon van De Michel te scannen (DELEN). De uitnodiging is een lange willekeurige code (12 tekens) in de link; niemand typt hem. De Michel kan in OPTIES een **nieuwe link maken** (de oude link en QR werken dan niet meer) en bij afsluiten de link ook uitschakelen. Wie de link kwijt is, tikt op **Plak link** (leest het klembord).

## Meedoen en installeren (iPhone)
De link of QR zet je meteen in het feestje, in elke browser. Wat je daarna ziet:
- **Safari op de iPhone (tabblad):** je kijkt mee (titel, crew, TOP, LOG) maar kiest nog geen naam. Een grote stapkaart zegt: **Stap 1** zet De Michel op je beginscherm (Deel, Zet op beginscherm, Voeg toe). **Stap 2** open De Michel vanaf je beginscherm en voeg je naam toe. Een app op het beginscherm heeft op iOS aparte opslag, daarom wordt de naam pas daar gekozen (zo ontstaat geen "Bezet" door een Safari-sessie).
- **De app op het beginscherm:** opent direct in het feestje (op iOS is er bewust geen manifest, dus de link met `?p=` blijft het startadres), neemt je op en toont **Wie ben jij?** met bovenaan **+ Mijn naam toevoegen**; bestaande vrije namen staan eronder. Komt de app toch zonder feestje open, tik dan op **Plak link**.
- **Android, desktop of iOS in de app:** direct meedoen en **Wie ben jij?**; een installatiebanner is niet blokkerend.
Staat je naam als **Bezet** (nieuw toestel), vraag De Michel om hem vrij te geven (Opties > Gekozen namen).

## Spelregels
**Hoe werkt het**
- Iedereen kiest zijn eigen naam. Tik op de grote + om bij te pakken: kies 1, ½ of ¼, en de tijd (nu of eerder).
- Na een hele gaat na 2 uur het alarm af, na een halve na 1,5 uur, na een kwart na 1 uur: INKAKKEN IS BIJPAKKEN!
- Alarm werkt alleen met De Michel open.
- Je plan blijft binnen je max en stopt op je laatste moment. (Mijn plan: alleen op je eigen telefoon, nooit gesynct; het rekent met je echte snoepjes en de wachttijden en geeft geen extra alarm.)
- De Michel krijgt ieders alarm, de rest alleen hun eigen.
- Max bereikt? Dan geen alarm meer.
- TOP = wie heeft het meest, LOG = wie nam wat wanneer.

**Wie kan wat**
- Iedereen voegt zichzelf toe via de link. Iedereen: meedoen via de link of QR van De Michel, eigen naam kiezen of toevoegen, eigen snoepjes toevoegen en tijden aanpassen, alles bekijken.
- (M) De Michel: feestjes aanmaken en afsluiten, vrienden toevoegen en verwijderen, max instellen, de uitnodigingslink vernieuwen, namen vrijgeven.

**Installeren (iPhone)**
- Stap 1: tik in Safari op Deel, kies Zet op beginscherm en tik op Voeg toe.
- Stap 2: open De Michel vanaf je beginscherm (die opent meteen in dit feestje) en voeg daar je naam toe. In Safari kijk je alleen mee.

## Opstartscherm
De splash (geel/zwart foto, voortgangsbalk) staat minimaal 3 s in beeld en blijft tot de eerste data binnen is, maximaal 5 s; daarna 200 ms fade. Alleen bij een koude start, niet bij terugkeren uit de achtergrond.

## Assets opnieuw maken
- `node tools/make-icons.mjs`: iconen en opstartschermen (Edge + Anton).
- `node tools/make-splash.mjs`: `assets/splash.jpg` (geel/zwart duotone) uit `assets/splash-source.*`. De kleurenoriginal staat in `.gitignore`.
- `vendor/qrcode.js`: qrcode-generator 1.4.4 (MIT), ongewijzigd uit npm.
