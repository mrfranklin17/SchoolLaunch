// Display labels and totals for startup funding sources (P-UX-07 / P-UX-08).
//
// Display only: the stored values in school_profiles.startup_funding stay the lowercase
// enums (`received`, `n/a`, `debt`, ...). Kept out of startupFunding.ts on purpose — that
// file is part of the engine hash (scripts/gen-engine-version.cjs), and labels are not math.
import type { StartupFundingSource } from './types'

export type FundingStatus = StartupFundingSource['status']
export type FundingType = StartupFundingSource['type']

export const FUNDING_STATUSES: FundingStatus[] = ['received', 'pledged', 'applied', 'projected', 'n/a']
export const FUNDING_TYPES: FundingType[] = ['grant', 'donation', 'debt', 'other']

export const FUNDING_STATUS_LABELS: Record<FundingStatus, string> = {
  received: 'Received',
  pledged: 'Pledged',
  applied: 'Applied',
  projected: 'Projected',
  'n/a': 'N/A',
}

/** `debt` reads as "Loan", matching the onboarding funding row. */
export const FUNDING_TYPE_LABELS: Record<FundingType, string> = {
  grant: 'Grant',
  donation: 'Donation',
  debt: 'Loan',
  other: 'Other',
}

/** Label for a stored status; an unrecognized value is shown as stored. */
export function fundingStatusLabel(status: unknown): string {
  if (typeof status !== 'string' || status === '') return '—'
  return FUNDING_STATUS_LABELS[status as FundingStatus] ?? status
}

/** Label for a stored type; an unrecognized value is shown as stored. */
export function fundingTypeLabel(type: unknown): string {
  if (typeof type !== 'string' || type === '') return '—'
  return FUNDING_TYPE_LABELS[type as FundingType] ?? type
}

/** Received and pledged funds count as secured; everything else is pending. */
export function isSecuredFunding(status: unknown): boolean {
  return status === 'received' || status === 'pledged'
}

/** Total, secured and pending amounts across funding sources (non-numeric amounts count as 0). */
export function summarizeStartupFunding(sources: readonly Pick<StartupFundingSource, 'amount' | 'status'>[] | null | undefined): {
  total: number
  secured: number
  pending: number
} {
  let total = 0
  let secured = 0
  for (const s of sources ?? []) {
    const amount = Number(s?.amount)
    if (!Number.isFinite(amount)) continue
    total += amount
    if (isSecuredFunding(s?.status)) secured += amount
  }
  return { total, secured, pending: total - secured }
}
