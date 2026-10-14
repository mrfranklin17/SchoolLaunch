// Shared safety guard + restore for the overnight browser harness. The ONLY mutable
// account is test-columbia; every write asserts the target is not a protected id.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

export const SID = '64b84ff8-2824-4ca4-9814-57fa39b23c26' // test-columbia (MUTABLE)
export const PROTECTED = new Set([
  '06ae181c-1b88-45ae-a4dc-95758c3e63fa', // Spokane Arts
  '63fedd25-90b0-4078-9854-7ec7071e0fb2', // Cedar Grove V11
])

export const SNAPSHOT = {
  grade_config: 'K-8', region: 'benton_county', planned_open_year: 2027,
  target_enrollment_y1: 72, target_enrollment_y2: 96, target_enrollment_y3: 120,
  target_enrollment_y4: 144, target_enrollment_y5: 168, max_class_size: 24,
  pct_frl: 62, pct_iep: 13, pct_ell: 18, pct_hicap: 3, per_pupil_rate: 15000,
  lease_sqft: null, lease_rate_per_sqft: null, lease_monthly_flat: null,
  tuition_rate: null, financial_aid_pct: null, fiscal_year_start_month: 9,
  retention_rate: 92, onboarding_complete: true,
  opening_grades: ['K', '1', '2'], buildout_grades: ['K', '1', '2', '3', '4', '5', '6', '7', '8'],
  pre_opening_expenses: [], pre_opening_transactions: [],
  custom_revenue_lines: [], custom_expense_lines: [], custom_payment_schedule: null,
  facility_financing: null,
  startup_funding: [{ type: 'grant', amount: 350000, source: 'Federal CSP Grant', status: 'projected', selectedYears: [0, 1, 2, 3, 4], yearAllocations: { '0': 350000, '1': 0, '2': 0, '3': 0, '4': 0 } }],
  financial_assumptions: { aafte_pct: 95, per_pupil_rate: 12000, sped_per_pupil: 4500, contingency_pct: 2, insurance_annual: 18000, revenue_cola_pct: 3, benefits_load_pct: 30, ops_escalator_pct: 2, authorizer_fee_pct: 3, facilities_per_pupil: 0, food_service_offered: true, regular_ed_per_pupil: 12000, salary_escalator_pct: 2.5, supplies_per_student: 200, interest_rate_on_cash: 3, regionalization_factor: 1.02, technology_per_student: 180, transportation_offered: false, levy_equity_per_student: 0, food_service_per_student: 1200, transportation_per_student: 800, food_service_revenue_per_pupil: 710, contracted_services_per_student: 150, transportation_revenue_per_pupil: 560 },
}

export function loadEnv(): void {
  try {
    const content = readFileSync('.env.local', 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch { /* ignore */ }
}

export function service(): SupabaseClient {
  loadEnv()
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export function assertTarget(id: string): void {
  if (PROTECTED.has(id)) throw new Error(`SAFETY ABORT: write to PROTECTED id ${id}`)
  if (id !== SID) throw new Error(`SAFETY ABORT: target ${id} is not test-columbia`)
}

export async function guardedSeed(patch: Record<string, unknown>): Promise<void> {
  assertTarget(SID)
  const { error } = await service().from('school_profiles').update(patch).eq('school_id', SID)
  if (error) throw new Error('seed failed: ' + error.message)
}

/** The school_profiles columns the restore check reads (the row has more). */
export type RestoredProfileRow = {
  facility_financing: unknown
  custom_revenue_lines: unknown[] | null
  custom_expense_lines: unknown[] | null
  pct_frl: number
  onboarding_complete: boolean
}

export async function restoreAndVerify(): Promise<{ ok: boolean; row: RestoredProfileRow }> {
  assertTarget(SID)
  await guardedSeed(SNAPSHOT)
  const { data } = await service().from('school_profiles').select('*').eq('school_id', SID).single()
  const row = data as RestoredProfileRow
  const ok = row.facility_financing === null && (row.custom_revenue_lines || []).length === 0 &&
    (row.custom_expense_lines || []).length === 0 && row.pct_frl === 62 && row.onboarding_complete === true
  return { ok, row }
}
