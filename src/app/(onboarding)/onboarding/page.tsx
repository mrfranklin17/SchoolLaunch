'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { replaceGradeExpansionPlan } from '@/lib/atomicReplace'
import { replaceYearOneStaffing } from '@/lib/onboardingStaffing'
import { resolvePositionType } from '@/lib/positionTypes'
import { toast } from '@/components/ui/Toast'
import { calcCommissionRevenue, calcSmallSchoolEnhancement } from '@/lib/calculations'
import { DEFAULT_ASSUMPTIONS } from '@/lib/types'
import StepIdentity from '@/components/onboarding/StepIdentity'
import StepEnrollment from '@/components/onboarding/StepEnrollment'
import StepDemographics from '@/components/onboarding/StepDemographics'
import StepStaffing from '@/components/onboarding/StepStaffing'
import StepOperations, { defaultOperationsData } from '@/components/onboarding/StepOperations'
import { OnboardingStepper } from '@/components/onboarding/Stepper'
import { Callout } from '@/components/ui/Callout'
import type { GrowthPreset, StartupFundingSource, GradeExpansionEntry, EnrollmentMode } from '@/lib/types'
import type { Pathway } from '@/lib/stateConfig'
import { getStateConfig } from '@/lib/stateConfig'
import { RETENTION_RATE_DEFAULT } from '@/lib/gradeExpansion'
import { evaluatePersonnelPct, healthColor, healthPathway } from '@/lib/healthThresholds'
import { SCHOOL_ROLES, sortRolesNewestFirst } from '@/lib/schoolSession'

const STEPS = [
  {
    label: 'School Identity',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    minutes: 2,
    outcome: "After this step, you'll have your school's basic profile saved.",
  },
  {
    label: 'Enrollment',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    minutes: 5,
    outcome: "After this step, you'll have a 5-year enrollment plan with grade rollout.",
  },
  {
    label: 'Demographics',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    minutes: 2,
    outcome: "After this step, you'll see which categorical grants you're eligible for.",
  },
  {
    label: 'Staffing',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    minutes: 8,
    outcome: "After this step, you'll have a Year 1 staffing plan with personnel costs.",
  },
  {
    label: 'Operations',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    minutes: 5,
    outcome: "After this step, you'll have a complete Year 1 budget.",
  },
]

interface WizardData {
  schoolName: string
  region: string
  plannedOpenYear: number
  gradeConfig: string
  enrollmentY1: number
  enrollmentY2: number
  enrollmentY3: number
  enrollmentY4: number
  enrollmentY5: number
  maxClassSize: number
  growthPreset: GrowthPreset
  pctFrl: number
  pctIep: number
  pctEll: number
  pctHicap: number
  positions: { key: string; title: string; category: 'certificated' | 'classified' | 'admin'; fte: number; salary: number; positionType?: string; classification?: string; driver?: string }[]
  operations: {
    facilityMode: 'sqft' | 'flat'
    facilitySqft: number
    facilityCostPerSqft: number
    facilityMonthly: number
    suppliesPerPupil: number
    contractedPerPupil: number
    technologyPerPupil: number
    foodProgram: boolean
    insurance: number
    miscPct: number
  }
  startupFunding: StartupFundingSource[]
  enrollmentMode: EnrollmentMode
  openingGrades: string[]
  buildoutGrades: string[]
  retentionRate: number
  expansionPlan: GradeExpansionEntry[]
  // Generic pathway fields
  state: string
  schoolType: 'charter' | 'private' | 'micro'
  pathway: Pathway
  fiscalYearStartMonth: number
  tuitionRate: number
  financialAidPct: number
}

