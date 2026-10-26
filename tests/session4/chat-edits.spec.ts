import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  CHAT_EDIT_TOOLS,
  EDITABLE_RATES,
  applyChanges,
  canApplyFromChat,
  parsePlanChange,
  planState,
  scopeOfChanges,
  scopeOfState,
  statesMatch,
  describeChange,
  editableItemsForPrompt,
  parseToolCall,
  positionGroups,
  proposalMarker,
  reviewToolCalls,
  splitProposal,
  validateChange,
  type PlanChange,
  type PlanSnapshot,
} from '../../src/lib/chatEdits'
import { previewChanges } from '../../src/lib/chatPreview'
import { splitStreamError } from '../../src/lib/aiErrors'
import { stubStream } from '../../src/lib/aiStub'
import { getAssumptions, type SchoolProfile, type StaffingPosition } from '../../src/lib/types'
import type { ProjectionInputs } from '../../src/lib/budgetEngine'

/**
 * Phase 6a (ROADMAP.md): chat proposes plan changes and previews them; nothing is saved.
 *
 * Run: npx playwright test tests/session4/chat-edits.spec.ts
 */

const SCHOOL = 'school-1'

const profile: SchoolProfile = {
  school_id: SCHOOL,
  region: 'King',
  planned_open_year: 2027,
  grade_config: 'K-5',
  target_enrollment_y1: 0,
  target_enrollment_y2: 0,
  target_enrollment_y3: 0,
  target_enrollment_y4: 0,
  target_enrollment_y5: 0,
  max_class_size: 24,
  pct_frl: 55,
  pct_iep: 14,
  pct_ell: 20,
  pct_hicap: 3,
  onboarding_complete: true,
  financial_assumptions: { salary_escalator_pct: 2.5 },
}

/** Rows for one position across five years, saved the way the Staffing tab saves them. */
function position(sortOrder: number, type: string, title: string, fte: number, salary: number, category: StaffingPosition['category']): StaffingPosition[] {
  return [1, 2, 3, 4, 5].map((year) => ({
    school_id: SCHOOL,
    year,
    title,
    category,
    fte,
    annual_salary: Math.round(salary * Math.pow(1.025, year - 1)),
    position_type: type,
    sort_order: sortOrder,
  }))
}

const allPositions: StaffingPosition[] = [
  ...position(0, 'principal', 'Principal/Head of School', 1, 123600, 'admin'),
  ...position(1, 'teacher_elem', 'Classroom Teacher - Elementary', 6, 80340, 'certificated'),
  ...position(2, 'instructional_coach', 'Instructional Coach/Curriculum Specialist', 1, 87550, 'certificated'),
]

// K–2 in Year 1 (the founding cohort), grade 3 added in Year 2.
const gradeExpansionPlan = [1, 2, 3, 4, 5].flatMap((year) => [
  ...['K', '1', '2'].map((grade_level) => ({ year, grade_level, sections: 2, students_per_section: 24, is_new_grade: false })),
  ...(year >= 2 ? [{ year, grade_level: '3', sections: 2, students_per_section: 24, is_new_grade: year === 2 }] : []),
])

const snapshot: PlanSnapshot = {
  profile,
  allPositions,
  projections: [
    { school_id: SCHOOL, year: 1, category: 'Operations', subcategory: 'Facilities', amount: 240000, is_revenue: false },
    { school_id: SCHOOL, year: 1, category: 'Operations', subcategory: 'Insurance', amount: 18000, is_revenue: false },
  ],
  gradeExpansionPlan,
}

const noPlan: PlanSnapshot = { ...snapshot, gradeExpansionPlan: [], profile: { ...profile, target_enrollment_y1: 144, target_enrollment_y2: 168 } }

function inputs(s: PlanSnapshot): ProjectionInputs {
  return {
    pathway: 'wa_charter',
    profile: s.profile,
    positions: s.allPositions.filter((p) => p.year === 1),
    allPositions: s.allPositions,
    projections: s.projections,
    assumptions: getAssumptions(s.profile.financial_assumptions),
    preOpenCash: 0,
    gradeExpansionPlan: s.gradeExpansionPlan,
  }
}

