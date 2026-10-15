import { defineConfig } from '@playwright/test'

/**
 * The advisor eval (AI-EXP-01 step 3): real AI calls, run on demand only. Not matched by the
 * default config or CI (its file is *.eval.ts). See tests/evals/README.md.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /\.eval\.ts$/,
  globalSetup: './evalSetup.ts',
  fullyParallel: true,
  workers: 5,
  retries: 0,
  // Eight model calls per case per run; the briefing alone may take two minutes.
  timeout: 15 * 60_000,
  reporter: 'list',
})
