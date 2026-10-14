import { test, expect } from '@playwright/test'
import { COMMISSION_POSITIONS } from '../../src/lib/types'
import { getStateConfig } from '../../src/lib/stateConfig'
import { defaultDriver, PARAEDUCATOR_MIN_FTE, resolveDriver } from '../../src/lib/positionTypes'
import { openingYearOptions } from '../../src/lib/openingYears'

/**
 * Backlog pass 1: one WA position catalog (P-UX-09, R-REV-09), saved drivers survive a reload
 * (P4-FU-01), the paraeducator floor (P-UX-10) and the opening-year options (P-UX-06).
 *
 * Run: npx playwright test tests/session4/staffing-drivers.spec.ts
 */

test.describe('position catalog', () => {
  test('catalog drivers are the ones the Staffing tab offers (no per-band variants)', () => {
    const drivers = new Set(COMMISSION_POSITIONS.map((p) => p.driver))
    expect([...drivers].sort()).toEqual(['fixed', 'per_pupil', 'per_pupil_el'])
    expect(defaultDriver('teacher_elem')).toBe('per_pupil')
    expect(defaultDriver('sped_teacher')).toBe('fixed')
    expect(defaultDriver('asst_principal')).toBe('fixed')
    expect(defaultDriver('el_specialist')).toBe('per_pupil_el')
    expect(defaultDriver('custom')).toBe('fixed')
    expect(defaultDriver('not_a_type')).toBe('fixed')
  })

  test('the WA pathway config positions come from the catalog (one place for salaries)', () => {
    const wa = getStateConfig('wa_charter').position_types
    const catalog = COMMISSION_POSITIONS.filter((p) => p.type !== 'custom')
    expect(wa).toHaveLength(27)
    expect(wa.map((p) => [p.type, p.default_salary, p.driver, p.students_per_position]))
      .toEqual(catalog.map((p) => [p.type, p.salary, p.driver, p.studentsPerPosition]))
  })
})

test.describe('saved drivers (P4-FU-01)', () => {
  test('a toggled-to-fixed driver is kept', () => {
    expect(resolveDriver('teacher_elem', 'fixed')).toBe('fixed')
    expect(resolveDriver('paraeducator', 'fixed')).toBe('fixed')
  })

  test("the type's default is kept; anything else reads as the default", () => {
    expect(resolveDriver('teacher_elem', 'per_pupil')).toBe('per_pupil')
    expect(resolveDriver('teacher_elem', 'per_pupil_elem')).toBe('per_pupil')
    expect(resolveDriver('sped_teacher', 'per_pupil_sped')).toBe('fixed')
    expect(resolveDriver('el_specialist', null)).toBe('per_pupil_el')
    expect(resolveDriver('custom', 'per_pupil')).toBe('fixed')
  })

  test('paraeducator Year 1 floor is 2 FTE', () => {
    expect(PARAEDUCATOR_MIN_FTE).toBe(2)
  })
})

test.describe('opening year options (P-UX-06)', () => {
  test('this year and the next five', () => {
    expect(openingYearOptions(null, 2026)).toEqual([2026, 2027, 2028, 2029, 2030, 2031])
  })

  test('a saved year outside the window stays selectable', () => {
    expect(openingYearOptions(2025, 2026)).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031])
    expect(openingYearOptions(2033, 2026)).toContain(2033)
    expect(openingYearOptions(2028, 2026)).toHaveLength(6)
  })
})
