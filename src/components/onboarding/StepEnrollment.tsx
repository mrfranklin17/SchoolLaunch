'use client'

import { useState, useMemo, useCallback } from 'react'
import { calcCommissionRevenue, calcSmallSchoolEnhancementFromGrades } from '@/lib/calculations'
import { stateApportionmentBase } from '@/lib/budgetEngine'
import { DEFAULT_ASSUMPTIONS } from '@/lib/types'
import type { GrowthPreset, GradeExpansionEntry, EnrollmentMode } from '@/lib/types'
import { expansionToEnrollmentArray } from '@/lib/gradeExpansion'
import GradeExpansionEditor from '@/components/GradeExpansionEditor'
import type { Pathway } from '@/lib/stateConfig'
import { getStateConfig } from '@/lib/stateConfig'
import { FormField } from '@/components/ui/FormField'
import { Tabs } from '@/components/ui/Tabs'
import { CurrencyInput } from '@/components/ui/CurrencyInput'

const GRADE_ENROLLMENT_DEFAULTS: Record<string, { classSize: number }> = {
  'K-5': { classSize: 24 },
  'K-8': { classSize: 24 },
  '6-8': { classSize: 25 },
  '9-12': { classSize: 28 },
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface Props {
  initialData: {
    enrollmentY1: number
    maxClassSize: number
    enrollmentY2: number
    enrollmentY3: number
    enrollmentY4: number
    growthPreset: GrowthPreset
    tuitionRate?: number
    financialAidPct?: number
  }
  gradeConfig: string
  pctFrl: number
  pctIep: number
  pctEll: number
  pctHicap: number
  pathway?: Pathway
  initialOpeningGrades?: string[]
  initialBuildoutGrades?: string[]
  initialRetentionRate?: number
  initialExpansionPlan?: GradeExpansionEntry[]
  onNext: (data: {
    enrollmentY1: number
    maxClassSize: number
    enrollmentY2: number
    enrollmentY3: number
    enrollmentY4: number
    enrollmentY5: number
    growthPreset: GrowthPreset
    enrollmentMode: EnrollmentMode
    openingGrades?: string[]
    buildoutGrades?: string[]
    retentionRate?: number
    expansionPlan?: GradeExpansionEntry[]
    tuitionRate?: number
    financialAidPct?: number
  }) => void
  onBack: () => void
}

export default function StepEnrollment({
  initialData, gradeConfig, pctFrl, pctIep, pctEll, pctHicap,
  pathway,
  initialOpeningGrades, initialBuildoutGrades, initialRetentionRate, initialExpansionPlan,
  onNext, onBack,
}: Props) {
  const config = getStateConfig(pathway)
  const isTuitionBased = config.revenue_model === 'tuition'
  const isCharter = config.pathway === 'wa_charter' || config.pathway === 'generic_charter'

  const defaults = GRADE_ENROLLMENT_DEFAULTS[gradeConfig] || GRADE_ENROLLMENT_DEFAULTS['K-5']
  const configClassSize = config.students_per_section_default
  const [mode, setMode] = useState<EnrollmentMode>('grade_expansion')

  const [maxClassSize, setMaxClassSize] = useState(initialData.maxClassSize || configClassSize || defaults.classSize)

  // Tuition inputs for private/micro pathways
  const [tuitionRate, setTuitionRate] = useState(initialData.tuitionRate ?? config.tuition_rate_default ?? 0)
  const [financialAidPct, setFinancialAidPct] = useState(initialData.financialAidPct ?? ((config.financial_aid_pct_default ?? 0) * 100))

  // Grade expansion state
  const [expansionResult, setExpansionResult] = useState<{
    openingGrades: string[]
    buildoutGrades: string[]
    retentionRate: number
    plan: GradeExpansionEntry[]
    enrollments: { year: number; total: number }[]
  } | null>(null)

  const handleExpansionChange = useCallback((data: {
    openingGrades: string[]
    buildoutGrades: string[]
    retentionRate: number
    plan: GradeExpansionEntry[]
    enrollments: { year: number; total: number; returning: number; newGrade: number; grades: string[]; newGrades: string[] }[]
  }) => {
    setExpansionResult(data)
    // Keep maxClassSize in sync with the max students_per_section across Year 1 entries
    const y1Entries = data.plan.filter((e) => e.year === 1)
    if (y1Entries.length > 0) {
      setMaxClassSize(Math.max(...y1Entries.map((e) => e.students_per_section)))
    }
  }, [])

  // Derive enrollment numbers from expansion plan (source of truth)
  const expansionEnrollments = useMemo(() => {
    if (!expansionResult) return { y1: initialData.enrollmentY1, y2: initialData.enrollmentY2, y3: initialData.enrollmentY3, y4: initialData.enrollmentY4, y5: 0 }
    const find = (yr: number) => expansionResult.enrollments.find(e => e.year === yr)?.total || 0
    return { y1: find(1), y2: find(2), y3: find(3), y4: find(4), y5: find(5) }
  }, [expansionResult, initialData])

  const effectiveY1 = expansionEnrollments.y1

  // Total sections for Y1 = sum of sections across all Year 1 plan entries
  const sectionsY1 = expansionResult
    ? expansionResult.plan.filter(e => e.year === 1).reduce((sum, e) => sum + e.sections, 0)
    : Math.ceil(effectiveY1 / maxClassSize)

  const revenuePreview = useMemo(() => {
    if (isTuitionBased) {
      // Private/Micro: tuition × enrollment × (1 - aid%)
      const grossTuition = effectiveY1 * tuitionRate
      const aidDiscount = grossTuition * (financialAidPct / 100)
      const netTuition = grossTuition - aidDiscount
      return { baseRevenue: netTuition, totalGrants: 0, total: netTuition }
    }
    // Charter pathways: use Commission revenue calculation
    const openingGrades = expansionResult?.openingGrades || initialOpeningGrades || []
    const sse = calcSmallSchoolEnhancementFromGrades(
      effectiveY1,
      openingGrades,
      DEFAULT_ASSUMPTIONS.aafte_pct,
      DEFAULT_ASSUMPTIONS.regular_ed_per_pupil,
      DEFAULT_ASSUMPTIONS.regionalization_factor || 1.0,
    )
    const rev = calcCommissionRevenue(effectiveY1, pctFrl, pctIep, pctEll, pctHicap, DEFAULT_ASSUMPTIONS, 1, sse)
    const baseRevenue = stateApportionmentBase(rev, sse)
    const totalGrants = rev.total - baseRevenue
    return { baseRevenue, totalGrants, total: rev.total }
  }, [effectiveY1, pctFrl, pctIep, pctEll, pctHicap, isTuitionBased, tuitionRate, financialAidPct, expansionResult, initialOpeningGrades])

  function handleNext(e: React.FormEvent) {
    e.preventDefault()

    const tuitionFields = isTuitionBased ? { tuitionRate, financialAidPct: financialAidPct / 100 } : {}

    if (expansionResult) {
      const arr = expansionToEnrollmentArray(expansionResult.plan, expansionResult.retentionRate)
      onNext({
        enrollmentY1: arr[0],
        maxClassSize,
        enrollmentY2: arr[1],
        enrollmentY3: arr[2],
        enrollmentY4: arr[3],
        enrollmentY5: arr[4] || 0,
        growthPreset: 'moderate',
        enrollmentMode: mode,
        openingGrades: expansionResult.openingGrades,
        buildoutGrades: expansionResult.buildoutGrades,
        retentionRate: expansionResult.retentionRate,
        expansionPlan: expansionResult.plan,
        ...tuitionFields,
      })
    } else {
      onNext({
        enrollmentY1: expansionEnrollments.y1,
        maxClassSize,
        enrollmentY2: expansionEnrollments.y2,
        enrollmentY3: expansionEnrollments.y3,
        enrollmentY4: expansionEnrollments.y4,
        enrollmentY5: expansionEnrollments.y5,
        growthPreset: 'moderate',
        enrollmentMode: mode,
        ...tuitionFields,
      })
    }
  }

  return (
    <form onSubmit={handleNext} className="space-y-6 max-w-2xl">
      <p className="text-sm text-slate-500">
        Enrollment drives nearly every financial metric. Choose your enrollment planning approach.
      </p>

      {/* Mode toggle — Tabs primitive */}
      <Tabs
        variant="underlined"
        value={mode}
        onValueChange={(v) => setMode(v as EnrollmentMode)}
        ariaLabel="Enrollment mode"
        items={[
          {
            value: 'grade_expansion',
            label: 'Grade Expansion Plan',
            panel: (
              <div className="space-y-4">
                <div className="text-xs text-slate-400 italic">
                  Grade expansion produces cohort-based projections that authorizers find more credible than flat growth rates.
                </div>
                <GradeExpansionEditor
                  gradeConfig={gradeConfig}
                  maxClassSize={maxClassSize}
                  initialOpeningGrades={initialOpeningGrades}
                  initialBuildoutGrades={initialBuildoutGrades}
                  initialRetentionRate={initialRetentionRate}
                  initialPlan={initialExpansionPlan}
                  onChange={handleExpansionChange}
                />
              </div>
            ),
          },
          {
            value: 'simple',
            label: 'Enrollment Summary',
            panel: (
              <div className="space-y-4">
                <div className="text-xs text-slate-400 italic">
                  Enrollment targets are calculated from your Grade Expansion Plan. Switch to the Grade Expansion Plan tab to adjust which grades are added each year.
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[
                    { label: 'Year 1', value: expansionEnrollments.y1 },
                    { label: 'Year 2', value: expansionEnrollments.y2 },
                    { label: 'Year 3', value: expansionEnrollments.y3 },
                    { label: 'Year 4', value: expansionEnrollments.y4 },
                    { label: 'Year 5', value: expansionEnrollments.y5 },
                  ].map(({ label, value }) => (
                    <FormField key={label} label={label}>
                      {() => (
                        <div className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold">
                          {value > 0 ? value : '—'}
                        </div>
                      )}
                    </FormField>
                  ))}
                </div>

                {expansionEnrollments.y1 === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
                    No enrollment data yet. Switch to the Grade Expansion Plan tab to configure your grade rollout.
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Tuition inputs — private/micro only */}
      {isTuitionBased && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Tuition Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Annual Tuition Per Student">
              {(id) => (
                <CurrencyInput id={id} value={tuitionRate} onChange={setTuitionRate} fullWidth />
              )}
            </FormField>
            <FormField label="Financial Aid Discount %">
              {(id) => (
                <div className="relative">
                  <input
                    id={id}
                    type="number"
                    value={financialAidPct}
                    onChange={(e) => setFinancialAidPct(Number(e.target.value))}
                    min={0}
                    max={100}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900"
                  />
                  <span className="absolute right-3 top-2.5 text-slate-400">%</span>
                </div>
              )}
            </FormField>
          </div>
          {effectiveY1 > 0 && (
            <p className="text-xs text-slate-500">
              {effectiveY1} students x {fmt(tuitionRate)} = {fmt(effectiveY1 * tuitionRate)} gross
              {financialAidPct > 0 && <> less {financialAidPct}% aid = <strong className="text-teal-600">{fmt(effectiveY1 * tuitionRate * (1 - financialAidPct / 100))}</strong> net tuition</>}
            </p>
          )}
        </div>
      )}

      {/* Revenue preview */}
      <div className="bg-slate-50 rounded-xl p-4 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-slate-500">Sections Needed (Y1)</p>
          <p className="text-lg font-semibold text-slate-800">{sectionsY1}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">
            {isTuitionBased ? 'Est. Tuition Revenue' : config.pathway === 'generic_charter' ? 'Est. Per-Pupil Revenue' : 'Est. Base Revenue'}
          </p>
          <p className="text-lg font-semibold text-slate-800">{fmt(revenuePreview.baseRevenue)}</p>
        </div>
        {isCharter && (
          <div>
            <p className="text-xs text-slate-500">Est. Grants</p>
            <p className="text-lg font-semibold text-slate-800">{fmt(revenuePreview.totalGrants)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-slate-500">Total Revenue</p>
          <p className="text-lg font-semibold text-teal-600">{fmt(revenuePreview.total)}</p>
        </div>
      </div>

      <div className="pt-4 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          className="bg-teal-600 text-white px-8 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          Continue
        </button>
      </div>
    </form>
  )
}
