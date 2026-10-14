'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useSchoolSession } from '@/contexts/SchoolSessionContext'
import { orgRoleRow } from '@/lib/schoolSession'
import { isAgentFailed, normalizeAdvisory } from '@/lib/advisory'
import {
  runProjections,
  computeCarryForward,
  personnelPctOfRevenue,
  breakEvenEnrollment,
  type MultiYearDetailedRow,
} from '@/lib/budgetEngine'
import { portfolioHealthFor, type PortfolioMatrixKey } from '@/lib/portfolioHealth'
import type { SchoolProfile, StaffingPosition, BudgetProjection, GradeExpansionEntry, FinancialAssumptions } from '@/lib/types'
import { getAssumptions } from '@/lib/types'
import {
  evaluateDaysOfCash,
  evaluatePersonnelPct,
  healthColor,
  healthPathway,
  type HealthPathway,
  type HealthStatus,
} from '@/lib/healthThresholds'
import SchoolLogo from '@/components/SchoolLogo'
import Tooltip from '@/components/ui/Tooltip'
import { HealthTile } from '@/components/ui/HealthTile'
import { toast } from '@/components/ui/Toast'

interface SchoolCard {
  id: string
  name: string
  status: string
  /** Health-threshold family for the school's pathway (WA Commission bands or generic). */
  healthPathway: HealthPathway
  gradeConfig: string
  openingGrades: string[] | null
  buildoutGrades: string[] | null
  plannedOpenYear: number
  enrollmentY1: number
  multiYear: MultiYearDetailedRow[]
  /** Years 1–5 status per matrix column, graded on the school's pathway (portfolioHealthFor). */
  matrix: Record<PortfolioMatrixKey, HealthStatus[]> | null
  /** WA: FPF measures failing Stage 1; other pathways: health measures in the concern band in Years 1–2. */
  stage1Issues: number
  notes: NoteEntry[]
  onboardingComplete: boolean
  lastUpdated: string | null
  logoUrl: string | null
  // New fields for enhanced portfolio
  advisoryStatus: { strong: number; attention: number; risk: number } | null
  scenarioReserveDays: { conservative: number; base: number; optimistic: number } | null
  scenarioAssumptions: Array<{ name: string; assumptions: Record<string, number>; y1ReserveDays: number }> | null
  hasBudget: boolean
  hasScenarios: boolean
  hasAdvisory: boolean
  hasAlignment: boolean
  readinessScore: number
}

interface NoteEntry {
  id: string
  content: string
  created_at: string
}

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planning: 'bg-blue-50 text-blue-700 border-blue-200',
    authorized: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    exported: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${styles[status] || styles.planning}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function ReadinessBadge({ issues, hp }: { issues: number; hp: HealthPathway }) {
  const status: HealthStatus = issues === 0 ? 'meets' : issues <= 2 ? 'approaching' : 'fails'
  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${healthColor(status, 'twCard')}`}>
      {issues === 0 ? (hp === 'wa_charter' ? 'Meets Stage 1' : 'Healthy') : `${issues} ${issues === 1 ? 'Issue' : 'Issues'}`}
    </span>
  )
}

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold ${color || 'text-slate-800'}`}>{value}</div>
    </div>
  )
}

// Every portfolio metric is a Year 1 value: WA schools are judged against Commission Stage 1
// (Days of Cash) and the founding-year personnel band; generic schools against the generic bands.
function reserveStatus(days: number, hp: HealthPathway): HealthStatus {
  return evaluateDaysOfCash(days, 1, hp).status
}

function reserveColor(days: number, hp: HealthPathway): string {
  return healthColor(reserveStatus(days, hp), 'twText')
}

function personnelStatus(pct: number, hp: HealthPathway): HealthStatus {
  return evaluatePersonnelPct(pct, 1, hp).status
}

function personnelColor(pct: number, hp: HealthPathway): string {
  return healthColor(personnelStatus(pct, hp), 'twText')
}

