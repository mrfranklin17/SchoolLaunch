'use client'

import { useMemo } from 'react'
import type { StateConfig } from '@/lib/stateConfig'
import type { SchoolProfile, StartupFundingSource } from '@/lib/types'
import { getGrantAllocationsForYear } from '@/lib/budgetEngine'

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface Props {
  config: StateConfig
  profile: SchoolProfile & { tuition_rate?: number; financial_aid_pct?: number; custom_revenue_lines?: { key: string; label: string; amount: number }[] }
  enrollment: number
  startupFunding?: StartupFundingSource[] | null
  canEdit: boolean
}

export default function GenericRevenueView({ config, profile, enrollment, startupFunding }: Props) {
  const isTuition = config.revenue_model === 'tuition'
  const tuitionRate = profile.tuition_rate || config.tuition_rate_default || 0
  const aidPct = profile.financial_aid_pct || config.financial_aid_pct_default || 0
  const customLines = useMemo(() => profile.custom_revenue_lines || [], [profile.custom_revenue_lines])

  // Revenue calculations
  const revenue = useMemo(() => {
    if (isTuition) {
      const grossTuition = enrollment * tuitionRate
      const aidOffset = Math.round(grossTuition * aidPct)
      const netTuition = grossTuition - aidOffset
      const regFees = customLines.find(l => l.key === 'registration_fees')?.amount || 0
      const fundraising = customLines.find(l => l.key === 'fundraising')?.amount || 0
      const other = customLines.filter(l => !['registration_fees', 'fundraising', 'per_pupil_funding'].includes(l.key))
        .reduce((s, l) => s + l.amount, 0)
      return {
        lines: [
          { label: 'Gross Tuition', amount: grossTuition, group: 'Tuition' },
          { label: 'Financial Aid Discount', amount: -aidOffset, group: 'Tuition' },
          { label: 'Net Tuition Revenue', amount: netTuition, group: 'Tuition', isSubtotal: true },
          ...(regFees > 0 ? [{ label: 'Registration/Enrollment Fees', amount: regFees, group: 'Fees' }] : []),
          ...(fundraising > 0 ? [{ label: 'Fundraising/Annual Fund', amount: fundraising, group: 'Other' }] : []),
          ...(other > 0 ? [{ label: 'Other Revenue', amount: other, group: 'Other' }] : []),
        ],
        operatingTotal: netTuition + regFees + fundraising + other,
      }
    } else {
      // Per-pupil (generic charter)
      const ppLine = customLines.find(l => l.key === 'per_pupil_funding')
      const ppRevenue = ppLine?.amount || (enrollment * 10000)
      const fundraising = customLines.find(l => l.key === 'fundraising')?.amount || 0
      return {
        lines: [
          { label: 'Per-Pupil Public Funding', amount: ppRevenue, group: 'Public Funding' },
          ...(fundraising > 0 ? [{ label: 'Fundraising/Donations', amount: fundraising, group: 'Other' }] : []),
        ],
        operatingTotal: ppRevenue + fundraising,
      }
    }
  }, [enrollment, tuitionRate, aidPct, customLines, isTuition])

  // Grant/startup funding for Year 1
  const grantAllocations = getGrantAllocationsForYear(startupFunding, 1)
  const totalGrants = grantAllocations.reduce((s, a) => s + a.amount, 0)
  const totalRevenue = revenue.operatingTotal + totalGrants

  // Group lines by category
  const groups = useMemo(() => {
    const map = new Map<string, typeof revenue.lines>()
    for (const line of revenue.lines) {
      const existing = map.get(line.group) || []
      existing.push(line)
      map.set(line.group, existing)
    }
    return Array.from(map.entries())
  }, [revenue])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800" style={{ fontFamily: 'var(--font-heading-var)' }}>
            Revenue
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {isTuition ? 'Tuition-based revenue model' : 'Per-pupil funding revenue model'} for {enrollment} students
          </p>
        </div>
      </div>

      {/* Revenue breakdown */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 font-semibold text-slate-600">Revenue Line</th>
              <th className="text-right px-5 py-3 font-semibold text-slate-600">Amount</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([groupName, lines]) => (
              <React.Fragment key={groupName}>
                <tr className="bg-slate-50/50">
                  <td colSpan={2} className="px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    {groupName}
                  </td>
                </tr>
                {lines.map((line) => (
                  <tr key={line.label} className={`border-b border-slate-100 ${(line as { isSubtotal?: boolean }).isSubtotal ? 'bg-slate-50' : ''}`}>
                    <td className={`px-5 py-3 ${(line as { isSubtotal?: boolean }).isSubtotal ? 'font-semibold text-slate-800' : 'text-slate-700 pl-8'}`}>
                      {line.label}
                    </td>
                    <td className={`px-5 py-3 text-right ${line.amount < 0 ? 'text-red-600' : (line as { isSubtotal?: boolean }).isSubtotal ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
                      {fmt(line.amount)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}

            {/* Operating Revenue subtotal */}
            <tr className="border-t-2 border-slate-300 bg-slate-50">
              <td className="px-5 py-3 font-semibold text-slate-800">Operating Revenue</td>
              <td className="px-5 py-3 text-right font-semibold text-slate-800">{fmt(revenue.operatingTotal)}</td>
            </tr>

            {/* Startup Funding */}
            {totalGrants > 0 && (
              <>
                <tr className="bg-slate-50/50">
                  <td colSpan={2} className="px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Startup & Grant Funding (Year 1)
                  </td>
                </tr>
                {grantAllocations.map((a) => (
                  <tr key={a.source} className="border-b border-slate-100">
                    <td className="px-5 py-3 text-slate-700 pl-8">{a.source}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{fmt(a.amount)}</td>
                  </tr>
                ))}
              </>
            )}

            {/* Total Revenue */}
            <tr className="border-t-2 border-teal-200 bg-teal-50">
              <td className="px-5 py-3 font-bold text-teal-800">Total Revenue</td>
              <td className="px-5 py-3 text-right font-bold text-teal-800">{fmt(totalRevenue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Need React import for Fragment
import React from 'react'
