import { test, expect } from '@playwright/test'
import {
  advisoryDataHash,
  advisorySchoolType,
  alignmentAgentCard,
  alignmentAppendix,
  buildAdvisoryRequest,
  failedAgentCount,
  isAgentFailed,
  isCacheable,
  normalizeAdvisory,
  LEGACY_UNAVAILABLE_SUMMARY,
  type AdvisoryAgent,
  type AlignmentReviewSummary,
} from '../../src/lib/advisory'
import { buildAgentContextString, buildSchoolContextString, computeAdvisoryHash } from '../../src/lib/buildSchoolContext'
import { runProjections, computeFPFScorecard } from '../../src/lib/budgetEngine'
import { DEFAULT_ASSUMPTIONS, type SchoolProfile, type StaffingPosition, type BudgetProjection } from '../../src/lib/types'

/**
 * Phase 3 — the Overview briefing card and the Advisory Panel share one advisory hook
 * (useAdvisory) over these rules: one context (with Alignment Review findings), one staleness
 * hash, failed advisors flagged instead of shown as "Needs Attention", and only complete panels
 * cached.
 *
 * Run: npx playwright test tests/session4/advisory-shared.spec.ts
 */

function agent(id: string, extra: Partial<AdvisoryAgent> = {}): AdvisoryAgent {
  return { id, name: id, icon: 'shield', subtitle: '', status: 'strong', summary: `${id} summary`, actions: ['do x'], ...extra }
}

const REVIEW: AlignmentReviewSummary = {
  id: 'rev-1',
  created_at: '2026-10-01T00:00:00Z',
  overall_alignment: 'moderate',
  summary: 'Narrative and model mostly agree.',
  misalignments: [
    { severity: 'critical', title: 'Enrollment ramp differs' },
    { severity: 'minor', title: 'Typo in budget table' },
    { severity: 'important', title: 'Facility cost not in narrative' },
    { severity: 'important', title: 'Counselor FTE' },
    { severity: 'critical', title: 'Fourth key finding' },
  ],
}

test.describe('failed advisors', () => {
  test('flagged by the API or recognised from the legacy fallback text', () => {
    expect(isAgentFailed(agent('a', { failed: true }))).toBe(true)
    expect(isAgentFailed(agent('a', { summary: LEGACY_UNAVAILABLE_SUMMARY }))).toBe(true)
    expect(isAgentFailed(agent('a'))).toBe(false)
  })

  test('normalizeAdvisory: a legacy all-failed cache with no briefing is "no panel"', () => {
    // The shape two production schools hold today: 7 fallback agents and an empty briefing.
    const legacy = {
      briefing: '',
      agents: Array.from({ length: 7 }, (_, i) => agent(`a${i}`, { status: 'needs_attention', summary: LEGACY_UNAVAILABLE_SUMMARY, actions: [] })),
      generatedAt: '2026-01-01T00:00:00Z',
      dataHash: 'h',
    }
    expect(normalizeAdvisory(legacy)).toBeNull()
    expect(normalizeAdvisory(null)).toBeNull()
    expect(normalizeAdvisory('nope')).toBeNull()
    expect(normalizeAdvisory({ briefing: '   ', agents: [] })).toBeNull()
  })

  test('normalizeAdvisory marks legacy failures and fills missing fields', () => {
    const n = normalizeAdvisory({ briefing: 'B', agents: [agent('ok'), agent('bad', { summary: LEGACY_UNAVAILABLE_SUMMARY, actions: ['x'] })] })
    expect(n).not.toBeNull()
    expect(n!.agents[0].failed).toBeUndefined()
    expect(n!.agents[1]).toMatchObject({ failed: true, actions: [] })
    expect(n!.dataHash).toBe('')
    expect(n!.generatedAt).toBe('')
    expect(failedAgentCount(n)).toBe(1)
    expect(failedAgentCount(null)).toBe(0)
  })

  test('a panel whose briefing alone failed still shows its advisors (never complete)', () => {
    const n = normalizeAdvisory({ briefing: '', agents: [agent('a'), agent('b', { failed: true })] })
    expect(n).not.toBeNull()
    expect(n!.briefing).toBe('')
    expect(isCacheable(n!)).toBe(false)
    expect(normalizeAdvisory({ briefing: '', agents: [agent('b', { failed: true })] })).toBeNull()
    expect(normalizeAdvisory({ briefing: 'B', agents: [null, 'x', agent('a')] })!.agents).toHaveLength(1)
  })

  test('only complete panels are cacheable', () => {
    const complete = normalizeAdvisory({ briefing: 'B', agents: [agent('a'), agent('b')], generatedAt: 't', dataHash: 'h' })!
    expect(isCacheable(complete)).toBe(true)
    expect(isCacheable({ ...complete, agents: [agent('a'), agent('b', { failed: true })] })).toBe(false)
    expect(isCacheable({ ...complete, agents: [] })).toBe(false)
    expect(isCacheable({ ...complete, briefing: ' ' })).toBe(false)
  })
})

