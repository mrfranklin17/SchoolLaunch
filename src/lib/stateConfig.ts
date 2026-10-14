/**
 * State Configuration Architecture for SchoolLaunch Generic Pathway
 *
 * This module defines the configuration object that controls all pathway-specific
 * behavior throughout the application. Each pathway (wa_charter, generic_charter,
 * generic_private, generic_micro) returns a complete config that the app reads
 * at every point where pathway-specific logic is needed.
 */

import { COMMISSION_POSITIONS } from './types'

// --- Interfaces ---

export type Pathway = 'wa_charter' | 'generic_charter' | 'generic_private' | 'generic_micro'

export type RevenueModel = 'per_pupil' | 'tuition'

export type AccountabilityFramework = 'commission_fpf' | 'generic_health'

export type PositionClassification = 'Administrative' | 'Instructional' | 'Non-Instructional'

export type PositionDriver =
  | 'fixed'
  | 'per_pupil'
  | 'per_pupil_elem'
  | 'per_pupil_ms'
  | 'per_pupil_hs'
  | 'per_pupil_sped'
  | 'per_pupil_el'
  | 'contracted'

export interface PositionType {
  type: string
  name: string
  classification: PositionClassification
  default_salary: number
  default_fte: number
  driver: PositionDriver
  students_per_position: number
}

export type RevenueCalculation =
  | 'per_pupil_aafte'
  | 'per_pupil_headcount'
  | 'per_pupil_demographic'
  | 'tuition'
  | 'financial_aid'
  | 'flat'
  | 'percentage'
  | 'custom'

export type RevenueGroup =
  | 'state_local'
  | 'federal'
  | 'state_categorical'
  | 'tuition'
  | 'fees'
  | 'fundraising'
  | 'other'

export interface RevenueLineConfig {
  key: string
  name: string
  group: RevenueGroup
  calculation: RevenueCalculation
  default_rate: number | null
  demographic_field?: string
  demographic_threshold?: number
  escalation_rate?: number
  editable: boolean
  visible_by_default: boolean
}

export interface StateConfig {
  pathway: Pathway
  display_name: string
  fiscal_year_start_month: number // 1-12 (WA = 9 for September)
  revenue_model: RevenueModel
  payment_schedule: number[] // 12 monthly percentages summing to 100
  position_types: PositionType[]
  benchmark_salaries_source: string
  benefits_load: number // decimal (0.30 = 30%)
  authorizer_fee: number // decimal (0.03 = 3%)
  authorizer_fee_editable: boolean
  accountability_framework: AccountabilityFramework
  categorical_programs: string[]
  salary_escalator: number // decimal (0.025 = 2.5%)
  revenue_escalator: number // decimal (0.03 = 3%)
  operations_escalator: number // decimal (0.02 = 2%)
  demographics_required: boolean
  students_per_section_default: number
  tuition_rate_default: number | null
  financial_aid_pct_default: number | null
  operations_defaults: Record<string, number>
  revenue_lines: RevenueLineConfig[]
}

// --- WA Charter Position Types ---
// Derived from COMMISSION_POSITIONS (types.ts), the one WA catalog (R-REV-09); 'custom' excluded.

const WA_CHARTER_POSITIONS: PositionType[] = COMMISSION_POSITIONS
  .filter((p) => p.type !== 'custom')
  .map((p) => ({
    type: p.type,
    name: p.name,
    classification: p.classification,
    default_salary: p.salary,
    default_fte: 1,
    driver: p.driver as PositionDriver,
    students_per_position: p.studentsPerPosition,
  }))

// --- Generic Charter Position Types (20 positions) ---