const ok = (name: string, input: unknown, s: PlanSnapshot = snapshot): PlanChange => {
  const r = parseToolCall(name, input, s)
  if ('error' in r) throw new Error(r.error)
  return r.change
}
const err = (name: string, input: unknown, s: PlanSnapshot = snapshot): string => {
  const r = parseToolCall(name, input, s)
  if ('change' in r) throw new Error('expected an error')
  return r.error
}

test.describe('positions', () => {
  test('rows group across years by sort order and type, keyed in Staffing tab order', () => {
    const groups = positionGroups([...allPositions].reverse())
    expect(groups.map((g) => [g.key, g.title, g.rows.length])).toEqual([
      ['P1', 'Principal/Head of School', 5],
      ['P2', 'Classroom Teacher - Elementary', 5],
      ['P3', 'Instructional Coach/Curriculum Specialist', 5],
    ])
    expect(groups[2].rows.map((r) => r.year)).toEqual([1, 2, 3, 4, 5])
  })

  test('the model is shown each position with its key, FTE by year and base salary', () => {
    const text = editableItemsForPrompt(snapshot)
    expect(text).toContain('- P3: Instructional Coach/Curriculum Specialist — Y1 1, Y2 1, Y3 1, Y4 1, Y5 1; $87,550')
    expect(text).toContain('- Facilities: $240,000')
    expect(text).toContain('- K: Y1 2×24, Y2 2×24')
    expect(text).toContain('- 3: Y2 2×24 (added), Y3 2×24')
    // Enrollment targets are hidden when the grade plan drives enrollment.
    expect(text).not.toContain('target_enrollment_y1')
    expect(editableItemsForPrompt(noPlan)).toContain('target_enrollment_y1 (Year 1 enrollment): 144')
  })
})