test.describe('alignment review in the advisory', () => {
  test('appendix text: summary plus critical/important findings (unchanged from the Advisory tab)', () => {
    expect(alignmentAppendix(REVIEW)).toBe(`\n\nAPPLICATION ALIGNMENT REVIEW (moderate):
Narrative and model mostly agree.
Key misalignments:
- [critical] Enrollment ramp differs
- [important] Facility cost not in narrative
- [important] Counselor FTE
- [critical] Fourth key finding`)
    expect(alignmentAppendix({ ...REVIEW, misalignments: [{ severity: 'minor', title: 'x' }] }))
      .toContain('No critical misalignments found.')
    expect(alignmentAppendix({ ...REVIEW, misalignments: null })).toContain('No critical misalignments found.')
  })

  test('Application Reviewer card: verdict mapping and top three key findings', () => {
    const card = alignmentAgentCard(REVIEW)
    expect(card.id).toBe('application_reviewer')
    expect(card.status).toBe('needs_attention')
    expect(card.actions).toEqual(['Enrollment ramp differs', 'Facility cost not in narrative', 'Counselor FTE'])
    expect(alignmentAgentCard({ ...REVIEW, overall_alignment: 'strong' }).status).toBe('strong')
    expect(alignmentAgentCard({ ...REVIEW, overall_alignment: 'weak' }).status).toBe('risk')
  })
})

// --- Context and hash -------------------------------------------------------------------------

const positions: StaffingPosition[] = [
  { school_id: 's', year: 1, title: 'Principal', category: 'admin', fte: 1, annual_salary: 120000, position_type: 'principal', classification: 'Administrative', driver: 'fixed', students_per_position: 0 },
  { school_id: 's', year: 1, title: 'Teacher', category: 'certificated', fte: 5, annual_salary: 68000, position_type: 'teacher_elem', classification: 'Certificated', driver: 'per_pupil', students_per_position: 22 },
]
const projections: BudgetProjection[] = [{ school_id: 's', year: 1, category: 'Operations', subcategory: 'Facilities', amount: 150000, is_revenue: false }]
const profile = {
  school_id: 's', region: 'Spokane', planned_open_year: 2027, grade_config: 'K-5',
  target_enrollment_y1: 110, target_enrollment_y2: 130, target_enrollment_y3: 150, target_enrollment_y4: 170, target_enrollment_y5: 190,
  max_class_size: 24, pct_frl: 55, pct_iep: 12, pct_ell: 10, pct_hicap: 5, onboarding_complete: true, retention_rate: 92,
  financial_assumptions: {},
} as unknown as SchoolProfile
const hashInput = { profile, positions, projections, gradeExpansionPlan: [] }

test.describe('advisoryDataHash', () => {
  test('without a review it IS computeAdvisoryHash, so existing caches stay valid', () => {
    expect(advisoryDataHash(hashInput, null)).toBe(computeAdvisoryHash(hashInput))
  })
  test('a review (and a newer review) changes it', () => {
    const none = advisoryDataHash(hashInput, null)
    const r1 = advisoryDataHash(hashInput, REVIEW)
    const r2 = advisoryDataHash(hashInput, { ...REVIEW, id: 'rev-2' })
    expect(r1).not.toBe(none)
    expect(r2).not.toBe(r1)
    expect(r1.startsWith(none)).toBe(true)
  })
})

test.describe('buildAdvisoryRequest', () => {
  for (const pathway of ['wa_charter', 'generic_private'] as const) {
    test(`${pathway}: both contexts are the shared builders plus the alignment appendix`, () => {
      const multiYear = runProjections({ pathway, profile, positions, projections, assumptions: DEFAULT_ASSUMPTIONS, preOpenCash: 150000, gradeExpansionPlan: [], allPositions: positions, startupFunding: [] })
      const fpfScorecard = computeFPFScorecard(multiYear, 150000, false)
      const scorecard = pathway === 'wa_charter' ? fpfScorecard : undefined
      const base = { schoolId: 's', schoolName: 'Test Academy', profile, positions, projections, gradeExpansionPlan: [], multiYear, fpfScorecard, pathway }

      const plain = buildAdvisoryRequest({ ...base, alignmentReview: null })
      expect(plain.schoolContext).toBe(buildSchoolContextString('Test Academy', profile, positions, projections, [], multiYear, scorecard, pathway))
      expect(plain.agentContext).toBe(buildAgentContextString('Test Academy', profile, positions, projections, [], multiYear, scorecard, pathway))
      expect(plain).toMatchObject({ schoolId: 's', pathway, schoolType: advisorySchoolType(pathway) })

      const withReview = buildAdvisoryRequest({ ...base, alignmentReview: REVIEW })
      expect(withReview.schoolContext).toBe(plain.schoolContext + alignmentAppendix(REVIEW))
      expect(withReview.agentContext).toBe(plain.agentContext + alignmentAppendix(REVIEW))
    })
  }

  test('school type by pathway', () => {
    expect(advisorySchoolType('wa_charter')).toBe('charter')
    expect(advisorySchoolType('generic_charter')).toBe('charter')
    expect(advisorySchoolType('generic_private')).toBe('private')
    expect(advisorySchoolType('generic_micro')).toBe('micro')
  })
})
