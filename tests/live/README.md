# Read-only live tests (production)

`harness.cjs` drives headless Chromium against https://schoollaunch.vercel.app to check a
deployed change in a real browser, without changing any data.

- **The guard:** `newSession()` aborts every Supabase REST/storage write and every non-GET
  `/api` call unless the script lists it in `allowApi` or `stubs`, and records each attempt in
  `log.blockedWrites`. An unexpected entry there is a finding (a page writing on load).
- **AI calls:** stub `/api/advisory`, `/api/chat` etc. with `stubs` rather than allowing them.
- **API checks:** use `apiFetch(page, …)`, which fetches from inside the page so the guard and
  the proxy apply. Playwright's `context.request` bypasses both.
- **Credentials:** read at runtime from `tests/session1/fixtures.ts` (`readAccounts()`). Never
  print them, and never print raw Playwright errors (their call logs include auth cookies);
  use `errLine(e)`.
- **Proof of deploy:** `servedBuildContains(page, log, ['<string only the new code has>'])`.
- **Data check:** before and after a run, hash the rows the test touches (Supabase MCP,
  read-only SQL) and compare.

Scripts are plain CommonJS run with `node` (not `npx playwright test`):

```js
const h = require('./tests/live/harness.cjs')
const { browser, page, log } = await h.newSession({ allowApi: ['/api/staffing/seed'] })
await h.login(page, 'spokaneArts')          // spokaneArts | columbiaValley | eswaOrgAdmin
await page.goto('/dashboard/cashflow'); await h.settle(page)
console.log(h.summarize(log)); await browser.close()
```

Screenshots go to `h.outDir('<area>')` (outside the repo). Cloud sessions need full network
access (or Supabase, Vercel and Google Fonts hosts allowed).
