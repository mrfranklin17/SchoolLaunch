import type { AdvisoryCache, BudgetProjection, GradeExpansionEntry, SchoolProfile, StaffingPosition } from './types'
import type { FPFScorecard, MultiYearDetailedRow } from './budgetEngine'
import { buildAgentContextString, buildSchoolContextString, computeAdvisoryHash, type ProjectionHashInputs } from './buildSchoolContext'

/**
 * Advisory panel rules shared by the Overview briefing card and the Advisory Panel (Phase 3).
 * Both pages read and write the same school_profiles.advisory_cache, so they must send the same
 * context, compute the same staleness hash and treat a failed advisor the same way.
 */

export type AdvisoryAgent = AdvisoryCache['agents'][number]
export type AdvisoryData = AdvisoryCache

/** The latest Alignment Review, as the advisory context and the Application Reviewer card use it. */
export interface AlignmentReviewSummary {
  id: string
  created_at: string
  overall_alignment: string
  summary: string
  misalignments: { severity: string; title: string }[] | null
}

/** What /api/advisory returned for an advisor whose call failed, before failures were flagged. */
export const LEGACY_UNAVAILABLE_SUMMARY = 'Unable to generate assessment at this time.'

/** An advisor whose assessment could not be generated (flagged by the API, or a legacy fallback). */
export function isAgentFailed(agent: Pick<AdvisoryAgent, 'summary'> & { failed?: boolean }): boolean {
  return agent.failed === true || agent.summary === LEGACY_UNAVAILABLE_SUMMARY
}

export function failedAgentCount(advisory: AdvisoryData | null): number {
  return advisory ? advisory.agents.filter(isAgentFailed).length : 0
}

/** The school type the API uses to pick generic advisors and the briefing prompt. */
export function advisorySchoolType(pathway: string): 'private' | 'micro' | 'charter' {
  return pathway === 'generic_private' ? 'private' : pathway === 'generic_micro' ? 'micro' : 'charter'
}

function keyMisalignments(review: AlignmentReviewSummary) {
  return (review.misalignments ?? []).filter((m) => m.severity === 'critical' || m.severity === 'important')
}

/** Alignment findings appended to both advisory contexts when the school has a review. */
export function alignmentAppendix(review: AlignmentReviewSummary): string {
  const findings = keyMisalignments(review).map((m) => `- [${m.severity}] ${m.title}`).join('\n')
  return `\n\nAPPLICATION ALIGNMENT REVIEW (${review.overall_alignment}):
${review.summary}
${findings ? `Key misalignments:\n${findings}` : 'No critical misalignments found.'}`
}

/** The Application Reviewer card the Advisory Panel shows alongside the seven advisors. */
export function alignmentAgentCard(review: AlignmentReviewSummary): AdvisoryAgent {
  return {
    id: 'application_reviewer',
    name: 'Application Reviewer',
    icon: 'clipboard',
    subtitle: 'Application narrative vs. financial model',
    status: review.overall_alignment === 'strong' ? 'strong'
      : review.overall_alignment === 'weak' ? 'risk'
      : 'needs_attention',
    summary: review.summary,
    actions: keyMisalignments(review).slice(0, 3).map((m) => m.title),
  }
}

/**
 * Staleness hash for the advisory cache: the model inputs (computeAdvisoryHash), plus the
 * Alignment Review the context included. Without a review the hash is exactly
 * computeAdvisoryHash, so caches of schools that never ran a review stay valid.
 */
export function advisoryDataHash(input: ProjectionHashInputs, review: Pick<AlignmentReviewSummary, 'id'> | null): string {
  const base = computeAdvisoryHash(input)
  return review ? `${base}|align:${review.id}` : base
}

export interface AdvisoryRequestInput {
  schoolId: string
  schoolName: string
  profile: SchoolProfile
  /** Year 1 positions (the context's staffing section). */
  positions: StaffingPosition[]
  projections: BudgetProjection[]
  gradeExpansionPlan: GradeExpansionEntry[]
  multiYear: MultiYearDetailedRow[]
  fpfScorecard: FPFScorecard
  pathway: string
  alignmentReview: AlignmentReviewSummary | null
}

/** The /api/advisory request body: full and agent contexts, with alignment findings when present. */
export function buildAdvisoryRequest(i: AdvisoryRequestInput) {
  const scorecard = i.pathway === 'wa_charter' ? i.fpfScorecard : undefined
  const appendix = i.alignmentReview ? alignmentAppendix(i.alignmentReview) : ''
  return {
    schoolId: i.schoolId,
    schoolContext: buildSchoolContextString(i.schoolName, i.profile, i.positions, i.projections, i.gradeExpansionPlan, i.multiYear, scorecard, i.pathway) + appendix,
    agentContext: buildAgentContextString(i.schoolName, i.profile, i.positions, i.projections, i.gradeExpansionPlan, i.multiYear, scorecard, i.pathway) + appendix,
    pathway: i.pathway,
    schoolType: advisorySchoolType(i.pathway),
  }
}

/**
 * A stored or freshly generated advisory in display shape, or null when there is nothing to
 * show (no briefing). Failed advisors are flagged so they render as unavailable rather than as
 * a "Needs Attention" verdict.
 */
export function normalizeAdvisory(raw: unknown): AdvisoryData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<AdvisoryData>
  if (typeof r.briefing !== 'string' || !r.briefing.trim()) return null
  const agents = Array.isArray(r.agents) ? r.agents : []
  return {
    briefing: r.briefing,
    agents: agents.map((a) => (isAgentFailed(a) ? { ...a, failed: true, actions: [] } : a)),
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : '',
    dataHash: typeof r.dataHash === 'string' ? r.dataHash : '',
  }
}

/** Only complete results are cached: a briefing and every advisor's assessment. */
export function isCacheable(advisory: AdvisoryData): boolean {
  return advisory.briefing.trim().length > 0 && advisory.agents.length > 0 && failedAgentCount(advisory) === 0
}
