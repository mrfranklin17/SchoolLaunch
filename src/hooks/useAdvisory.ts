'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useScenario } from '@/lib/ScenarioContext'
import { usePermissions } from '@/hooks/usePermissions'
import {
  advisoryDataHash,
  buildAdvisoryRequest,
  failedAgentCount,
  isCacheable,
  normalizeAdvisory,
  type AdvisoryData,
  type AlignmentReviewSummary,
} from '@/lib/advisory'

export interface AdvisoryState {
  /** The cached or just-generated advisory; null until one exists. */
  advisory: AdvisoryData | null
  /** The school's latest Alignment Review (part of the advisory context), if any. */
  alignmentReview: AlignmentReviewSummary | null
  /** True once the cache and alignment lookups have finished. */
  ready: boolean
  generating: boolean
  error: string | null
  /** The model (or alignment review) changed since the advisory was generated. */
  modelChanged: boolean
  /** Advisors that could not be reached in the advisory shown. */
  failedAgents: number
  /** Owners and editors generate; viewers read the cached panel. */
  canGenerate: boolean
  /** Run the panel (no-op for viewers). Resolves to the new advisory, or null on failure. */
  generate: () => Promise<AdvisoryData | null>
}

/**
 * The advisory panel for the current school, shared by the Overview briefing card and the
 * Advisory Panel (Phase 3). Reads school_profiles.advisory_cache straight from Supabase on
 * mount (never from stale React state), builds one context — including Alignment Review
 * findings — and caches only complete results. Viewers never trigger generation: a school
 * without a cached panel shows them an empty state instead of eight AI calls per visit.
 */
export function useAdvisory(): AdvisoryState {
  const {
    schoolData: { schoolId, schoolName, profile, positions, allPositions, projections, gradeExpansionPlan, loading },
    pathway,
    multiYear,
    fpfScorecard,
  } = useScenario()
  const { canEdit, isLoading: permissionsLoading } = usePermissions()
  const [supabase] = useState(() => createClient())

  const [advisory, setAdvisory] = useState<AdvisoryData | null>(null)
  const [alignmentReview, setAlignmentReview] = useState<AlignmentReviewSummary | null>(null)
  const [ready, setReady] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initRef = useRef(false)
  const inFlightRef = useRef(false)

  // Uses allPositions so Y2–Y5 staffing edits invalidate the cache (matches scenario staleness).
  const hashFor = useCallback(
    (review: AlignmentReviewSummary | null) =>
      advisoryDataHash({ profile, positions: allPositions, projections, gradeExpansionPlan }, review),
    [profile, allPositions, projections, gradeExpansionPlan],
  )
  const currentDataHash = useMemo(() => hashFor(alignmentReview), [hashFor, alignmentReview])

  const run = useCallback(async (review: AlignmentReviewSummary | null): Promise<AdvisoryData | null> => {
    if (!canEdit || !schoolId || !schoolName || loading || inFlightRef.current) return null
    inFlightRef.current = true
    setGenerating(true)
    setError(null)
    try {
      const body = buildAdvisoryRequest({
        schoolId, schoolName, profile, positions, projections, gradeExpansionPlan,
        multiYear, fpfScorecard, pathway, alignmentReview: review,
      })
      const res = await fetch('/api/advisory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const result = normalizeAdvisory({ ...(await res.json()), dataHash: hashFor(review) })
      if (!result) throw new Error('No briefing returned')
      setAdvisory(result)
      // A partial panel is shown for this visit but never replaces the cache.
      if (isCacheable(result)) {
        const { error: saveError } = await supabase
          .from('school_profiles')
          .update({ advisory_cache: result })
          .eq('school_id', schoolId)
        if (saveError) console.error('Advisory cache save failed:', saveError.message)
      }
      return result
    } catch (err) {
      console.error('Advisory generation failed:', err)
      setError('Failed to generate advisory analysis. Please try again.')
      return null
    } finally {
      inFlightRef.current = false
      setGenerating(false)
    }
  }, [canEdit, schoolId, schoolName, loading, profile, positions, projections, gradeExpansionPlan, multiYear, fpfScorecard, pathway, hashFor, supabase])

  // Mount: load the cache and the latest alignment review together (the review is part of the
  // context and the hash), then generate only when nothing is cached and the user may edit.
  useEffect(() => {
    if (loading || permissionsLoading || !schoolId || initRef.current) return
    initRef.current = true
    ;(async () => {
      const [cacheRes, reviewRes] = await Promise.all([
        supabase.from('school_profiles').select('advisory_cache').eq('school_id', schoolId).maybeSingle(),
        supabase.from('alignment_reviews')
          .select('id, created_at, overall_alignment, summary, misalignments')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(1),
      ])
      const review = (reviewRes.data?.[0] ?? null) as AlignmentReviewSummary | null
      const cached = normalizeAdvisory(cacheRes.data?.advisory_cache)
      setAlignmentReview(review)
      setAdvisory(cached)
      setReady(true)
      // No auto-run on a model still being set up (editors can open a school mid-onboarding).
      if (!cached && profile.onboarding_complete) await run(review)
    })()
  }, [loading, permissionsLoading, schoolId, supabase, run, profile.onboarding_complete])

  return {
    advisory,
    alignmentReview,
    ready,
    generating,
    error,
    modelChanged: !!advisory?.dataHash && advisory.dataHash !== currentDataHash,
    failedAgents: failedAgentCount(advisory),
    canGenerate: canEdit,
    generate: () => run(alignmentReview),
  }
}
