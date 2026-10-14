# SchoolLaunch

Financial planning for charter school founders. A founder models staffing, revenue,
operations and five-year projections, and gets advisory analysis against the Washington State
Charter School Commission's Financial Performance Framework (other pathways use generic
benchmarks).

Live at [schoollaunch.vercel.app](https://schoollaunch.vercel.app).

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- Supabase: Postgres with row-level security, Auth, Storage
- Anthropic API for the advisory panel, Ask SchoolLaunch, Alignment Review and the narrative
  PDF (one model constant: `AI_MODEL` in `src/lib/anthropic-client.ts`)
- Deployed on Vercel

## Run it locally

```bash
npm ci
npm run dev
```

Create a git-ignored `.env.local` first:

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything (the Supabase project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything (the project's public anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | server routes that bypass RLS (signup, team and invitations, seeding, scenarios) |
| `ANTHROPIC_API_KEY` | AI features (they show an error without it) |
| `NEXT_PUBLIC_APP_URL` | links in invitation emails |

## Checks

| Command | What it does |
|---|---|
| `npx tsc --noEmit -p .` | typecheck the app |
| `npx tsc --noEmit -p tsconfig.test.json` | typecheck the tests |
| `npx eslint .` | lint (expected clean) |
| `npx playwright test 'tests/session4/[^/]+\.spec\.ts'` | offline suite: engine, thresholds, hashing, helpers; no browser or network |

CI (`.github/workflows/ci.yml`) runs all four on every pull request.

Other suites sign in to **production** and must not be run casually: `tests/session1`,
`tests/session4/e2e`, `tests/e2e-overnight` (writes to a test school) and the read-only
browser harness in `tests/live/` (see its README). Never run a bare `npx playwright test`.

After changing an engine file (listed in `scripts/gen-engine-version.cjs`), run
`node scripts/gen-engine-version.cjs`; a spec fails while `src/lib/engineVersion.ts` is stale.

## Where things are

- `src/lib/budgetEngine.ts`, `calculations.ts`: the financial engine (one run per school,
  shared through `src/lib/ScenarioContext.tsx`)
- `src/lib/healthThresholds.ts`: every band, verdict and status color
- `src/app/(authenticated)/dashboard/*`: the dashboard tabs
- `src/app/api/*`: API routes (auth via `src/lib/apiAuth.ts`)
- `supabase/migrations/`: database migrations
- `CLAUDE.md`: architecture notes · `ROADMAP.md`: the phased plan · `BACKLOG.md`: known issues