test.describe('tool calls are checked against the saved plan', () => {
  test('a valid staffing change parses', () => {
    expect(ok('propose_staffing_change', { position_key: 'p3', years: [3, 1, 2, 4, 5], fte: 0.5, year1_salary: null }))
      .toEqual({ kind: 'position', positionKey: 'P3', years: [1, 2, 3, 4, 5], fte: 0.5, year1Salary: null })
  })

  test('unknown keys, missing years, out-of-range values and empty changes are errors the model can fix', () => {
    expect(err('propose_staffing_change', { position_key: 'P9', years: [1], fte: 1, year1_salary: null })).toMatch(/No position has key P9/)
    expect(err('propose_staffing_change', { position_key: 'P1', years: [1], fte: null, year1_salary: null })).toMatch(/Nothing to change/)
    expect(err('propose_staffing_change', { position_key: 'P1', years: [1], fte: 80, year1_salary: null })).toMatch(/FTE must be between/)
    expect(err('propose_staffing_change', { position_key: 'P1', years: [1], fte: 0.333, year1_salary: null })).toMatch(/two decimals/)
    expect(err('propose_staffing_change', { position_key: 'P1', years: [2], fte: null, year1_salary: 90000 })).toMatch(/years must include 1/)
    expect(err('propose_staffing_change', { position_key: 'P1', years: [], fte: 1, year1_salary: null })).toMatch(/Malformed/)
    const y1Only = { ...snapshot, allPositions: allPositions.filter((p) => p.year === 1) }
    expect(err('propose_staffing_change', { position_key: 'P1', years: [1, 2], fte: 1, year1_salary: null }, y1Only)).toMatch(/no saved Year 2 row/)
  })

  test('operations, rates and the profile are range-checked', () => {
    expect(ok('propose_operations_change', { line: 'Facilities', year1_amount: 300000 })).toEqual({ kind: 'operations', line: 'Facilities', year1Amount: 300000 })
    expect(err('propose_operations_change', { line: 'Authorizer Fee', year1_amount: 1 })).toMatch(/Malformed/)
    expect(err('propose_operations_change', { line: 'Facilities', year1_amount: -5 })).toMatch(/between 0/)
    expect(err('propose_rate_change', { setting: 'salary_escalator_pct', value: 25 })).toMatch(/Salary escalator must be between 0 and 10/)
    expect(err('propose_school_profile_change', { field: 'pct_frl', value: 140 })).toMatch(/between 0 and 100/)
  })

  test('enrollment follows the grade plan when the school has one, the targets otherwise', () => {
    expect(err('propose_school_profile_change', { field: 'target_enrollment_y1', value: 150 })).toMatch(/grade expansion plan/)
    expect(ok('propose_school_profile_change', { field: 'target_enrollment_y1', value: 150 }, noPlan)).toEqual({ kind: 'profile', field: 'target_enrollment_y1', value: 150 })
    expect(err('propose_school_profile_change', { field: 'target_enrollment_y1', value: 150.5 }, noPlan)).toMatch(/whole number/)
    expect(err('propose_grade_plan_change', { grade: 'K', years: [2], sections: 3, students_per_section: null }, noPlan)).toMatch(/no grade expansion plan/)
    expect(err('propose_grade_plan_change', { grade: '5', years: [2], sections: 3, students_per_section: null })).toMatch(/not in the plan/)
    expect(ok('propose_grade_plan_change', { grade: '3', years: [2], sections: 3, students_per_section: null }))
      .toEqual({ kind: 'grade_plan', grade: '3', years: [2], sections: 3, studentsPerSection: null })
    expect(ok('propose_grade_plan_change', { grade: 'K', years: [1], sections: 3, students_per_section: 22 }))
      .toEqual({ kind: 'grade_plan', grade: 'K', years: [1], sections: 3, studentsPerSection: 22 })
  })

  test('sections of a continuing grade after Year 1 do not set enrollment, so changing them is refused', () => {
    expect(err('propose_grade_plan_change', { grade: 'K', years: [2, 3], sections: 3, students_per_section: null }))
      .toMatch(/continues from the year before in Year 2, 3.*for grade K: Year 1/)
    expect(err('propose_grade_plan_change', { grade: '3', years: [2, 3], sections: 3, students_per_section: null }))
      .toMatch(/in Year 3.*for grade 3: Year 2/)
  })

  test('no tool can change the authorizer fee, the benefits load or per-pupil funding', () => {
    const settings = Object.keys(EDITABLE_RATES)
    for (const fixed of ['authorizer_fee_pct', 'benefits_load_pct', 'regular_ed_per_pupil', 'sped_per_pupil']) {
      expect(settings).not.toContain(fixed)
      expect(err('propose_rate_change', { setting: fixed, value: 1 })).toMatch(/Malformed/)
    }
    expect(err('set_authorizer_fee', {})).toMatch(/Unknown tool/)
  })

  test('every tool is strict: closed schemas with every property required', () => {
    for (const tool of CHAT_EDIT_TOOLS) {
      expect(tool.strict).toBe(true)
      const schema = tool.input_schema as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
      expect(schema.additionalProperties).toBe(false)
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
    }
  })

  test('a turn with valid and invalid calls keeps the valid ones and returns errors for the rest', () => {
    const message = {
      content: [
        { type: 'text', text: 'Setting that up.', citations: null },
        { type: 'tool_use', id: 'a', name: 'propose_staffing_change', input: { position_key: 'P3', years: [1, 2, 3, 4, 5], fte: 0.5, year1_salary: null } },
        { type: 'tool_use', id: 'b', name: 'propose_staffing_change', input: { position_key: 'P7', years: [1], fte: 1, year1_salary: null } },
      ],
    } as unknown as Parameters<typeof reviewToolCalls>[0]
    const { changes, results } = reviewToolCalls(message, snapshot)
    expect(changes).toHaveLength(1)
    expect(results.map((r) => [r.tool_use_id, !!r.is_error])).toEqual([['a', false], ['b', true]])
  })
})

