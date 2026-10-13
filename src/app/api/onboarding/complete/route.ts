// Onboarding completion: saves staffing, projections, and scenario via service role
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  calcCommissionRevenue,
  calcAuthorizerFeeCommission,
  calcSmallSchoolEnhancementFromGrades,
} from '@/lib/calculations'
import { getAssumptions, DEFAULT_ASSUMPTIONS } from '@/lib/types'
import { getStateConfig } from '@/lib/stateConfig'
import type { Pathway } from '@/lib/stateConfig'

export async function POST(request: Request) {
  // Authenticate the user via their session cookie
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify user has school_ceo role and get school_id
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('school_id')
    .eq('user_id', user.id)
    .eq('role', 'school_ceo')
    .single()

  if (!roleData?.school_id) {
    return NextResponse.json({ error: 'No school found for this user' }, { status: 403 })
  }

  const schoolId = roleData.school_id
  const body = await request.json()
  const { positions, operations } = body

  if (!positions || !operations) {
    return NextResponse.json({ error: 'Missing positions or operations data' }, { status: 400 })
  }

  // Use service role client for all writes (bypasses RLS)
  const admin = createServiceRoleClient()

  // Read profile from DB for enrollment/demographics
  const { data: profile, error: profileError } = await admin
    .from('school_profiles')
    .select('*')
    .eq('school_id', schoolId)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'School profile not found', detail: profileError }, { status: 404 })
  }

  const enrollment = profile.target_enrollment_y1
  const assumptions = getAssumptions(profile.financial_assumptions)

  // --- Read school pathway ---
  const { data: school } = await admin.from('schools').select('pathway').eq('id', schoolId).single()
  const pathway = (school?.pathway || 'wa_charter') as Pathway
  const config = getStateConfig(pathway)
  const isWaCharter = pathway === 'wa_charter'
  const benefitsRate = config.benefits_load

  // --- Calculate revenue ---
  let revenueProjections: { school_id: string; year: number; category: string; subcategory: string; amount: number; is_revenue: boolean }[]

  if (isWaCharter) {
    // WA Charter: Commission-aligned (unchanged)
    const rev = calcCommissionRevenue(enrollment, profile.pct_frl, profile.pct_iep, profile.pct_ell, profile.pct_hicap, assumptions)
    const smallSchoolEnhancement = calcSmallSchoolEnhancementFromGrades(
      enrollment, profile.opening_grades || [], assumptions.aafte_pct, assumptions.regular_ed_per_pupil, assumptions.regionalization_factor || 1.0
    )

    revenueProjections = [
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Regular Ed Apportionment', amount: rev.regularEd, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'SPED Apportionment', amount: rev.sped, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'State Special Education', amount: rev.stateSped, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Facilities Revenue', amount: rev.facilitiesRev, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Levy Equity', amount: rev.levyEquity, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Small School Enhancement', amount: smallSchoolEnhancement, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Title I', amount: rev.titleI, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'IDEA', amount: rev.idea, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'LAP', amount: rev.lap, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'LAP High Poverty', amount: rev.lapHighPoverty, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'TBIP', amount: rev.tbip, is_revenue: true },
      { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'HiCap', amount: rev.hicap, is_revenue: true },
    ]
  } else {
    // Generic pathways
    const customLines = profile.custom_revenue_lines || []
    if (config.revenue_model === 'tuition') {
      const tuitionRate = profile.tuition_rate || config.tuition_rate_default || 0
      const aidPct = profile.financial_aid_pct || config.financial_aid_pct_default || 0
      const grossTuition = enrollment * tuitionRate
      const netTuition = Math.round(grossTuition * (1 - aidPct))
      const regFees = customLines.find((l: { key: string }) => l.key === 'registration_fees')?.amount || 0
      const fundraisingRev = customLines.find((l: { key: string }) => l.key === 'fundraising')?.amount || 0
      revenueProjections = [
        { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Tuition Revenue', amount: netTuition, is_revenue: true },
        { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Registration Fees', amount: regFees, is_revenue: true },
        { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Fundraising', amount: fundraisingRev, is_revenue: true },
      ]
    } else {
      // Per-pupil (generic charter)
      const ppLine = customLines.find((l: { key: string }) => l.key === 'per_pupil_funding')
      const ppRevenue = ppLine?.amount || (enrollment * 10000)
      const fundraisingRev = customLines.find((l: { key: string }) => l.key === 'fundraising')?.amount || 0
      revenueProjections = [
        { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Per-Pupil Funding', amount: ppRevenue, is_revenue: true },
        { school_id: schoolId, year: 1, category: 'Revenue', subcategory: 'Fundraising', amount: fundraisingRev, is_revenue: true },
      ]
    }
  }

  // --- Calculate operations costs ---
  const facilityCost = operations.facilityMode === 'sqft'
    ? operations.facilitySqft * operations.facilityCostPerSqft
    : operations.facilityMonthly * 12
  const supplies = operations.suppliesPerPupil * enrollment
  const contracted = operations.contractedPerPupil * enrollment
  const technology = operations.technologyPerPupil * enrollment
  const insurance = operations.insurance

  // Authorizer fee: WA uses Commission calculation, generic uses config rate
  let authorizerFee: number
  if (isWaCharter) {
    const rev = calcCommissionRevenue(enrollment, profile.pct_frl, profile.pct_iep, profile.pct_ell, profile.pct_hicap, assumptions)
    const smallSchoolEnhancement = calcSmallSchoolEnhancementFromGrades(
      enrollment, profile.opening_grades || [], assumptions.aafte_pct, assumptions.regular_ed_per_pupil, assumptions.regionalization_factor || 1.0
    )
    const stateApport = rev.regularEd + rev.sped + rev.stateSped + rev.facilitiesRev + smallSchoolEnhancement
    authorizerFee = calcAuthorizerFeeCommission(stateApport, assumptions.authorizer_fee_pct / 100)
  } else {
    const totalRev = revenueProjections.reduce((s, p) => s + p.amount, 0)
    authorizerFee = Math.round(totalRev * config.authorizer_fee)
  }

  // --- Calculate personnel total from positions ---
  let totalPersonnel = 0
  for (const p of positions) {
    const sal = p.fte * p.salary
    totalPersonnel += sal + Math.round(sal * benefitsRate)
  }

  // Expanded operations categories — use config defaults for generic, assumptions for WA
  const opsDefaults = config.operations_defaults
  const curriculum = (isWaCharter ? assumptions.curriculum_per_student : (opsDefaults.curriculum_per_student || 0)) * enrollment
  const totalFte = positions?.length > 0 ? positions.reduce((s: number, p: { fte: number }) => s + p.fte, 0) : 0
  const profDev = (isWaCharter ? assumptions.professional_development_per_fte : (opsDefaults.professional_development_per_fte || 0)) * totalFte
  const foodService = (isWaCharter && assumptions.food_service_offered) ? assumptions.food_service_per_student * enrollment : 0
  const transportation = (isWaCharter && assumptions.transportation_offered) ? assumptions.transportation_per_student * enrollment : 0
  const marketing = (isWaCharter ? assumptions.marketing_per_student : (opsDefaults.marketing_per_student || 0)) * enrollment
  const fundraisingExp = isWaCharter ? assumptions.fundraising_annual : (opsDefaults.fundraising_annual || 0)

  const subtotalExpenses = totalPersonnel + facilityCost + supplies + contracted + technology + authorizerFee + insurance + curriculum + profDev + foodService + transportation + marketing + fundraisingExp
  const misc = Math.round(subtotalExpenses * (operations.miscPct / 100))

  // --- Save staffing positions (fixes G4: uses service role) ---
  const { error: delStaffError } = await admin
    .from('staffing_positions')
    .delete()
    .eq('school_id', schoolId)
    .eq('year', 1)

  if (delStaffError) {
    console.error('[onboarding/complete] delete staffing_positions failed:', JSON.stringify(delStaffError))
    return NextResponse.json({ error: 'Failed to clear staffing positions', detail: delStaffError }, { status: 500 })
  }

  const staffRows = positions.map((p: { title: string; category: string; fte: number; salary: number }, i: number) => ({
    school_id: schoolId,
    year: 1,
    title: p.title,
    category: p.category,
    fte: p.fte,
    annual_salary: p.salary,
    sort_order: i,
  }))

  if (staffRows.length > 0) {
    const { error: staffError } = await admin.from('staffing_positions').insert(staffRows)
    if (staffError) {
      console.error('[onboarding/complete] insert staffing_positions failed:', JSON.stringify(staffError))
      return NextResponse.json({ error: 'Failed to save staffing positions', detail: staffError }, { status: 500 })
    }
  }

  // --- Delete existing projections and scenario ---
  const { error: delProjError } = await admin
    .from('budget_projections')
    .delete()
    .eq('school_id', schoolId)
    .eq('year', 1)

  if (delProjError) {
    console.error('[onboarding/complete] delete budget_projections failed:', JSON.stringify(delProjError))
    return NextResponse.json({ error: 'Failed to clear projections', detail: delProjError }, { status: 500 })
  }

  const { error: delScenError } = await admin
    .from('scenarios')
    .delete()
    .eq('school_id', schoolId)
    .eq('is_base_case', true)

  if (delScenError) {
    console.error('[onboarding/complete] delete scenarios failed:', JSON.stringify(delScenError))
    return NextResponse.json({ error: 'Failed to clear scenarios', detail: delScenError }, { status: 500 })
  }

  // --- Create base scenario ---
  const { error: scenError } = await admin.from('scenarios').insert({
    school_id: schoolId,
    name: 'Base Case',
    is_base_case: true,
    assumptions: {
      enrollment,
      maxClassSize: profile.max_class_size,
      pctFrl: profile.pct_frl,
      pctIep: profile.pct_iep,
      pctEll: profile.pct_ell,
      pctHicap: profile.pct_hicap,
      operations,
      enrollmentY2: profile.target_enrollment_y2,
      enrollmentY3: profile.target_enrollment_y3,
      enrollmentY4: profile.target_enrollment_y4,
    },
  })

  if (scenError) {
    console.error('[onboarding/complete] insert scenario failed:', JSON.stringify(scenError))
    return NextResponse.json({ error: 'Failed to create scenario', detail: scenError }, { status: 500 })
  }

  // --- Insert budget projections ---
  // Personnel is live-computed from staffing_positions (see budgetEngine) —
  // no Total Personnel row is persisted.
  const expenseProjections = [
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Facilities', amount: facilityCost, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Supplies & Materials', amount: supplies, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Contracted Services', amount: contracted, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Technology', amount: technology, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Authorizer Fee', amount: authorizerFee, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Insurance', amount: insurance, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Curriculum & Materials', amount: curriculum, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Professional Development', amount: profDev, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Food Service', amount: foodService, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Transportation', amount: transportation, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Marketing & Outreach', amount: marketing, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Fundraising', amount: fundraisingExp, is_revenue: false },
    { school_id: schoolId, year: 1, category: 'Operations', subcategory: 'Misc/Contingency', amount: misc, is_revenue: false },
  ]
  const projections = [...revenueProjections, ...expenseProjections]

  const { error: projError } = await admin.from('budget_projections').insert(projections)
  if (projError) {
    console.error('[onboarding/complete] insert budget_projections FAILED:', JSON.stringify(projError))
    return NextResponse.json({ error: 'Failed to save projections', detail: projError }, { status: 500 })
  }

  // Mark onboarding as complete and persist program flags to financial_assumptions
  const existingFa = profile.financial_assumptions || {}
  const updatedFa = {
    ...existingFa,
    food_service_offered: !!operations.foodProgram,
    transportation_offered: !!operations.transportationProgram,
    // P-UX-26: keep an explicit $0 the founder already saved; default only a missing rate.
    food_service_per_student: existingFa.food_service_per_student ?? DEFAULT_ASSUMPTIONS.food_service_per_student,
    transportation_per_student: existingFa.transportation_per_student ?? DEFAULT_ASSUMPTIONS.transportation_per_student,
    food_service_revenue_per_pupil: existingFa.food_service_revenue_per_pupil ?? DEFAULT_ASSUMPTIONS.food_service_revenue_per_pupil,
    transportation_revenue_per_pupil: existingFa.transportation_revenue_per_pupil ?? DEFAULT_ASSUMPTIONS.transportation_revenue_per_pupil,
  }
  const { error: onboardingError } = await admin
    .from('school_profiles')
    .update({ onboarding_complete: true, financial_assumptions: updatedFa })
    .eq('school_id', schoolId)

  if (onboardingError) {
    console.error('[onboarding/complete] update onboarding_complete failed:', JSON.stringify(onboardingError))
  }

  return NextResponse.json({ success: true })
}
