import { test, expect } from '@playwright/test'
import { ENGINE_VERSION } from '../../src/lib/engineVersion'
import { computeEngineVersion } from '../../scripts/gen-engine-version.cjs'

/**
 * The committed src/lib/engineVersion.ts must match the engine files it hashes. Vercel
 * regenerates it in `prebuild`, but `next dev` and the tests read the committed file, so a
 * stale token makes local dev and production compute different advisory/scenario hashes
 * against the one shared Supabase project.
 *
 * Fix a failure with `node scripts/gen-engine-version.cjs` from the repo root, then commit
 * src/lib/engineVersion.ts.
 *
 * Run: npx playwright test tests/session4/engine-version-current.spec.ts
 */
test('committed ENGINE_VERSION matches the current engine files', () => {
  expect(ENGINE_VERSION).toBe(computeEngineVersion())
})
