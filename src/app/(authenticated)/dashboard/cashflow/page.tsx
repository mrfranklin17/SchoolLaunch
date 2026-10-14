'use client'

import { useState, useMemo, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { useScenario } from '@/lib/ScenarioContext'
import { computeCarryForwardBreakdown, computeMonthlyCashFlow, runProjections } from '@/lib/budgetEngine'
import { createClient } from '@/lib/supabase/client'
import type { StartupFundingSource, PreOpeningExpense, PreOpeningTransaction } from '@/lib/types'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermissions } from '@/hooks/usePermissions'
import Tooltip from '@/components/ui/Tooltip'
import { DataTable, type DataTableColumn, type DataTableRow } from '@/components/ui/DataTable'
import { formatCurrency } from '@/lib/format'
import { fundingStatusLabel, fundingTypeLabel } from '@/lib/fundingLabels'
import { PageHeader } from '@/components/ui/PageHeader'
import { CashflowSkeleton } from '../_skeletons'
import { toast } from '@/components/ui/Toast'
import { Year1CashCard } from '@/components/charts/Year1CashCard'
import { UnsavedIndicator } from '@/components/ui/UnsavedIndicator'
import { useSavedSnapshot, useUnsavedChanges } from '@/hooks/useUnsavedChanges'

const fmt = (n: number) => formatCurrency(n, 'accounting')

let _id = 0
function uid() { return `poe-${++_id}-${Date.now()}` }

const PRE_OPEN_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']
const MONTH_KEYS = ['mar', 'apr', 'may', 'jun', 'jul', 'aug']

const DEFAULT_EXPENSES: PreOpeningExpense[] = [
  { id: uid(), name: 'Founder/CEO Compensation', budgeted: 0, actual: 0 },
]

/** Saved pre-opening expenses, or the defaults with fresh ids when none are saved. */
function savedOrDefaultExpenses(saved: PreOpeningExpense[] | null | undefined): PreOpeningExpense[] {
  if (saved && saved.length > 0) return saved
  return DEFAULT_EXPENSES.map((e) => ({ ...e, id: uid() }))
}

/** Get Y0 allocation for a funding source, falling back to full amount if no years selected */
function getY0Allocation(src: StartupFundingSource): number {
  if (src.selectedYears?.includes(0) && src.yearAllocations?.[0]) {
    return src.yearAllocations[0]
  }
  if (!src.selectedYears || src.selectedYears.length === 0) {
    return src.amount
  }
  return 0
}