function formatGradeTrajectory(opening: string[] | null, buildout: string[] | null, gradeConfig: string): string {
  if (!opening?.length || !buildout?.length) return gradeConfig || 'Not set'
  const sortGrades = (grades: string[]) => {
    const order = ['PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
    return [...grades].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }
  const sorted = sortGrades(opening)
  const sortedBuild = sortGrades(buildout)
  const first = sorted[0] === 'K' ? 'K' : sorted[0]
  const last = sorted[sorted.length - 1] === 'K' ? 'K' : sorted[sorted.length - 1]
  const bFirst = sortedBuild[0] === 'K' ? 'K' : sortedBuild[0]
  const bLast = sortedBuild[sortedBuild.length - 1] === 'K' ? 'K' : sortedBuild[sortedBuild.length - 1]
  const openLabel = sorted.length === 1 ? first : `${first}-${last}`
  const buildLabel = sortedBuild.length === 1 ? bFirst : `${bFirst}-${bLast}`
  if (openLabel === buildLabel) return buildLabel
  return `${openLabel} → ${buildLabel}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No activity'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/** A school with Year 1 data needs attention when its Year 1 reserve days or personnel % fail
 *  their health band, or any measure fails in Years 1-2 (WA: FPF Stage 1; generic: concern band). */
function needsAttentionFilter(s: SchoolCard): boolean {
  if (!s.onboardingComplete) return false
  const y1 = s.multiYear[0]
  const days = y1?.reserveDays ?? 0
  const pct = y1 ? personnelPctOfRevenue(y1) : 0
  return reserveStatus(days, s.healthPathway) === 'fails' || personnelStatus(pct, s.healthPathway) === 'fails' || s.stage1Issues > 0
}

export default function PortfolioPage() {
  const router = useRouter()
  const supabase = createClient()
  const session = useSchoolSession()
  const orgRole = orgRoleRow(session.roles)
  const [orgName, setOrgName] = useState('')
  const [schools, setSchools] = useState<SchoolCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({})
  // Reference time for the "days since update" column, fixed per visit (render stays pure).
  const [now] = useState(() => Date.now())
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [sortKey, setSortKey] = useState<string>('reserveDays')
  const [sortAsc, setSortAsc] = useState(true)
  const [showFpfMatrix, setShowFpfMatrix] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [sortDropdown, setSortDropdown] = useState('reserveDays-asc')
  const [notesModal, setNotesModal] = useState<string | null>(null) // school ID for open notes modal
  const [exporting, setExporting] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  function toggleRowExpanded(schoolId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(schoolId)) next.delete(schoolId); else next.add(schoolId)
      return next
    })
  }

  const loadData = useCallback(async () => {
    if (session.loading) return
    if (!session.userId) { router.push('/login'); return }
    // The newest org-level role decides the portfolio (users can also hold school roles).
    if (!orgRole) { router.push('/dashboard'); return }
    const orgId = orgRole.organization_id

    // Load org name (readable by the org's members: organizations_select_members policy)
    if (orgId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle()
      if (org) setOrgName(org.name)
    }

    // Load schools in org
    const { data: schoolRows } = await supabase
      .from('schools')
      .select('id, name, status, organization_id, pathway')
      .eq('organization_id', orgId)

    if (!schoolRows?.length) { setLoading(false); return }

    const schoolIds = schoolRows.map((s) => s.id)

    // Load all data needed for runProjections per school
    const [profilesRes, allPosRes, projectionsRes, notesRes, gepRes, scenRes, alignRes] = await Promise.all([
      supabase.from('school_profiles').select('*').in('school_id', schoolIds),
      supabase.from('staffing_positions').select('*').in('school_id', schoolIds).order('year'),
      supabase.from('budget_projections').select('*').in('school_id', schoolIds).eq('year', 1),
      supabase.from('org_notes').select('id, school_id, content, created_at').in('school_id', schoolIds).order('created_at', { ascending: false }),
      supabase.from('grade_expansion_plan').select('*').in('school_id', schoolIds).order('year').order('grade_level'),
      supabase.from('scenarios').select('school_id, name, assumptions, results').in('school_id', schoolIds).eq('scenario_type', 'engine'),
      supabase.from('alignment_reviews').select('school_id').in('school_id', schoolIds),
    ])

    const profiles = profilesRes.data || []
    const allPositions = (allPosRes.data || []) as (StaffingPosition & { updated_at?: string })[]
    const projections = (projectionsRes.data || []) as BudgetProjection[]
    const notes = (notesRes.data || []) as (NoteEntry & { school_id: string })[]
    const allGep = (gepRes.data || []) as (GradeExpansionEntry & { school_id: string })[]
    const allScenarios = (scenRes.data || []) as { school_id: string; name: string; assumptions: Record<string, number>; results: { years: Record<string, { reserve_days: number }> } | null }[]
    const allAlignments = (alignRes.data || []) as { school_id: string }[]

    const cards: SchoolCard[] = schoolRows.map((school) => {
      const profileRaw = profiles.find((p) => p.school_id === school.id)
      const profile = profileRaw as SchoolProfile | undefined
      const schoolAllPositions = allPositions.filter((p) => p.school_id === school.id)
      const schoolY1Positions = schoolAllPositions.filter((p) => p.year === 1)
      const schoolProjections = projections.filter((p) => p.school_id === school.id)
      const schoolNotes = notes.filter((n) => n.school_id === school.id)
      const schoolGep = allGep.filter((g) => (g as unknown as { school_id: string }).school_id === school.id) as GradeExpansionEntry[]

      const assumptions = getAssumptions(profile?.financial_assumptions as Partial<FinancialAssumptions> | null)
      const preOpenCash = profile ? computeCarryForward(profile) : 0

      // Compute multi-year detailed rows (same engine as school_ceo dashboard)
      let multiYear: MultiYearDetailedRow[] = []
      let matrix: SchoolCard['matrix'] = null
      let stage1Issues = 0

      if (profile && profile.onboarding_complete) {
        // The school's pathway engine, same inputs as its own dashboard (ScenarioContext).
        multiYear = runProjections({
          pathway: school.pathway,
          profile,
          positions: schoolY1Positions,
          projections: schoolProjections,
          assumptions,
          preOpenCash,
          gradeExpansionPlan: schoolGep,
          allPositions: schoolAllPositions,
          startupFunding: profile.startup_funding,
        })
        // Graded on the school's pathway: FPF for WA charters, generic health benchmarks otherwise.
        const health = portfolioHealthFor(school.pathway, multiYear, preOpenCash, profile)
        matrix = health.matrix
        stage1Issues = health.issues.length
      }

      // Last activity: most recent updated_at across profile, positions, projections
      const timestamps: string[] = []
      if (profileRaw?.updated_at) timestamps.push(profileRaw.updated_at)
      for (const pos of schoolAllPositions) {
        if ((pos as { updated_at?: string }).updated_at) timestamps.push((pos as { updated_at?: string }).updated_at!)
      }
      for (const proj of schoolProjections) {
        if (proj.updated_at) timestamps.push(proj.updated_at)
      }
      const lastUpdated = timestamps.length > 0
        ? timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
        : null

      // Advisory status from cached results
      // (normalizeAdvisory drops panels with no briefing; failed advisors carry no verdict.)
      const advisoryCache = normalizeAdvisory(profileRaw?.advisory_cache)
      let advisoryStatus: SchoolCard['advisoryStatus'] = null
      if (advisoryCache) {
        const agents = advisoryCache.agents.filter((a) => !isAgentFailed(a))
        advisoryStatus = {
          strong: agents.filter(a => a.status === 'strong').length,
          attention: agents.filter(a => a.status === 'needs_attention').length,
          risk: agents.filter(a => a.status === 'risk').length,
        }
      }

      // Scenario data
      const schoolScenarios = allScenarios.filter(s => s.school_id === school.id)
      const hasScenarios = schoolScenarios.length > 0
      let scenarioReserveDays: SchoolCard['scenarioReserveDays'] = null
      let scenarioAssumptions: SchoolCard['scenarioAssumptions'] = null
      if (hasScenarios) {
        const getDays = (name: string) => {
          const s = schoolScenarios.find(sc => sc.name === name)
          return Math.max(0, s?.results?.years?.['1']?.reserve_days ?? 0)
        }
        scenarioReserveDays = { conservative: getDays('Conservative'), base: getDays('Base Case'), optimistic: getDays('Optimistic') }
        scenarioAssumptions = schoolScenarios.map(sc => ({
          name: sc.name,
          assumptions: sc.assumptions || {},
          y1ReserveDays: Math.max(0, sc.results?.years?.['1']?.reserve_days ?? 0),
        }))
      }

      // Readiness milestones
      const hasBudget = schoolProjections.length > 0
      const hasAdvisory = !!advisoryCache?.briefing
      const hasAlignment = allAlignments.some(a => a.school_id === school.id)
      const readinessScore = [profile?.onboarding_complete, hasBudget, hasScenarios, hasAdvisory, hasAlignment].filter(Boolean).length

      return {
        id: school.id,
        name: school.name,
        status: school.status || 'planning',
        healthPathway: healthPathway(school.pathway),
        gradeConfig: profile?.grade_config || 'Not set',
        openingGrades: profile?.opening_grades || null,
        buildoutGrades: profile?.buildout_grades || null,
        plannedOpenYear: profile?.planned_open_year || 0,
        enrollmentY1: profile?.target_enrollment_y1 || 0,
        multiYear,
        matrix,
        stage1Issues,
        notes: schoolNotes,
        onboardingComplete: profile?.onboarding_complete || false,
        lastUpdated,
        logoUrl: profile?.logo_url || null,
        advisoryStatus,
        scenarioReserveDays,
        scenarioAssumptions,
        hasBudget,
        hasScenarios,
        hasAdvisory,
        hasAlignment,
        readinessScore,
      }
    })

    setSchools(cards)
    setLoading(false)
  }, [supabase, router, session.loading, session.userId, orgRole])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount: state is set after the request resolves
    loadData()
  }, [loadData])

  async function addNote(schoolId: string) {
    const content = noteInputs[schoolId]?.trim()
    if (!content) return

    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId, content }),
    })

    if (res.ok) {
      const note = await res.json()
      setSchools((prev) =>
        prev.map((s) =>
          s.id === schoolId
            ? { ...s, notes: [{ id: note.id, content: note.content, created_at: note.created_at }, ...s.notes] }
            : s
        )
      )
      setNoteInputs((prev) => ({ ...prev, [schoolId]: '' }))
    }
  }

  function buildExportPayload() {
    return schools.map(s => {
      const y1 = s.multiYear[0]
      const pct = y1 ? personnelPctOfRevenue(y1) : 0
      return {
        name: s.name,
        status: s.status,
        pathway: s.healthPathway,
        gradeConfig: s.gradeConfig,
        openingYear: s.plannedOpenYear,
        enrollmentY1: s.enrollmentY1,
        reserveDays: y1?.reserveDays ?? 0,
        personnelPct: Math.round(pct * 10) / 10,
        netPosition: y1?.net ?? 0,
        totalRevenue: y1?.revenue.total ?? 0,
        totalExpenses: y1?.totalExpenses ?? 0,
        fpfIssues: s.stage1Issues,
        readinessScore: s.readinessScore,
        advisoryStatus: s.advisoryStatus ? `${s.advisoryStatus.strong}S ${s.advisoryStatus.attention}A ${s.advisoryStatus.risk}R` : 'Not Run',
        onboardingComplete: s.onboardingComplete,
        multiYear: s.multiYear.map(r => ({ year: r.year, revenue: r.revenue.total, expenses: r.totalExpenses, net: r.net, reserveDays: r.reserveDays })),
        scenarios: s.scenarioAssumptions ? s.scenarioAssumptions.map(sc => ({
          name: sc.name,
          assumptions: sc.assumptions,
          y1ReserveDays: sc.y1ReserveDays,
        })) : null,
      }
    })
  }

  async function handleExportPdf() {
    setExporting(true)
    try {
      const res = await fetch('/api/portfolio/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName, schools: buildExportPayload(), dateStr: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }),
      })
      if (res.ok) {
        const html = await res.text()
        const w = window.open('', '_blank')
        if (w) { w.document.write(html); w.document.close() }
      } else {
        exportFailed('PDF', res.status)
      }
    } catch (err) {
      exportFailed('PDF', err)
    }
    setExporting(false)
  }

  /** Both export routes are org-admin only (P2-FU-02): 401 signed out, 403 without an org-level role. */
  function exportFailed(kind: 'PDF' | 'Excel', statusOrError: number | unknown) {
    console.error(`${kind} export failed:`, statusOrError)
    toast.error(
      statusOrError === 401 ? `${kind} export failed — your session has expired. Please sign in again.`
        : statusOrError === 403 ? `${kind} export failed — only organization admins can export the portfolio.`
        : `${kind} export failed — please try again.`,
    )
  }

  async function handleExportExcel() {
    setExporting(true)
    try {
      const res = await fetch('/api/portfolio/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName, schools: buildExportPayload() }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${orgName.replace(/\s+/g, '_')}_Portfolio_Summary.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        exportFailed('Excel', res.status)
      }
    } catch (err) {
      exportFailed('Excel', err)
    }
    setExporting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading portfolio...</p>
        </div>
      </div>
    )
  }

  // Summary stats
  const totalSchools = schools.length
  const schoolsWithData = schools.filter((s) => s.onboardingComplete)
  const meetingStage1 = schoolsWithData.filter((s) => s.stage1Issues === 0).length
  const needsAttention = schoolsWithData.filter((s) => s.stage1Issues >= 2).length

  // Enhanced stats
  const avgReserveDays = schoolsWithData.length > 0
    ? Math.round(schoolsWithData.reduce((s, sc) => s + (sc.multiYear[0]?.reserveDays ?? 0), 0) / schoolsWithData.length)
    : 0
  // Portfolio-wide averages use the generic bands only when every school with data is generic.
  const portfolioPathway: HealthPathway = schoolsWithData.length > 0 && schoolsWithData.every((s) => s.healthPathway === 'generic')
    ? 'generic'
    : 'wa_charter'
  // Labels: Commission FPF when every school is WA, health benchmarks when none is, both when mixed.
  const anyGeneric = schools.some((s) => s.healthPathway === 'generic')
  const anyWa = schools.some((s) => s.healthPathway === 'wa_charter')
  const complianceLabel = !anyGeneric ? 'FPF' : !anyWa ? 'Health' : 'FPF / Health'
  const readyCount = schools.filter(s => s.readinessScore >= 4).length
  const inProgressCount = schools.filter(s => s.readinessScore >= 1 && s.readinessScore < 4).length

  // Table sorting
  // Filter counts
  const needsAttentionCount = schools.filter(needsAttentionFilter).length
  const onTrackCount = schools.filter(s => s.onboardingComplete && s.stage1Issues === 0).length
  const notStartedCount2 = schools.filter(s => !s.onboardingComplete).length
  const scenariosMissingCount = schools.filter(s => !s.hasScenarios).length

  // Apply search + filter
  const filteredSchools = schools.filter(s => {
    // Search
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
    // Filter
    if (activeFilter === 'needsAttention') return needsAttentionFilter(s)
    if (activeFilter === 'onTrack') return s.onboardingComplete && s.stage1Issues === 0
    if (activeFilter === 'notStarted') return !s.onboardingComplete
    if (activeFilter === 'scenariosMissing') return !s.hasScenarios
    return true
  })

  // Sort dropdown sync
  function handleSortDropdown(val: string) {
    setSortDropdown(val)
    const [key, dir] = val.split('-')
    setSortKey(key)
    setSortAsc(dir === 'asc')
  }

  const sortedSchools = [...filteredSchools].sort((a, b) => {
    const getVal = (s: SchoolCard): number => {
      if (sortKey === 'reserveDays') return s.multiYear[0]?.reserveDays ?? -999
      if (sortKey === 'personnel') return s.multiYear[0] && s.multiYear[0].revenue.operatingRevenue > 0 ? personnelPctOfRevenue(s.multiYear[0]) : 999
      if (sortKey === 'netPosition') return s.multiYear[0]?.net ?? -999999
      if (sortKey === 'readiness') return s.readinessScore
      if (sortKey === 'name') return 0
      if (sortKey === 'updated') return s.lastUpdated ? new Date(s.lastUpdated).getTime() : 0
      return 0
    }
    if (sortKey === 'name') return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    const diff = getVal(a) - getVal(b)
    return sortAsc ? diff : -diff
  })

  function handleSort(key: string) {
    if (sortKey === key) { setSortAsc(!sortAsc) } else { setSortKey(key); setSortAsc(true) }
  }

  const sortIcon = (col: string) => (
    sortKey === col ? <span className="ml-0.5 text-[8px]">{sortAsc ? '▲' : '▼'}</span> : null
  )

  return (
    <div className="animate-fade-in">
      {/* RFP deadline countdown */}
      <RfpCountdown />


      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900">Portfolio</h1>
          <p className="text-sm text-slate-500 mt-1">{orgName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowFpfMatrix(!showFpfMatrix)} className="px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            {showFpfMatrix ? `Hide ${complianceLabel} Matrix` : `${complianceLabel} Matrix`}
          </button>
          <button onClick={handleExportPdf} disabled={exporting} className="px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">
            Export PDF
          </button>
          <button onClick={handleExportExcel} disabled={exporting} className="px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">
            Export Excel
          </button>
          <button
            data-tour="invite-button"
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors"
          >
            Invite School
          </button>
        </div>
      </div>

      {/* Summary Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3 mb-6">
        <HealthTile
          label="Total Schools"
          value={totalSchools}
          status="na"
          valueFormat="number"
        />
        <HealthTile
          label={`${complianceLabel} Compliance`}
          value={meetingStage1}
          status={schoolsWithData.length === 0 ? 'na' : meetingStage1 === schoolsWithData.length ? 'meets' : 'approaching'}
          valueFormat="number"
          sublabel={schoolsWithData.length > 0 ? `of ${schoolsWithData.length} with data` : 'no data yet'}
        />
        <HealthTile
          label="Avg Reserve Days"
          value={avgReserveDays}
          status={schoolsWithData.length === 0 ? 'na' : reserveStatus(avgReserveDays, portfolioPathway)}
          valueFormat="days"
        />
        <HealthTile
          label="Ready"
          value={readyCount}
          status={readyCount > 0 ? 'meets' : 'na'}
          valueFormat="number"
        />
        <HealthTile
          label="In Progress"
          value={inProgressCount}
          status={inProgressCount > 0 ? 'approaching' : 'na'}
          valueFormat="number"
        />
        <HealthTile
          label="Needs Attention"
          value={needsAttention}
          status={needsAttention > 0 ? 'fails' : 'meets'}
          valueFormat="number"
        />
      </div>

      {/* FPF Compliance Matrix (conditional) */}
      {showFpfMatrix && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6 overflow-x-auto">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">{!anyGeneric ? 'Commission FPF Compliance Matrix' : !anyWa ? 'Financial Health Matrix' : 'FPF / Financial Health Matrix'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {anyWa && 'WA charters: Commission Stage 1 thresholds for Years 1-2, Stage 2 for Years 3+'}
              {anyWa && anyGeneric && ' · '}
              {anyGeneric && 'Other schools: financial health benchmarks (no Enrollment Variance measure)'}
            </p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-3 py-2 font-semibold text-slate-600 sticky left-0 bg-slate-50">School</th>
                {[1,2,3,4,5].map(y => (
                  <th key={y} colSpan={4} className="text-center px-1 py-2 font-semibold text-slate-600 border-l border-slate-200">Year {y}</th>
                ))}
              </tr>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="sticky left-0 bg-slate-50/50" />
                {[1,2,3,4,5].map(y => (
                  ['CR','DC','TM','EV'].map(m => (
                    <th key={`${y}-${m}`} className="text-center px-1 py-1 text-[9px] text-slate-400 font-medium">{m}</th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {schoolsWithData.map(s => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 bg-white whitespace-nowrap">{s.name}</td>
                  {[0,1,2,3,4].map(yi => {
                    const keys: PortfolioMatrixKey[] = ['CR', 'DC', 'TM', 'EV']
                    return keys.map(k => {
                      const status: HealthStatus = s.matrix?.[k][yi] ?? 'na'
                      const bg = healthColor(status, 'twPill')
                      return (
                        <td key={`${yi}-${k}`} className="text-center px-0.5 py-1.5">
                          <span className={`inline-block w-5 h-5 rounded text-[8px] font-bold leading-5 ${bg}`}>
                            {status === 'meets' ? '✓' : status === 'approaching' ? '~' : status === 'fails' ? '✗' : '—'}
                          </span>
                        </td>
                      )
                    })
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 flex gap-4">
            <span>CR = Current Ratio · DC = Days Cash · TM = Total Margin · EV = Enrollment Variance</span>
            <span className="ml-auto">
              <span className={`inline-block w-3 h-3 rounded mr-0.5 ${healthColor('meets', 'twPill')}`} /> Meets
              <span className={`inline-block w-3 h-3 rounded ml-2 mr-0.5 ${healthColor('approaching', 'twPill')}`} /> Approaching
              <span className={`inline-block w-3 h-3 rounded ml-2 mr-0.5 ${healthColor('fails', 'twPill')}`} /> Does Not Meet
            </span>
          </div>
        </div>
      )}

      {/* Search, Sort, View controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search schools..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        <select
          value={sortDropdown}
          aria-label="Sort schools"
          onChange={e => handleSortDropdown(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="reserveDays-asc">Reserve Days (Low → High)</option>
          <option value="reserveDays-desc">Reserve Days (High → Low)</option>
          <option value="personnel-desc">Personnel % (High → Low)</option>
          <option value="personnel-asc">Personnel % (Low → High)</option>
          <option value="readiness-asc">Readiness (Low → High)</option>
          <option value="readiness-desc">Readiness (High → Low)</option>
          <option value="name-asc">School Name (A → Z)</option>
          <option value="updated-asc">Last Updated (Oldest)</option>
          <option value="updated-desc">Last Updated (Newest)</option>
        </select>
        <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
          <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Table</button>
          <button onClick={() => setViewMode('cards')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Cards</button>
        </div>
      </div>

      {/* Filter chips */}
      <div role="radiogroup" aria-label="Filter schools" className="flex flex-wrap gap-2 mb-4">
        {[
          { key: 'all', label: 'All', count: schools.length },
          { key: 'needsAttention', label: 'Needs Attention', count: needsAttentionCount },
          { key: 'onTrack', label: 'On Track', count: onTrackCount },
          { key: 'notStarted', label: 'Not Started', count: notStartedCount2 },
          { key: 'scenariosMissing', label: 'Scenarios Missing', count: scenariosMissingCount },
        ].map(f => {
          const active = activeFilter === f.key
          return (
            <button
              key={f.key}
              role="radio"
              aria-checked={active}
              onClick={() => setActiveFilter(f.key)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'text-white border-transparent'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
              style={
                active
                  ? { background: 'var(--navy-dark)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              <span>{f.label}</span>
              <span
                className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold font-tabular"
                style={
                  active
                    ? { background: 'rgba(255, 255, 255, 0.18)', color: '#fff' }
                    : { background: 'var(--bg-table-alt)', color: 'var(--text-tertiary)' }
                }
              >
                {f.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th onClick={() => handleSort('name')} className="text-left px-4 py-3 font-semibold text-slate-600 cursor-pointer hover:text-teal-600 whitespace-nowrap">School{sortIcon('name')}</th>
                <th onClick={() => handleSort('reserveDays')} className="text-center px-2 py-3 font-semibold text-slate-600 cursor-pointer hover:text-teal-600 whitespace-nowrap">Reserve Days{sortIcon('reserveDays')}</th>
                <th onClick={() => handleSort('personnel')} className="text-center px-2 py-3 font-semibold text-slate-600 cursor-pointer hover:text-teal-600 whitespace-nowrap">Personnel %{sortIcon('personnel')}</th>
                <th className="text-center px-2 py-3 font-semibold text-slate-600 whitespace-nowrap">Last Activity</th>
                <th onClick={() => handleSort('netPosition')} className="hidden xl:table-cell text-center px-2 py-3 font-semibold text-slate-600 cursor-pointer hover:text-teal-600 whitespace-nowrap">Net Position{sortIcon('netPosition')}</th>
                <th className="hidden xl:table-cell text-center px-2 py-3 font-semibold text-slate-600 whitespace-nowrap">{complianceLabel}</th>
                <th className="hidden xl:table-cell text-center px-2 py-3 font-semibold text-slate-600 whitespace-nowrap">Advisory</th>
                <th onClick={() => handleSort('readiness')} className="hidden xl:table-cell text-center px-2 py-3 font-semibold text-slate-600 cursor-pointer hover:text-teal-600 whitespace-nowrap">Ready{sortIcon('readiness')}</th>
                <th className="hidden xl:table-cell text-center px-2 py-3 font-semibold text-slate-600 whitespace-nowrap">Y1 Enroll</th>
                <th className="xl:hidden text-center px-2 py-3 font-semibold text-slate-600 whitespace-nowrap" aria-label="More columns" />
              </tr>
            </thead>
            <tbody>
              {sortedSchools.map(s => {
                const y1 = s.multiYear[0]
                const days = y1?.reserveDays ?? 0
                const pct = y1 ? personnelPctOfRevenue(y1) : 0
                const net = y1?.net ?? 0
                const daysAgo = s.lastUpdated ? Math.floor((now - new Date(s.lastUpdated).getTime()) / (1000 * 60 * 60 * 24)) : 999
                const isExpanded = expandedRows.has(s.id)

                return (
                  <Fragment key={s.id}>
                    <tr className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/portfolio/${s.id}`} className="flex items-center gap-2 hover:text-teal-600 transition-colors">
                            <SchoolLogo name={s.name} logoUrl={s.logoUrl} size={24} />
                            <span className="font-medium text-slate-800">{s.name}</span>
                          </Link>
                          {s.onboardingComplete ? (
                            <StatusBadge status={s.status} />
                          ) : (
                            <span className="text-[10px] text-slate-400">Setup incomplete</span>
                          )}
                          {s.notes.length > 0 && (
                            <Tooltip content="View notes">
                              <button onClick={() => setNotesModal(s.id)} className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 hover:bg-teal-100 hover:text-teal-600" aria-label="View notes">
                                {s.notes.length}
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className={`text-center px-2 py-2.5 font-medium ${s.onboardingComplete ? reserveColor(days, s.healthPathway) : 'text-slate-400'}`}>
                        {s.onboardingComplete ? `${days}d` : '—'}
                      </td>
                      <td className={`text-center px-2 py-2.5 font-medium ${s.onboardingComplete ? personnelColor(pct, s.healthPathway) : 'text-slate-400'}`}>
                        {s.onboardingComplete ? `${pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className={`text-center px-2 py-2.5 text-xs ${daysAgo > 14 ? 'text-red-700' : daysAgo > 7 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {daysAgo < 999 ? `${daysAgo}d ago` : '—'}
                      </td>
                      <td className={`hidden xl:table-cell text-center px-2 py-2.5 font-medium ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {s.onboardingComplete ? fmt(net) : '—'}
                      </td>
                      <td className="hidden xl:table-cell text-center px-2 py-2.5">
                        {s.onboardingComplete ? <ReadinessBadge issues={s.stage1Issues} hp={s.healthPathway} /> : <span className="text-[10px] text-slate-400">—</span>}
                      </td>
                      <td className="hidden xl:table-cell text-center px-2 py-2.5">
                        {s.advisoryStatus ? (
                          <span className="text-[10px]">
                            {s.advisoryStatus.strong > 0 && <span className="text-emerald-600 font-medium">{s.advisoryStatus.strong}S</span>}
                            {s.advisoryStatus.attention > 0 && <span className="text-amber-600 font-medium ml-1">{s.advisoryStatus.attention}A</span>}
                            {s.advisoryStatus.risk > 0 && <span className="text-red-600 font-medium ml-1">{s.advisoryStatus.risk}R</span>}
                          </span>
                        ) : <span className="text-[10px] text-slate-400">—</span>}
                      </td>
                      <td className="hidden xl:table-cell text-center px-2 py-2.5">
                        <span className={`text-xs font-medium ${s.readinessScore >= 4 ? 'text-emerald-600' : s.readinessScore >= 2 ? 'text-amber-600' : 'text-slate-400'}`}>
                          {s.readinessScore}/5
                        </span>
                      </td>
                      <td className="hidden xl:table-cell text-center px-2 py-2.5 text-slate-700">{s.enrollmentY1 || '—'}</td>
                      <td className="xl:hidden text-center px-2 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleRowExpanded(s.id)}
                          className="text-xs font-medium text-teal-600 hover:text-teal-700 inline-flex items-center gap-0.5"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Hide additional columns' : 'Show additional columns'}
                        >
                          More
                          <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="xl:hidden border-b border-slate-100 bg-slate-50/40">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Y1 Enrollment</div>
                              <div className="text-slate-700">{s.enrollmentY1 || '—'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Net Position</div>
                              <div className={`font-medium ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                {s.onboardingComplete ? fmt(net) : '—'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">{s.healthPathway === 'wa_charter' ? 'FPF Readiness' : 'Health Readiness'}</div>
                              <div>
                                {s.onboardingComplete ? <ReadinessBadge issues={s.stage1Issues} hp={s.healthPathway} /> : <span className="text-slate-400">—</span>}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Advisory</div>
                              <div className="text-[11px]">
                                {s.advisoryStatus ? (
                                  <>
                                    {s.advisoryStatus.strong > 0 && <span className="text-emerald-600 font-medium">{s.advisoryStatus.strong}S </span>}
                                    {s.advisoryStatus.attention > 0 && <span className="text-amber-600 font-medium">{s.advisoryStatus.attention}A </span>}
                                    {s.advisoryStatus.risk > 0 && <span className="text-red-600 font-medium">{s.advisoryStatus.risk}R</span>}
                                  </>
                                ) : <span className="text-slate-400">—</span>}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Ready Score</div>
                              <div className={`font-medium ${s.readinessScore >= 4 ? 'text-emerald-600' : s.readinessScore >= 2 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {s.readinessScore}/5
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td className="px-4 py-2 font-semibold text-slate-600 text-xs">Portfolio Average</td>
                <td className={`text-center text-xs font-medium ${schoolsWithData.length > 0 ? reserveColor(avgReserveDays, portfolioPathway) : 'text-slate-400'}`}>{avgReserveDays}d</td>
                <td className="text-center text-xs text-slate-600">
                  {schoolsWithData.length > 0 ? `${(schoolsWithData.reduce((s, sc) => {
                    const y = sc.multiYear[0]
                    return s + (y ? personnelPctOfRevenue(y) : 0)
                  }, 0) / schoolsWithData.length).toFixed(1)}%` : '—'}
                </td>
                <td />
                <td className="hidden xl:table-cell" />
                <td className="hidden xl:table-cell" />
                <td className="hidden xl:table-cell" />
                <td className="hidden xl:table-cell" />
                <td className="hidden xl:table-cell text-center text-xs text-slate-600">
                  {schoolsWithData.length > 0 ? Math.round(schoolsWithData.reduce((s, sc) => s + sc.enrollmentY1, 0) / schoolsWithData.length) : '—'}
                </td>
                <td className="xl:hidden" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* CARD VIEW */}
      {viewMode === 'cards' && (schools.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <p className="text-slate-500">No schools in your portfolio yet.</p>
          <p className="text-sm text-slate-400 mt-1">Click &ldquo;Invite School&rdquo; to get started.</p>
        </div>
      ) : (
        <div data-tour="school-cards" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {schools.map((school, idx) => {
            const y1 = school.multiYear[0]
            const personnelPct = y1 ? personnelPctOfRevenue(y1) : 0
            const netPosition = y1 ? y1.net : 0
            const reserveDays = y1 ? y1.reserveDays : 0
            const breakEven = y1 ? breakEvenEnrollment(y1) : 0
            const gradeLabel = formatGradeTrajectory(school.openingGrades, school.buildoutGrades, school.gradeConfig)

            const cardClasses = school.onboardingComplete
              ? 'bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200'
              : 'bg-slate-50/60 border border-dashed border-slate-300 rounded-xl overflow-hidden hover:border-slate-400 hover:bg-slate-50 transition-all duration-200'
            return (
              <Link
                key={school.id}
                href={`/portfolio/${school.id}`}
                className={`${cardClasses} block`}
                aria-label={school.onboardingComplete ? `View ${school.name}` : `View ${school.name} — setup incomplete`}
              >
                {/* Card header */}
                <div className="p-5 border-b border-slate-100">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <SchoolLogo name={school.name} logoUrl={school.logoUrl} size={32} />
                      <h3 className={`font-semibold ${school.onboardingComplete ? 'text-slate-800' : 'text-slate-600'}`}>{school.name}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2" {...(idx === 0 ? { 'data-tour': 'status-badge' } : {})}>
                      {school.onboardingComplete ? (
                        <>
                          <StatusBadge status={school.status} />
                          <ReadinessBadge issues={school.stage1Issues} hp={school.healthPathway} />
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                          </svg>
                          Setup incomplete
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {school.plannedOpenYear > 0 && (
                      <span className="font-medium text-slate-600">Opening Fall {school.plannedOpenYear}</span>
                    )}
                    {school.openingGrades?.length || school.gradeConfig !== 'Not set' ? (
                      <span>{gradeLabel}</span>
                    ) : null}
                    {school.enrollmentY1 > 0 && <span>{school.enrollmentY1} students Year 1</span>}
                  </div>
                </div>

                {/* Metrics */}
                {school.onboardingComplete ? (
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      <MetricCell
                        label="Reserve Days"
                        value={`${reserveDays} days`}
                        color={reserveColor(reserveDays, school.healthPathway)}
                      />
                      <MetricCell
                        label="Personnel %"
                        value={`${personnelPct.toFixed(1)}%`}
                        color={personnelColor(personnelPct, school.healthPathway)}
                      />
                      <MetricCell
                        label="Net Position"
                        value={fmt(netPosition)}
                        color={netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'}
                      />
                      <MetricCell
                        label="Break-Even"
                        value={`${breakEven} students`}
                      />
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">
                      Last updated: {formatDate(school.lastUpdated)}
                    </div>
                    {/* Advisory status */}
                    {school.advisoryStatus ? (
                      <div className="text-[10px] mb-1">
                        <span className="text-slate-400 mr-1">Advisory:</span>
                        {school.advisoryStatus.strong > 0 && <span className="text-emerald-600 font-medium">{school.advisoryStatus.strong} Strong</span>}
                        {school.advisoryStatus.attention > 0 && <span className="text-amber-600 font-medium ml-1">· {school.advisoryStatus.attention} Attention</span>}
                        {school.advisoryStatus.risk > 0 && <span className="text-red-600 font-medium ml-1">· {school.advisoryStatus.risk} Risk</span>}
                      </div>
                    ) : <div className="text-[10px] text-slate-400 mb-1">Advisory: Not Run</div>}
                    {/* Scenario summary */}
                    {school.scenarioReserveDays ? (
                      <div className="text-[10px] mb-1">
                        <span className="text-slate-400 mr-1">Scenarios:</span>
                        <span className={reserveColor(school.scenarioReserveDays.conservative, school.healthPathway)}>{school.scenarioReserveDays.conservative}d{school.scenarioReserveDays.conservative === 0 ? ' ⚠' : ''} Con</span>
                        <span className="text-slate-400 mx-0.5">·</span>
                        <span className={reserveColor(school.scenarioReserveDays.base, school.healthPathway)}>{school.scenarioReserveDays.base}d Base</span>
                        <span className="text-slate-400 mx-0.5">·</span>
                        <span className={reserveColor(school.scenarioReserveDays.optimistic, school.healthPathway)}>{school.scenarioReserveDays.optimistic}d Opt</span>
                      </div>
                    ) : <div className="text-[10px] text-slate-400 mb-1">Scenarios: Not Started</div>}
                    {/* Readiness */}
                    <div className="text-[10px]">
                      <span className="text-slate-400 mr-1">Ready:</span>
                      {[school.onboardingComplete, school.hasBudget, school.hasScenarios, school.hasAdvisory, school.hasAlignment].map((done, i) => (
                        <span key={i} className={`inline-block w-2 h-2 rounded-full mr-0.5 ${done ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                      ))}
                      <span className="text-slate-500 ml-1">{school.readinessScore}/5</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full mb-2" style={{ background: 'var(--bg-table-alt)' }}>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }}>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Awaiting founder setup</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Metrics will appear once onboarding is complete.</p>
                  </div>
                )}

                {/* Notes */}
                <div className="border-t border-slate-100 px-5 py-3">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNotesModal(school.id) }}
                    className="text-xs font-medium text-slate-500 hover:text-teal-600 flex items-center gap-1.5 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                    Notes ({school.notes.length})
                  </button>
                </div>
              </Link>
            )
          })}
        </div>
      ))}

      {/* Recent Activity Feed */}
      {schools.some(s => s.notes.length > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mt-6">
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Recent Activity</h3>
          <div className="space-y-2">
            {schools
              .flatMap(s => s.notes.map(n => ({ ...n, schoolName: s.name, schoolId: s.id })))
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .slice(0, 10)
              .map(n => (
                <Link key={n.id} href={`/portfolio/${n.schoolId}`} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-slate-800">
                      <span className="font-medium">{n.schoolName}</span>
                      <span className="text-slate-400 mx-1">—</span>
                      <span className="text-slate-600">{n.content.length > 80 ? n.content.slice(0, 80) + '...' : n.content}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{formatDate(n.created_at)}</div>
                  </div>
                </Link>
              ))}
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {notesModal && (() => {
        const school = schools.find(s => s.id === notesModal)
        if (!school) return null
        const noteInputId = `notes-input-${school.id}`
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30" onClick={() => setNotesModal(null)}>
            <div className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-800 truncate">{school.name}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Tooltip content={"Notes are visible to your organization's admins only — not to the school's founders."}>
                      <svg className="w-3 h-3 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }} aria-label="Admin only">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" />
                      </svg>
                    </Tooltip>
                    <p className="text-xs text-slate-500">Notes &amp; Activity · Admin only</p>
                  </div>
                </div>
                <button onClick={() => setNotesModal(null)} className="text-slate-400 hover:text-slate-600 shrink-0 ml-2" aria-label="Close notes panel">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-5">
                <div className="flex gap-2 mb-4">
                  <input
                    id={noteInputId}
                    type="text"
                    placeholder="Add a note about this school..."
                    value={noteInputs[school.id] || ''}
                    onChange={e => setNoteInputs(prev => ({ ...prev, [school.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addNote(school.id)}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <button onClick={() => addNote(school.id)} className="px-3 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 whitespace-nowrap">Save</button>
                </div>
                {school.notes.length === 0 ? (
                  <div className="text-center py-10">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full mb-3" style={{ background: 'var(--bg-table-alt)' }}>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No notes yet</p>
                    <button
                      type="button"
                      onClick={() => document.getElementById(noteInputId)?.focus()}
                      className="text-xs font-medium text-teal-600 hover:text-teal-700 mt-1.5 inline-flex items-center gap-1"
                    >
                      Add the first note
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {school.notes.map(n => (
                      <div key={n.id} className="border-l-2 border-teal-200 pl-3 py-1">
                        <p className="text-sm text-slate-700">{n.content}</p>
                        <p className="text-[10px] text-slate-400 mt-1">{formatDate(n.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Invite Modal */}
      {showInviteModal && <InviteModal onClose={() => setShowInviteModal(false)} onSuccess={loadData} />}
    </div>
  )
}

function RfpCountdown() {
  // Charter Continuity RFP — fixed deadlines published by the WA Charter Commission.
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const execDeadline = new Date(2026, 4, 19) // May 19, 2026 — Exec Summary + Draft Financial Plan
  const fullDeadline = new Date(2026, 6, 1) // July 1, 2026 — Full Proposal
  const dayMs = 1000 * 60 * 60 * 24
  const execDays = Math.ceil((execDeadline.getTime() - today.getTime()) / dayMs)
  const fullDays = Math.ceil((fullDeadline.getTime() - today.getTime()) / dayMs)

  if (execDays <= -1 && fullDays <= -1) return null

  const variant = execDays < 14 ? 'crit' : execDays <= 30 ? 'warn' : 'info'
  const variantStyles = {
    crit: { bg: 'var(--status-fails-bg)', fg: 'var(--status-fails-fg)', border: 'var(--status-fails-border)', accent: 'var(--rose-600)' },
    warn: { bg: 'var(--status-approaching-bg)', fg: 'var(--status-approaching-fg)', border: 'var(--status-approaching-border)', accent: 'var(--amber-600)' },
    info: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', accent: '#2563EB' },
  } as const
  const styles = variantStyles[variant]

  function formatDays(n: number) {
    if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} past`
    if (n === 0) return 'today'
    return `${n} day${n === 1 ? '' : 's'}`
  }

  return (
    <div
      role="status"
      className="mb-6 rounded-xl border px-5 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
      style={{ background: styles.bg, borderColor: styles.border, color: styles.fg }}
    >
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke={styles.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <div>
          <div className="text-sm font-semibold" style={{ fontFamily: 'var(--font-heading-var)' }}>
            Charter Continuity RFP — Executive Summary &amp; Draft Financial Plan
          </div>
          <div className="text-xs mt-0.5" style={{ color: styles.fg, opacity: 0.85 }}>
            Due May 19, 2026 · Full Proposal due July 1, 2026 ({formatDays(fullDays)})
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 md:text-right">
        <div className="font-tabular text-2xl font-semibold leading-none" style={{ color: styles.accent }}>
          {execDays < 0 ? `${Math.abs(execDays)}` : execDays}
        </div>
        <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color: styles.fg, opacity: 0.8 }}>
          {execDays < 0 ? 'days past due' : execDays === 1 ? 'day remaining' : 'days remaining'}
        </div>
      </div>
    </div>
  )
}

function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [ceoName, setCeoName] = useState('')
  const [ceoEmail, setCeoEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ceoName, ceoEmail }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create invitation')
        setLoading(false)
        return
      }

      const data = await res.json()
      setInviteUrl(data.inviteUrl)
      onSuccess()
    } catch {
      setError('An unexpected error occurred')
    }
    setLoading(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Invite School</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {inviteUrl ? (
          <div>
            <div className="bg-emerald-50 text-emerald-700 text-sm px-4 py-3 rounded-lg mb-4">
              Invitation created successfully!
            </div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Invite Link</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-slate-600"
              />
              <button
                onClick={copyLink}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Send this link to the school CEO. They&apos;ll use it to create their account.
            </p>
            <button
              onClick={onClose}
              className="mt-4 w-full py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">CEO Name</label>
              <input
                type="text"
                value={ceoName}
                onChange={(e) => setCeoName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900"
                placeholder="e.g., Sarah Johnson"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">CEO Email</label>
              <input
                type="email"
                value={ceoEmail}
                onChange={(e) => setCeoEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900"
                placeholder="ceo@school.org"
              />
            </div>
            <p className="text-xs text-slate-400">The CEO will set up their school name, grade configuration, and all other details during onboarding.</p>

            {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Invitation'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
