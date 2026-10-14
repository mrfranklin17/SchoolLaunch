'use client'

import React, { useState, useMemo, useEffect } from 'react'
import type { GradeExpansionEntry } from '@/lib/types'
import {
  ALL_GRADES,
  gradeIndex,
  gradesForConfig,
  defaultOpeningGrades,
  sortGrades,
  generateExpansionPlan,
  defaultYearNewGrades,
  computeExpansionEnrollments,
  RETENTION_RATE_DEFAULT,
} from '@/lib/gradeExpansion'
import Tooltip from '@/components/ui/Tooltip'

interface Props {
  gradeConfig: string
  maxClassSize: number
  initialOpeningGrades?: string[]
  initialBuildoutGrades?: string[]
  initialRetentionRate?: number
  initialPlan?: GradeExpansionEntry[]
  onChange: (data: {
    openingGrades: string[]
    buildoutGrades: string[]
    retentionRate: number
    plan: GradeExpansionEntry[]
    enrollments: { year: number; total: number; returning: number; newGrade: number; grades: string[]; newGrades: string[] }[]
  }) => void
}

export default function GradeExpansionEditor({
  gradeConfig,
  maxClassSize,
  initialOpeningGrades,
  initialBuildoutGrades,
  initialRetentionRate,
  initialPlan,
  onChange,
}: Props) {
  const configGrades = gradesForConfig(gradeConfig)

  // Available grades = union of config range + any grades already selected as buildout
  // This ensures grades selected in Step 1 (e.g., Grade 6 beyond K-5 config) are visible
  const availableGrades = sortGrades(
    ALL_GRADES.filter((g) =>
      configGrades.includes(g) ||
      (initialBuildoutGrades && initialBuildoutGrades.includes(g)) ||
      (initialOpeningGrades && initialOpeningGrades.includes(g))
    )
  )

  const [openingGrades, setOpeningGrades] = useState<string[]>(
    initialOpeningGrades && initialOpeningGrades.length > 0
      ? initialOpeningGrades
      : defaultOpeningGrades(gradeConfig)
  )
  const [buildoutGrades, setBuildoutGrades] = useState<string[]>(
    initialBuildoutGrades && initialBuildoutGrades.length > 0
      ? initialBuildoutGrades
      : configGrades
  )
  // R-ENR-01: retention is user-editable. Slider lives below the Expansion Timeline.
  // `initialRetentionRate ?? RETENTION_RATE_DEFAULT` handles null and missing-key cases —
  // a school with `retention_rate=null` or missing JSONB key shows 92% in the slider.
  const [retentionRate, setRetentionRate] = useState<number>(initialRetentionRate ?? RETENTION_RATE_DEFAULT)

  // Default students per section (used for new grades that have no override)
  const [defaultStudentsPerSection, setDefaultStudentsPerSection] = useState(
    initialPlan && initialPlan.length > 0 ? (initialPlan[0].students_per_section || maxClassSize) : maxClassSize
  )

  // Consistent class size toggle — when checked, all grades use the same students/section
  const [consistentClassSize, setConsistentClassSize] = useState(() => {
    if (!initialPlan || initialPlan.length === 0) return true
    const values = new Set(initialPlan.map((e) => e.students_per_section))
    return values.size <= 1 // consistent if all rows have the same value
  })
  const [consistentValue, setConsistentValue] = useState(
    initialPlan && initialPlan.length > 0 ? (initialPlan[0].students_per_section || maxClassSize) : maxClassSize
  )

  // Per-year new grade assignments (editable by user)
  const [yearNewGrades, setYearNewGrades] = useState<Map<number, string[]>>(() => {
    if (initialPlan && initialPlan.length > 0) {
      const map = new Map<number, string[]>()
      for (const entry of initialPlan) {
        if (entry.is_new_grade) {
          const existing = map.get(entry.year) || []
          existing.push(entry.grade_level)
          map.set(entry.year, sortGrades(existing))
        }
      }
      return map
    }
    const initOpening = initialOpeningGrades && initialOpeningGrades.length > 0
      ? initialOpeningGrades
      : defaultOpeningGrades(gradeConfig)
    const initBuildout = initialBuildoutGrades && initialBuildoutGrades.length > 0
      ? initialBuildoutGrades
      : configGrades
    return defaultYearNewGrades(initOpening, initBuildout)
  })

  // Custom per-year/grade overrides (sections, students_per_section)
  const [planOverrides, setPlanOverrides] = useState<Map<string, { sections: number; students_per_section: number }>>(
    () => {
      const map = new Map()
      if (initialPlan) {
        for (const e of initialPlan) {
          map.set(`${e.year}-${e.grade_level}`, { sections: e.sections, students_per_section: e.students_per_section })
        }
      }
      return map
    }
  )

  const plan = useMemo(() => {
    // Default sections = 1 for new plans
    const defaultSections = initialPlan && initialPlan.length > 0 ? (initialPlan[0].sections || 1) : 1
    const base = generateExpansionPlan(openingGrades, buildoutGrades, defaultSections, defaultStudentsPerSection, yearNewGrades)

    // Apply overrides, then iteratively propagate to subsequent years.
    // Must be iterative (not a single .map pass) because Year 3 depends on
    // Year 2's propagated values, which depend on Year 1's overrides.
    const result = base.map((entry) => {
      const key = `${entry.year}-${entry.grade_level}`
      const override = planOverrides.get(key)
      if (override) {
        return { ...entry, sections: override.sections, students_per_section: override.students_per_section }
      }
      return { ...entry }
    })

    // Iterative propagation: process year by year so each year sees the resolved prior year
    for (let i = 0; i < result.length; i++) {
      const entry = result[i]
      const key = `${entry.year}-${entry.grade_level}`
      if (planOverrides.has(key) || entry.year <= 1) continue

      if (entry.is_new_grade) {
        // New grade: inherit from the last entry of the prior year (already resolved)
        const priorYearEntries = result.filter((e) => e.year === entry.year - 1)
        if (priorYearEntries.length > 0) {
          const lastEntry = priorYearEntries[priorYearEntries.length - 1]
          result[i] = { ...entry, sections: lastEntry.sections, students_per_section: lastEntry.students_per_section }
        }
      } else {
        // Returning grade: inherit from same grade in prior year (already resolved)
        const priorEntry = result.find((e) => e.year === entry.year - 1 && e.grade_level === entry.grade_level)
        if (priorEntry) {
          result[i] = { ...entry, sections: priorEntry.sections, students_per_section: priorEntry.students_per_section }
        }
      }
    }

    return result
  }, [openingGrades, buildoutGrades, defaultStudentsPerSection, yearNewGrades, planOverrides, initialPlan])

  const enrollments = useMemo(
    () => computeExpansionEnrollments(plan, retentionRate),
    [plan, retentionRate]
  )

  // For each year, compute which buildout grades are NOT yet served
  const availableByYear = useMemo(() => {
    const map = new Map<number, string[]>()
    const served = new Set(openingGrades)
    for (let year = 2; year <= 5; year++) {
      const priorNew = yearNewGrades.get(year - 1) || []
      for (const g of priorNew) served.add(g)
      const thisYearAssigned = new Set(yearNewGrades.get(year) || [])
      const available = sortGrades(buildoutGrades.filter((g) => !served.has(g) && !thisYearAssigned.has(g)))
      map.set(year, available)
    }
    return map
  }, [openingGrades, buildoutGrades, yearNewGrades])

  // Compute grades that don't fit in the 5-year window
  const unassignedGrades = useMemo(() => {
    const assigned = new Set(openingGrades)
    for (let y = 2; y <= 5; y++) {
      for (const g of (yearNewGrades.get(y) || [])) assigned.add(g)
    }
    return sortGrades(buildoutGrades.filter(g => !assigned.has(g)))
  }, [openingGrades, buildoutGrades, yearNewGrades])

  const lastAssignedGrade = useMemo(() => {
    const assigned = sortGrades([...openingGrades])
    for (let y = 2; y <= 5; y++) {
      for (const g of (yearNewGrades.get(y) || [])) assigned.push(g)
    }
    const sorted = sortGrades(assigned)
    return sorted[sorted.length - 1] || ''
  }, [openingGrades, yearNewGrades])

  // Notify parent on changes
  useEffect(() => {
    onChange({
      openingGrades: sortGrades(openingGrades),
      buildoutGrades: sortGrades(buildoutGrades),
      retentionRate,
      plan,
      enrollments,
    })
  }, [openingGrades, buildoutGrades, retentionRate, plan, enrollments, onChange])

  function toggleOpeningGrade(grade: string) {
    const newList = openingGrades.includes(grade)
      ? openingGrades.filter((g) => g !== grade)
      : [...openingGrades, grade]
    setOpeningGrades(newList)
    setYearNewGrades(defaultYearNewGrades(newList, buildoutGrades))
  }

  function toggleBuildoutGrade(grade: string) {
    const newList = buildoutGrades.includes(grade)
      ? buildoutGrades.filter((g) => g !== grade)
      : [...buildoutGrades, grade]
    setBuildoutGrades(newList)
    setYearNewGrades(defaultYearNewGrades(openingGrades, newList))
  }

  function toggleYearGrade(year: number, grade: string) {
    setYearNewGrades((prev) => {
      const next = new Map(prev)
      const current = next.get(year) || []
      if (current.includes(grade)) {
        next.set(year, current.filter((g) => g !== grade))
      } else {
        // Guard: don't add a grade that's already served as a returning grade
        const priorGrades = new Set<string>(openingGrades)
        for (let y = 2; y < year; y++) {
          for (const g of (prev.get(y) || [])) priorGrades.add(g)
        }
        if (priorGrades.has(grade)) return prev // already present in this year
        next.set(year, sortGrades([...current, grade]))
      }
      return next
    })
  }

  function applyConsistentClassSize(value: number) {
    setConsistentValue(value)
    setDefaultStudentsPerSection(value)
    // Push to all existing plan overrides
    setPlanOverrides((prev) => {
      const next = new Map(prev)
      for (const entry of plan) {
        const key = `${entry.year}-${entry.grade_level}`
        const existing = next.get(key)
        if (existing) {
          next.set(key, { ...existing, students_per_section: value })
        } else {
          next.set(key, { sections: entry.sections, students_per_section: value })
        }
      }
      return next
    })
  }

  function updatePlanEntry(year: number, grade: string, field: 'sections' | 'students_per_section', value: number) {
    setPlanOverrides((prev) => {
      const next = new Map(prev)
      const key = `${year}-${grade}`
      const entry = plan.find((e) => e.year === year && e.grade_level === grade)
      const existing = next.get(key) || {
        sections: entry?.sections || 1,
        students_per_section: entry?.students_per_section || defaultStudentsPerSection,
      }
      next.set(key, { ...existing, [field]: value })
      // Remove overrides for this grade in subsequent years so the
      // propagation loop inherits the new value (carry-forward fix)
      for (let y = year + 1; y <= 5; y++) {
        next.delete(`${y}-${grade}`)
      }
      return next
    })
  }

  const years = Array.from(new Set(plan.map((e) => e.year))).sort((a, b) => a - b)

  // Founding grades config for the per-grade table (sorted by grade order)
  const foundingEntries = plan.filter((e) => e.year === 1).sort((a, b) => gradeIndex(a.grade_level) - gradeIndex(b.grade_level))
  const foundingTotal = foundingEntries.reduce((s, e) => s + e.sections * e.students_per_section, 0)
  const foundingSections = foundingEntries.reduce((s, e) => s + e.sections, 0)

  return (
    <div className="space-y-6">
      {/* Opening Grades */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Opening Grades (Year 1)
        </label>
        <p className="text-xs text-slate-400 mb-2">Which grade levels will you serve in your first year?</p>
        <div className="flex flex-wrap gap-1.5">
          {availableGrades.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => toggleOpeningGrade(g)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                openingGrades.includes(g)
                  ? 'border-teal-600 bg-teal-50 text-teal-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
              }`}
            >
              {g === 'K' ? 'K' : `Grade ${g}`}
            </button>
          ))}
        </div>
      </div>

      {/* Buildout Grades */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Full Buildout Grades
        </label>
        <p className="text-xs text-slate-400 mb-2">Which grade levels will you serve when fully grown?</p>
        <div className="flex flex-wrap gap-1.5">
          {availableGrades.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => toggleBuildoutGrade(g)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                buildoutGrades.includes(g)
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                  : openingGrades.includes(g)
                  ? 'border-teal-300 bg-teal-50/50 text-teal-500'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
              }`}
            >
              {g === 'K' ? 'K' : `Grade ${g}`}
            </button>
          ))}
        </div>
      </div>

      {/* Per-Grade Founding Configuration */}
      {foundingEntries.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Year 1 Grade Configuration</h3>
          <p className="text-xs text-slate-400 mb-3">Set sections and class size for each founding grade.</p>

          {/* Consistent class size toggle */}
          <div className="flex items-center gap-3 mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input
                type="checkbox"
                checked={consistentClassSize}
                onChange={(e) => {
                  const checked = e.target.checked
                  setConsistentClassSize(checked)
                  if (checked) {
                    applyConsistentClassSize(consistentValue)
                  }
                }}
                className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              Use consistent class size across all grades
            </label>
            {consistentClassSize && (
              <input
                type="number"
                min={10}
                max={50}
                value={consistentValue}
                onChange={(e) => applyConsistentClassSize(Number(e.target.value))}
                className="w-16 text-center border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600">Grade</th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600">Sections</th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600">Students / Section</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600">Students</th>
                </tr>
              </thead>
              <tbody>
                {foundingEntries.map((entry) => (
                  <tr key={entry.grade_level} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 font-medium text-slate-700">
                      {entry.grade_level === 'K' ? 'Kindergarten' : `Grade ${entry.grade_level}`}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <select
                        value={entry.sections}
                        onChange={(e) => updatePlanEntry(1, entry.grade_level, 'sections', Number(e.target.value))}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent cursor-text"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="number"
                        min={10}
                        max={50}
                        value={entry.students_per_section}
                        onChange={(e) => updatePlanEntry(1, entry.grade_level, 'students_per_section', Number(e.target.value))}
                        readOnly={consistentClassSize}
                        tabIndex={consistentClassSize ? -1 : undefined}
                        className={`w-16 text-center border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent cursor-text ${
                          consistentClassSize ? 'bg-slate-100 text-slate-500 cursor-default' : 'bg-white'
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="block text-right font-semibold rounded-md px-2 py-1.5 cursor-default"
                        style={{ background: 'var(--bg-table-alt)', color: 'var(--text-secondary)' }}
                      >
                        {entry.sections * entry.students_per_section}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200">
                  <td className="px-3 py-2 font-bold text-slate-700">Total Year 1</td>
                  <td className="px-3 py-2 text-center font-semibold text-slate-600">{foundingSections}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{foundingTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Expansion Timeline — unified per-grade detail */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Grade Expansion Plan</h3>
        <p className="text-xs text-slate-400 mb-3">
          Full plan by year. Click grade badges to customize which grades are added each year. Edit sections and class size per grade.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Grade</th>
                <th className="text-center px-3 py-2 font-semibold text-slate-600">Sections</th>
                <th className="text-center px-3 py-2 font-semibold text-slate-600">Students/Section</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Students</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">Year Added</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => {
                const yearEntries = plan.filter((e) => e.year === year).sort((a, b) => gradeIndex(a.grade_level) - gradeIndex(b.grade_level))
                const yearTotal = yearEntries.reduce((s, e) => s + e.sections * e.students_per_section, 0)
                const yearAssigned = yearNewGrades.get(year) || []

                return (
                  <React.Fragment key={year}>
                    {/* Year header row */}
                    <tr className="bg-slate-50/60 border-b border-slate-200">
                      <td colSpan={3} className="px-3 py-2 font-bold text-slate-700 text-xs uppercase tracking-wide">
                        Year {year}
                        {year > 1 && (
                          <span className="ml-2 font-normal normal-case tracking-normal">
                            {/* New grade toggle badges */}
                            {yearAssigned.map((g) => (
                              <Tooltip key={g} content={`Remove grade ${g} from Year ${year}`}>
                                <button
                                  type="button"
                                  onClick={() => toggleYearGrade(year, g)}
                                  className="px-2 py-0.5 rounded text-xs font-medium bg-teal-100 text-teal-700 border border-teal-300 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors cursor-pointer ml-1"
                                >
                                  +{g}
                                </button>
                              </Tooltip>
                            ))}
                            {(availableByYear.get(year) || []).map((g) => (
                              <Tooltip key={g} content={`Add grade ${g} to Year ${year}`}>
                                <button
                                  type="button"
                                  onClick={() => toggleYearGrade(year, g)}
                                  className="px-2 py-0.5 rounded text-xs font-medium bg-white text-slate-400 border border-dashed border-slate-300 hover:border-teal-400 hover:text-teal-600 hover:bg-teal-50 transition-colors cursor-pointer ml-1"
                                >
                                  {g}
                                </button>
                              </Tooltip>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800 text-xs">{yearTotal} students</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                    {/* Per-grade rows */}
                    {yearEntries.map((entry) => (
                      <tr key={`${year}-${entry.grade_level}`} className={`border-b border-slate-100 ${entry.is_new_grade ? 'bg-teal-50/40' : ''}`}>
                        <td className="px-3 py-2 pl-6">
                          <span className={entry.is_new_grade ? 'text-teal-700 font-medium' : 'text-slate-600'}>
                            {entry.grade_level === 'K' ? 'K' : `Grade ${entry.grade_level}`}
                            {entry.is_new_grade && <span className="text-[10px] ml-1.5 text-teal-500 font-semibold">NEW</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <select
                            value={entry.sections}
                            onChange={(e) => updatePlanEntry(year, entry.grade_level, 'sections', Number(e.target.value))}
                            className="border border-slate-200 rounded px-1.5 py-1 text-xs text-center bg-white focus:ring-2 focus:ring-teal-500 focus:border-transparent cursor-text"
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="number"
                            min={10}
                            max={50}
                            value={entry.students_per_section}
                            onChange={(e) => updatePlanEntry(year, entry.grade_level, 'students_per_section', Number(e.target.value))}
                            readOnly={consistentClassSize}
                            tabIndex={consistentClassSize ? -1 : undefined}
                            className={`w-14 text-center border border-slate-200 rounded px-1.5 py-1 text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent cursor-text ${
                              consistentClassSize ? 'bg-slate-100 text-slate-500 cursor-default' : 'bg-white'
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="block text-right font-medium rounded px-1.5 py-1 cursor-default"
                            style={{ background: 'var(--bg-table-alt)', color: 'var(--text-secondary)' }}
                          >
                            {entry.sections * entry.students_per_section}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-xs flex items-center gap-1">
                          {entry.is_new_grade ? `Year ${year}` : 'Year 1'}
                          {entry.is_new_grade && year > 1 && (
                            <Tooltip content={`Remove grade ${entry.grade_level} from Year ${year}`}>
                              <button
                                type="button"
                                onClick={() => toggleYearGrade(year, entry.grade_level)}
                                className="ml-1 w-4 h-4 inline-flex items-center justify-center rounded text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                aria-label={`Remove grade ${entry.grade_level} from Year ${year}`}
                              >
                                ✕
                              </button>
                            </Tooltip>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Info banner for grades beyond the 5-year window */}
        {unassignedGrades.length > 0 && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
            <strong>Note:</strong> Your grade expansion plan extends beyond the 5-year projection window.
            Grade{unassignedGrades.length > 1 ? 's' : ''} {unassignedGrades.join(', ')} would be added in Year{unassignedGrades.length > 1 ? 's' : ''} {unassignedGrades.map((_, i) => 6 + i).join('-')},
            after your first Commission re-authorization cycle. The 5-year financial model covers your buildout through Grade {lastAssignedGrade}.
          </div>
        )}
      </div>

      {/* R-ENR-01: Annual Retention Rate slider */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <label className="block text-sm font-medium text-slate-700">Annual Retention Rate</label>
            <Tooltip content="Estimated percentage of students who return each year. Affects Year 2 and beyond. WA charter elementary schools typically see 90–95% annual retention. Adjust based on your school's context — neighborhood mobility, programmatic differentiation, family commitment patterns. Once your school reaches full grade buildout, total enrollment may decline slightly year-over-year as retention continues to apply with no new grades being added — this reflects realistic stable-state enrollment. You can change this later in Settings → Grade Expansion.">
              <span className="text-slate-400 text-xs cursor-help" aria-label="More information about annual retention rate">ⓘ</span>
            </Tooltip>
          </div>
          <span className="text-sm font-semibold text-slate-700 tabular-nums">{retentionRate}%</span>
        </div>
        <p className="text-xs text-slate-400 mb-2">
          Percentage of students who return each year. Affects multi-year projections from Year 2 onward.
          The Commission&apos;s Long-Range Projection template has no retention input (every student
          returns), so its Year 2–5 enrollment matches this model at 100%.
        </p>
        <input
          type="range"
          min={70}
          max={100}
          step={1}
          value={retentionRate}
          onChange={(e) => setRetentionRate(Number(e.target.value))}
          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
          aria-label="Annual retention rate"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>70%</span>
          <span className="italic">Default 92% — WA charter elementary range 90–95%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  )
}
