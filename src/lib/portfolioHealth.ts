import {
  computeFPFScorecard,
  genericScorecardFor,
  type MultiYearDetailedRow,
} from './budgetEngine'
import {
  fpfIssuesForStage,
  fromFpfStatus,
  fromGenericColor,
  genericIssuesForYears,
  healthPathway,
  type HealthPathway,
  type HealthStatus,
} from './healthThresholds'
import { getStateConfig } from './stateConfig'
import type { SchoolProfile } from './types'

/** Compliance-matrix columns: Current Ratio, Days Cash, Total Margin, Enrollment Variance. */
export type PortfolioMatrixKey = 'CR' | 'DC' | 'TM' | 'EV'

export interface PortfolioHealth {
  healthPathway: HealthPathway
  /**
   * Early-year issues: WA — FPF measures failing Stage 1 (Years 1–2); other pathways — generic
   * health measures in the concern band in Year 1 or 2.
   */
  issues: string[]
  /** Status per year (Years 1–5) for each matrix column; 'na' where the pathway has no measure. */
  matrix: Record<PortfolioMatrixKey, HealthStatus[]>
}

const FPF_NAMES: Record<PortfolioMatrixKey, string> = {
  CR: 'Current Ratio',
  DC: 'Days of Cash',
  TM: 'Total Margin',
  EV: 'Enrollment Variance',
}

const GENERIC_NAMES: Record<PortfolioMatrixKey, string | null> = {
  CR: 'Current Ratio',
  DC: 'Reserve Days (Cash on Hand)',
  TM: 'Total Margin (Net / Revenue)',
  EV: null,
}

const KEYS: PortfolioMatrixKey[] = ['CR', 'DC', 'TM', 'EV']

/**
 * The admin portfolio's health read for one school, graded on the school's own pathway: the
 * Commission FPF scorecard for WA charters, the generic health scorecard (the one the school's
 * dashboard shows) for every other pathway.
 */
export function portfolioHealthFor(
  pathway: string | null | undefined,
  multiYear: MultiYearDetailedRow[],
  preOpenCash: number,
  profile: SchoolProfile,
): PortfolioHealth {
  const hp = healthPathway(pathway)
  const years = multiYear.map((r) => r.year)
  const generic = genericScorecardFor(multiYear, preOpenCash, getStateConfig(pathway), profile)
  if (!generic) {
    const fpf = computeFPFScorecard(multiYear, preOpenCash, false)
    const matrix = {} as Record<PortfolioMatrixKey, HealthStatus[]>
    for (const k of KEYS) {
      const m = fpf.measures.find((x) => x.name === FPF_NAMES[k])
      matrix[k] = years.map((_, i) => fromFpfStatus(m?.statuses[i]))
    }
    return { healthPathway: hp, issues: fpfIssuesForStage(fpf, 1), matrix }
  }
  const matrix = {} as Record<PortfolioMatrixKey, HealthStatus[]>
  for (const k of KEYS) {
    const name = GENERIC_NAMES[k]
    const m = name ? generic.measures.find((x) => x.name === name) : undefined
    matrix[k] = years.map((_, i) => fromGenericColor(m?.values[i]?.status))
  }
  return { healthPathway: hp, issues: genericIssuesForYears(generic, 2), matrix }
}
