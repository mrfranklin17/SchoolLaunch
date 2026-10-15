# E2E against a local stack (T-INFRA-01)

The session4 e2e specs (`tests/session4/e2e/`) and the overnight harness (`tests/e2e-overnight/`)
sign up accounts, edit Spokane Arts and test-columbia, and call the AI routes. They are meant to
run against a local Supabase stack with stubbed AI, not production.

## Guard

`tests/e2e-target.ts` treats a run as production when `NEXT_PUBLIC_SUPABASE_URL` is the
production project (`nlvlrznhiwuorxlapnej`) or `PLAYWRIGHT_BASE_URL` is `schoollaunch.vercel.app`.
Against production both suites refuse to start unless the run sets `E2E_ALLOW_PRODUCTION=1`:

```bash
E2E_ALLOW_PRODUCTION=1 PLAYWRIGHT_BASE_URL=https://schoollaunch.vercel.app \
  npx playwright test tests/session4/e2e/full-founder-journey.spec.ts
```

## AI stub

With `AI_STUB=1`, `next dev` answers every AI call (`callAnthropic` / `streamAnthropic` in
`src/lib/anthropic-client.ts`) with a canned reply from `src/lib/aiStub.ts` and never calls the
API. Structured replies follow the request's JSON schema; text replies are a fixed paragraph
marked "[AI stub]". The stub cannot switch on in a production build (`NODE_ENV=production`,
which covers every Vercel deployment). The founder journey passes with it, AI phases included.

```bash
AI_STUB=1 npx next dev -p 3100
E2E_ALLOW_PRODUCTION=1 PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/session4/e2e/full-founder-journey.spec.ts
```

(`E2E_ALLOW_PRODUCTION=1` is still needed there while `next dev` points at the production
database; the local stack below removes it.)

## Local Supabase stack (next step)

Docker and the Supabase CLI (`npx supabase`) both run in the cloud environment. What's missing
is the schema: most of production's tables, RLS policies, SECURITY DEFINER functions and the
signup trigger were created in the dashboard, so `supabase/migrations/` can't rebuild the
database on its own. The plan, once `SUPABASE_DB_URL` (the Session pooler connection string) is
set as an environment secret:

1. Take a schema-only dump of production (`public`, plus the auth trigger and storage policies)
   into the repo, e.g. `npx supabase db dump --db-url "$SUPABASE_DB_URL" -f supabase/e2e/schema.sql`.
   The connection string is used for this dump only.
2. `npx supabase start` (with `dockerd` started first if it isn't running), load the dump,
   then seed the fixture accounts the specs log in as (Spokane Arts, test-columbia).
3. Run `next dev` with `AI_STUB=1` and the local stack's URL and keys, and the e2e suites with
   `PLAYWRIGHT_BASE_URL` pointing at it. No `E2E_ALLOW_PRODUCTION` needed.
