import { test, expect } from '@playwright/test'
import { SEED_POSITIONS, WA_SEED_POSITION_TYPES, waSeedSalary } from '../../src/lib/staffingDefaults'
import { getCommissionPosition } from '../../src/lib/types'

/**
 * R-REV-05 guardrail - WA Charter default salary single source of truth.
 *
 * Pins the cross-path invariant: for each WA Charter seeded position, the salary
 * resolved by every code path is identical and equals the COMMISSION_POSITIONS
 * (OSPI/BLS WA) catalog value:
 *   - onboarding seed: buildWaOnboardingSeed (staffingDefaults, used by StepStaffing) consumes waSeedSalary()
 *   - staffing/seed fallback route: SEED_POSITIONS (salary + benchmarkSalary)
 *   - dashboard add-position: staffing/page.tsx reads getCommissionPosition(type).salary
 *
 * The pinned catalog values guard against silent drift in either direction
 * (the prior bug was seed salaries ~25-40% BELOW these). Run with:
 *   npx playwright test tests/session4/staffing-salary-defaults.spec.ts
 */

// Catalog (COMMISSION_POSITIONS) values as of R-REV-05. Zero new numbers were
// introduced by the fix - these are the existing OSPI/BLS WA benchmarks that the
// seed paths now adopt instead of their old below-market literals.
const EXPECTED_CATALOG_SALARY: Record<string, number> = {
  ceo_director: 164800,
  principal: 123600,
  teacher_elem: 80340,
  teacher_ms: 82400,
  teacher_hs: 84460,
  sped_teacher: 87550,
  office_mgr: 56650,
  paraeducator: 41200,
}

// The old below-market onboarding/seed defaults R-REV-05 removed. No seeded
// salary may equal these again (regression guard).
const OLD_BELOW_MARKET: Record<string, number> = {
  ceo_director: 120000,
  principal: 95000,
  teacher_elem: 58000,
  teacher_ms: 62000,
  sped_teacher: 62000,
  office_mgr: 52000,
  paraeducator: 38000,
}

test.describe('R-REV-05 - WA Charter salary defaults single source of truth', () => {
  test('catalog carries the expected OSPI/BLS benchmark for every seeded position', () => {
    for (const type of WA_SEED_POSITION_TYPES) {
      const cp = getCommissionPosition(type)
      expect(cp, `COMMISSION_POSITIONS missing ${type}`).toBeTruthy()
      expect(cp!.salary, `${type} catalog salary`).toBe(EXPECTED_CATALOG_SALARY[type])
      expect(cp!.salary).toBeGreaterThan(0)
    }
  })

  test('onboarding seed path (waSeedSalary) === catalog for every position', () => {
    for (const type of WA_SEED_POSITION_TYPES) {
      const catalog = getCommissionPosition(type)!.salary
      expect(waSeedSalary(type), `${type} onboarding salary`).toBe(catalog)
    }
  })

  test('staffing/seed route (SEED_POSITIONS) salary + benchmark === catalog', () => {
    for (const pos of SEED_POSITIONS) {
      const catalog = getCommissionPosition(pos.positionType)!.salary
      expect(pos.salary, `${pos.positionType} seed salary`).toBe(catalog)
      expect(pos.benchmarkSalary, `${pos.positionType} seed benchmark`).toBe(catalog)
    }
  })

  test('regression: no seeded salary fell back to the old below-market default', () => {
    for (const type of WA_SEED_POSITION_TYPES) {
      // teacher_hs joined the onboarding seed with P-UX-13; it never had a below-market literal.
      if (!(type in OLD_BELOW_MARKET)) continue
      const resolved = waSeedSalary(type)
      expect(resolved, `${type} must not be the old low default`).not.toBe(OLD_BELOW_MARKET[type])
      expect(resolved, `${type} must be at or above old default`).toBeGreaterThan(OLD_BELOW_MARKET[type])
    }
    for (const pos of SEED_POSITIONS) {
      expect(pos.salary).not.toBe(OLD_BELOW_MARKET[pos.positionType])
    }
  })
})