test.describe('applying a change (in memory only)', () => {
  test('FTE changes only the listed years and marks later years as set by hand', () => {
    const next = applyChanges(snapshot, [{ kind: 'position', positionKey: 'P3', years: [2, 3], fte: 0.5, year1Salary: null }])
    const coach = next.allPositions.filter((p) => p.position_type === 'instructional_coach')
    expect(coach.map((p) => p.fte)).toEqual([1, 0.5, 0.5, 1, 1])
    expect(coach.map((p) => !!p.manual_override)).toEqual([false, true, true, false, false])
    // The saved data is untouched.
    expect(allPositions.filter((p) => p.position_type === 'instructional_coach').every((p) => p.fte === 1)).toBe(true)
  })

  test('a new base salary escalates into later years like a Staffing tab save', () => {
    const next = applyChanges(snapshot, [{ kind: 'position', positionKey: 'P1', years: [1, 2, 3, 4, 5], fte: null, year1Salary: 130000 }])
    expect(next.allPositions.filter((p) => p.position_type === 'principal').map((p) => p.annual_salary))
      .toEqual([130000, 133250, 136581, 139996, 143496])
  })

  test('operations lines update or are added; rates, profile and grade plan change in place', () => {
    const next = applyChanges(snapshot, [
      { kind: 'operations', line: 'Facilities', year1Amount: 300000 },
      { kind: 'operations', line: 'Technology', year1Amount: 25000 },
      { kind: 'rate', setting: 'revenue_cola_pct', value: 2 },
      { kind: 'profile', field: 'pct_frl', value: 60 },
      { kind: 'grade_plan', grade: 'K', years: [2, 3, 4, 5], sections: 3, studentsPerSection: null },
    ])
    expect(next.projections.find((p) => p.subcategory === 'Facilities')?.amount).toBe(300000)
    expect(next.projections.find((p) => p.subcategory === 'Technology')).toMatchObject({ year: 1, amount: 25000, is_revenue: false })
    expect(getAssumptions(next.profile.financial_assumptions).revenue_cola_pct).toBe(2)
    expect(getAssumptions(next.profile.financial_assumptions).salary_escalator_pct).toBe(2.5)
    expect(next.profile.pct_frl).toBe(60)
    expect(next.gradeExpansionPlan.filter((e) => e.grade_level === 'K').map((e) => e.sections)).toEqual([2, 3, 3, 3, 3])
    expect(snapshot.projections).toHaveLength(2)
  })

  test('each change reads as before → after', () => {
    expect(describeChange({ kind: 'position', positionKey: 'P3', years: [1, 2, 3, 4, 5], fte: 0.5, year1Salary: null }, snapshot))
      .toEqual([{ label: 'Instructional Coach/Curriculum Specialist FTE, Years 1–5', before: '1', after: '0.5' }])
    expect(describeChange({ kind: 'operations', line: 'Facilities', year1Amount: 300000 }, snapshot))
      .toEqual([{ label: 'Facilities, Year 1', before: '$240,000', after: '$300,000' }])
    expect(describeChange({ kind: 'grade_plan', grade: 'K', years: [2, 4], sections: 3, studentsPerSection: null }, snapshot))
      .toEqual([{ label: 'Grade K sections, Years 2, 4', before: '2', after: '3' }])
  })
})

test.describe('engine preview', () => {
  test('cutting a position lowers expenses and raises net income every year', () => {
    const { metrics } = previewChanges(inputs(snapshot), snapshot, [{ kind: 'position', positionKey: 'P3', years: [1, 2, 3, 4, 5], fte: 0.5, year1Salary: null }])
    const expenses = metrics.find((m) => m.label === 'Total expenses')!
    const net = metrics.find((m) => m.label === 'Net income')!
    for (let i = 0; i < 2; i++) {
      expect(expenses.after[i]).toBeLessThan(expenses.before[i])
      expect(net.after[i]).toBeGreaterThan(net.before[i])
    }
    expect(metrics.find((m) => m.label === 'Enrollment')!.after).toEqual(metrics.find((m) => m.label === 'Enrollment')!.before)
  })

  test('another section in the year a grade is added raises enrollment from then on', () => {
    const { metrics } = previewChanges(inputs(snapshot), snapshot, [{ kind: 'grade_plan', grade: '3', years: [2], sections: 3, studentsPerSection: null }])
    const enrollment = metrics.find((m) => m.label === 'Enrollment')!
    expect(enrollment.after[0]).toBe(enrollment.before[0])
    expect(enrollment.after[1]).toBeGreaterThan(enrollment.before[1])
  })

  test('the saved plan previews against itself unchanged', () => {
    const { metrics, fpfMeets } = previewChanges(inputs(snapshot), snapshot, [])
    for (const m of metrics) expect(m.after).toEqual(m.before)
    expect(fpfMeets.after).toEqual(fpfMeets.before)
  })

  test('a change that no longer fits the plan is caught before previewing', () => {
    expect(validateChange({ kind: 'position', positionKey: 'P4', years: [1], fte: 1, year1Salary: null }, snapshot)).toMatch(/No position/)
  })
})

