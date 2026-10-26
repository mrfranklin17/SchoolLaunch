/**
 * Phase 6a: the engine preview behind a chat proposal. Re-runs the pathway's 5-year engine on
 * the saved inputs with the proposed changes overlaid (nothing is saved) and reads off the
 * figures the preview card compares. Pure; the Ask page passes useScenario().projectionInputs.
 */
import {
  computeCarryForward,
  computeFPFScorecard,
  personnelPctOfRevenue,
  runProjections,
  type FPFScorecard,
  type MultiYearDetailedRow,
  type ProjectionInputs,
} from './budgetEngine'
import { applyChanges, type PlanChange, type PlanSnapshot } from './chatEdits'
import { getAssumptions } from './types'

export type MetricFormat = 'currency' | 'days' | 'percent' | 'students'

export interface ImpactMetric {
  label: string
  format: MetricFormat
  /** One value per compared year (PREVIEW_YEARS), before and after the change. */
  before: number[]
  after: number[]
}

/** The years the card compares: the opening year and the last plan year. */
export const PREVIEW_YEARS = [1, 5] as const

export interface ChangePreview {
  metrics: ImpactMetric[]
  /** FPF measures meeting the standard in each compared year, before and after. */
  fpfMeets: { before: number[]; after: number[]; total: number }
}

/** The projection inputs with the snapshot's (changed) data in place of the saved data. */
export function inputsFor(inputs: ProjectionInputs, snapshot: PlanSnapshot): ProjectionInputs {
  return {
    ...inputs,
    profile: snapshot.profile,
    positions: snapshot.allPositions.filter((p) => p.year === 1),
    allPositions: snapshot.allPositions,
    projections: snapshot.projections,
    gradeExpansionPlan: snapshot.gradeExpansionPlan,
    assumptions: getAssumptions(snapshot.profile.financial_assumptions),
    preOpenCash: computeCarryForward(snapshot.profile),
    startupFunding: snapshot.profile.startup_funding,
  }
}

function meetsCount(scorecard: FPFScorecard, yearIndex: number): number {
  return scorecard.measures.filter((m) => m.statuses[yearIndex] === 'meets').length
}

/** Engine figures for the saved plan and for the plan with `changes` applied. */
export function previewChanges(inputs: ProjectionInputs, snapshot: PlanSnapshot, changes: PlanChange[]): ChangePreview {
  const beforeInputs = inputsFor(inputs, snapshot)
  const afterInputs = inputsFor(inputs, applyChanges(snapshot, changes))
  const before = runProjections(beforeInputs)
  const after = runProjections(afterInputs)
  const rowsOf = (rows: MultiYearDetailedRow[]) => PREVIEW_YEARS.map((y) => rows[y - 1] ?? rows[rows.length - 1])
  const b = rowsOf(before)
  const a = rowsOf(after)
  const metric = (label: string, format: MetricFormat, read: (r: MultiYearDetailedRow) => number): ImpactMetric => ({
    label, format, before: b.map(read), after: a.map(read),
  })

  const fpfBefore = computeFPFScorecard(before, beforeInputs.preOpenCash, false)
  const fpfAfter = computeFPFScorecard(after, afterInputs.preOpenCash, false)

  return {
    metrics: [
      metric('Enrollment', 'students', (r) => r.enrollment),
      metric('Total revenue', 'currency', (r) => r.revenue.total),
      metric('Total expenses', 'currency', (r) => r.totalExpenses),
      metric('Net income', 'currency', (r) => r.net),
      metric('Ending cash', 'currency', (r) => r.endingCash),
      metric('Days of cash', 'days', (r) => r.reserveDays),
      metric('Personnel % of revenue', 'percent', (r) => personnelPctOfRevenue(r)),
    ],
    fpfMeets: {
      before: PREVIEW_YEARS.map((y) => meetsCount(fpfBefore, y - 1)),
      after: PREVIEW_YEARS.map((y) => meetsCount(fpfAfter, y - 1)),
      total: fpfAfter.measures.length,
    },
  }
}
