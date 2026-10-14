import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  FUNDING_STATUSES,
  FUNDING_STATUS_LABELS,
  FUNDING_TYPES,
  FUNDING_TYPE_LABELS,
  fundingStatusLabel,
  fundingTypeLabel,
  isSecuredFunding,
  summarizeStartupFunding,
} from '../../src/lib/fundingLabels'
import type { StartupFundingSource } from '../../src/lib/types'

/**
 * P-UX-07 / P-UX-08 — startup funding display labels and the summary totals shown by the
 * Settings editor and the Revenue tab summary. Display only: stored values stay lowercase.
 *
 * Run: npx playwright test tests/session4/funding-labels.spec.ts
 */

test.describe('FUNDING_STATUS_LABELS (P-UX-07)', () => {
  test('maps every stored status to its Title Case label', () => {
    expect(FUNDING_STATUS_LABELS).toEqual({
      received: 'Received',
      pledged: 'Pledged',
      applied: 'Applied',
      projected: 'Projected',
      'n/a': 'N/A',
    })
  })

  test('the option list covers exactly the labelled statuses, in dropdown order', () => {
    expect(FUNDING_STATUSES).toEqual(['received', 'pledged', 'applied', 'projected', 'n/a'])
    expect([...FUNDING_STATUSES].sort()).toEqual(Object.keys(FUNDING_STATUS_LABELS).sort())
  })

  test('fundingStatusLabel: known values labelled, unknown shown as stored, empty as a dash', () => {
    expect(fundingStatusLabel('n/a')).toBe('N/A')
    expect(fundingStatusLabel('received')).toBe('Received')
    expect(fundingStatusLabel('committed')).toBe('committed')
    expect(fundingStatusLabel('')).toBe('—')
    expect(fundingStatusLabel(null)).toBe('—')
    expect(fundingStatusLabel(undefined)).toBe('—')
  })
})

test.describe('FUNDING_TYPE_LABELS', () => {
  test('debt reads as Loan (matches onboarding); every type is labelled', () => {
    expect(FUNDING_TYPE_LABELS).toEqual({ grant: 'Grant', donation: 'Donation', debt: 'Loan', other: 'Other' })
    expect([...FUNDING_TYPES].sort()).toEqual(Object.keys(FUNDING_TYPE_LABELS).sort())
    expect(fundingTypeLabel('debt')).toBe('Loan')
    expect(fundingTypeLabel('bond')).toBe('bond')
    expect(fundingTypeLabel(42)).toBe('—')
  })
})

test.describe('summarizeStartupFunding', () => {
  test('received and pledged are secured; the rest is pending', () => {
    const sources: StartupFundingSource[] = [
      { source: 'CSP', amount: 150000, type: 'grant', status: 'applied' },
      { source: 'Founder', amount: 50000, type: 'other', status: 'received' },
      { source: 'Foundation', amount: 75000, type: 'donation', status: 'pledged' },
      { source: 'Loan', amount: 25000, type: 'debt', status: 'n/a' },
      { source: 'Future', amount: 10000, type: 'grant', status: 'projected' },
    ]
    expect(summarizeStartupFunding(sources)).toEqual({ total: 310000, secured: 125000, pending: 185000 })
  })

  test('empty, null and non-numeric amounts are safe', () => {
    expect(summarizeStartupFunding([])).toEqual({ total: 0, secured: 0, pending: 0 })
    expect(summarizeStartupFunding(null)).toEqual({ total: 0, secured: 0, pending: 0 })
    expect(summarizeStartupFunding(undefined)).toEqual({ total: 0, secured: 0, pending: 0 })
    const messy = [
      { amount: Number.NaN, status: 'received' },
      { amount: '1000' as unknown as number, status: 'pledged' },
      { amount: 500, status: 'applied' },
    ] as Pick<StartupFundingSource, 'amount' | 'status'>[]
    expect(summarizeStartupFunding(messy)).toEqual({ total: 1500, secured: 1000, pending: 500 })
  })

  test('isSecuredFunding matches only received and pledged', () => {
    expect(FUNDING_STATUSES.filter(isSecuredFunding)).toEqual(['received', 'pledged'])
    expect(isSecuredFunding('Received')).toBe(false)
  })
})

test.describe('labels are not engine code', () => {
  test('fundingLabels.ts is outside the engine hash set, so labels never change ENGINE_VERSION', () => {
    const script = readFileSync('scripts/gen-engine-version.cjs', 'utf8')
    expect(script).not.toContain('fundingLabels')
  })
})
