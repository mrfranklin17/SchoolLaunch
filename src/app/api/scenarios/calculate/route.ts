import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { authenticateRequest } from '@/lib/apiAuth'
import { computeScenarioProjections, type ScenarioAssumptions } from '@/lib/scenarioEngine'
import { scenarioBaseHash } from '@/lib/buildSchoolContext'
import type { SchoolProfile, StaffingPosition, BudgetProjection, GradeExpansionEntry } from '@/lib/types'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { schoolId?: string; scenarioId?: string } | null
  const schoolId = body?.schoolId
  const scenarioId = body?.scenarioId
  if (!schoolId) return NextResponse.json({ error: 'Missing schoolId' }, { status: 400 })

  const auth = await authenticateRequest(request, {
    schoolId,
    requireRoles: ['school_ceo', 'school_editor', 'org_admin'],
  })
  if (auth instanceof NextResponse) return auth

  const admin = createServiceRoleClient()

  // Load all engine scenarios for this school (or just one if scenarioId provided)
  let scenarioQuery = admin
    .from('scenarios')
    .select('id, name, assumptions')
    .eq('school_id', schoolId)
    .eq('scenario_type', 'engine')

  if (scenarioId) {
    scenarioQuery = scenarioQuery.eq('id', scenarioId)
  }

  const { data: scenarios, error: scenError } = await scenarioQuery
  if (scenError || !scenarios || scenarios.length === 0) {
    return NextResponse.json({ error: 'No scenarios found' }, { status: 404 })
  }

  // Load school's base case data
  const [profileRes, posRes, projRes, gepRes] = await Promise.all([
    admin.from('school_profiles').select('*').eq('school_id', schoolId).single(),
    admin.from('staffing_positions').select('*').eq('school_id', schoolId).order('year'),
    admin.from('budget_projections').select('*').eq('school_id', schoolId),
    admin.from('grade_expansion_plan').select('*').eq('school_id', schoolId).order('year').order('grade_level'),
  ])

  const profile = profileRes.data as SchoolProfile
  if (!profile) return NextResponse.json({ error: 'School profile not found' }, { status: 404 })

  const allPositions = (posRes.data || []) as StaffingPosition[]
  const positions = allPositions.filter(p => p.year === 1)
  const projections = (projRes.data || []) as BudgetProjection[]
  const gradeExpansionPlan = (gepRes.data || []) as GradeExpansionEntry[]

  // Staleness hash: the same scenarioBaseHash the Scenarios tab and Overview compare against.
  const baseHash = scenarioBaseHash({ profile, allPositions, projections, gradeExpansionPlan })

  // Calculate each scenario
  const results: Array<{ id: string; name: string; results: unknown }> = []

  for (const scenario of scenarios) {
    const levers = scenario.assumptions as ScenarioAssumptions
    const { results: scenarioResults } = computeScenarioProjections(
      profile,
      positions,
      allPositions,
      projections,
      gradeExpansionPlan,
      levers,
    )

    // Save results to database
    await admin
      .from('scenarios')
      .update({
        results: scenarioResults,
        base_data_hash: baseHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scenario.id)

    results.push({
      id: scenario.id,
      name: scenario.name,
      results: scenarioResults,
    })
  }

  return NextResponse.json({ success: true, scenarios: results, baseHash })
}