const initialWizardData: WizardData = {
  schoolName: '',
  region: 'King County',
  plannedOpenYear: new Date().getFullYear(),
  gradeConfig: 'K-5',
  enrollmentY1: 120,
  enrollmentY2: 0,
  enrollmentY3: 0,
  enrollmentY4: 0,
  enrollmentY5: 0,
  maxClassSize: 24,
  growthPreset: 'moderate',
  pctFrl: 50,
  pctIep: 12,
  pctEll: 10,
  pctHicap: 5,
  positions: [],
  operations: defaultOperationsData,
  startupFunding: [],
  enrollmentMode: 'simple' as EnrollmentMode,
  openingGrades: [],
  buildoutGrades: [],
  retentionRate: RETENTION_RATE_DEFAULT,
  expansionPlan: [],
  // Generic pathway fields — default to WA charter
  state: 'WA',
  schoolType: 'charter',
  pathway: 'wa_charter',
  fiscalYearStartMonth: 9,
  tuitionRate: 0,
  financialAidPct: 0,
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function OnboardingPage() {
  const [step, setStep] = useState(-1) // -1 = welcome screen
  const [data, setData] = useState<WizardData>(initialWizardData)
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completingRef = useRef(false)
  const errorRef = useRef<HTMLDivElement | null>(null)
  const [navigating, setNavigating] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // Wrap a save attempt to drive the saveStatus indicator. Re-throws on failure
  // so the caller can decide whether to advance the step or stay put.
  const trackSave = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = null
    }
    setSaveStatus('saving')
    try {
      const result = await work()
      setSaveStatus('saved')
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('idle')
        savedTimerRef.current = null
      }, 3000)
      return result
    } catch (e) {
      setSaveStatus('error')
      toast.error('Save failed — please try again.')
      throw e
    }
  }, [])

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  // Bring a new error into view (the Complete button sits at the bottom of a long form).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  // Load existing data on mount
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Users can hold several roles: onboard the CEO school (the one the middleware gates on),
      // else the newest school membership.
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role, school_id, created_at')
        .eq('user_id', user.id)
      const schoolRows = sortRolesNewestFirst((roleRows ?? []).filter((r) => r.school_id && SCHOOL_ROLES.includes(r.role)))
      const roleData = schoolRows.find((r) => r.role === 'school_ceo') ?? schoolRows[0] ?? null

      if (!roleData?.school_id) { setLoading(false); return }

      setSchoolId(roleData.school_id)

      // Load school name and pathway fields
      const { data: school } = await supabase
        .from('schools')
        .select('name, pathway, state, school_type')
        .eq('id', roleData.school_id)
        .single()

      // Load profile
      const { data: profile } = await supabase
        .from('school_profiles')
        .select('*')
        .eq('school_id', roleData.school_id)
        .single()

      if (profile?.onboarding_complete) {
        router.push('/dashboard')
        return
      }

      // Load existing staffing positions and grade expansion plan
      const [{ data: existingPositions }, { data: existingExpansion }] = await Promise.all([
        supabase.from('staffing_positions').select('*').eq('school_id', roleData.school_id).eq('year', 1),
        supabase.from('grade_expansion_plan').select('*').eq('school_id', roleData.school_id).order('year').order('grade_level'),
      ])

      if (school || profile) {
        setData((prev) => ({
          ...prev,
          schoolName: school?.name || prev.schoolName,
          region: profile?.region || prev.region,
          plannedOpenYear: profile?.planned_open_year || prev.plannedOpenYear,
          gradeConfig: profile?.grade_config || prev.gradeConfig,
          enrollmentY1: profile?.target_enrollment_y1 || prev.enrollmentY1,
          enrollmentY2: profile?.target_enrollment_y2 || prev.enrollmentY2,
          enrollmentY3: profile?.target_enrollment_y3 || prev.enrollmentY3,
          enrollmentY4: profile?.target_enrollment_y4 || prev.enrollmentY4,
          enrollmentY5: profile?.target_enrollment_y5 || prev.enrollmentY5,
          maxClassSize: profile?.max_class_size || prev.maxClassSize,
          pctFrl: profile?.pct_frl ?? prev.pctFrl,
          pctIep: profile?.pct_iep ?? prev.pctIep,
          pctEll: profile?.pct_ell ?? prev.pctEll,
          pctHicap: profile?.pct_hicap ?? prev.pctHicap,
          startupFunding: profile?.startup_funding || prev.startupFunding,
          openingGrades: profile?.opening_grades || prev.openingGrades,
          buildoutGrades: profile?.buildout_grades || prev.buildoutGrades,
          retentionRate: profile?.retention_rate ?? prev.retentionRate,
          enrollmentMode: (existingExpansion && existingExpansion.length > 0 ? 'grade_expansion' : prev.enrollmentMode) as EnrollmentMode,
          expansionPlan: existingExpansion && existingExpansion.length > 0
            ? existingExpansion.map((e: Record<string, unknown>) => ({
                year: e.year as number,
                grade_level: e.grade_level as string,
                sections: e.sections as number,
                students_per_section: e.students_per_section as number,
                is_new_grade: e.is_new_grade as boolean,
              }))
            : prev.expansionPlan,
          positions: existingPositions && existingPositions.length > 0
            ? [...existingPositions]
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((p, i) => ({
                  key: `db-${i}`,
                  title: p.title,
                  category: p.category as 'certificated' | 'classified' | 'admin',
                  fte: p.fte,
                  salary: p.annual_salary,
                  // Keep the saved type so a resave doesn't drop it (untyped legacy rows are typed from their title).
                  positionType: resolvePositionType(p),
                  classification: p.classification ?? undefined,
                  driver: p.driver ?? undefined,
                }))
            : prev.positions,
          // Pathway fields from schools table
          state: school?.state || prev.state,
          schoolType: (school?.school_type as 'charter' | 'private' | 'micro') || prev.schoolType,
          pathway: (school?.pathway as Pathway) || prev.pathway,
          fiscalYearStartMonth: profile?.fiscal_year_start_month || prev.fiscalYearStartMonth,
        }))
      }

      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveStep1 = useCallback(async (stepData: {
    schoolName: string; region: string; plannedOpenYear: number;
    foundingGrades: string[]; buildoutGrades: string[]; gradeConfig: string;
    regionalizationFactor: number;
    state: string; schoolType: 'charter' | 'private' | 'micro';
    pathway: Pathway; fiscalYearStartMonth: number
  }) => {
    if (!schoolId) return
    // Set tuition/aid defaults from config when pathway is tuition-based
    const stepConfig = getStateConfig(stepData.pathway)
    const tuitionDefaults = stepConfig.revenue_model === 'tuition'
      ? { tuitionRate: stepConfig.tuition_rate_default ?? 0, financialAidPct: stepConfig.financial_aid_pct_default ?? 0 }
      : {}
    setData((prev) => ({
      ...prev,
      schoolName: stepData.schoolName,
      region: stepData.region,
      plannedOpenYear: stepData.plannedOpenYear,
      gradeConfig: stepData.gradeConfig,
      openingGrades: stepData.foundingGrades,
      buildoutGrades: stepData.buildoutGrades,
      state: stepData.state,
      schoolType: stepData.schoolType,
      pathway: stepData.pathway,
      fiscalYearStartMonth: stepData.fiscalYearStartMonth,
      ...tuitionDefaults,
    }))

    try {
      await trackSave(async () => {
        // Update schools table with pathway fields
        const { error: schoolErr } = await supabase.from('schools').update({
          name: stepData.schoolName,
          pathway: stepData.pathway,
          state: stepData.state,
          school_type: stepData.schoolType,
        }).eq('id', schoolId)
        if (schoolErr) throw schoolErr

        // Read existing financial_assumptions to merge regionalization_factor
        const { data: existingProfile } = await supabase
          .from('school_profiles')
          .select('financial_assumptions')
          .eq('school_id', schoolId)
          .single()

        const existingFa = existingProfile?.financial_assumptions || {}
        const updatedFa = { ...existingFa, regionalization_factor: stepData.regionalizationFactor }

        const { error: profileErr } = await supabase.from('school_profiles').upsert({
          school_id: schoolId,
          region: stepData.region,
          planned_open_year: stepData.plannedOpenYear,
          grade_config: stepData.gradeConfig,
          opening_grades: stepData.foundingGrades,
          buildout_grades: stepData.buildoutGrades,
          financial_assumptions: updatedFa,
          fiscal_year_start_month: stepData.fiscalYearStartMonth,
        }, { onConflict: 'school_id' })
        if (profileErr) throw profileErr
      })
      setStep(1)
    } catch { /* trackSave already toasted */ }
  }, [schoolId, supabase, trackSave])

  const saveStep2 = useCallback(async (stepData: {
    enrollmentY1: number; maxClassSize: number;
    enrollmentY2: number; enrollmentY3: number; enrollmentY4: number; enrollmentY5: number;
    growthPreset: GrowthPreset
    enrollmentMode: EnrollmentMode
    openingGrades?: string[]
    buildoutGrades?: string[]
    retentionRate?: number
    expansionPlan?: GradeExpansionEntry[]
    tuitionRate?: number
    financialAidPct?: number
  }) => {
    if (!schoolId) return
    setData((prev) => ({
      ...prev,
      ...stepData,
      openingGrades: stepData.openingGrades || prev.openingGrades,
      buildoutGrades: stepData.buildoutGrades || prev.buildoutGrades,
      retentionRate: stepData.retentionRate ?? prev.retentionRate,
      expansionPlan: stepData.expansionPlan || prev.expansionPlan,
      enrollmentMode: stepData.enrollmentMode,
      tuitionRate: stepData.tuitionRate ?? prev.tuitionRate,
      financialAidPct: stepData.financialAidPct ?? prev.financialAidPct,
    }))

    const profileUpdate: Record<string, unknown> = {
      school_id: schoolId,
      target_enrollment_y1: stepData.enrollmentY1,
      target_enrollment_y2: stepData.enrollmentY2,
      target_enrollment_y3: stepData.enrollmentY3,
      target_enrollment_y4: stepData.enrollmentY4,
      target_enrollment_y5: stepData.enrollmentY5,
      max_class_size: stepData.maxClassSize,
    }

    // Save tuition data for private/micro pathways
    if (stepData.tuitionRate != null) profileUpdate.tuition_rate = stepData.tuitionRate
    if (stepData.financialAidPct != null) profileUpdate.financial_aid_pct = stepData.financialAidPct

    if (stepData.enrollmentMode === 'grade_expansion' && stepData.openingGrades) {
      profileUpdate.opening_grades = stepData.openingGrades
      profileUpdate.buildout_grades = stepData.buildoutGrades
      profileUpdate.retention_rate = stepData.retentionRate
    }

    try {
      await trackSave(async () => {
        const { error: profileErr } = await supabase.from('school_profiles').upsert(profileUpdate, { onConflict: 'school_id' })
        if (profileErr) throw profileErr

        // Save grade expansion plan if in expansion mode
        if (stepData.enrollmentMode === 'grade_expansion' && stepData.expansionPlan && stepData.expansionPlan.length > 0) {
          const rows = stepData.expansionPlan.map((e) => ({
            school_id: schoolId,
            year: e.year,
            grade_level: e.grade_level,
            sections: e.sections,
            students_per_section: e.students_per_section,
            is_new_grade: e.is_new_grade,
          }))
          // Delete + insert in one transaction so a failed insert can't wipe the saved plan.
          const planResult = await replaceGradeExpansionPlan(supabase, schoolId, rows)
          if (!planResult.ok) throw new Error(planResult.message)
        }
      })
      setStep(2)
    } catch { /* trackSave already toasted */ }
  }, [schoolId, supabase, trackSave])

  const saveStep3 = useCallback(async (stepData: { pctFrl: number; pctIep: number; pctEll: number; pctHicap: number }) => {
    if (!schoolId) return
    setData((prev) => ({ ...prev, ...stepData }))

    try {
      await trackSave(async () => {
        const { error: profileErr } = await supabase.from('school_profiles').upsert({
          school_id: schoolId,
          pct_frl: stepData.pctFrl,
          pct_iep: stepData.pctIep,
          pct_ell: stepData.pctEll,
          pct_hicap: stepData.pctHicap,
        }, { onConflict: 'school_id' })
        if (profileErr) throw profileErr
      })
      setStep(3)
    } catch { /* trackSave already toasted */ }
  }, [schoolId, supabase, trackSave])

  const skipDemographics = useCallback(() => {
    // Leave demographics at 0 and advance to staffing
    setData((prev) => ({ ...prev, pctFrl: 0, pctIep: 0, pctEll: 0, pctHicap: 0 }))
    setStep(3)
  }, [])

  const saveStep4 = useCallback(async (positions: WizardData['positions']) => {
    if (!schoolId) return
    setData((prev) => ({ ...prev, positions }))

    try {
      await trackSave(async () => {
        // Typed rows, replaced in one transaction (Years 2-5 kept) — never delete-then-insert.
        const result = await replaceYearOneStaffing(supabase, schoolId, positions, data.pathway)
        if (!result.ok) throw new Error(result.message)
      })
      setStep(4)
    } catch { /* trackSave already toasted */ }
  }, [schoolId, supabase, trackSave, data.pathway])

  const completeOnboarding = useCallback(async (opsData: WizardData['operations'], startupFunding: StartupFundingSource[], customRevenue?: { key: string; label: string; amount: number }[]) => {
    if (!schoolId) return
    // P-UX-14: one submission at a time — a double-click or Enter-mash can't fire a second
    // completion before React re-renders the disabled button.
    if (completingRef.current) return
    completingRef.current = true
    setSaving(true)
    setError(null)
    setData((prev) => ({ ...prev, operations: opsData, startupFunding }))

    const fail = (message: string) => {
      setError(message)
      setSaving(false)
      completingRef.current = false
    }

    try {
      // Save startup funding and custom revenue lines to profile
      const profileUpdate: Record<string, unknown> = {
        school_id: schoolId,
        startup_funding: startupFunding,
      }
      if (customRevenue) {
        profileUpdate.custom_revenue_lines = customRevenue
      }
      // P-UX-24: stop here if this fails — building the budget without it would land the
      // founder on a dashboard missing their startup funding with nothing saying so.
      const { error: profileErr } = await supabase.from('school_profiles').upsert(profileUpdate, { onConflict: 'school_id' })
      if (profileErr) {
        console.error('[onboarding] saving startup funding failed:', profileErr)
        fail(`Couldn't save your startup funding${customRevenue ? ' and revenue lines' : ''}, so your budget wasn't built yet. Nothing was lost — press Complete Onboarding to try again. (${profileErr.message})`)
        return
      }

      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positions: data.positions,
          operations: opsData,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[onboarding] completion failed:', err)
        fail(`${err.error || 'Failed to save budget data.'} Press Complete Onboarding to try again.`)
        return
      }

      setCompleted(true)
      setSaving(false)
      completingRef.current = false
    } catch (e) {
      console.error('[onboarding] network error:', e)
      fail('Network error. Please check your connection and press Complete Onboarding to try again.')
    }
  }, [schoolId, data.positions, supabase])

  // Derive Y1 sections from expansion plan (sectionsPerGrade × openingGrades)
  const sectionsY1 = data.expansionPlan.length > 0
    ? data.expansionPlan.filter(e => e.year === 1).reduce((sum, e) => sum + e.sections, 0)
    : Math.ceil(data.enrollmentY1 / data.maxClassSize)

  // Pathway config
  const pathwayConfig = getStateConfig(data.pathway)

  // Calculate total personnel cost for operations step — pathway-aware benefits
  const totalPersonnelCost = data.positions.reduce((sum, p) => {
    const sal = p.fte * p.salary
    return sum + sal + Math.round(sal * pathwayConfig.benefits_load)
  }, 0)

  // Year-1 Small School Enhancement for the previews, with the engine's rule: it comes from
  // the grade expansion plan, so it is $0 in simple enrollment mode (no plan is saved).
  const sseY1 = useMemo(() => {
    if (data.enrollmentMode !== 'grade_expansion' || data.expansionPlan.length === 0) return 0
    const a = DEFAULT_ASSUMPTIONS
    return calcSmallSchoolEnhancement(data.expansionPlan, 1, a.aafte_pct, a.regular_ed_per_pupil, a.regionalization_factor || 1.0, 1, a.revenue_cola_pct)
  }, [data.enrollmentMode, data.expansionPlan])

  // Completion summary metrics — pathway-aware
  const completionMetrics = useMemo(() => {
    let totalRevenue: number
    if (pathwayConfig.revenue_model === 'tuition') {
      totalRevenue = data.enrollmentY1 * data.tuitionRate * (1 - data.financialAidPct)
    } else {
      const rev = calcCommissionRevenue(data.enrollmentY1, data.pctFrl, data.pctIep, data.pctEll, data.pctHicap, DEFAULT_ASSUMPTIONS, 1, sseY1)
      totalRevenue = rev.total
    }
    const totalFte = data.positions.reduce((s, p) => s + p.fte, 0)
    const personnelPct = totalRevenue > 0 ? ((totalPersonnelCost / totalRevenue) * 100).toFixed(1) : '0'
    return { totalRevenue, totalPersonnelCost, totalFte, personnelPct }
  }, [data, totalPersonnelCost, pathwayConfig, sseY1])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">Loading your school data...</p>
        </div>
      </div>
    )
  }

  // Completion screen
  if (completed) {
    const pdfLabel = data.pathway === 'wa_charter' ? 'Budget Narrative PDF' : 'Financial Plan PDF'
    const advisorCount = data.pathway === 'wa_charter' ? 7 : 5

    function navigateAfterOnboarding(target: string) {
      if (navigating) return
      setNavigating(true)
      try { sessionStorage.setItem('onboarding_just_completed', 'true') } catch { /* storage blocked */ }
      router.push(target)
    }

    return (
      <div className="max-w-3xl mx-auto">
        {navigating && <SetupInterstitial title="Opening your dashboard…" detail="Loading your financial model." />}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-[bounce_1s_ease-in-out]">
            <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-semibold text-slate-900 mb-2" style={{ fontFamily: 'var(--font-heading-var)' }}>
            Your Budget is Ready
          </h1>
          <p className="text-slate-500">
            {data.schoolName}&apos;s financial model has been built. Here&apos;s a quick snapshot.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Year 1 Revenue</p>
            <p className="text-lg font-bold text-slate-800 font-tabular">{fmt(completionMetrics.totalRevenue)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Personnel Cost</p>
            <p className="text-lg font-bold text-slate-800 font-tabular">{fmt(completionMetrics.totalPersonnelCost)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Total FTE</p>
            <p className="text-lg font-bold text-slate-800 font-tabular">{completionMetrics.totalFte.toFixed(1)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Personnel %</p>
            <p className={`text-lg font-bold font-tabular ${healthColor(
              evaluatePersonnelPct(completionMetrics.totalRevenue > 0 ? Number(completionMetrics.personnelPct) : null, 1, healthPathway(data.pathway)).status,
              'twText',
            )}`}>{completionMetrics.personnelPct}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <CompletionCta
            primary
            icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
            )}
            title="Go to Dashboard"
            description="Explore your financial model"
            onClick={() => navigateAfterOnboarding('/dashboard?onboarding=complete')}
          />
          <CompletionCta
            icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <rect x="4" y="6" width="16" height="12" rx="2" />
                <path d="M9 11h.01M15 11h.01M9 15h6" />
                <path d="M12 2v4" />
              </svg>
            )}
            title="Run Advisory Panel"
            description={`Get AI feedback from ${advisorCount} advisors`}
            onClick={() => navigateAfterOnboarding('/dashboard/advisory?onboarding=complete')}
          />
          <CompletionCta
            icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 12v5M9 15l3 3 3-3" />
              </svg>
            )}
            title="Export PDF"
            description={`Download your ${pdfLabel}`}
            onClick={() => navigateAfterOnboarding('/dashboard?onboarding=complete')}
          />
        </div>

        <Callout variant="info">
          <strong>Tip:</strong> The guided tutorial walks you through each tab. Look for the <strong>?</strong> icon on any page to restart it.
        </Callout>
      </div>
    )
  }

  // Welcome screen (pre-step)
  if (step === -1) {
    return (
      <div>
        <OnboardingStepper steps={STEPS} currentIndex={-1} />

        {/* Welcome content */}
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-semibold text-slate-900 mb-2" style={{ fontFamily: 'var(--font-heading-var)' }}>
              Welcome to SchoolLaunch
            </h1>
            <p className="text-base text-slate-500">
              In about {STEPS.reduce((s, x) => s + x.minutes, 0)} minutes you&rsquo;ll have a {data.pathway === 'wa_charter' ? 'Commission-aligned' : 'comprehensive'} Year 1 budget you can refine on your dashboard.
            </p>
          </div>

          <ol className="space-y-3 mb-8">
            {STEPS.map((s, i) => (
              <li
                key={s.label}
                className="flex items-start gap-4 px-4 py-3 rounded-lg border border-slate-200 bg-white"
              >
                <span
                  className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold"
                  style={{
                    background: 'var(--teal-50)',
                    color: 'var(--teal-700)',
                    fontFamily: 'var(--font-heading-var)',
                  }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-800" style={{ fontFamily: 'var(--font-heading-var)' }}>
                      {s.label}
                    </h3>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      ~{s.minutes} min
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{s.outcome}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="text-center">
            <button
              onClick={() => setStep(0)}
              className="bg-teal-600 text-white px-8 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors"
            >
              Get started
            </button>
            <p className="text-xs text-slate-400 mt-3">
              You can change any of these answers later in Settings.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <OnboardingStepper steps={STEPS} currentIndex={step} />
      <div className="text-center mb-6">
        <h2 className="text-[24px] font-semibold text-slate-900" style={{ fontFamily: 'var(--font-heading-var)' }}>{STEPS[step].label}</h2>
        <p className="text-[15px] text-slate-400 mt-1">Step {step + 1} of {STEPS.length}</p>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {saving && step === 4 && (
        <SetupInterstitial
          title="Setting up your school…"
          detail="Saving your staffing plan and building your Year 1 budget and base scenario. This takes a few seconds — please keep this page open."
        />
      )}

      {error && (
        <div ref={errorRef} role="alert" className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {step === 0 && (
        <StepIdentity
          initialData={{
            schoolName: data.schoolName,
            region: data.region,
            plannedOpenYear: data.plannedOpenYear,
            foundingGrades: data.openingGrades,
            buildoutGrades: data.buildoutGrades,
            state: data.state,
            schoolType: data.schoolType,
            fiscalYearStartMonth: data.fiscalYearStartMonth,
          }}
          onNext={saveStep1}
        />
      )}

      {step === 1 && (
        <StepEnrollment
          initialData={{
            enrollmentY1: data.enrollmentY1,
            maxClassSize: data.maxClassSize,
            enrollmentY2: data.enrollmentY2,
            enrollmentY3: data.enrollmentY3,
            enrollmentY4: data.enrollmentY4,
            growthPreset: data.growthPreset,
            tuitionRate: data.tuitionRate,
            financialAidPct: data.financialAidPct * 100,
          }}
          gradeConfig={data.gradeConfig}
          pctFrl={data.pctFrl}
          pctIep={data.pctIep}
          pctEll={data.pctEll}
          pctHicap={data.pctHicap}
          pathway={data.pathway}
          initialOpeningGrades={data.openingGrades.length > 0 ? data.openingGrades : undefined}
          initialBuildoutGrades={data.buildoutGrades.length > 0 ? data.buildoutGrades : undefined}
          initialRetentionRate={data.retentionRate}
          initialExpansionPlan={data.expansionPlan.length > 0 ? data.expansionPlan : undefined}
          onNext={saveStep2}
          onBack={() => setStep(0)}
        />
      )}

      {step === 2 && (
        <StepDemographics
          enrollment={data.enrollmentY1}
          region={data.region}
          openingGrades={data.openingGrades}
          initialData={{
            pctFrl: data.pctFrl,
            pctIep: data.pctIep,
            pctEll: data.pctEll,
            pctHicap: data.pctHicap,
          }}
          pathway={data.pathway}
          onNext={saveStep3}
          onSkip={skipDemographics}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <StepStaffing
          enrollment={data.enrollmentY1}
          maxClassSize={data.maxClassSize}
          sectionsY1={sectionsY1}
          gradeConfig={data.gradeConfig}
          openingGrades={data.openingGrades}
          expansionPlan={data.expansionPlan}
          pctFrl={data.pctFrl}
          pctIep={data.pctIep}
          pctEll={data.pctEll}
          pctHicap={data.pctHicap}
          pathway={data.pathway}
          tuitionRate={data.tuitionRate}
          financialAidPct={data.financialAidPct}
          sseY1={sseY1}
          initialPositions={data.positions}
          onNext={saveStep4}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && (
        <StepOperations
          enrollment={data.enrollmentY1}
          totalPersonnelCost={totalPersonnelCost}
          pctFrl={data.pctFrl}
          pctIep={data.pctIep}
          pctEll={data.pctEll}
          pctHicap={data.pctHicap}
          pathway={data.pathway}
          sseY1={sseY1}
          tuitionRate={data.tuitionRate}
          financialAidPct={data.financialAidPct}
          initialData={data.operations}
          startupFunding={data.startupFunding}
          onComplete={completeOnboarding}
          onBack={() => setStep(3)}
          saving={saving}
        />
      )}
    </div>
  )
}

function CompletionCta({
  primary,
  icon,
  title,
  description,
  onClick,
}: {
  primary?: boolean
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  if (primary) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col items-start text-left rounded-xl px-5 py-4 transition-colors text-white"
        style={{ background: 'var(--navy-dark)' }}
      >
        <div className="text-white opacity-90">{icon}</div>
        <div className="mt-3 font-semibold" style={{ fontFamily: 'var(--font-heading-var)' }}>{title}</div>
        <div className="text-xs mt-0.5 text-white/70">{description}</div>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start text-left rounded-xl border border-slate-200 bg-white hover:border-slate-300 px-5 py-4 transition-colors"
    >
      <div style={{ color: 'var(--navy-dark)' }}>{icon}</div>
      <div className="mt-3 font-semibold text-slate-800" style={{ fontFamily: 'var(--font-heading-var)' }}>{title}</div>
      <div className="text-xs mt-0.5 text-slate-500">{description}</div>
    </button>
  )
}

/**
 * P-UX-14: full-screen "working" state for onboarding completion. It overlays the form
 * (which stays mounted, so nothing typed is lost if completion fails) and announces itself
 * to screen readers.
 */
function SetupInterstitial({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-white/95"
      data-testid="onboarding-setup-interstitial"
    >
      <div className="max-w-sm text-center">
        <div className="w-12 h-12 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-5" aria-hidden="true" />
        <p className="text-lg font-semibold text-slate-900" style={{ fontFamily: 'var(--font-heading-var)' }}>{title}</p>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') {
    return <div aria-hidden="true" className="h-4 mt-2" />
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 inline-flex items-center gap-1.5 text-xs"
      style={{
        color:
          status === 'error' ? 'var(--rose-700)' :
            status === 'saved' ? 'var(--teal-700)' :
              'var(--text-tertiary)',
      }}
    >
      {status === 'saving' && (
        <>
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          <span>Saving&hellip;</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
          <span>Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" strokeWidth={2} />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
          <span>Save failed &mdash; press Continue again to retry.</span>
        </>
      )}
    </div>
  )
}
