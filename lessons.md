# Lessons

- puppeteer-core `launch()` fails with Edge here (exits with code 0); use `tools/edge.mjs` (spawn with `--headless=new --remote-debugging-port` + `puppeteer.connect`).
- Never use `waitUntil: 'networkidle0'` on pages with an SSE stream; it never settles. Use `domcontentloaded` plus a sleep.
- Long heredocs with quotes break in this shell; write files with the Write tool.
- RTDB rules: a granted `.write` on an ancestor cascades down and cannot be revoked by children, so only grant on narrow paths. In atomic multi-path updates `root` is the OLD state; use `newData.parent()...` to look at the new state.
- RTDB rules cannot iterate, so "one claim per phone" needs the reverse index `members/{uid}`.
- `Math.max(0, -rem)` avoids a `-0` in status().
- Every behaviour change in `dev-server.mjs` must also be made in `scripts/gen-rules.mjs` (and the other way round); `test/parity.test.js` catches drift.

- Headless test browsers MUST run with `--mute-audio` (the alarm beeps play out loud on the host) and always close in a `finally`.
- localStorage is shared between pages of one browser context: a test page for uid A overwrites the stored secret of uid B. Pass `devsecret` explicitly in tests.
- iOS Safari tab and the home-screen app have separate storage: never let people join/claim in the Safari tab (install screen first).
- Rules: `update(ref(db), ...)` for multi-path writes; `ref(db, '')` throws in SDK v12.
- Toasts must never sit over sheet buttons: `pointer-events:none` on the toast, move it to the top while a sheet is open.
- 'gone' alarms (state changed elsewhere) must never write the seen map; seen is keyed by `doseId:t`.
- Max per friend is a SOFT rule by product decision: the UI warns ("Toch toevoegen?"), neither rules nor dev server enforce it. Do not flag this as a bug.
- Rules only allow deleting claims/members that exist: build multi-path deletes from the current snapshot, never blindly (removing an unclaimed friend failed on real Firebase).
- Falsy trap: code order 0 (main code) is falsy; test `=== undefined`, not `!value`.
- Windows worktrees check files out with CRLF: patch scripts must normalise line endings.