test.describe('stream protocol', () => {
  test('the proposal marker round-trips and is split off after the error marker', () => {
    const changes: PlanChange[] = [{ kind: 'grade_plan', grade: 'K', years: [2, 3], sections: 3, studentsPerSection: null }]
    const streamed = `I'll set that up.${proposalMarker(changes)}`
    const { text, error } = splitStreamError(streamed)
    expect(error).toBeNull()
    expect(splitProposal(text)).toEqual({ text: "I'll set that up.", changes })
  })

  test('a marker still arriving is hidden, never shown as text', () => {
    const partial = `I'll set that up.${proposalMarker([{ kind: 'operations', line: 'Facilities', year1Amount: 1 }]).slice(0, 30)}`
    expect(splitProposal(partial)).toEqual({ text: "I'll set that up.", changes: null })
    expect(splitProposal('No change here.')).toEqual({ text: 'No change here.', changes: null })
  })

  test('the AI stub stream has finalMessage, so the route reads stubbed and real streams alike', async () => {
    const stream = stubStream({ model: 'm', max_tokens: 10, messages: [] })
    const final = await stream.finalMessage()
    expect(final.stop_reason).toBe('end_turn')
  })

  test('edit tools are offered only to roles that can edit, on the WA pathway, with the saved plan loaded', () => {
    const route = readFileSync('src/app/api/chat/route.ts', 'utf8')
    expect(route).toContain("const PROPOSE_ROLES = ['school_ceo', 'school_editor', 'super_admin']")
    expect(route).toContain('const canPropose = isWaCharter && auth.roles.some((r) => PROPOSE_ROLES.includes(r.role))')
    expect(route).toContain('...(snapshot ? { tools: CHAT_EDIT_TOOLS } : {})')
  })
})

