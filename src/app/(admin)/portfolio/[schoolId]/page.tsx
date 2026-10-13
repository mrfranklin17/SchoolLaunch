'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  runProjections,
  computeCarryForward,
  computeMonthlyCashFlow,
  personnelPctOfRevenue,
  breakEvenEnrollment,
} from '@/lib/budgetEngine'
import type { SchoolProfile, StaffingPosition, BudgetProjection, GradeExpansionEntry, FinancialAssumptions, StartupFundingSource } from '@/lib/types'
import { getAssumptions } from '@/lib/types'
import { getStateConfig } from '@/lib/stateConfig'
import { evaluateDaysOfCash, evaluatePersonnelPct, healthColor, healthPathway, type HealthStatus } from '@/lib/healthThresholds'

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

/** Tile tinted by a shared health status (R-HEALTH-01 palette); untinted when status is omitted. */
function HealthTile({ label, value, status }: {
  label: string
  value: string
  status?: HealthStatus
}) {
  const card = status ? healthColor(status, 'twCard') : 'bg-white text-slate-800 border-slate-200'
  return (
    <div className={`${card} border rounded-xl p-5`}>
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

export default function SchoolDetailPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [schoolName, setSchoolName] = useState('')
  const [pathway, setPathway] = useState<string | null>(null)
  const [profile, setProfile] = useState<SchoolProfile | null>(null)
  const [positions, setPositions] = useState<StaffingPosition[]>([])
  const [allPositions, setAllPositions] = useState<StaffingPosition[]>([])
  const [projections, setProjections] = useState<BudgetProjection[]>([])
  const [gradeExpansionPlan, setGradeExpansionPlan] = useState<GradeExpansionEntry[]>([])
  const [notes, setNotes] = useState<Array<{ id: string; content: string; created_at: string }>>([])
  const [noteInput, setNoteInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [portfolioSchools, setPortfolioSchools] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    async function load() {
      // Verify user is org_admin
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role, organization_id')
        .eq('user_id', user.id)
        .single()

      if (!roleData || roleData.role === 'school_ceo') {
        router.push('/dashboard')
        return
      }

      const [schoolRes, profileRes, posRes, projRes, gepRes, notesRes, portfolioRes] = await Promise.all([
        supabase.from('schools').select('name, pathway').eq('id', schoolId).single(),
        supabase.from('school_profiles').select('*').eq('school_id', schoolId).single(),
        supabase.from('staffing_positions').select('*').eq('school_id', schoolId).order('year'),
        supabase.from('budget_projections').select('*').eq('school_id', schoolId).eq('year', 1),
        supabase.from('grade_expansion_plan').select('*').eq('school_id', schoolId).order('year').order('grade_level'),
        supabase.from('org_notes').select('id, content, created_at').eq('school_id', schoolId).order('created_at', { ascending: false }),
        roleData.organization_id
          ? supabase.from('schools').select('id, name').eq('organization_id', roleData.organization_id).order('name')
          : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      ])
      if (portfolioRes.data) setPortfolioSchools(portfolioRes.data)

      if (schoolRes.data) {
        setSchoolName(schoolRes.data.name)
        setPathway(schoolRes.data.pathway ?? null)
      }
      if (profileRes.data) setProfile(profileRes.data as SchoolProfile)
      if (posRes.data) {
        const all = posRes.data as StaffingPosition[]
        setAllPositions(all)
        setPositions(all.filter(p => p.year === 1))
      }
      if (projRes.data) setProjections(projRes.data as BudgetProjection[])
      if (gepRes.data) setGradeExpansionPlan(gepRes.data as GradeExpansionEntry[])
      if (notesRes.data) setNotes(notesRes.data)
      setLoading(false)
    }
    load()
  }, [schoolId, supabase, router])

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    )
  }

  const assumptions = getAssumptions(profile.financial_assumptions as Partial<FinancialAssumptions> | null)
  const isWaCharter = healthPathway(pathway) === 'wa_charter'
  const benefitsRate = isWaCharter ? assumptions.benefits_load_pct / 100 : getStateConfig(pathway).benefits_load

  // The school's pathway engine on its saved data, with the same carry-forward and inputs as
  // the school's own dashboard (ScenarioContext), so every figure here matches what the founder sees.
  const preOpenCash = computeCarryForward(profile)
  const multiYear = runProjections({
    pathway,
    profile,
    positions,
    projections,
    assumptions,
    preOpenCash,
    gradeExpansionPlan,
    allPositions,
    startupFunding: profile.startup_funding as StartupFundingSource[] | null,
  })
  const y1 = multiYear[0]
  const cashFlow = computeMonthlyCashFlow(y1, preOpenCash, { pathway }).months

  // Year 1 tiles: engine row + shared helpers; colors from the shared health bands (Year 1 =
  // Commission Stage 1 / founding-year personnel band for WA; generic benchmarks otherwise).
  const hp = healthPathway(pathway)
  const daysOfCash = y1.reserveDays
  const y1Net = y1.net
  const personnelPct = personnelPctOfRevenue(y1)
  const breakEvenEnroll = breakEvenEnrollment(y1)
  const reserveStatus = evaluateDaysOfCash(daysOfCash, 1, hp).status
  const personnelStatus = evaluatePersonnelPct(personnelPct, 1, hp).status
  const surplusStatus: HealthStatus = y1Net >= 0 ? 'meets' : 'fails'

  // Revenue and operations line items from the engine's Year 1 row, so each table sums to its total.
  const y1Rev = y1.revenue
  const revenueLines = [
    { label: isWaCharter ? 'Regular Ed Apportionment' : 'Tuition / Per-Pupil Revenue', amount: y1Rev.regularEd },
    { label: 'SPED Apportionment', amount: y1Rev.sped },
    { label: 'State Special Education', amount: y1Rev.stateSped },
    { label: 'Facilities Revenue', amount: y1Rev.facilitiesRev },
    { label: 'Levy Equity', amount: y1Rev.levyEquity },
    { label: 'Small School Enhancement', amount: y1Rev.smallSchoolEnhancement },
    { label: 'Title I', amount: y1Rev.titleI },
    { label: 'IDEA', amount: y1Rev.idea },
    { label: 'LAP', amount: y1Rev.lap },
    { label: 'LAP High Poverty', amount: y1Rev.lapHighPoverty },
    { label: 'TBIP', amount: y1Rev.tbip },
    { label: 'HiCap', amount: y1Rev.hicap },
    { label: 'Food Service (NSLP)', amount: y1Rev.foodServiceRev },
    { label: 'Transportation (State)', amount: y1Rev.transportationRev },
    ...(y1Rev.customRevenue ?? []).map((c) => ({ label: c.name, amount: c.amount })),
    { label: 'Interest Income', amount: y1Rev.interestIncome },
    { label: 'Startup Grants', amount: y1Rev.grantRevenue },
  ]
  // Generic-pathway fee and fundraising revenue appear only in the row total.
  const otherRevenue = y1Rev.total - revenueLines.reduce((s, l) => s + l.amount, 0)
  const liveRevenueLines = [
    ...revenueLines,
    { label: 'Fees, Fundraising & Other', amount: otherRevenue },
  ].filter(l => l.amount > 0)
  const totalRevenue = y1Rev.total

  const y1Ops = y1.operations
  const opsLines = [
    { label: 'Facilities', amount: y1Ops.facilities },
    { label: 'Supplies & Materials', amount: y1Ops.supplies },
    { label: 'Contracted Services', amount: y1Ops.contracted },
    { label: 'Technology', amount: y1Ops.technology },
    { label: 'Authorizer Fee', amount: y1Ops.authorizerFee },
    { label: 'Insurance', amount: y1Ops.insurance },
    { label: 'Food Service', amount: y1Ops.foodService },
    { label: 'Transportation', amount: y1Ops.transportation },
    { label: 'Curriculum & Materials', amount: y1Ops.curriculum },
    { label: 'Professional Development', amount: y1Ops.profDev },
    { label: 'Marketing & Outreach', amount: y1Ops.marketing },
    { label: 'Fundraising', amount: y1Ops.fundraising },
    { label: 'Contingency', amount: y1Ops.contingency },
    ...(y1Ops.customExpense ?? []).map((c) => ({ label: c.name, amount: c.amount })),
    { label: 'Facility Depreciation', amount: y1Ops.depreciation ?? 0 },
    { label: 'Facility Interest', amount: y1Ops.interest ?? 0 },
  ].filter((l) => l.amount !== 0)

  async function handleAddNote() {
    const content = noteInput.trim()
    if (!content) return
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, content }),
      })
      if (res.ok) {
        const note = await res.json()
        setNotes(prev => [{ id: note.id, content: note.content, created_at: note.created_at }, ...prev])
        setNoteInput('')
      }
    } catch (err) {
      console.error('Failed to save note:', err)
    }
  }

  return (
    <div data-tour="school-detail">
      {/* Sticky read-only bar */}
      <ReadOnlyBar
        schoolId={schoolId}
        schools={portfolioSchools}
        onSwitch={(id) => router.push(`/portfolio/${id}`)}
      />

      <h1 className="text-2xl font-bold text-slate-800 mb-1">{schoolName}</h1>
      <p className="text-sm text-slate-500 mb-6">
        {profile.grade_config} &middot; {profile.target_enrollment_y1} students (Y1) &middot; {profile.region}
      </p>

      {/* Health tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <HealthTile label="Days of Cash Y1" value={`${daysOfCash} days`} status={reserveStatus} />
        <HealthTile label="Personnel % of Revenue" value={`${personnelPct.toFixed(1)}%`} status={personnelStatus} />
        <HealthTile label="Year 1 Net Position" value={fmt(y1Net)} status={surplusStatus} />
        <HealthTile label="Break-Even Enrollment" value={`${breakEvenEnroll} students`} />
      </div>

      {/* Revenue */}
      <Section title="Revenue">
        <SimpleTable
          rows={liveRevenueLines.map((r) => [r.label, fmt(r.amount)])}
          footer={['Total Revenue', fmt(totalRevenue)]}
        />
      </Section>

      {/* Staffing */}
      <Section title="Staffing">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2 font-semibold text-slate-600">Position</th>
                <th className="text-left px-4 py-2 font-semibold text-slate-600">Category</th>
                <th className="text-right px-4 py-2 font-semibold text-slate-600">FTE</th>
                <th className="text-right px-4 py-2 font-semibold text-slate-600">Salary</th>
                <th className="text-right px-4 py-2 font-semibold text-slate-600">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => {
                // The engine's benefits rate and per-position rounding, so the rows add up to
                // the engine's Total Personnel (generic pathways use the pathway's load).
                const cost = p.annual_salary * p.fte
                const totalCost = cost + Math.round(cost * benefitsRate)
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-4 py-2 text-slate-700">{p.title}</td>
                    <td className="px-4 py-2 text-slate-500 capitalize">{p.category}</td>
                    <td className="px-4 py-2 text-right text-slate-600">{p.fte}</td>
                    <td className="px-4 py-2 text-right text-slate-600">${p.annual_salary.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-slate-700 font-medium">${totalCost.toLocaleString()}</td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-2 text-slate-800" colSpan={4}>Total Personnel</td>
                <td className="px-4 py-2 text-right text-slate-800">{fmt(y1.personnel.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Operations */}
      <Section title="Operations">
        <SimpleTable
          rows={opsLines.map((o) => [o.label, fmt(o.amount)])}
          footer={['Total Operations', fmt(y1Ops.total)]}
        />
      </Section>

      {/* Cash Flow */}
      <Section title="Monthly Cash Flow">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Month</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Inflow</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Payroll</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Other Exp</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Net</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Balance</th>
              </tr>
            </thead>
            <tbody>
              {cashFlow.map((m) => (
                <tr key={m.month} className="border-b border-slate-100">
                  <td className="px-3 py-2 text-slate-700 font-medium">{m.month}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{fmt(m.totalInflow)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{fmt(m.payroll)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{fmt(m.otherExpenses)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${m.netCashFlow >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(m.netCashFlow)}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium ${m.cumulativeBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                    {fmt(m.cumulativeBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Multi-Year */}
      <Section title="Multi-Year Projections">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2 font-semibold text-slate-600"></th>
                {multiYear.map((r) => (
                  <th key={r.year} className="text-right px-4 py-2 font-semibold text-slate-600">Year {r.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Enrollment', values: multiYear.map((r) => `${r.enrollment}`) },
                { label: 'Total Revenue', values: multiYear.map((r) => fmt(r.revenue.total)) },
                { label: 'Total Personnel', values: multiYear.map((r) => fmt(r.personnel.total)) },
                { label: 'Total Operations', values: multiYear.map((r) => fmt(r.operations.total)) },
                { label: 'Net Position', values: multiYear.map((r) => fmt(r.net)), bold: true },
                { label: 'Days Cash', values: multiYear.map((r) => `${r.reserveDays} days`), bold: true },
              ].map((row) => (
                <tr key={row.label} className="border-b border-slate-100">
                  <td className={`px-4 py-2 ${row.bold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className={`px-4 py-2 text-right ${row.bold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Add a note about this school..."
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddNote()}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button onClick={handleAddNote} disabled={!noteInput.trim()} className="px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50">
            Save Note
          </button>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No notes yet. Add a note to track your review of this school.</p>
        ) : (
          <div className="space-y-3">
            {notes.map(n => {
              const ago = Math.floor((Date.now() - new Date(n.created_at).getTime()) / (1000 * 60))
              const timeLabel = ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.floor(ago / 60)}h ago` : `${Math.floor(ago / 1440)}d ago`
              return (
                <div key={n.id} className="border-l-2 border-teal-200 pl-3 py-1">
                  <p className="text-sm text-slate-700">{n.content}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{timeLabel}</p>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function ReadOnlyBar({
  schoolId,
  schools,
  onSwitch,
}: {
  schoolId: string
  schools: Array<{ id: string; name: string }>
  onSwitch: (id: string) => void
}) {
  return (
    <div
      data-testid="readonly-bar"
      className="sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 py-2 mb-5 bg-white border-b border-slate-200 flex items-center justify-between gap-3"
      style={{ boxShadow: 'var(--shadow-1)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 1 1 8 0v4" />
          </svg>
          <span className="hidden sm:inline">Viewing as portfolio admin · Read-only</span>
          <span className="sm:hidden">Read-only</span>
        </span>
        <Link
          href="/portfolio"
          className="text-xs font-medium text-teal-600 hover:text-teal-700 inline-flex items-center gap-1"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Portfolio
        </Link>
      </div>
      {schools.length > 1 && (
        <select
          value={schoolId}
          onChange={(e) => onSwitch(e.target.value)}
          aria-label="Switch school"
          className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 max-w-[160px] truncate"
        >
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
      <div className="px-5 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function SimpleTable({ rows, footer }: { rows: [string, string][]; footer: [string, string] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={i} className="border-b border-slate-100">
            <td className="px-5 py-2.5 text-slate-600">{label}</td>
            <td className="px-5 py-2.5 text-right text-slate-700 font-medium">{value}</td>
          </tr>
        ))}
        <tr className="bg-slate-50 font-semibold">
          <td className="px-5 py-2.5 text-slate-800">{footer[0]}</td>
          <td className="px-5 py-2.5 text-right text-slate-800">{footer[1]}</td>
        </tr>
      </tbody>
    </table>
  )
}
