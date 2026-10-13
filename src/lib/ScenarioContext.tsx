'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useSchoolData, type SchoolData } from '@/lib/useSchoolData'
import { useStateConfig } from '@/contexts/StateConfigContext'
import {
  computeCarryForward,
  computeFPFScorecard,
  computeGenericHealthScorecard,
  runProjections,
  type FPFScorecard,
  type GenericHealthScorecard,
  type MultiYearDetailedRow,
  type ProjectionInputs,
} from '@/lib/budgetEngine'
import type { FinancialAssumptions } from '@/lib/types'
import { getAssumptions } from '@/lib/types'
import type { Pathway, StateConfig } from '@/lib/stateConfig'

/**
 * Dashboard-wide engine context. Every Year-N figure on the dashboard comes from one run of
 * the pathway's 5-year engine (runProjections) on the saved school data, so tabs cannot
 * disagree. A page that previews unsaved edits re-runs the engine with projectionInputs
 * overlaid with its local state. The scorecards are computed here once too, so the Overview,
 * Scorecard, Advisory, Ask and Alignment tabs grade the same numbers.
 */
export interface ScenarioContextType {
  schoolData: SchoolData
  assumptions: FinancialAssumptions
  pathway: Pathway
  pathwayConfig: StateConfig
  /** Year-1 starting cash: computeCarryForward(profile). */
  preOpenCash: number
  /** The inputs behind multiYear, for re-running the engine (sensitivity, unsaved previews). */
  projectionInputs: ProjectionInputs
  multiYear: MultiYearDetailedRow[]
  /** multiYear[0]. */
  y1: MultiYearDetailedRow
  /** Commission FPF scorecard on multiYear (also used as AI context on every pathway). */
  fpfScorecard: FPFScorecard
  /** Financial health scorecard for non-WA pathways; null on wa_charter. */
  genericScorecard: GenericHealthScorecard | null
}

const ScenarioContext = createContext<ScenarioContextType | null>(null)

export function useScenario(): ScenarioContextType {
  const ctx = useContext(ScenarioContext)
  if (!ctx) throw new Error('useScenario must be used within ScenarioProvider')
  return ctx
}

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const schoolData = useSchoolData()
  const { config: pathwayConfig, pathway } = useStateConfig()
  const { profile, positions, allPositions, projections, gradeExpansionPlan } = schoolData

  const assumptions = useMemo(() => getAssumptions(profile.financial_assumptions), [profile.financial_assumptions])
  const preOpenCash = useMemo(() => computeCarryForward(profile), [profile])

  const projectionInputs = useMemo<ProjectionInputs>(() => ({
    pathway,
    config: pathwayConfig,
    profile,
    positions,
    projections,
    assumptions,
    preOpenCash,
    gradeExpansionPlan,
    allPositions,
    startupFunding: profile.startup_funding,
  }), [pathway, pathwayConfig, profile, positions, projections, assumptions, preOpenCash, gradeExpansionPlan, allPositions])

  const multiYear = useMemo(() => runProjections(projectionInputs), [projectionInputs])

  const fpfScorecard = useMemo(() => computeFPFScorecard(multiYear, preOpenCash, false), [multiYear, preOpenCash])
  const genericScorecard = useMemo(() => {
    if (pathway === 'wa_charter') return null
    const profileExt = profile as unknown as Record<string, unknown>
    return computeGenericHealthScorecard(
      multiYear, preOpenCash, pathwayConfig,
      profileExt.tuition_rate as number | undefined,
      profileExt.financial_aid_pct as number | undefined,
    )
  }, [multiYear, preOpenCash, pathway, pathwayConfig, profile])

  const value: ScenarioContextType = {
    schoolData,
    assumptions,
    pathway,
    pathwayConfig,
    preOpenCash,
    projectionInputs,
    multiYear,
    y1: multiYear[0],
    fpfScorecard,
    genericScorecard,
  }

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>
}