test.describe('6b: applying for real', () => {
  test('Owners can apply staffing, operations and grade plan changes; rates and profile stay preview-only', () => {
    const position: PlanChange = { kind: 'position', positionKey: 'P1', years: [1], fte: 1, year1Salary: null }
    const ops: PlanChange = { kind: 'operations', line: 'Facilities', year1Amount: 1 }
    const grade: PlanChange = { kind: 'grade_plan', grade: 'K', years: [1], sections: 3, studentsPerSection: null }
    expect(canApplyFromChat([position, ops, grade])).toBe(true)
    expect(canApplyFromChat([position, { kind: 'rate', setting: 'revenue_cola_pct', value: 2 }])).toBe(false)
    expect(canApplyFromChat([{ kind: 'profile', field: 'pct_frl', value: 50 }])).toBe(false)
    expect(canApplyFromChat([])).toBe(false)
  })

  test('request bodies are parsed by shape; anything else is rejected', () => {
    expect(parsePlanChange({ kind: 'operations', line: 'Facilities', year1Amount: 5 })).toEqual({ kind: 'operations', line: 'Facilities', year1Amount: 5 })
    expect(parsePlanChange({ kind: 'position', positionKey: 'P1', years: [2, 1], fte: 0.5, year1Salary: null }))
      .toEqual({ kind: 'position', positionKey: 'P1', years: [1, 2], fte: 0.5, year1Salary: null })
    for (const bad of [null, 'x', {}, { kind: 'operations', line: 'Authorizer Fee', year1Amount: 5 }, { kind: 'position', positionKey: 'P1', years: [9], fte: 1, year1Salary: null }, { kind: 'rate', setting: 'authorizer_fee_pct', value: 1 }, { kind: 'grade_plan', grade: 'K', years: [1], sections: '3', studentsPerSection: null }]) {
      expect(parsePlanChange(bad)).toBeNull()
    }
  })

  test('an operations amount keeps its per-student rate in step, as the Operations tab saves it', () => {
    const withEnrollment = { ...snapshot, profile: { ...profile, target_enrollment_y1: 150 } }
    const next = applyChanges(withEnrollment, [
      { kind: 'operations', line: 'Technology', year1Amount: 30000 },
      { kind: 'operations', line: 'Professional Development', year1Amount: 16000 },
      { kind: 'operations', line: 'Facilities', year1Amount: 300000 },
    ])
    const fa = next.profile.financial_assumptions as Record<string, unknown>
    expect(fa.technology_per_student).toBe(200) // 30,000 ÷ 150 students
    expect(fa.professional_development_per_fte).toBe(2000) // 16,000 ÷ 8 Year 1 FTE
    expect(Object.keys(fa).sort()).toEqual(['professional_development_per_fte', 'salary_escalator_pct', 'technology_per_student'])
  })

  test('the plan state covers only the touched parts, normalized as the replace RPCs store rows', () => {
    const changes: PlanChange[] = [
      { kind: 'position', positionKey: 'P3', years: [1, 2, 3, 4, 5], fte: 0.5, year1Salary: null },
      { kind: 'operations', line: 'Technology', year1Amount: 30000 },
    ]
    const scope = scopeOfChanges(changes)
    expect(scope).toEqual({ staffing: true, gradePlan: false, operationsLines: ['Technology'] })
    const before = planState(snapshot, scope)
    expect(before.gradePlan).toBeUndefined()
    expect(before.staffing).toHaveLength(15)
    expect(before.staffing![0]).toEqual({
      year: 1, title: 'Principal/Head of School', category: 'admin', fte: 1, annual_salary: 123600, position_type: 'principal',
      driver: 'fixed', classification: 'Administrative', benchmark_salary: 0, students_per_position: 24, sort_order: 0, manual_override: false,
    })
    expect(before.operations).toEqual({ lines: { Technology: 0 }, rates: { technology_per_student: null } })
    expect(scopeOfState(before)).toEqual(scope)

    const after = planState(applyChanges(snapshot, changes), scope)
    expect(statesMatch(after, before)).toBe(false)
    // A fresh read of the same data (ids, string numbers, row order) still matches.
    const reread = { ...snapshot, allPositions: [...snapshot.allPositions].reverse().map((p, i) => ({ ...p, id: `row-${i}`, fte: String(p.fte) as unknown as number })) }
    expect(statesMatch(planState(reread, scope), before)).toBe(true)
  })

  test('apply and undo are Owner-only routes over the shared store', () => {
    for (const route of ['src/app/api/plan-changes/apply/route.ts', 'src/app/api/plan-changes/undo/route.ts']) {
      expect(readFileSync(route, 'utf8')).toContain("requireRoles: ['school_ceo']")
    }
    const store = readFileSync('src/lib/planChangeStore.ts', 'utf8')
    expect(store).toContain('replaceStaffingPositions(')
    expect(store).toContain('replaceGradeExpansionPlan(')
    expect(store).toContain('The plan changed since this preview')
    expect(store).toContain('The plan has been edited since this change')
  })

  test('the change-log migration is additive, with RLS and no delete path', () => {
    const sql = readFileSync('supabase/migrations/20261026182948_phase6b_plan_changes.sql', 'utf8')
    const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(body).toContain('ENABLE ROW LEVEL SECURITY')
    expect(body).not.toMatch(/\bDELETE\b|\bDROP\b/i)
    expect(body).toMatch(/FOR INSERT[\s\S]*ur\.role = 'school_ceo'/)
  })
})