export default function CashFlowPage() {
  const {
    schoolData: { schoolId, schoolName, profile, loading, reload },
    pathway,
    preOpenCash,
    projectionInputs,
    y1,
  } = useScenario()
  const { canEdit } = usePermissions()
  useDocumentTitle('Cash Flow', schoolName)

  const supabase = createClient()
  const [view, setView] = useState<'year0' | 'year1'>('year0')
  const [saving, setSaving] = useState(false)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())

  // Load expenses from profile or use defaults
  const [expenses, setExpenses] = useState<PreOpeningExpense[]>(() => savedOrDefaultExpenses(profile.pre_opening_expenses))

  // Load transactions from profile
  const [transactions, setTransactions] = useState<PreOpeningTransaction[]>(
    () => profile.pre_opening_transactions || []
  )

  // The page mounts while school data is still loading (e.g. a hard reload of this tab), so
  // seed the editable Year 0 state from the saved profile once it arrives. Otherwise the
  // defaults would stand in for saved data, and Year 1 starting cash would ignore it.
  // reload() after Save keeps loading false and the school id unchanged, so it never re-seeds
  // over edits made since.
  const [seededSchoolId, setSeededSchoolId] = useState<string | null>(loading ? null : profile.school_id)
  // Unsaved-changes guard: the Year 0 editors compared with what was loaded or last saved.
  const { dirty: year0Dirty, markSaved, hasSnapshot } = useSavedSnapshot({ expenses, transactions })
  if (!loading && seededSchoolId !== profile.school_id) {
    const seeded = {
      expenses: savedOrDefaultExpenses(profile.pre_opening_expenses),
      transactions: profile.pre_opening_transactions || [],
    }
    setSeededSchoolId(profile.school_id)
    setExpenses(seeded.expenses)
    setTransactions(seeded.transactions)
    markSaved(seeded)
  } else if (!loading && !hasSnapshot) {
    markSaved({ expenses, transactions })
  }
  useUnsavedChanges(year0Dirty, 'Pre-opening expenses and transactions')

  // Funding — always read from profile (database) so it syncs with Settings → Startup Funding saves
  const fundingSources: StartupFundingSource[] = useMemo(
    () => (profile.startup_funding && profile.startup_funding.length > 0 ? profile.startup_funding : []),
    [profile.startup_funding],
  )

  // Secured/At Risk calculated from current database status values
  const securedFunding = fundingSources
    .filter((f) => f.status === 'received' || f.status === 'pledged')
    .reduce((s, f) => s + f.amount, 0)
  const totalFunding = fundingSources.reduce((s, f) => s + f.amount, 0)

  // Year 0 allocation from startup funding
  const year0Funding = useMemo(() => {
    let y0 = 0
    for (const src of fundingSources) {
      y0 += getY0Allocation(src)
    }
    return y0 || totalFunding
  }, [fundingSources, totalFunding])

  // Funding sources with Y0 allocations — used for expense assignment dropdown
  const y0Sources = useMemo(() => {
    const result: { name: string; y0Amount: number }[] = []
    for (const src of fundingSources) {
      const y0 = getY0Allocation(src)
      if (y0 > 0 && src.source) {
        result.push({ name: src.source, y0Amount: y0 })
      }
    }
    return result
  }, [fundingSources])

  // Set of valid Y0 source names for detecting removed sources
  const validY0SourceNames = useMemo(() => new Set(y0Sources.map((s) => s.name)), [y0Sources])

  // Roll up transaction totals per expense category
  const actualsByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const tx of transactions) {
      map[tx.expense_category] = (map[tx.expense_category] || 0) + tx.amount
    }
    return map
  }, [transactions])

  // Totals — actuals driven by transactions
  const totalBudgeted = expenses.reduce((s, e) => s + e.budgeted, 0)
  const totalActual = transactions.reduce((s, tx) => s + tx.amount, 0)
  const totalRemaining = totalBudgeted - totalActual
  const pctFundingUsed = year0Funding > 0 ? (totalBudgeted / year0Funding * 100) : 0

  // Expense names for transaction category dropdown
  const expenseNames = useMemo(() => expenses.map((e) => e.name).filter(Boolean), [expenses])

  // Build expense→fundingSource lookup for utilization
  const expenseFundingMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of expenses) {
      if (e.fundingSource && e.name) map[e.name] = e.fundingSource
    }
    return map
  }, [expenses])

  // Funding source utilization — budgeted from expenses, spent from transactions
  const fundingUtilization = useMemo(() => {
    return y0Sources.map((src) => {
      const assignedExpenses = expenses.filter((e) => e.fundingSource === src.name)
      const budgeted = assignedExpenses.reduce((s, e) => s + e.budgeted, 0)
      const spent = transactions
        .filter((tx) => expenseFundingMap[tx.expense_category] === src.name)
        .reduce((s, tx) => s + tx.amount, 0)
      return {
        name: src.name,
        y0Amount: src.y0Amount,
        budgeted,
        spent,
        remaining: src.y0Amount - spent,
      }
    })
  }, [y0Sources, expenses, transactions, expenseFundingMap])

  // Unassigned totals
  const unassignedBudgeted = expenses
    .filter((e) => !e.fundingSource || !validY0SourceNames.has(e.fundingSource))
    .reduce((s, e) => s + e.budgeted, 0)
  const unassignedSpent = transactions
    .filter((tx) => !expenseFundingMap[tx.expense_category] || !validY0SourceNames.has(expenseFundingMap[tx.expense_category]))
    .reduce((s, tx) => s + tx.amount, 0)

  // Monthly cash flow — budget evenly spread, actuals from transactions per month
  const year0Flow = useMemo(() => {
    const monthlyBudget = Math.round(totalBudgeted / PRE_OPEN_MONTHS.length)
    const actuals = MONTH_KEYS.map((key) => transactions.filter((tx) => tx.month === key))
    const monthActual = actuals.map((txs) => txs.reduce((s, tx) => s + tx.amount, 0))
    const cumulativeActual = monthActual.map((_, i) => monthActual.slice(0, i + 1).reduce((s, v) => s + v, 0))

    return MONTH_KEYS.map((key, i) => ({
      month: PRE_OPEN_MONTHS[i],
      monthKey: key,
      budgeted: monthlyBudget,
      actual: monthActual[i],
      txCount: actuals[i].length,
      cumulativeBudgeted: monthlyBudget * (i + 1),
      cumulativeActual: cumulativeActual[i],
      balanceActual: year0Funding - cumulativeActual[i],
    }))
  }, [totalBudgeted, transactions, year0Funding])

  // Year 0 ending balance = Year 1 starting cash. The engine's carry-forward logic
  // (actual spend when transactions total > $0, otherwise the budget) applied to the unsaved
  // expenses/transactions on this page, so it equals every other surface's figure once saved.
  const carryForward = useMemo(
    () => computeCarryForwardBreakdown({ ...profile, pre_opening_expenses: expenses, pre_opening_transactions: transactions }),
    [profile, expenses, transactions]
  )
  const year0EndingBalance = carryForward.carryForward
  const usesActualSpend = carryForward.preOpenActualSpend > 0

  // Year 1 monthly cash flow from the engine's Year 1 row (same model as the narrative PDF,
  // Commission Excel and admin portfolio view). Its last fiscal month ends at the engine's
  // year-end cash.
  // With unsaved Year-0 edits the starting cash differs from the saved run, and Year-1
  // interest income depends on it, so re-run the engine on the overlaid profile.
  const y1Row = useMemo(() => {
    if (year0EndingBalance === preOpenCash) return y1
    return runProjections({
      ...projectionInputs,
      profile: { ...projectionInputs.profile, pre_opening_expenses: expenses, pre_opening_transactions: transactions },
      preOpenCash: year0EndingBalance,
    })[0]
  }, [y1, preOpenCash, year0EndingBalance, projectionInputs, expenses, transactions])
  const monthlyCashFlow = useMemo(
    () => computeMonthlyCashFlow(y1Row, year0EndingBalance, { pathway, fiscalYearStartMonth: profile.fiscal_year_start_month }),
    [y1Row, year0EndingBalance, pathway, profile.fiscal_year_start_month]
  )
  const cashFlow = monthlyCashFlow.months
  const usesOspiSchedule = monthlyCashFlow.usesOspiSchedule

  // ── Expense CRUD ──
  function updateExpense(id: string, field: keyof PreOpeningExpense, value: string | number) {
    setExpenses((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e))
  }

  function addExpense() {
    setExpenses((prev) => [...prev, { id: uid(), name: '', budgeted: 0, actual: 0 }])
  }

  function removeExpense(id: string) {
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }

  // ── Transaction CRUD ──
  function addTransaction(monthKey: string) {
    const tx: PreOpeningTransaction = {
      id: uid(),
      month: monthKey,
      description: '',
      amount: 0,
      expense_category: '',
      created_at: new Date().toISOString(),
    }
    setTransactions((prev) => [...prev, tx])
  }

  function updateTransaction(id: string, field: keyof PreOpeningTransaction, value: string | number) {
    setTransactions((prev) => prev.map((tx) => tx.id === id ? { ...tx, [field]: value } : tx))
  }

  function removeTransaction(id: string) {
    setTransactions((prev) => prev.filter((tx) => tx.id !== id))
  }

  function toggleMonth(monthKey: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(monthKey)) next.delete(monthKey)
      else next.add(monthKey)
      return next
    })
  }

  // ── Save ──
  const saveAll = useCallback(async () => {
    if (!schoolId) return
    setSaving(true)

    const { error } = await supabase
      .from('school_profiles')
      .update({
        pre_opening_expenses: expenses,
        pre_opening_transactions: transactions,
      })
      .eq('school_id', schoolId)

    if (error) {
      toast.error(`Save failed — changes not saved: ${error.message}`, { duration: Infinity })
    } else {
      toast.success('Saved')
      markSaved({ expenses, transactions })
      await reload()
    }
    setSaving(false)
  }, [schoolId, expenses, transactions, supabase, reload, markSaved])

  if (loading) {
    return <CashflowSkeleton />
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Cash Flow"
        subtitle={usesOspiSchedule
          ? 'Month-by-month projections using the OSPI apportionment payment schedule.'
          : 'Month-by-month projections using your payment schedule.'}
      />

      {/* Year toggle — segmented control */}
      <div role="tablist" aria-label="Cash flow year" data-tour="cashflow-tabs" className="inline-flex bg-slate-100 rounded-lg p-1 mb-6">
        <button
          role="tab"
          aria-selected={view === 'year0'}
          onClick={() => setView('year0')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'year0' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Year 0 (Pre-Opening)
        </button>
        <button
          role="tab"
          aria-selected={view === 'year1'}
          onClick={() => setView('year1')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'year1' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Year 1 (First Operating Year)
        </button>
      </div>

      {view === 'year0' ? (
        <>
          {/* ── SECTION: Startup Funding Inflows ── */}
          <div data-tour="funding-inflows" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Startup Funding Inflows</h2>
            {fundingSources.length > 0 ? (
              <>
                <div className="overflow-x-auto sl-scroll">
                  <table className="w-full text-sm sl-table mb-4">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Source</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Y0 Allocation</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-24">Type</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fundingSources.map((src, idx) => {
                        const y0 = getY0Allocation(src)
                        if (y0 === 0) return null
                        return (
                          <tr key={idx} className="border-b border-slate-100">
                            <td className="px-3 py-2 text-slate-700">{src.source || 'Unnamed'}</td>
                            <td className="px-3 py-2 text-right font-medium text-slate-800 num">{fmt(y0)}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                src.type === 'grant' ? 'bg-blue-100 text-blue-700' :
                                src.type === 'donation' ? 'bg-purple-100 text-purple-700' :
                                src.type === 'debt' ? 'bg-red-100 text-red-700' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {fundingTypeLabel(src.type)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                src.status === 'received' ? 'bg-emerald-100 text-emerald-700' :
                                src.status === 'pledged' ? 'bg-blue-100 text-blue-700' :
                                src.status === 'applied' ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {fundingStatusLabel(src.status)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td className="px-3 py-2 font-bold text-slate-800">Total Year 0 Funding</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-800 num">{fmt(year0Funding)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="flex flex-wrap gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-emerald-600 font-semibold">Secured:</span>
                    <span className="text-emerald-700 font-bold ml-1">{fmt(securedFunding)}</span>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-amber-600 font-semibold">At Risk:</span>
                    <span className="text-amber-700 font-bold ml-1">{fmt(totalFunding - securedFunding)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-4">
                <p className="text-sm text-slate-500 mb-3">No funding sources configured.</p>
                <Link
                  href="/dashboard/settings#startup-funding"
                  className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                >
                  Add funding sources in Settings
                </Link>
              </div>
            )}

            <p className="text-xs text-slate-500 mt-3">
              <Link href="/dashboard/settings#startup-funding" className="text-teal-600 hover:text-teal-800 hover:underline">Manage funding sources in Settings → Startup Funding</Link>. Only Received and Pledged funds count as secured.
            </p>
          </div>

          {/* ── SECTION 1: Pre-Opening Expenses (Budget + Rolled-Up Actuals) ── */}
          <div data-tour="preopen-expenses" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Pre-Opening Expense Budget</h2>

            {/* Summary badges */}
            <div className="flex flex-wrap gap-3 mb-5">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Total Budgeted</p>
                <p className="text-sm font-bold text-slate-800">{fmt(totalBudgeted)}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase font-medium">Total Spent</p>
                <p className="text-sm font-bold text-slate-800">{fmt(totalActual)}</p>
              </div>
              <div className={`border rounded-lg px-3 py-2 ${totalRemaining >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-[10px] text-slate-400 uppercase font-medium">Variance</p>
                <p className={`text-sm font-bold ${totalRemaining >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(totalRemaining)}</p>
              </div>
              <div className={`border rounded-lg px-3 py-2 ${pctFundingUsed <= 100 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-[10px] text-slate-400 uppercase font-medium">% of Startup Funding</p>
                <p className={`text-sm font-bold ${pctFundingUsed <= 100 ? 'text-blue-700' : 'text-red-700'}`}>{pctFundingUsed.toFixed(1)}%</p>
              </div>
            </div>

            {/* Expense budget table */}
            <div className="overflow-x-auto sl-scroll">
              <table className="w-full text-sm sl-table mb-3">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide min-w-[180px]">Expense Name</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide min-w-[160px]">Funding Source</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Budgeted</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Actual</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-24">Variance</th>
                    <th className="py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => {
                    const actual = actualsByCategory[exp.name] || 0
                    const variance = exp.budgeted - actual
                    const hasRemovedSource = exp.fundingSource && !validY0SourceNames.has(exp.fundingSource)
                    return (
                      <tr key={exp.id} className="border-b border-slate-100">
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={exp.name}
                            onChange={(e) => updateExpense(exp.id, 'name', e.target.value)}
                            placeholder="Expense name..."
                            className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={hasRemovedSource ? '' : (exp.fundingSource || '')}
                            onChange={(e) => updateExpense(exp.id, 'fundingSource', e.target.value)}
                            className={`w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 ${
                              hasRemovedSource ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                            }`}
                          >
                            <option value="">Unassigned</option>
                            {y0Sources.map((src) => (
                              <option key={src.name} value={src.name}>
                                {src.name} ({fmt(src.y0Amount)})
                              </option>
                            ))}
                          </select>
                          {hasRemovedSource && (
                            <div className="text-[10px] text-amber-600 mt-0.5">
                              &ldquo;{exp.fundingSource}&rdquo; no longer has Y0 allocation
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step={500}
                            min={0}
                            value={exp.budgeted}
                            onChange={(e) => updateExpense(exp.id, 'budgeted', Number(e.target.value))}
                            className="w-full text-right border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 num tabular-nums">
                          {fmt(actual)}
                        </td>
                        <td className={`px-3 py-2 text-right font-medium num ${
                          variance > 0 ? 'text-emerald-600' : variance < 0 ? 'text-red-600' : 'text-slate-400'
                        }`}>
                          {variance !== 0 && (variance > 0 ? '+' : '')}{fmt(variance)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Tooltip content="Remove">
                            <button
                              onClick={() => removeExpense(exp.id)}
                              className="text-red-400 hover:text-red-600 text-lg leading-none"
                              aria-label="Remove"
                            >
                              &times;
                            </button>
                          </Tooltip>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="px-3 py-2 font-bold text-slate-800" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800 num">{fmt(totalBudgeted)}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800 num">{fmt(totalActual)}</td>
                    <td className={`px-3 py-2 text-right font-bold num ${
                      totalRemaining > 0 ? 'text-emerald-600' : totalRemaining < 0 ? 'text-red-600' : 'text-slate-400'
                    }`}>
                      {totalRemaining !== 0 && (totalRemaining > 0 ? '+' : '')}{fmt(totalRemaining)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3">
              <button
                onClick={addExpense}
                className="text-sm text-teal-600 hover:text-teal-800 font-medium"
              >
                + Add Expense Category
              </button>
            </div>
          </div>

          {/* ── SECTION 2: Funding Source Utilization ── */}
          {y0Sources.length > 0 && (
            <div data-tour="funding-utilization" className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">Funding Source Utilization</h2>
              <div className="overflow-x-auto sl-scroll">
                <table className="w-full text-sm sl-table">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Source</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Y0 Allocation</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Budgeted</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Spent</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide w-28">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fundingUtilization.map((fu) => (
                      <tr key={fu.name} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-700 font-medium">{fu.name}</td>
                        <td className="px-3 py-2 text-right text-slate-800 num">{fmt(fu.y0Amount)}</td>
                        <td className="px-3 py-2 text-right text-slate-600 num">{fmt(fu.budgeted)}</td>
                        <td className="px-3 py-2 text-right text-slate-600 num">{fmt(fu.spent)}</td>
                        <td className={`px-3 py-2 text-right font-semibold num ${
                          fu.remaining < 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}>
                          {fmt(fu.remaining)}
                        </td>
                      </tr>
                    ))}
                    {(unassignedBudgeted > 0 || unassignedSpent > 0) && (
                      <tr className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-500 italic">Unassigned</td>
                        <td className="px-3 py-2 text-right text-slate-400 num">&mdash;</td>
                        <td className="px-3 py-2 text-right text-slate-500 num">{fmt(unassignedBudgeted)}</td>
                        <td className="px-3 py-2 text-right text-slate-500 num">{fmt(unassignedSpent)}</td>
                        <td className="px-3 py-2 text-right text-slate-400 num">&mdash;</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 font-bold text-slate-800">Total</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800 num">{fmt(year0Funding)}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800 num">{fmt(totalBudgeted)}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800 num">{fmt(totalActual)}</td>
                      <td className={`px-3 py-2 text-right font-bold num ${
                        year0Funding - totalActual >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {fmt(year0Funding - totalActual)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── SECTION 3: Monthly Cash Flow with Transaction Entry ── */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Monthly Cash Flow &amp; Transactions</h2>
              <p className="text-xs text-slate-500 mt-1">Click a month to expand and add individual transactions. Transactions roll up to expense categories above.</p>
            </div>
            <div className="overflow-x-auto sl-scroll">
              <table className="w-full text-sm sl-table">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide w-10"></th>
                    <th className="text-left px-2 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Month</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Budgeted</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Actual</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Cum. Budget</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Cum. Actual</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Balance</th>
                  </tr>
                </thead>
                <tbody data-tour="monthly-transactions">
                  {year0Flow.map((m) => {
                    const isExpanded = expandedMonths.has(m.monthKey)
                    const monthTxs = transactions.filter((tx) => tx.month === m.monthKey)
                    const balanceNegative = m.balanceActual < 0

                    return (
                      <MonthSection
                        key={m.monthKey}
                        month={m.month}
                        monthKey={m.monthKey}
                        budgeted={m.budgeted}
                        actual={m.actual}
                        txCount={m.txCount}
                        cumulativeBudgeted={m.cumulativeBudgeted}
                        cumulativeActual={m.cumulativeActual}
                        balanceActual={m.balanceActual}
                        balanceNegative={balanceNegative}
                        isExpanded={isExpanded}
                        onToggle={() => toggleMonth(m.monthKey)}
                        monthTxs={monthTxs}
                        expenseNames={expenseNames}
                        onAddTx={() => addTransaction(m.monthKey)}
                        onUpdateTx={updateTransaction}
                        onRemoveTx={removeTransaction}
                      />
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td></td>
                    <td className="px-2 py-3 font-bold text-slate-800">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 num">{fmt(totalBudgeted)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800 num">{fmt(totalActual)}</td>
                    <td colSpan={2}></td>
                    <td className={`px-4 py-3 text-right font-bold num ${year0EndingBalance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                      {fmt(year0EndingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Save action bar (sticky) */}
          {canEdit && (
            <div
              data-testid="action-bar"
              className="sticky bottom-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-6 bg-white border-t border-slate-200"
              style={{ boxShadow: 'var(--shadow-2)' }}
            >
              <div className="flex items-center justify-between gap-4">
                <UnsavedIndicator dirty={year0Dirty} />
                <button
                  onClick={saveAll}
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save All Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Carry-forward note */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
            Year 0 ending balance of <strong>{fmt(year0EndingBalance)}</strong> carries forward as Year 1 starting cash.
            {usesActualSpend && (
              <span className="text-slate-500 ml-1">(Based on {transactions.length} transaction{transactions.length !== 1 ? 's' : ''})</span>
            )}
          </div>

          {year0EndingBalance < 0 && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>Warning:</strong> Pre-opening funding is insufficient. You need additional startup capital to cover shortfalls.
            </div>
          )}

          {totalActual > 0 && totalActual > totalBudgeted && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>Over Budget:</strong> Actual spending ({fmt(totalActual)}) exceeds budget ({fmt(totalBudgeted)}) by {fmt(totalActual - totalBudgeted)}.
            </div>
          )}

          {securedFunding < totalFunding * 0.5 && totalFunding > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              <strong>Funding Risk:</strong> Less than 50% of startup funding is secured.
              Cash flow projections may be optimistic if pending funding does not materialize.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
            Starting cash balance: <strong>{fmt(year0EndingBalance)}</strong> (carried from Year 0 pre-opening)
            {monthlyCashFlow.totals.depreciationExcluded > 0 && (
              <span className="block text-xs text-slate-500 mt-1">
                Non-cash facility depreciation ({fmt(monthlyCashFlow.totals.depreciationExcluded)}) is excluded from monthly outflows.
              </span>
            )}
          </div>

          <Year1CashCard cashFlow={monthlyCashFlow} row={y1Row} pathway={pathway} />

          {(() => {
            type Y1Row = (typeof cashFlow)[number]
            const dataRows: DataTableRow<Y1Row>[] = cashFlow.map((m) => ({
              type: 'item',
              key: m.month,
              data: m,
            }))

            const renderNet = (m: Y1Row): ReactNode => (
              <span className={`font-medium ${m.netCashFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {fmt(m.netCashFlow)}
              </span>
            )
            const renderCumulative = (m: Y1Row): ReactNode => (
              <span className={`font-bold ${m.cumulativeBalance >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                {fmt(m.cumulativeBalance)}
              </span>
            )

            const columns: DataTableColumn<Y1Row>[] = [
              { key: 'month', header: 'Month', align: 'left', render: (m) => <span className="font-medium text-slate-800">{m.month}</span> },
              { key: 'apport-pct', header: usesOspiSchedule ? 'Apport. %' : 'Scheduled %', numeric: true, render: (m) => <span className="text-slate-500">{(m.apportionmentPct * 100).toFixed(1)}%</span> },
              { key: 'apport-amt', header: usesOspiSchedule ? 'Apport. $' : 'Scheduled $', numeric: true, render: (m) => <span className="text-slate-600">{fmt(m.apportionmentAmt)}</span> },
              { key: 'other-rev', header: 'Other Revenue', numeric: true, render: (m) => <span className="text-slate-600">{fmt(m.otherRevenue)}</span> },
              { key: 'inflow', header: 'Total Inflow', numeric: true, render: (m) => <span className="font-medium text-slate-800">{fmt(m.totalInflow)}</span> },
              { key: 'payroll', header: 'Payroll', numeric: true, render: (m) => <span className="text-slate-600">{fmt(m.payroll)}</span> },
              { key: 'other-exp', header: 'Other Expenses', numeric: true, render: (m) => <span className="text-slate-600">{fmt(m.otherExpenses)}</span> },
              { key: 'net', header: 'Net Cash Flow', numeric: true, render: renderNet },
              { key: 'cumulative', header: 'Cumulative Balance', numeric: true, render: renderCumulative },
            ]

            return (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <DataTable columns={columns} rows={dataRows} caption="Year 1 monthly cash flow" />
              </div>
            )
          })()}

          {cashFlow.some((m) => m.cumulativeBalance < 0) && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>Warning:</strong> Cumulative cash balance goes negative in one or more months.
              This may require a line of credit or pre-opening fundraising to cover shortfalls.
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Month Section (expandable row + transaction list) ── */

function MonthSection({
  month,
  budgeted,
  actual,
  txCount,
  cumulativeBudgeted,
  cumulativeActual,
  balanceActual,
  balanceNegative,
  isExpanded,
  onToggle,
  monthTxs,
  expenseNames,
  onAddTx,
  onUpdateTx,
  onRemoveTx,
}: {
  month: string
  monthKey: string
  budgeted: number
  actual: number
  txCount: number
  cumulativeBudgeted: number
  cumulativeActual: number
  balanceActual: number
  balanceNegative: boolean
  isExpanded: boolean
  onToggle: () => void
  monthTxs: PreOpeningTransaction[]
  expenseNames: string[]
  onAddTx: () => void
  onUpdateTx: (id: string, field: keyof PreOpeningTransaction, value: string | number) => void
  onRemoveTx: (id: string) => void
}) {
  return (
    <>
      {/* Summary row */}
      <tr
        className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50/70 transition-colors ${balanceNegative ? 'bg-red-50/50' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-center">
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </td>
        <td className="px-2 py-3">
          <span className="font-medium text-slate-800">{month}</span>
          {txCount > 0 && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-100 text-teal-700">
              {txCount} tx
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right text-slate-600 num">{fmt(budgeted)}</td>
        <td className={`px-4 py-3 text-right num ${actual > budgeted ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
          {fmt(actual)}
        </td>
        <td className="px-4 py-3 text-right text-slate-600 num">{fmt(cumulativeBudgeted)}</td>
        <td className={`px-4 py-3 text-right num ${cumulativeActual > cumulativeBudgeted ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
          {fmt(cumulativeActual)}
        </td>
        <td className={`px-4 py-3 text-right font-bold num ${balanceNegative ? 'text-red-600' : 'text-slate-800'}`}>
          {fmt(balanceActual)}
        </td>
      </tr>

      {/* Expanded transaction rows */}
      {isExpanded && (
        <>
          {monthTxs.length > 0 ? monthTxs.map((tx) => (
            <tr key={tx.id} className="bg-slate-50/60 border-b border-slate-100">
              <td></td>
              <td className="px-2 py-1.5" colSpan={2}>
                <input
                  type="text"
                  value={tx.description}
                  onChange={(e) => onUpdateTx(tx.id, 'description', e.target.value)}
                  placeholder="Transaction description..."
                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                  onClick={(e) => e.stopPropagation()}
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  step={100}
                  min={0}
                  value={tx.amount}
                  onChange={(e) => onUpdateTx(tx.id, 'amount', Number(e.target.value))}
                  className="w-full text-right border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                  onClick={(e) => e.stopPropagation()}
                />
              </td>
              <td className="px-2 py-1.5" colSpan={2}>
                <select
                  value={tx.expense_category}
                  onChange={(e) => onUpdateTx(tx.id, 'expense_category', e.target.value)}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">Other / Uncategorized</option>
                  {expenseNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-1.5 text-center">
                <Tooltip content="Remove transaction">
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveTx(tx.id) }}
                    className="text-red-400 hover:text-red-600 text-sm leading-none"
                    aria-label="Remove transaction"
                  >
                    &times;
                  </button>
                </Tooltip>
              </td>
            </tr>
          )) : (
            <tr className="bg-slate-50/60 border-b border-slate-100">
              <td></td>
              <td colSpan={6} className="px-4 py-3 text-xs text-slate-400 italic">
                No transactions for {month}. Click &ldquo;+ Add Transaction&rdquo; below to start tracking.
              </td>
            </tr>
          )}
          <tr className="bg-slate-50/60 border-b border-slate-200">
            <td></td>
            <td colSpan={6} className="px-4 py-2">
              <button
                onClick={(e) => { e.stopPropagation(); onAddTx() }}
                className="text-xs text-teal-600 hover:text-teal-800 font-medium"
              >
                + Add Transaction
              </button>
            </td>
          </tr>
        </>
      )}
    </>
  )
}
