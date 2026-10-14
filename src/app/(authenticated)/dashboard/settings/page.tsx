'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useScenario } from '@/lib/ScenarioContext'
import { createClient } from '@/lib/supabase/client'
import { replaceGradeExpansionPlan, replaceFailureMessage, type ReplaceResult } from '@/lib/atomicReplace'
import { calcCommissionRevenue, calcSmallSchoolEnhancement, SMALL_SCHOOL_THRESHOLDS } from '@/lib/calculations'
import { benefitsPctFor } from '@/lib/budgetEngine'
import type { FinancialAssumptions, GradeExpansionEntry } from '@/lib/types'
import { getAssumptions, ASSUMPTIONS_VERSION_KEY, CURRENT_ASSUMPTIONS_VERSION } from '@/lib/types'
import { REGIONALIZATION_FACTORS } from '@/lib/regionalization'
import GradeExpansionEditor from '@/components/GradeExpansionEditor'
import TeamSection from '@/components/settings/TeamSection'
import LogoUpload from '@/components/settings/LogoUpload'
import StartupFundingEditor from '@/components/dashboard/StartupFundingEditor'
import { usePermissions } from '@/hooks/usePermissions'
import { useStateConfig } from '@/contexts/StateConfigContext'
import { useSchoolSession } from '@/contexts/SchoolSessionContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { SettingsSkeleton } from '../_skeletons'
import { UnsavedIndicator } from '@/components/ui/UnsavedIndicator'
import { useSavedSnapshot, useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { toast } from '@/components/ui/Toast'

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const COUNTY_KEYS = Object.keys(REGIONALIZATION_FACTORS)
const GRADE_CONFIGS = ['K-5', 'K-8', '6-8', '6-12', '9-12', 'K-12']

// Revenue rate inputs. P-UX-26: an explicit $0 is honored (it excludes that revenue line),
// so save rejects only a negative or empty rate.
const REVENUE_RATE_FIELDS: Array<[keyof FinancialAssumptions, string]> = [
  ['regular_ed_per_pupil', 'Regular Ed per Pupil'],
  ['sped_per_pupil', 'SPED Apportionment per Pupil'],
  ['state_sped_per_pupil', 'State Special Ed per Pupil'],
  ['lap_high_poverty_per_pupil', 'LAP High Poverty per Student'],
  ['facilities_per_pupil', 'Facilities per Pupil'],
  ['levy_equity_per_student', 'Levy Equity per Student'],
  ['title_i_per_pupil', 'Title I per FRL Student'],
  ['idea_per_pupil', 'IDEA per IEP Student'],
  ['lap_per_pupil', 'LAP per FRL Student'],
  ['tbip_per_pupil', 'TBIP per ELL Student'],
  ['hicap_per_pupil', 'Highly Capable per HiCap Student'],
  ['food_service_revenue_per_pupil', 'Food Service Revenue per Student'],
  ['transportation_revenue_per_pupil', 'Transportation Revenue per Student'],
]

// A cleared rate box stays empty (NaN in state) instead of silently becoming $0, so save can
// tell "cleared" apart from an intentional $0.
function parseRate(raw: string): number {
  return raw.trim() === '' ? NaN : Number(raw)
}
function rateValue(v: number): number | '' {
  return typeof v === 'number' && Number.isNaN(v) ? '' : v
}

/** The saved shape of the grade editor's state, for unsaved-changes comparison. */
function expansionKey(d: { openingGrades: string[]; buildoutGrades: string[]; retentionRate: number; plan: GradeExpansionEntry[] }): string {
  return JSON.stringify({ o: d.openingGrades, b: d.buildoutGrades, r: d.retentionRate, p: d.plan })
}

export default function SettingsPage() {
  const {
    schoolData: { schoolId, schoolName, profile, gradeExpansionPlan, loading, reload },
    assumptions,
  } = useScenario()
  const supabase = createClient()
  const { canEdit, canManageTeam, canResetSchool, canEditIdentity } = usePermissions()
  const { config: pathwayConfig } = useStateConfig()
  const isWaCharter = pathwayConfig.pathway === 'wa_charter'
  useDocumentTitle('Settings', schoolName)
  // Current user (team section), from the session lookup the layout already ran.
  const currentUserId = useSchoolSession().userId

  const [name, setName] = useState(schoolName)
  const [region, setRegion] = useState(profile.region)
  const [openYear, setOpenYear] = useState(profile.planned_open_year)
  const [gradeConfig, setGradeConfig] = useState(profile.grade_config)
  const [pctFrl, setPctFrl] = useState(profile.pct_frl)
  const [pctIep, setPctIep] = useState(profile.pct_iep)
  const [pctEll, setPctEll] = useState(profile.pct_ell)
  const [pctHicap, setPctHicap] = useState(profile.pct_hicap)
  const [logoUrl, setLogoUrl] = useState<string | null>(profile.logo_url || null)

  const [fa, setFa] = useState<FinancialAssumptions>({ ...assumptions })

  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [dangerExpanded, setDangerExpanded] = useState(false)

  // Grade expansion state
  const [expansionData, setExpansionData] = useState<{
    openingGrades: string[]
    buildoutGrades: string[]
    retentionRate: number
    plan: GradeExpansionEntry[]
    enrollments: { year: number; total: number; returning: number; newGrade: number; grades: string[]; newGrades: string[] }[]
  } | null>(null)

  // The grade editor reports its state on mount; that first report is the saved plan.
  const [expansionSnapshot, setExpansionSnapshot] = useState<string | null>(null)
  const handleExpansionChange = useCallback((data: {
    openingGrades: string[]
    buildoutGrades: string[]
    retentionRate: number
    plan: GradeExpansionEntry[]
    enrollments: { year: number; total: number; returning: number; newGrade: number; grades: string[]; newGrades: string[] }[]
  }) => {
    setExpansionData(data)
    setExpansionSnapshot((prev) => prev ?? expansionKey(data))
  }, [])


  // Enrollment is derived from expansion plan (read-only)
  const enrollY1 = expansionData?.enrollments.find((e) => e.year === 1)?.total ?? profile.target_enrollment_y1
  const enrollY2 = expansionData?.enrollments.find((e) => e.year === 2)?.total ?? profile.target_enrollment_y2
  const enrollY3 = expansionData?.enrollments.find((e) => e.year === 3)?.total ?? profile.target_enrollment_y3
  const enrollY4 = expansionData?.enrollments.find((e) => e.year === 4)?.total ?? profile.target_enrollment_y4
  const enrollY5 = expansionData?.enrollments.find((e) => e.year === 5)?.total ?? profile.target_enrollment_y5

  const form = { name, region, openYear, gradeConfig, pctFrl, pctIep, pctEll, pctHicap, fa }
  const { dirty: formDirty, markSaved: markFormSaved } = useSavedSnapshot(form)

  // Initialize from loaded data (runs once when loading finishes)
  const [initialized, setInitialized] = useState(false)
  if (!initialized && !loading && profile.school_id) {
    setName(schoolName)
    setRegion(profile.region)
    setOpenYear(profile.planned_open_year)
    setGradeConfig(profile.grade_config)
    setPctFrl(profile.pct_frl)
    setPctIep(profile.pct_iep)
    setPctEll(profile.pct_ell)
    setPctHicap(profile.pct_hicap)
    setLogoUrl(profile.logo_url || null)
    // Show the rates the engine actually uses (getAssumptions remaps retired defaults).
    setFa(getAssumptions(profile.financial_assumptions))
    markFormSaved({
      name: schoolName, region: profile.region, openYear: profile.planned_open_year, gradeConfig: profile.grade_config,
      pctFrl: profile.pct_frl, pctIep: profile.pct_iep, pctEll: profile.pct_ell, pctHicap: profile.pct_hicap,
      fa: getAssumptions(profile.financial_assumptions),
    })
    setInitialized(true)
  }

  // Unsaved-changes guard: one Save covers every section on this page.
  const expansionDirty = expansionData !== null && expansionSnapshot !== null && expansionKey(expansionData) !== expansionSnapshot
  const settingsDirty = formDirty || expansionDirty
  useUnsavedChanges(settingsDirty, 'Settings')

  // Deep links such as /dashboard/settings#startup-funding can arrive while the skeleton is
  // showing, before the target section exists; scroll to it once the sections render.
  useEffect(() => {
    if (loading) return
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(decodeURIComponent(id))?.scrollIntoView({ block: 'start' })
  }, [loading])

  // Year-1 categorical preview from the engine's revenue function on the live (unsaved) rates,
  // so it matches what Revenue and Multi-Year show after Save (incl. the LAP High Poverty gate).
  // An empty rate box previews as $0.
  const previewFa: FinancialAssumptions = { ...fa }
  for (const [field] of REVENUE_RATE_FIELDS) {
    if (rateValue(previewFa[field] as number) === '') (previewFa as unknown as Record<string, number>)[field] = 0
  }
  const previewRev = calcCommissionRevenue(enrollY1, pctFrl, pctIep, pctEll, pctHicap, previewFa)
  const grantPreview = {
    titleI: previewRev.titleI,
    idea: previewRev.idea,
    lap: previewRev.lap,
    lapHighPoverty: previewRev.lapHighPoverty,
    tbip: previewRev.tbip,
    hicap: previewRev.hicap,
  }

  const totalGrants = grantPreview.titleI + grantPreview.idea + grantPreview.lap + grantPreview.lapHighPoverty + grantPreview.tbip + grantPreview.hicap

  function updateFa(field: keyof FinancialAssumptions, value: number | boolean) {
    setFa((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    if (!schoolId) return

    // P-UX-26: a $0 rate is saved and honored. Reject a rate the founder changed to a negative
    // or empty value (untouched stored values are left alone so a hidden field never blocks Save).
    const loadedFa = getAssumptions(profile.financial_assumptions)
    const badRate = REVENUE_RATE_FIELDS.find(([field]) => {
      const v = fa[field] as number
      return v !== loadedFa[field] && !(Number.isFinite(v) && v >= 0)
    })
    if (badRate) {
      const cleared = rateValue(fa[badRate[0]] as number) === ''
      toast.error(
        cleared
          ? `${badRate[1]} is empty. Enter a rate, or 0 to exclude the line. Changes not saved.`
          : `${badRate[1]}: rates can't be negative. Enter 0 to exclude a line. Changes not saved.`,
        { duration: Infinity },
      )
      return
    }

    setSaving(true)

    // Enforce pathway-level authorizer fee lock (e.g., WA Commission contract = 3%, non-negotiable).
    const faLocked: FinancialAssumptions = pathwayConfig.authorizer_fee_editable
      ? fa
      : { ...fa, authorizer_fee_pct: pathwayConfig.authorizer_fee * 100 }
    // Mark the rates as founder-confirmed so getAssumptions stops remapping retired defaults.
    const faToSave = { ...faLocked, [ASSUMPTIONS_VERSION_KEY]: CURRENT_ASSUMPTIONS_VERSION }

    const profileUpdate: Record<string, unknown> = {
      region,
      planned_open_year: openYear,
      grade_config: gradeConfig,
      target_enrollment_y1: enrollY1,
      target_enrollment_y2: enrollY2,
      target_enrollment_y3: enrollY3,
      target_enrollment_y4: enrollY4,
      target_enrollment_y5: enrollY5,
      pct_frl: pctFrl,
      pct_iep: pctIep,
      pct_ell: pctEll,
      pct_hicap: pctHicap,
      financial_assumptions: faToSave,
    }

    if (expansionData) {
      profileUpdate.opening_grades = expansionData.openingGrades
      profileUpdate.buildout_grades = expansionData.buildoutGrades
      profileUpdate.retention_rate = expansionData.retentionRate
    }

    const [schoolRes, profileRes] = await Promise.all([
      supabase.from('schools').update({ name }).eq('id', schoolId),
      supabase.from('school_profiles').update(profileUpdate).eq('school_id', schoolId),
    ])

    const profileSaved = !schoolRes.error && !profileRes.error

    // Save grade expansion plan rows — delete + insert in one transaction, and only once the
    // profile it belongs to (opening/buildout grades, retention) has saved.
    let planResult: ReplaceResult = { ok: true }
    if (profileSaved && expansionData && expansionData.plan.length > 0) {
      const rows = expansionData.plan.map((e) => ({
        school_id: schoolId,
        year: e.year,
        grade_level: e.grade_level,
        sections: e.sections,
        students_per_section: e.students_per_section,
        is_new_grade: e.is_new_grade,
      }))
      planResult = await replaceGradeExpansionPlan(supabase, schoolId, rows)
    }

    setSaving(false)
    if (profileSaved) {
      markFormSaved(form)
      if (planResult.ok && expansionData) setExpansionSnapshot(expansionKey(expansionData))
    }
    if (!profileSaved) {
      toast.error('Save failed — changes not saved. Please try again.', { duration: Infinity })
      console.error('Settings save error:', schoolRes.error, profileRes.error)
    } else if (!planResult.ok) {
      // Keep the editor's unsaved plan on screen (no reload) so Save can be retried.
      toast.error(`${replaceFailureMessage('grade expansion plan', planResult)} Your other settings were saved.`, { duration: Infinity })
      console.error('Grade expansion plan save error:', planResult.message)
    } else {
      toast.success('Saved')
      await reload()
    }
  }

  if (loading) {
    return <SettingsSkeleton />
  }

  const sections: Array<{ id: string; label: string; visible: boolean }> = [
    { id: 'school-profile', label: 'School Profile', visible: true },
    { id: 'team-members', label: 'Team Members', visible: !!(canManageTeam && schoolId && currentUserId) },
    { id: 'enrollment-demographics', label: 'Enrollment & Demographics', visible: true },
    { id: 'grade-expansion-plan', label: 'Grade Expansion Plan', visible: true },
    { id: 'programs', label: 'Programs', visible: true },
    { id: 'startup-funding', label: 'Startup Funding', visible: true },
    { id: 'revenue-assumptions', label: 'Revenue Assumptions', visible: true },
    { id: 'expense-assumptions', label: 'Expense Assumptions', visible: true },
    { id: 'operations-benchmarks', label: 'Operations Benchmarks', visible: true },
    { id: 'danger-zone', label: 'Danger Zone', visible: !!canResetSchool },
  ].filter((s) => s.visible)

  return (
    <div className="animate-fade-in">
      <div data-tour="settings-header">
        <PageHeader
          title="Settings"
          subtitle="School profile, demographics, financial assumptions, and team management."
        />
      </div>

      {!canEdit && (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
          You have view-only access. Contact the school owner to request edit permissions.
        </div>
      )}

      <div className="md:grid md:grid-cols-[200px_1fr] md:gap-8">
        <SettingsSubRail sections={sections} />
        <div className="max-w-3xl">

      {/* Section 1: School Profile */}
      <div id="school-profile" data-tour="school-profile" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">School Profile</h2>
        {schoolId && (
          <LogoUpload
            schoolId={schoolId}
            schoolName={name}
            logoUrl={logoUrl}
            canEdit={canEditIdentity}
            onUpdate={(url) => setLogoUrl(url)}
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">School Name</label>
            <input aria-label="School Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEditIdentity}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
            />
          </div>
          {isWaCharter && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">WA County / Region</label>
              <select aria-label="WA County / Region"
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value)
                  const factor = REGIONALIZATION_FACTORS[e.target.value]?.factor ?? 1.0
                  updateFa('regionalization_factor', factor)
                }}
                disabled={!canEditIdentity}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
              >
                <option value="">Select county...</option>
                {COUNTY_KEYS.map((key) => <option key={key} value={key}>{REGIONALIZATION_FACTORS[key].label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Planned Opening Year</label>
            <input aria-label="Planned Opening Year"
              type="number"
              value={openYear}
              onChange={(e) => setOpenYear(Number(e.target.value))}
              disabled={!canEditIdentity}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Grade Configuration</label>
            <select aria-label="Grade Configuration"
              value={gradeConfig}
              onChange={(e) => setGradeConfig(e.target.value)}
              disabled={!canEditIdentity}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-600"
            >
              <option value="">Select grades...</option>
              {GRADE_CONFIGS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        <SaveSectionButton saving={saving} dirty={settingsDirty} canEdit={canEditIdentity} onClick={handleSave} />
      </div>

      {/* Section: Team Members (CEO only) */}
      {canManageTeam && schoolId && currentUserId && (
        <div id="team-members" className="scroll-mt-6">
          <TeamSection schoolId={schoolId} currentUserId={currentUserId} schoolName={schoolName} />
        </div>
      )}

      {/* Section 2: Enrollment & Demographics */}
      <div id="enrollment-demographics" data-tour="enrollment-demographics" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Enrollment & Demographics</h2>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-2">
          {[
            { label: 'Year 1', value: enrollY1 },
            { label: 'Year 2', value: enrollY2 },
            { label: 'Year 3', value: enrollY3 },
            { label: 'Year 4', value: enrollY4 },
            { label: 'Year 5', value: enrollY5 },
          ].map(({ label, value }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label} Enrollment</label>
              <input type="number" value={value} readOnly tabIndex={-1} aria-label={`${label} Enrollment`}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600 cursor-default" />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mb-6">Enrollment is calculated from your Grade Expansion Plan below.</p>

        <div className="space-y-4">
          {[
            { label: '% Free/Reduced Lunch', value: pctFrl, set: setPctFrl },
            { label: '% IEP', value: pctIep, set: setPctIep },
            { label: '% ELL', value: pctEll, set: setPctEll },
            { label: '% Highly Capable', value: pctHicap, set: setPctHicap },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <div className="flex justify-between text-xs font-medium text-slate-500 mb-1">
                <span>{label}</span>
                <span>{value}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={1} value={value}
                aria-label={label}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full accent-teal-600"
              />
            </div>
          ))}
        </div>

        {/* Grant preview */}
        <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
            Estimated Categorical Grants (Year 1)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Title I</span><span className="font-medium text-slate-700">{fmt(grantPreview.titleI)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">IDEA</span><span className="font-medium text-slate-700">{fmt(grantPreview.idea)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">LAP</span><span className="font-medium text-slate-700">{fmt(grantPreview.lap)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">LAP High Poverty</span><span className="font-medium text-slate-700">{fmt(grantPreview.lapHighPoverty)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">TBIP</span><span className="font-medium text-slate-700">{fmt(grantPreview.tbip)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">HiCap</span><span className="font-medium text-slate-700">{fmt(grantPreview.hicap)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600 font-semibold">Total</span><span className="font-bold text-slate-800">{fmt(totalGrants)}</span></div>
          </div>
        </div>
        <SaveSectionButton saving={saving} dirty={settingsDirty} canEdit={canEdit} onClick={handleSave} />
      </div>

      {/* Section: Grade Expansion Plan */}
      <div id="grade-expansion-plan" data-tour="grade-expansion" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Grade Expansion Plan</h2>
        <p className="text-xs text-slate-500 mb-4">
          Define which grade levels you open with and how you expand year over year. This produces cohort-based enrollment projections that authorizers find more credible than flat growth rates.
        </p>
        <GradeExpansionEditor
          gradeConfig={gradeConfig}
          maxClassSize={profile.max_class_size}
          initialOpeningGrades={profile.opening_grades || undefined}
          initialBuildoutGrades={profile.buildout_grades || undefined}
          initialRetentionRate={profile.retention_rate ?? undefined}
          initialPlan={gradeExpansionPlan}
          onChange={handleExpansionChange}
        />
        <SaveSectionButton saving={saving} dirty={settingsDirty} canEdit={canEdit} onClick={handleSave} />
      </div>

      {/* Section 3: Programs */}
      <div id="programs" data-tour="programs-section" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Programs</h2>
        <p className="text-xs text-slate-500 mb-4">
          Toggle programs your school plans to offer. Enabling a program adds its line item to the Operations budget.
        </p>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200">
            <div>
              <div className="text-sm font-medium text-slate-800">Food Service</div>
              <div className="text-xs text-slate-500">
                Adds {fmt(fa.food_service_per_student)}/student to operations.
                Schools with high FRL% may qualify for USDA NSLP reimbursement (CEP).
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!fa.food_service_offered}
              aria-label="Food service program"
              disabled={!canEdit}
              onClick={() => updateFa('food_service_offered', !fa.food_service_offered)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                fa.food_service_offered ? 'bg-teal-600' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                fa.food_service_offered ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200">
            <div>
              <div className="text-sm font-medium text-slate-800">Transportation</div>
              <div className="text-xs text-slate-500">
                Adds {fmt(fa.transportation_per_student)}/student to operations.
                {isWaCharter && 'Required under RCW 28A.710.040 for WA charter schools.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!fa.transportation_offered}
              aria-label="Transportation program"
              disabled={!canEdit}
              onClick={() => updateFa('transportation_offered', !fa.transportation_offered)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                fa.transportation_offered ? 'bg-teal-600' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                fa.transportation_offered ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* Startup Funding (P-UX-08): the canonical editor for startup funding sources. It loads
          and saves on its own, so it has its own Save rather than the page-wide one. */}
      <div id="startup-funding" data-tour="startup-funding" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Startup Funding</h2>
        <p className="text-xs text-slate-500 mb-4">
          Grants, gifts, loans and founder capital that fund pre-opening costs and early years. One-time funds count
          toward Total Revenue but not sustainability metrics. Only Received and Pledged funds count as secured.
          {isWaCharter && fa.csp_operating_revenue !== false && ' A CSP grant counts as operating revenue in Years 1–5 (Revenue Assumptions below).'}
          {' '}This section saves separately.
        </p>
        <StartupFundingEditor />
      </div>

      {/* Section 4: Revenue Assumptions */}
      <div id="revenue-assumptions" data-tour="revenue-assumptions" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Revenue Assumptions</h2>
        <p className="text-xs text-slate-500 mb-4">{isWaCharter ? 'Commission-aligned per-pupil rates. State apportionment uses AAFTE (Annual Average FTE).' : 'Revenue rates and escalation settings for your financial projections.'}</p>

        {/* R-REV-04: CSP grant as operating revenue (WA). */}
        {isWaCharter && (
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-slate-200 mb-4">
            <div>
              <div id="csp-operating-label" className="text-sm font-medium text-slate-800">Count the CSP grant as operating revenue</div>
              <div className="text-xs text-slate-500">
                On (the default, as in the Commission&apos;s financial plan template): Charter Schools Program grant
                allocations for Years 1–5 count as recurring federal revenue, so they&apos;re in Operating Revenue for Total
                Margin, Personnel % and Facility %. Off: they&apos;re one-time startup grants. Either way they&apos;re in net
                income and cash. A funding source counts as CSP when its name includes &ldquo;CSP&rdquo; or &ldquo;Charter
                Schools Program&rdquo;; its Year 0 share stays pre-opening cash.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={fa.csp_operating_revenue !== false}
              aria-labelledby="csp-operating-label"
              disabled={!canEdit}
              onClick={() => updateFa('csp_operating_revenue', fa.csp_operating_revenue === false)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                fa.csp_operating_revenue !== false ? 'bg-teal-600' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                fa.csp_operating_revenue !== false ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        )}

        {/* Tuition settings for private/micro pathways */}
        {!isWaCharter && pathwayConfig.revenue_model === 'tuition' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 pb-4 border-b border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Annual Tuition Per Student ($)</label>
              <input aria-label="Annual Tuition Per Student ($)" type="number" step={500} defaultValue={(profile as unknown as Record<string, unknown>).tuition_rate as number || pathwayConfig.tuition_rate_default || 0}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Financial Aid Discount (%)</label>
              <input aria-label="Financial Aid Discount (%)" type="number" step={1} min={0} max={100} defaultValue={((profile as unknown as Record<string, unknown>).financial_aid_pct as number || pathwayConfig.financial_aid_pct_default || 0) * 100}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Regular Ed per Pupil ($)</label>
            <input aria-label="Regular Ed per Pupil ($)" type="number" step={100} min={0} value={rateValue(fa.regular_ed_per_pupil)}
              onChange={(e) => { updateFa('regular_ed_per_pupil', parseRate(e.target.value)); updateFa('per_pupil_rate', parseRate(e.target.value)) }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">SPED Apportionment per Pupil ($)</label>
            <input aria-label="SPED Apportionment per Pupil ($)" type="number" step={100} min={0} value={rateValue(fa.sped_per_pupil)}
              onChange={(e) => updateFa('sped_per_pupil', parseRate(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">Excess cost allocation per SPED student</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">State Special Ed per Pupil ($)</label>
            <input aria-label="State Special Ed per Pupil ($)" type="number" step={100} min={0} value={rateValue(fa.state_sped_per_pupil)}
              onChange={(e) => updateFa('state_sped_per_pupil', parseRate(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">State safety net / BEA allocation per SPED student — largest SPED revenue source</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">LAP High Poverty per Student ($)</label>
            <input aria-label="LAP High Poverty per Student ($)" type="number" step={10} min={0} value={rateValue(fa.lap_high_poverty_per_pupil)}
              onChange={(e) => updateFa('lap_high_poverty_per_pupil', parseRate(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">Applies only with ≥ 50% FRL plus a 3-year FRPL history (new applicants don&apos;t yet qualify); scales with FRL share. Enter $0 to exclude.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Facilities per Pupil ($)</label>
            <input aria-label="Facilities per Pupil ($)" type="number" step={100} min={0} value={rateValue(fa.facilities_per_pupil)}
              onChange={(e) => updateFa('facilities_per_pupil', parseRate(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">Usually $0 for WA charters</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Levy Equity per Student ($)</label>
            <input aria-label="Levy Equity per Student ($)" type="number" step={100} min={0} value={rateValue(fa.levy_equity_per_student)}
              onChange={(e) => updateFa('levy_equity_per_student', parseRate(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">$0 — WA legislature has not reinstated levy equity funding</p>
          </div>
          {isWaCharter && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Title I per FRL Student ($)</label>
                <input aria-label="Title I per FRL Student ($)" type="number" step={10} min={0} value={rateValue(fa.title_i_per_pupil)}
                  onChange={(e) => updateFa('title_i_per_pupil', parseRate(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                <p className="text-[10px] text-slate-400 mt-0.5">Federal — applies only when FRL exceeds 40%. Enter $0 to exclude.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">IDEA per IEP Student ($)</label>
                <input aria-label="IDEA per IEP Student ($)" type="number" step={10} min={0} value={rateValue(fa.idea_per_pupil)}
                  onChange={(e) => updateFa('idea_per_pupil', parseRate(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                <p className="text-[10px] text-slate-400 mt-0.5">Federal special education allocation. Enter $0 to exclude.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">LAP per FRL Student ($)</label>
                <input aria-label="LAP per FRL Student ($)" type="number" step={10} min={0} value={rateValue(fa.lap_per_pupil)}
                  onChange={(e) => updateFa('lap_per_pupil', parseRate(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                <p className="text-[10px] text-slate-400 mt-0.5">State Learning Assistance Program. Enter $0 to exclude.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">TBIP per ELL Student ($)</label>
                <input aria-label="TBIP per ELL Student ($)" type="number" step={10} min={0} value={rateValue(fa.tbip_per_pupil)}
                  onChange={(e) => updateFa('tbip_per_pupil', parseRate(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                <p className="text-[10px] text-slate-400 mt-0.5">Transitional Bilingual Instruction Program. Enter $0 to exclude.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Highly Capable per HiCap Student ($)</label>
                <input aria-label="Highly Capable per HiCap Student ($)" type="number" step={10} min={0} value={rateValue(fa.hicap_per_pupil)}
                  onChange={(e) => updateFa('hicap_per_pupil', parseRate(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                <p className="text-[10px] text-slate-400 mt-0.5">State Highly Capable program. Enter $0 to exclude.</p>
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Revenue COLA (%)</label>
            <input aria-label="Revenue COLA (%)" type="number" step={0.5} value={fa.revenue_cola_pct}
              onChange={(e) => updateFa('revenue_cola_pct', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">Annual per-pupil rate escalation</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">AAFTE % of Headcount</label>
            <input aria-label="AAFTE % of Headcount" type="number" step={1} min={80} max={100} value={fa.aafte_pct}
              onChange={(e) => updateFa('aafte_pct', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">Typical: 95%. State revenue uses AAFTE, not headcount.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Regionalization Factor</label>
            <input aria-label="Regionalization Factor" type="number" step={0.001} min={1.0} max={1.3} value={fa.regionalization_factor}
              onChange={(e) => updateFa('regionalization_factor', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            <p className="text-[10px] text-slate-400 mt-0.5">
              Set automatically from your county but can be overridden if you know your district&apos;s exact factor.
              Multiplies the state apportionment rates (Regular Ed, SPED, State Special Ed). Categorical and federal rates are not regionalized.
            </p>
          </div>
        </div>
        <SaveSectionButton saving={saving} dirty={settingsDirty} canEdit={canEdit} onClick={handleSave} />
      </div>

      {/* Section 4a: Small School Enhancement Thresholds */}
      {(() => {
        // Same rule as the engine: SSE needs grade-band enrollment, which comes from the
        // grade expansion plan; without a saved plan the engine (and every tab) uses $0.
        const gep = gradeExpansionPlan
        const hasPlan = !!gep && gep.length > 0
        const sseAmount = hasPlan
          ? calcSmallSchoolEnhancement(gep, 1, fa.aafte_pct, fa.regular_ed_per_pupil, fa.regionalization_factor || 1.0, 1, fa.revenue_cola_pct)
          : 0
        const qualifies = sseAmount > 0
        return (
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Small School Enhancement Thresholds</h2>
            <p className="text-xs text-slate-500 mb-4">WA prototypical school funding model minimum AAFTE by grade band. Schools below these thresholds receive additional state funding.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">K-6 Minimum (Elementary)</label>
                <div className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600">{SMALL_SCHOOL_THRESHOLDS.k6} AAFTE</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">7-8 Minimum (Middle)</label>
                <div className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600">{SMALL_SCHOOL_THRESHOLDS.ms} AAFTE</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">9-12 Minimum (High)</label>
                <div className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600">{SMALL_SCHOOL_THRESHOLDS.hs} AAFTE</div>
              </div>
            </div>
            <div className={`rounded-lg px-4 py-3 text-sm ${qualifies ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
              {!hasPlan
                ? <>Small school enhancement is computed from your grade expansion plan. Save a plan to see whether your school qualifies; until then it is $0 in every projection.</>
                : qualifies
                  ? <>Your school <strong>qualifies</strong> for small school enhancement in Year 1 ({fmt(sseAmount)})</>
                  : <>Your school <strong>does not qualify</strong> for small school enhancement in Year 1 — all grade bands exceed their minimums</>
              }
            </div>
          </div>
        )
      })()}

      {/* Section 4b: Expense Assumptions */}
      <div id="expense-assumptions" data-tour="expense-assumptions" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Expense Assumptions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Benefits Load (%)</label>
            {isWaCharter ? (
              <input aria-label="Benefits Load (%)" type="number" step={1} value={fa.benefits_load_pct}
                onChange={(e) => updateFa('benefits_load_pct', Number(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            ) : (
              <>
                {/* The generic engine prices benefits at the pathway's load; show what it uses. */}
                <input type="number" value={benefitsPctFor(pathwayConfig.pathway, fa)} disabled
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 cursor-not-allowed" />
                <p className="text-[10px] text-slate-400 mt-0.5">Standard benefits load for {pathwayConfig.display_name.toLowerCase()} projections.</p>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Authorizer Fee (%)</label>
            {pathwayConfig.authorizer_fee_editable ? (
              <>
                <input aria-label="Authorizer Fee (%)" type="number" step={0.5} value={fa.authorizer_fee_pct}
                  onChange={(e) => updateFa('authorizer_fee_pct', Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                <p className="text-[10px] text-slate-400 mt-0.5">Applied to state apportionment</p>
              </>
            ) : (
              <>
                <input type="number" aria-label="Authorizer Fee (%)" value={(pathwayConfig.authorizer_fee * 100).toFixed(1)} disabled
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 cursor-not-allowed" />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {isWaCharter ? 'Fixed at 3% by WA Charter School Commission contract. Applied to state operating funding: apportionment, SPED, facilities, SSE, LAP, TBIP, HiCap and state transportation.' : 'Fixed by authorizer.'}
                </p>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Annual Salary Escalator (%)</label>
            <input aria-label="Annual Salary Escalator (%)" type="number" step={0.1} value={fa.salary_escalator_pct}
              onChange={(e) => updateFa('salary_escalator_pct', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Annual Operations Escalator (%)</label>
            <input aria-label="Annual Operations Escalator (%)" type="number" step={0.1} value={fa.ops_escalator_pct}
              onChange={(e) => updateFa('ops_escalator_pct', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Interest Rate on Cash (%)</label>
            <input aria-label="Interest Rate on Cash (%)" type="number" step={0.5} value={fa.interest_rate_on_cash}
              onChange={(e) => updateFa('interest_rate_on_cash', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
        </div>
        <SaveSectionButton saving={saving} dirty={settingsDirty} canEdit={canEdit} onClick={handleSave} />
      </div>

      {/* Section 5: Operations Benchmarks */}
      <div id="operations-benchmarks" data-tour="operations-benchmarks" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6 scroll-mt-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Operations Benchmarks</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Supplies per Student ($)</label>
            <input aria-label="Supplies per Student ($)" type="number" step={10} value={fa.supplies_per_student}
              onChange={(e) => updateFa('supplies_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Contracted Services per Student ($)</label>
            <input aria-label="Contracted Services per Student ($)" type="number" step={10} value={fa.contracted_services_per_student}
              onChange={(e) => updateFa('contracted_services_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Technology per Student ($)</label>
            <input aria-label="Technology per Student ($)" type="number" step={10} value={fa.technology_per_student}
              onChange={(e) => updateFa('technology_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Insurance Annual ($)</label>
            <input aria-label="Insurance Annual ($)" type="number" step={1000} value={fa.insurance_annual}
              onChange={(e) => updateFa('insurance_annual', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Contingency % of Total Expenses</label>
            <input aria-label="Contingency % of Total Expenses" type="number" step={0.5} value={fa.contingency_pct}
              onChange={(e) => updateFa('contingency_pct', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Curriculum per Student ($)</label>
            <input aria-label="Curriculum per Student ($)" type="number" step={50} value={fa.curriculum_per_student}
              onChange={(e) => updateFa('curriculum_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Professional Development per FTE ($)</label>
            <input aria-label="Professional Development per FTE ($)" type="number" step={100} value={fa.professional_development_per_fte}
              onChange={(e) => updateFa('professional_development_per_fte', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Food Service per Student ($)</label>
            <input aria-label="Food Service per Student ($)" type="number" step={50} value={fa.food_service_per_student}
              onChange={(e) => updateFa('food_service_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Transportation per Student ($)</label>
            <input aria-label="Transportation per Student ($)" type="number" step={50} value={fa.transportation_per_student}
              onChange={(e) => updateFa('transportation_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          {fa.food_service_offered && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Food Service Revenue per Student ($)</label>
              <input aria-label="Food Service Revenue per Student ($)" type="number" step={10} min={0} value={rateValue(fa.food_service_revenue_per_pupil)}
                onChange={(e) => updateFa('food_service_revenue_per_pupil', parseRate(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
              <p className="text-[10px] text-slate-400 mt-0.5">NSLP reimbursement estimate. Schools with 60%+ FRL may receive $750-$900/student. Enter $0 to exclude.</p>
            </div>
          )}
          {fa.transportation_offered && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Transportation Revenue per Student ($)</label>
              <input aria-label="Transportation Revenue per Student ($)" type="number" step={10} min={0} value={rateValue(fa.transportation_revenue_per_pupil)}
                onChange={(e) => updateFa('transportation_revenue_per_pupil', parseRate(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
              <p className="text-[10px] text-slate-400 mt-0.5">State allocation estimate. Rural: $700-$1,000; urban: $500-$800. Enter $0 to exclude.</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Marketing per Student ($)</label>
            <input aria-label="Marketing per Student ($)" type="number" step={10} value={fa.marketing_per_student}
              onChange={(e) => updateFa('marketing_per_student', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Fundraising Annual ($)</label>
            <input aria-label="Fundraising Annual ($)" type="number" step={1000} value={fa.fundraising_annual}
              onChange={(e) => updateFa('fundraising_annual', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
          </div>
        </div>
        <SaveSectionButton saving={saving} dirty={settingsDirty} canEdit={canEdit} onClick={handleSave} />
      </div>

      {/* Danger Zone — CEO only */}
      {canResetSchool && (
        <>
        <div id="danger-zone" className="mt-12 scroll-mt-6">
          {dangerExpanded ? (
            <div
              className="rounded-xl border p-6"
              style={{
                background: 'var(--status-fails-bg)',
                borderColor: 'var(--status-fails-border)',
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--rose-700)' }}>Danger Zone</h2>
                <button
                  type="button"
                  onClick={() => setDangerExpanded(false)}
                  className="text-xs font-medium hover:underline underline-offset-4"
                  style={{ color: 'var(--rose-700)' }}
                >
                  Hide
                </button>
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                Reset all school planning data and restart the onboarding process from scratch. Your account and school record will be preserved.
              </p>
              <button
                onClick={() => setShowResetModal(true)}
                className="px-5 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ background: 'var(--rose-600)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--rose-700)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--rose-600)' }}
              >
                Reset School &amp; Start Over
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-5 py-3 bg-white">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--rose-600)' }}>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
                <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Danger Zone</h2>
              </div>
              <button
                type="button"
                onClick={() => setDangerExpanded(true)}
                className="text-xs font-medium hover:underline underline-offset-4"
                style={{ color: 'var(--rose-700)' }}
              >
                Show Danger Zone
              </button>
            </div>
          )}
        </div>

        {/* Reset confirmation modal */}
        {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Reset School Data</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will clear all planning data &mdash; staffing, budgets, scenarios, and grade plans &mdash; and restart onboarding. Your school record, team, and account are preserved. The cleared data cannot be recovered.
            </p>
            <p className="text-sm text-slate-700 mb-2">
              Type <span className="font-semibold">{schoolName}</span> to confirm:
            </p>
            <input
              type="text"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="School name"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowResetModal(false); setResetConfirmText('') }}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={resetConfirmText !== schoolName || resetting}
                onClick={async () => {
                  setResetting(true)
                  try {
                    const res = await fetch('/api/settings/reset-school', { method: 'POST' })
                    if (!res.ok) {
                      const body = await res.json()
                      throw new Error(body.error || 'Reset failed')
                    }
                    router.push('/onboarding')
                  } catch (err) {
                    setResetting(false)
                    setShowResetModal(false)
                    setResetConfirmText('')
                    toast.error(`Reset failed: ${err instanceof Error ? err.message : 'unknown error'}`, { duration: Infinity })
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resetting ? 'Resetting...' : 'Reset School Data'}
              </button>
            </div>
          </div>
        </div>
        )}
        </>
      )}
        </div>
      </div>
    </div>
  )
}

function SaveSectionButton({
  saving,
  canEdit,
  dirty,
  onClick,
}: {
  saving: boolean
  canEdit: boolean
  dirty: boolean
  onClick: () => void
}) {
  if (!canEdit) return null
  return (
    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
      <UnsavedIndicator dirty={dirty} />
      <button
        type="button"
        onClick={onClick}
        disabled={saving}
        className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
      >
        {saving && (
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        )}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function SettingsSubRail({ sections }: { sections: Array<{ id: string; label: string }> }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the first section currently visible in the upper half of viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    )
    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])

  return (
    <nav
      aria-label="Settings sections"
      className="hidden md:block sticky top-6 self-start"
      style={{ maxHeight: 'calc(100vh - 3rem)' }}
    >
      <ul className="space-y-0.5">
        {sections.map((s) => {
          const active = activeId === s.id
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  setActiveId(s.id)
                  history.replaceState(null, '', `#${s.id}`)
                }}
                className={`block px-3 py-1.5 text-xs rounded-md transition-colors relative ${
                  active
                    ? 'font-semibold text-slate-900'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
                style={active ? { color: 'var(--navy-dark)', background: 'var(--bg-table-alt)' } : undefined}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full"
                    style={{ background: 'var(--navy-dark)' }}
                  />
                )}
                <span className={active ? 'pl-1.5' : ''}>{s.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
