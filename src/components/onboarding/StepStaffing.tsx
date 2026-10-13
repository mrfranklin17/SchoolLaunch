'use client'

import { useState, useMemo, useRef } from 'react'
import { calcCommissionRevenue } from '@/lib/calculations'
import { DEFAULT_ASSUMPTIONS } from '@/lib/types'
import type { Pathway } from '@/lib/stateConfig'
import { getStateConfig } from '@/lib/stateConfig'
import { evaluatePersonnelPct, healthColor, healthPathway } from '@/lib/healthThresholds'
import Tooltip from '@/components/ui/Tooltip'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { waSeedSalary, SALARY_SOURCE_NOTE } from '@/lib/staffingDefaults'

interface LocalPosition {
  key: string
  title: string
  category: 'certificated' | 'classified' | 'admin'
  fte: number
  salary: number
  positionType?: string
  classification?: string
  driver?: string
}

interface Props {
  enrollment: number
  maxClassSize: number
  sectionsY1?: number
  gradeConfig: string
  pctFrl: number
  pctIep: number
  pctEll: number
  pctHicap: number
  pathway?: Pathway
  tuitionRate?: number
  financialAidPct?: number
  /** Year-1 Small School Enhancement, computed like the engine (from the grade plan; $0 without one). */
  sseY1?: number
  initialPositions: LocalPosition[]
  onNext: (positions: LocalPosition[]) => void
  onBack: () => void
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

let keyCounter = 0
function nextKey() {
  return `pos-${++keyCounter}`
}

export function buildDefaultPositions(enrollment: number, maxClassSize: number, gradeConfig: string, pctIep: number, pctEll: number, sectionsOverride?: number): LocalPosition[] {
  const sections = sectionsOverride ?? Math.ceil(enrollment / maxClassSize)
  const paras = Math.max(1, Math.ceil((enrollment * pctIep / 100) / 10))
  const isSecondary = gradeConfig === '6-8' || gradeConfig === '9-12'

  const positions: LocalPosition[] = []

  // Administrative
  positions.push({
    key: nextKey(),
    title: 'CEO/Executive Director',
    category: 'admin',
    fte: 1,
    salary: waSeedSalary('ceo_director'),
    positionType: 'ceo_director',
    classification: 'Administrative',
    driver: 'fixed',
  })

  positions.push({
    key: nextKey(),
    title: 'Principal/Head of School',
    category: 'admin',
    fte: 1,
    salary: waSeedSalary('principal'),
    positionType: 'principal',
    classification: 'Administrative',
    driver: 'fixed',
  })

  // Certificated
  positions.push({
    key: nextKey(),
    title: isSecondary ? 'Classroom Teacher - Middle School' : 'Classroom Teacher - Elementary',
    category: 'certificated',
    fte: sections,
    salary: waSeedSalary(isSecondary ? 'teacher_ms' : 'teacher_elem'),
    positionType: isSecondary ? 'teacher_ms' : 'teacher_elem',
    classification: 'Certificated',
    driver: 'per_pupil',
  })

  positions.push({
    key: nextKey(),
    title: 'Special Education (SPED) Teacher',
    category: 'certificated',
    fte: 1,
    salary: waSeedSalary('sped_teacher'),
    positionType: 'sped_teacher',
    classification: 'Certificated',
    driver: 'fixed',
  })

  // Classified
  positions.push({
    key: nextKey(),
    title: 'Administrative Assistant/Office Manager',
    category: 'classified',
    fte: 1,
    salary: waSeedSalary('office_mgr'),
    positionType: 'office_mgr',
    classification: 'Classified',
    driver: 'fixed',
  })

  positions.push({
    key: nextKey(),
    title: 'Instructional Aides/Paraeducators',
    category: 'classified',
    fte: paras,
    salary: waSeedSalary('paraeducator'),
    positionType: 'paraeducator',
    classification: 'Classified',
    driver: 'per_pupil',
  })

  return positions
}

/** Build positions from stateConfig for non-WA pathways */
function buildDefaultPositionsFromConfig(
  pathway: Pathway,
  enrollment: number,
  maxClassSize: number,
  pctIep: number,
): LocalPosition[] {
  const config = getStateConfig(pathway)
  const sections = Math.ceil(enrollment / maxClassSize)
  const positions: LocalPosition[] = []

  for (const pt of config.position_types) {
    let fte = pt.default_fte
    // Scale per-pupil positions
    if (pt.driver === 'per_pupil' && pt.students_per_position > 0) {
      fte = Math.max(pt.default_fte, Math.ceil(enrollment / pt.students_per_position))
    } else if ((pt.driver === 'per_pupil_elem' || pt.driver === 'per_pupil_ms' || pt.driver === 'per_pupil_hs') && pt.students_per_position > 0) {
      fte = sections
    } else if (pt.driver === 'per_pupil_sped' && pt.students_per_position > 0) {
      fte = Math.max(1, Math.ceil((enrollment * pctIep / 100) / pt.students_per_position))
    }

    const category: 'admin' | 'certificated' | 'classified' =
      pt.classification === 'Administrative' ? 'admin' :
      pt.classification === 'Instructional' ? 'certificated' : 'classified'

    positions.push({
      key: nextKey(),
      title: pt.name,
      category,
      fte,
      salary: pt.default_salary,
      positionType: pt.type,
      classification: pt.classification,
      driver: pt.driver,
    })
  }

  return positions
}

export default function StepStaffing({ enrollment, maxClassSize, sectionsY1, gradeConfig, pctFrl, pctIep, pctEll, pctHicap, pathway, tuitionRate, financialAidPct, sseY1 = 0, initialPositions, onNext, onBack }: Props) {
  const config = getStateConfig(pathway)
  const benefitsRate = config.benefits_load

  function getDefaults() {
    if (config.pathway === 'wa_charter') {
      return buildDefaultPositions(enrollment, maxClassSize, gradeConfig, pctIep, pctEll, sectionsY1)
    }
    return buildDefaultPositionsFromConfig(config.pathway, enrollment, maxClassSize, pctIep)
  }

  const [positions, setPositions] = useState<LocalPosition[]>(
    initialPositions.length > 0 ? initialPositions : getDefaults()
  )

  // Revenue calculation — pathway-aware
  const totalRevenue = useMemo(() => {
    if (config.revenue_model === 'tuition') {
      const rate = tuitionRate ?? config.tuition_rate_default ?? 0
      const aidPct = financialAidPct ?? config.financial_aid_pct_default ?? 0
      return enrollment * rate * (1 - aidPct)
    }
    const rev = calcCommissionRevenue(enrollment, pctFrl, pctIep, pctEll, pctHicap, DEFAULT_ASSUMPTIONS, 1, sseY1)
    return rev.total
  }, [enrollment, pctFrl, pctIep, pctEll, pctHicap, sseY1, config, tuitionRate, financialAidPct])

  const totals = useMemo(() => {
    let totalPersonnel = 0
    let totalFte = 0
    for (const p of positions) {
      const salary = p.fte * p.salary
      totalPersonnel += salary + Math.round(salary * benefitsRate)
      totalFte += p.fte
    }
    const pctOfRevenue = totalRevenue > 0 ? (totalPersonnel / totalRevenue) * 100 : 0
    const studentTeacherRatio = (() => {
      const teacherFte = positions
        .filter(p => p.positionType === 'teacher_elem' || p.positionType === 'teacher_ms' || p.positionType === 'teacher_hs' || /classroom teacher/i.test(p.title) || /lead teacher/i.test(p.title))
        .reduce((s, p) => s + p.fte, 0)
      return teacherFte > 0 ? Math.round(enrollment / teacherFte) : 0
    })()
    return { totalPersonnel, totalFte, pctOfRevenue, studentTeacherRatio }
  }, [positions, totalRevenue, enrollment, benefitsRate])

  // R-HEALTH-01: Year 1 personnel band for the pathway (WA founding-year band; generic benchmark).
  const personnelHealth = evaluatePersonnelPct(totalRevenue > 0 ? totals.pctOfRevenue : null, 1, healthPathway(config.pathway))
  const personnelColor = healthColor(personnelHealth.status, 'twText')
  const healthLabel = personnelHealth.status === 'na'
    ? 'Add enrollment to estimate revenue'
    : `${personnelHealth.short} (Year 1 target ${personnelHealth.band.target.toLowerCase()})`

  function updatePosition(key: string, field: keyof LocalPosition, value: string | number) {
    setPositions((prev) =>
      prev.map((p) => (p.key === key ? { ...p, [field]: value } : p))
    )
  }

  function removePosition(key: string) {
    setPositions((prev) => prev.filter((p) => p.key !== key))
  }

  function addPosition() {
    setPositions((prev) => [
      ...prev,
      { key: nextKey(), title: 'New Position', category: 'classified', fte: 1.0, salary: 45000 },
    ])
  }

  function resetDefaults() {
    setPositions(getDefaults())
  }

  // Drag-and-drop reordering
  const dragIndexRef = useRef<number | null>(null)

  function handleDragStart(index: number) {
    dragIndexRef.current = index
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndexRef.current
    if (from === null || from === targetIndex) { dragIndexRef.current = null; return }
    setPositions((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
    dragIndexRef.current = null
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault()
    onNext(positions)
  }

  return (
    <form onSubmit={handleNext} className="space-y-6">
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-500 max-w-lg">
          Each row is a position type with total FTE (e.g., FTE of 4 = four people at that salary). Adjust as needed.
        </p>
        <button
          type="button"
          onClick={resetDefaults}
          className="text-xs text-teal-600 hover:text-teal-800 font-medium whitespace-nowrap ml-4"
        >
          Reset to Defaults
        </button>
      </div>

      {/* Financial health bar */}
      <div className="bg-slate-50 rounded-xl p-4">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-slate-500">Total Personnel Cost</p>
            <p className="text-lg font-semibold text-slate-800">{fmt(totals.totalPersonnel)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Personnel % of Revenue</p>
            <p className={`text-lg font-semibold ${personnelColor}`}>
              {totals.pctOfRevenue.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total FTE</p>
            <p className="text-lg font-semibold text-slate-800">{totals.totalFte.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Student:Teacher Ratio</p>
            <p className="text-lg font-semibold text-slate-800">{totals.studentTeacherRatio}:1</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Est. Total Revenue</p>
            <p className="text-lg font-semibold text-slate-800">{fmt(totalRevenue)}</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${healthColor(personnelHealth.status, 'twBar')}`}
              style={{ width: `${Math.min(totals.pctOfRevenue, 100)}%` }}
            />
          </div>
          <p className={`text-xs mt-1 ${personnelColor}`}>{healthLabel}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 w-6"></th>
              <th className="text-left py-2 pr-3 font-medium text-slate-600">Position Title</th>
              <th className="text-left py-2 pr-3 font-medium text-slate-600">Category</th>
              <th className="text-right py-2 pr-3 font-medium text-slate-600">FTE</th>
              <th className="text-right py-2 pr-3 font-medium text-slate-600">
                <Tooltip content={SALARY_SOURCE_NOTE} position="top" multiline>
                  <span tabIndex={0} className="cursor-help border-b border-dotted border-slate-400">Annual Salary</span>
                </Tooltip>
              </th>
              <th className="text-right py-2 pr-3 font-medium text-slate-600">Benefits ({Math.round(benefitsRate * 100)}%)</th>
              <th className="text-right py-2 pr-3 font-medium text-slate-600">Total Cost</th>
              <th className="py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const effectiveSalary = p.fte * p.salary
              const benefits = Math.round(effectiveSalary * benefitsRate)
              const total = effectiveSalary + benefits
              return (
                <tr
                  key={p.key}
                  className="border-b border-slate-100 hover:bg-slate-50"
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(i)}
                >
                  <td className="py-2 w-6 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none">
                    <Tooltip content="Drag to reorder">
                      <span className="inline-flex mx-auto" aria-label="Drag to reorder">
                        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="2" r="1.5"/><circle cx="9" cy="2" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="3" cy="14" r="1.5"/><circle cx="9" cy="14" r="1.5"/></svg>
                      </span>
                    </Tooltip>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      value={p.title}
                      onChange={(e) => updatePosition(p.key, 'title', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={p.category}
                      onChange={(e) => updatePosition(p.key, 'category', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="certificated">Certificated</option>
                      <option value="classified">Classified</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      value={p.fte}
                      onChange={(e) => updatePosition(p.key, 'fte', Number(e.target.value))}
                      min={0.5}
                      step={0.5}
                      className="w-20 px-2 py-1.5 border border-slate-200 rounded text-right text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <CurrencyInput
                      value={p.salary}
                      onChange={(v) => updatePosition(p.key, 'salary', v)}
                      min={0}
                      step={1000}
                      ariaLabel={`Annual salary for ${p.title}`}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right text-slate-500">{fmt(benefits)}</td>
                  <td className="py-2 pr-3 text-right font-medium text-slate-800">{fmt(total)}</td>
                  <td className="py-2">
                    <Tooltip content="Remove position">
                      <button
                        type="button"
                        onClick={() => removePosition(p.key)}
                        className="text-red-400 hover:text-red-600 text-lg leading-none"
                        aria-label="Remove position"
                      >
                        &times;
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addPosition}
        className="text-sm text-teal-600 hover:text-teal-800 font-medium"
      >
        + Add Position
      </button>

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