const GENERIC_CHARTER_POSITIONS: PositionType[] = [
  // Administrative
  { type: 'executive_director', name: 'Executive Director/Principal', classification: 'Administrative', default_salary: 105000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'asst_principal', name: 'Assistant Principal', classification: 'Administrative', default_salary: 85000, default_fte: 1, driver: 'per_pupil', students_per_position: 300 },
  { type: 'dean_students', name: 'Dean of Students', classification: 'Administrative', default_salary: 75000, default_fte: 1, driver: 'per_pupil', students_per_position: 400 },
  { type: 'office_manager', name: 'Office Manager', classification: 'Administrative', default_salary: 48000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'admin_assistant', name: 'Administrative Assistant', classification: 'Administrative', default_salary: 38000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  // Instructional
  { type: 'teacher_elem', name: 'Classroom Teacher Elementary', classification: 'Instructional', default_salary: 55000, default_fte: 1, driver: 'per_pupil_elem', students_per_position: 24 },
  { type: 'teacher_ms', name: 'Classroom Teacher Middle', classification: 'Instructional', default_salary: 57000, default_fte: 1, driver: 'per_pupil_ms', students_per_position: 24 },
  { type: 'teacher_hs', name: 'Classroom Teacher High', classification: 'Instructional', default_salary: 59000, default_fte: 1, driver: 'per_pupil_hs', students_per_position: 24 },
  { type: 'sped_teacher', name: 'Special Education Teacher', classification: 'Instructional', default_salary: 58000, default_fte: 1, driver: 'per_pupil_sped', students_per_position: 12 },
  { type: 'ell_teacher', name: 'ELL/ESL Teacher', classification: 'Instructional', default_salary: 56000, default_fte: 1, driver: 'per_pupil_el', students_per_position: 30 },
  { type: 'instructional_coach', name: 'Instructional Coach', classification: 'Instructional', default_salary: 65000, default_fte: 1, driver: 'per_pupil', students_per_position: 200 },
  { type: 'paraeducator', name: 'Paraeducator/Teaching Assistant', classification: 'Instructional', default_salary: 30000, default_fte: 1, driver: 'per_pupil', students_per_position: 48 },
  { type: 'sped_para', name: 'Special Education Paraeducator', classification: 'Instructional', default_salary: 32000, default_fte: 1, driver: 'per_pupil_sped', students_per_position: 8 },
  // Non-Instructional
  { type: 'counselor', name: 'School Counselor', classification: 'Non-Instructional', default_salary: 55000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'it_coordinator', name: 'IT/Technology Coordinator', classification: 'Non-Instructional', default_salary: 55000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'custodian', name: 'Custodian/Facilities', classification: 'Non-Instructional', default_salary: 35000, default_fte: 1, driver: 'per_pupil', students_per_position: 200 },
  { type: 'food_service', name: 'Food Service Coordinator', classification: 'Non-Instructional', default_salary: 35000, default_fte: 1, driver: 'per_pupil', students_per_position: 150 },
  { type: 'nurse', name: 'Nurse', classification: 'Non-Instructional', default_salary: 55000, default_fte: 0.5, driver: 'fixed', students_per_position: 0 },
  { type: 'social_worker', name: 'Social Worker', classification: 'Non-Instructional', default_salary: 52000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'business_manager', name: 'Business Manager/Bookkeeper', classification: 'Non-Instructional', default_salary: 55000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
]

// --- Private School Position Types (18 positions) ---

const PRIVATE_SCHOOL_POSITIONS: PositionType[] = [
  // Administrative
  { type: 'head_of_school', name: 'Head of School', classification: 'Administrative', default_salary: 120000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'asst_head', name: 'Assistant Head of School', classification: 'Administrative', default_salary: 95000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'division_head', name: 'Division Head', classification: 'Administrative', default_salary: 85000, default_fte: 1, driver: 'per_pupil', students_per_position: 200 },
  { type: 'dir_admission', name: 'Director of Admission', classification: 'Administrative', default_salary: 75000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'dir_development', name: 'Director of Development/Advancement', classification: 'Administrative', default_salary: 80000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'business_manager', name: 'Business Manager', classification: 'Administrative', default_salary: 70000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  // Instructional
  { type: 'classroom_teacher', name: 'Classroom Teacher', classification: 'Instructional', default_salary: 52000, default_fte: 1, driver: 'per_pupil', students_per_position: 20 },
  { type: 'specialist_teacher', name: 'Specialist Teacher', classification: 'Instructional', default_salary: 54000, default_fte: 1, driver: 'per_pupil', students_per_position: 60 },
  { type: 'learning_support', name: 'Learning Support Specialist', classification: 'Instructional', default_salary: 56000, default_fte: 1, driver: 'per_pupil', students_per_position: 40 },
  { type: 'librarian', name: 'Librarian', classification: 'Instructional', default_salary: 52000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  // Non-Instructional
  { type: 'counselor', name: 'School Counselor', classification: 'Non-Instructional', default_salary: 58000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'admin_assistant', name: 'Administrative Assistant', classification: 'Non-Instructional', default_salary: 40000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'registrar', name: 'Registrar', classification: 'Non-Instructional', default_salary: 45000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'admissions_coord', name: 'Admissions Coordinator', classification: 'Non-Instructional', default_salary: 45000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'it_coordinator', name: 'IT Coordinator', classification: 'Non-Instructional', default_salary: 55000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'facilities', name: 'Facilities/Maintenance', classification: 'Non-Instructional', default_salary: 40000, default_fte: 1, driver: 'per_pupil', students_per_position: 200 },
  { type: 'nurse', name: 'Nurse', classification: 'Non-Instructional', default_salary: 55000, default_fte: 0.5, driver: 'fixed', students_per_position: 0 },
  { type: 'afterschool_coord', name: 'After-School Program Coordinator', classification: 'Non-Instructional', default_salary: 42000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
]

// --- Micro School Position Types (12 positions) ---

const MICRO_SCHOOL_POSITIONS: PositionType[] = [
  // Administrative/Instructional (blended in micro schools)
  { type: 'lead_teacher', name: 'Lead Teacher/Founder', classification: 'Administrative', default_salary: 65000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'program_director', name: 'Program Director', classification: 'Administrative', default_salary: 55000, default_fte: 1, driver: 'fixed', students_per_position: 0 },
  { type: 'admin_coordinator', name: 'Administrative Coordinator', classification: 'Administrative', default_salary: 38000, default_fte: 0.5, driver: 'fixed', students_per_position: 0 },
  // Instructional
  { type: 'asst_teacher', name: 'Assistant Teacher', classification: 'Instructional', default_salary: 40000, default_fte: 1, driver: 'per_pupil', students_per_position: 15 },
  { type: 'learning_guide', name: 'Learning Guide/Facilitator', classification: 'Instructional', default_salary: 45000, default_fte: 1, driver: 'per_pupil', students_per_position: 15 },
  { type: 'sped_support', name: 'Special Education Support', classification: 'Instructional', default_salary: 45000, default_fte: 0.5, driver: 'per_pupil_sped', students_per_position: 8 },
  { type: 'substitute', name: 'Substitute/Float Teacher', classification: 'Instructional', default_salary: 25000, default_fte: 0.25, driver: 'fixed', students_per_position: 0 },
  { type: 'enrichment', name: 'Enrichment Instructor (part-time)', classification: 'Instructional', default_salary: 30000, default_fte: 0.5, driver: 'fixed', students_per_position: 0 },
  // Non-Instructional
  { type: 'counselor', name: 'Counselor (part-time)', classification: 'Non-Instructional', default_salary: 55000, default_fte: 0.25, driver: 'fixed', students_per_position: 0 },
  { type: 'bookkeeper', name: 'Bookkeeper (part-time)', classification: 'Non-Instructional', default_salary: 40000, default_fte: 0.25, driver: 'fixed', students_per_position: 0 },
  { type: 'it_support', name: 'IT Support (contracted)', classification: 'Non-Instructional', default_salary: 30000, default_fte: 0.1, driver: 'contracted', students_per_position: 0 },
  { type: 'facilities', name: 'Facilities (contracted)', classification: 'Non-Instructional', default_salary: 25000, default_fte: 0.1, driver: 'contracted', students_per_position: 0 },
]

// --- WA Charter Revenue Lines ---
// Exact match to current calcCommissionRevenue() in calculations.ts

const WA_CHARTER_REVENUE_LINES: RevenueLineConfig[] = [
  // State & Local (AAFTE-based)
  { key: 'regular_ed', name: 'Regular Education Apportionment', group: 'state_local', calculation: 'per_pupil_aafte', default_rate: 11812, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'sped', name: 'Special Education (Federal)', group: 'state_local', calculation: 'per_pupil_demographic', default_rate: 2548, demographic_field: 'pct_iep', escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'state_sped', name: 'Special Education (State)', group: 'state_local', calculation: 'per_pupil_demographic', default_rate: 13556, demographic_field: 'pct_iep', escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'facilities', name: 'Facilities Allowance', group: 'state_local', calculation: 'per_pupil_aafte', default_rate: 0, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'levy_equity', name: 'Levy Equity', group: 'state_local', calculation: 'per_pupil_aafte', default_rate: 0, escalation_rate: 0.03, editable: true, visible_by_default: true },
  // State Categorical (headcount-based)
  { key: 'lap', name: 'Learning Assistance Program (LAP)', group: 'state_categorical', calculation: 'per_pupil_demographic', default_rate: 816, demographic_field: 'pct_frl', escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'lap_high_poverty', name: 'LAP High Poverty', group: 'state_categorical', calculation: 'per_pupil_headcount', default_rate: 374, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'tbip', name: 'Transitional Bilingual (TBIP)', group: 'state_categorical', calculation: 'per_pupil_demographic', default_rate: 1600, demographic_field: 'pct_ell', escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'hicap', name: 'Highly Capable (HiCap)', group: 'state_categorical', calculation: 'per_pupil_demographic', default_rate: 730, demographic_field: 'pct_hicap', escalation_rate: 0.03, editable: true, visible_by_default: true },
  // Federal
  { key: 'title_i', name: 'Title I', group: 'federal', calculation: 'per_pupil_demographic', default_rate: 880, demographic_field: 'pct_frl', demographic_threshold: 0.40, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'idea', name: 'IDEA (Special Education)', group: 'federal', calculation: 'per_pupil_demographic', default_rate: 1500, demographic_field: 'pct_iep', escalation_rate: 0.03, editable: true, visible_by_default: true },
  // Program Revenue
  { key: 'food_service_rev', name: 'Food Service Revenue (NSLP)', group: 'other', calculation: 'per_pupil_headcount', default_rate: 710, escalation_rate: 0.03, editable: true, visible_by_default: false },
  { key: 'transportation_rev', name: 'Transportation Revenue (State)', group: 'other', calculation: 'per_pupil_headcount', default_rate: 560, escalation_rate: 0.03, editable: true, visible_by_default: false },
  // Small School Enhancement — computed externally based on grade-band enrollment
  { key: 'small_school_enhancement', name: 'Small School Enhancement', group: 'state_local', calculation: 'custom', default_rate: null, escalation_rate: 0.03, editable: false, visible_by_default: true },
  // Interest income
  { key: 'interest_income', name: 'Interest Income on Cash', group: 'other', calculation: 'custom', default_rate: null, editable: true, visible_by_default: true },
]

// --- Generic Charter Revenue Lines ---

const GENERIC_CHARTER_REVENUE_LINES: RevenueLineConfig[] = [
  // Per-Pupil Revenue (user-entered rates)
  { key: 'per_pupil_funding', name: 'Per-Pupil Funding', group: 'state_local', calculation: 'per_pupil_aafte', default_rate: 10000, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'facilities_funding', name: 'Facilities Funding', group: 'state_local', calculation: 'per_pupil_aafte', default_rate: 0, escalation_rate: 0.03, editable: true, visible_by_default: true },
  // State Categorical (available if demographics entered)
  { key: 'sped_funding', name: 'Special Education Funding', group: 'state_categorical', calculation: 'per_pupil_demographic', default_rate: 3000, demographic_field: 'pct_iep', escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'ell_funding', name: 'ELL/ESL Funding', group: 'state_categorical', calculation: 'per_pupil_demographic', default_rate: 1200, demographic_field: 'pct_ell', escalation_rate: 0.03, editable: true, visible_by_default: true },
  // Federal
  { key: 'title_i', name: 'Title I', group: 'federal', calculation: 'per_pupil_demographic', default_rate: 880, demographic_field: 'pct_frl', demographic_threshold: 0.40, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'idea', name: 'IDEA (Special Education)', group: 'federal', calculation: 'per_pupil_demographic', default_rate: 1500, demographic_field: 'pct_iep', escalation_rate: 0.03, editable: true, visible_by_default: true },
  // Other
  { key: 'food_service_rev', name: 'Food Service Revenue', group: 'other', calculation: 'per_pupil_headcount', default_rate: 710, escalation_rate: 0.03, editable: true, visible_by_default: false },
  { key: 'transportation_rev', name: 'Transportation Revenue', group: 'other', calculation: 'per_pupil_headcount', default_rate: 500, escalation_rate: 0.03, editable: true, visible_by_default: false },
  { key: 'fundraising', name: 'Fundraising/Donations', group: 'fundraising', calculation: 'flat', default_rate: 15000, editable: true, visible_by_default: true },
  { key: 'other_revenue', name: 'Other Revenue', group: 'other', calculation: 'flat', default_rate: 0, editable: true, visible_by_default: false },
]

// --- Private School Revenue Lines ---

const PRIVATE_SCHOOL_REVENUE_LINES: RevenueLineConfig[] = [
  // Tuition
  { key: 'tuition', name: 'Tuition Revenue', group: 'tuition', calculation: 'tuition', default_rate: 12000, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'financial_aid', name: 'Financial Aid (Discount)', group: 'tuition', calculation: 'financial_aid', default_rate: -0.10, editable: true, visible_by_default: true },
  // Fees
  { key: 'registration_fees', name: 'Registration/Application Fees', group: 'fees', calculation: 'per_pupil_headcount', default_rate: 500, editable: true, visible_by_default: true },
  { key: 'activity_fees', name: 'Activity/Materials Fees', group: 'fees', calculation: 'per_pupil_headcount', default_rate: 300, editable: true, visible_by_default: true },
  // Fundraising
  { key: 'annual_fund', name: 'Annual Fund', group: 'fundraising', calculation: 'flat', default_rate: 25000, editable: true, visible_by_default: true },
  { key: 'gala_events', name: 'Gala/Events Revenue', group: 'fundraising', calculation: 'flat', default_rate: 15000, editable: true, visible_by_default: true },
  { key: 'major_gifts', name: 'Major Gifts/Capital', group: 'fundraising', calculation: 'flat', default_rate: 0, editable: true, visible_by_default: false },
  // Other
  { key: 'afterschool_revenue', name: 'After-School Program Revenue', group: 'other', calculation: 'per_pupil_headcount', default_rate: 0, editable: true, visible_by_default: false },
  { key: 'other_revenue', name: 'Other Revenue', group: 'other', calculation: 'flat', default_rate: 0, editable: true, visible_by_default: false },
]

// --- Micro School Revenue Lines ---

const MICRO_SCHOOL_REVENUE_LINES: RevenueLineConfig[] = [
  // Tuition
  { key: 'tuition', name: 'Tuition Revenue', group: 'tuition', calculation: 'tuition', default_rate: 8500, escalation_rate: 0.03, editable: true, visible_by_default: true },
  { key: 'financial_aid', name: 'Financial Aid (Discount)', group: 'tuition', calculation: 'financial_aid', default_rate: -0.05, editable: true, visible_by_default: true },
  // Fees
  { key: 'registration_fees', name: 'Registration Fees', group: 'fees', calculation: 'per_pupil_headcount', default_rate: 250, editable: true, visible_by_default: true },
  { key: 'materials_fees', name: 'Materials/Supply Fees', group: 'fees', calculation: 'per_pupil_headcount', default_rate: 200, editable: true, visible_by_default: true },
  // Fundraising
  { key: 'fundraising', name: 'Fundraising/Donations', group: 'fundraising', calculation: 'flat', default_rate: 5000, editable: true, visible_by_default: true },
  // Other
  { key: 'other_revenue', name: 'Other Revenue', group: 'other', calculation: 'flat', default_rate: 0, editable: true, visible_by_default: false },
]

// --- OSPI Payment Schedule (WA charter) ---
// OSPI apportionment schedule (computeMonthlyCashFlow reads this for WA charter): Sep 9%, Oct 8%, Nov 5%, Dec 9%, Jan 8.5%, Feb 9%, Mar 9%, Apr 9%, May 5%, Jun 6%, Jul 12.5%, Aug 10%

const OSPI_PAYMENT_SCHEDULE = [9, 8, 5, 9, 8.5, 9, 9, 9, 5, 6, 12.5, 10]

// Even monthly (1/12 each month ≈ 8.333...)
const EVEN_MONTHLY_SCHEDULE = [
  8.34, 8.33, 8.33, 8.34, 8.33, 8.33,
  8.34, 8.33, 8.33, 8.34, 8.33, 8.33,
]

// Tuition collection: 10 academic months (months 1-10 of fiscal year), nothing in summer months 11-12
// For private/micro with Sept fiscal year start: Sep-Jun collection, Jul-Aug no collection
const TUITION_COLLECTION_SCHEDULE = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0]

// --- Config Objects ---

const WA_CHARTER_CONFIG: StateConfig = {
  pathway: 'wa_charter',
  display_name: 'WA Charter School',
  fiscal_year_start_month: 9, // September
  revenue_model: 'per_pupil',
  payment_schedule: OSPI_PAYMENT_SCHEDULE,
  position_types: WA_CHARTER_POSITIONS,
  benchmark_salaries_source: 'OSPI/BLS WA',
  benefits_load: 0.30,
  authorizer_fee: 0.03,
  authorizer_fee_editable: false,
  accountability_framework: 'commission_fpf',
  categorical_programs: ['title_i', 'idea', 'lap', 'lap_high_poverty', 'tbip', 'hicap'],
  salary_escalator: 0.025,
  revenue_escalator: 0.03,
  operations_escalator: 0.02,
  demographics_required: true,
  students_per_section_default: 24,
  tuition_rate_default: null,
  financial_aid_pct_default: null,
  operations_defaults: {
    supplies_per_student: 200,
    contracted_services_per_student: 150,
    technology_per_student: 180,
    insurance_annual: 18000,
    contingency_pct: 2,
    curriculum_per_student: 500,
    professional_development_per_fte: 1000,
    food_service_per_student: 1200,
    transportation_per_student: 800,
    marketing_per_student: 200,
    fundraising_annual: 15000,
  },
  revenue_lines: WA_CHARTER_REVENUE_LINES,
}

const GENERIC_CHARTER_CONFIG: StateConfig = {
  pathway: 'generic_charter',
  display_name: 'Charter School',
  fiscal_year_start_month: 7, // July (common fiscal year start)
  revenue_model: 'per_pupil',
  payment_schedule: EVEN_MONTHLY_SCHEDULE,
  position_types: GENERIC_CHARTER_POSITIONS,
  benchmark_salaries_source: 'National BLS',
  benefits_load: 0.25,
  authorizer_fee: 0,
  authorizer_fee_editable: true,
  accountability_framework: 'generic_health',
  categorical_programs: ['title_i', 'idea', 'sped_funding', 'ell_funding'],
  salary_escalator: 0.025,
  revenue_escalator: 0.03,
  operations_escalator: 0.02,
  demographics_required: true,
  students_per_section_default: 24,
  tuition_rate_default: null,
  financial_aid_pct_default: null,
  operations_defaults: {
    supplies_per_student: 200,
    contracted_services_per_student: 150,
    technology_per_student: 180,
    insurance_annual: 15000,
    contingency_pct: 2,
    curriculum_per_student: 400,
    professional_development_per_fte: 800,
    food_service_per_student: 1000,
    transportation_per_student: 600,
    marketing_per_student: 150,
    fundraising_annual: 15000,
  },
  revenue_lines: GENERIC_CHARTER_REVENUE_LINES,
}

const GENERIC_PRIVATE_CONFIG: StateConfig = {
  pathway: 'generic_private',
  display_name: 'Private School',
  fiscal_year_start_month: 9, // September
  revenue_model: 'tuition',
  payment_schedule: TUITION_COLLECTION_SCHEDULE,
  position_types: PRIVATE_SCHOOL_POSITIONS,
  benchmark_salaries_source: 'NAIS',
  benefits_load: 0.25,
  authorizer_fee: 0,
  authorizer_fee_editable: false,
  accountability_framework: 'generic_health',
  categorical_programs: [],
  salary_escalator: 0.025,
  revenue_escalator: 0.03,
  operations_escalator: 0.02,
  demographics_required: false,
  students_per_section_default: 20,
  tuition_rate_default: 12000,
  financial_aid_pct_default: 0.10,
  operations_defaults: {
    supplies_per_student: 250,
    contracted_services_per_student: 200,
    technology_per_student: 200,
    insurance_annual: 20000,
    contingency_pct: 2,
    curriculum_per_student: 600,
    professional_development_per_fte: 1200,
    food_service_per_student: 0,
    transportation_per_student: 0,
    marketing_per_student: 300,
    fundraising_annual: 25000,
  },
  revenue_lines: PRIVATE_SCHOOL_REVENUE_LINES,
}

const GENERIC_MICRO_CONFIG: StateConfig = {
  pathway: 'generic_micro',
  display_name: 'Micro School',
  fiscal_year_start_month: 9, // September
  revenue_model: 'tuition',
  payment_schedule: TUITION_COLLECTION_SCHEDULE,
  position_types: MICRO_SCHOOL_POSITIONS,
  benchmark_salaries_source: 'NAIS',
  benefits_load: 0.20,
  authorizer_fee: 0,
  authorizer_fee_editable: false,
  accountability_framework: 'generic_health',
  categorical_programs: [],
  salary_escalator: 0.025,
  revenue_escalator: 0.03,
  operations_escalator: 0.02,
  demographics_required: false,
  students_per_section_default: 15,
  tuition_rate_default: 8500,
  financial_aid_pct_default: 0.05,
  operations_defaults: {
    supplies_per_student: 150,
    contracted_services_per_student: 100,
    technology_per_student: 150,
    insurance_annual: 8000,
    contingency_pct: 2,
    curriculum_per_student: 300,
    professional_development_per_fte: 600,
    food_service_per_student: 0,
    transportation_per_student: 0,
    marketing_per_student: 200,
    fundraising_annual: 5000,
  },
  revenue_lines: MICRO_SCHOOL_REVENUE_LINES,
}

// --- Config Registry ---

const CONFIG_MAP: Record<Pathway, StateConfig> = {
  wa_charter: WA_CHARTER_CONFIG,
  generic_charter: GENERIC_CHARTER_CONFIG,
  generic_private: GENERIC_PRIVATE_CONFIG,
  generic_micro: GENERIC_MICRO_CONFIG,
}

/**
 * Get the full state configuration for a given pathway.
 * Defaults to wa_charter if no pathway is provided (backward compatible).
 */
export function getStateConfig(pathway?: Pathway | string | null): StateConfig {
  if (!pathway || !(pathway in CONFIG_MAP)) {
    return CONFIG_MAP.wa_charter
  }
  return CONFIG_MAP[pathway as Pathway]
}

/**
 * Derive the pathway from state + school type selections.
 */
export function derivePathway(state: string, schoolType: 'charter' | 'private' | 'micro'): Pathway {
  if (schoolType === 'private') return 'generic_private'
  if (schoolType === 'micro') return 'generic_micro'
  // Charter: only WA gets the WA-specific pathway
  if (state === 'WA' || state === 'Washington') return 'wa_charter'
  return 'generic_charter'
}

/**
 * US States list for the onboarding state dropdown.
 */
export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const

export type USStateCode = (typeof US_STATES)[number]['code']
