/**
 * Position-type resolution for saved staffing rows (Staffing tab).
 *
 * `position_type = 'custom'` means two different things in the database:
 * - a custom position a founder created or chose on the Staffing tab, which always saves it
 *   with `students_per_position = 0`; and
 * - an older row written without a type (the onboarding API and early imports), which gets the
 *   column defaults: 'custom' and `students_per_position = 24`.
 * Only the second kind is typed from its title. A founder's custom position keeps its type and
 * section even when its title contains a catalog keyword (P-UX-12).
 */

export type StaffClassification = 'Administrative' | 'Certificated' | 'Classified'

const CLASSIFICATIONS: ReadonlySet<string> = new Set(['Administrative', 'Certificated', 'Classified'])

/** Best-guess catalog type from a free-text title, for rows saved without a type. */
export function inferPositionType(title: string): string {
  const t = title.toLowerCase().trim()
  if (/\bceo\b/.test(t) || /\bexecutive director\b/.test(t)) return 'ceo_director'
  if (/\bassistant principal\b/.test(t) || /\bvice principal\b/.test(t) || /\bap\b/.test(t)) return 'asst_principal'
  if (/\bprincipal\b/.test(t) || /\bhead of school\b/.test(t)) return 'principal'
  if (/\bregistrar\b/.test(t) || /\benrollment manager\b/.test(t)) return 'registrar'
  if (/\bcoo\b/.test(t) || /\boperations manager\b/.test(t)) return 'coo'
  if (/\bcfo\b/.test(t) || /\bfinance\b/.test(t) || /\bbusiness manager\b/.test(t)) return 'cfo'
  if (/\bit coordinator\b/.test(t)) return 'it_coordinator'
  if (/\bfacilities manager\b/.test(t)) return 'facilities_mgr'
  if (/\bnutrition\b/.test(t)) return 'nutrition_mgr'
  if (/\bspecial ed\b/.test(t) || /\bsped\b/.test(t)) return 'sped_teacher'
  if (/\bell teacher\b/.test(t) || /\bell specialist\b/.test(t) || /\benglish learner\b/.test(t)) return 'el_specialist'
  if (/\binstructional coach\b/.test(t) || /\bcurriculum\b/.test(t)) return 'instructional_coach'
  if (/\bintervention\b/.test(t)) return 'interventionist'
  if (/\bsubstitute\b/.test(t)) return 'substitute_pool'
  if (/\bsubject teacher\b/.test(t)) return 'teacher_ms'
  if (/\bteacher\b/.test(t)) return 'teacher_elem'
  if (/\bparaeducator\b/.test(t) || /\bpara\b/.test(t) || /\binstructional aide\b/.test(t)) return 'paraeducator'
  if (/\bcounselor\b/.test(t)) return 'counselor'
  if (/\bsocial worker\b/.test(t)) return 'social_worker'
  if (/\bpsychologist\b/.test(t)) return 'psychologist'
  if (/\boffice manager\b/.test(t) || /\badministrative assistant\b/.test(t)) return 'office_mgr'
  if (/\bhuman resources\b/.test(t) || /\bhr\b/.test(t)) return 'hr_specialist'
  if (/\bcustodian\b/.test(t) || /\bjanitor\b/.test(t)) return 'custodian'
  if (/\bsecurity\b/.test(t) || /\bsafety\b/.test(t)) return 'security'
  if (/\bfood service\b/.test(t)) return 'food_service'
  if (/\btransportation\b/.test(t)) return 'transport_coord'
  return 'custom'
}

/** True for a custom position saved as such by the Staffing tab. */
export function isSavedCustomPosition(row: { position_type?: string | null; students_per_position?: number | null }): boolean {
  return row.position_type === 'custom' && row.students_per_position === 0
}

/** The type the Staffing tab shows for a saved row. */
export function resolvePositionType(row: { title: string; position_type?: string | null; students_per_position?: number | null }): string {
  if (row.position_type && row.position_type !== 'custom') return row.position_type
  if (isSavedCustomPosition(row)) return 'custom'
  return inferPositionType(row.title)
}

/**
 * The saved section of a founder's custom position, or null when the row should take its
 * type's default section (catalog types and untyped older rows).
 */
export function savedCustomClassification(row: { position_type?: string | null; students_per_position?: number | null; classification?: string | null }): StaffClassification | null {
  if (!isSavedCustomPosition(row) || !row.classification || !CLASSIFICATIONS.has(row.classification)) return null
  return row.classification as StaffClassification
}

// ─── Authoritative classification mapping by position type ────────────────────
// These override whatever is stored in the DB or in COMMISSION_POSITIONS. Shared by the
// Staffing tab and the onboarding writes (src/lib/onboardingStaffing.ts).

export const POSITION_CLASSIFICATION: Record<string, StaffClassification> = {
  // Administrative
  ceo_director: 'Administrative',
  principal: 'Administrative',
  asst_principal: 'Administrative',
  coo: 'Administrative',
  cfo: 'Administrative',
  nutrition_mgr: 'Administrative',
  facilities_mgr: 'Administrative',
  // Certificated
  teacher_elem: 'Certificated',
  teacher_ms: 'Certificated',
  teacher_hs: 'Certificated',
  sped_teacher: 'Certificated',
  el_specialist: 'Certificated',
  instructional_coach: 'Certificated',
  interventionist: 'Certificated',
  counselor: 'Certificated',
  social_worker: 'Certificated',
  psychologist: 'Certificated',
  substitute_pool: 'Certificated',
  // Classified
  paraeducator: 'Classified',
  registrar: 'Classified',
  office_mgr: 'Classified',
  it_coordinator: 'Classified',
  custodian: 'Classified',
  food_service: 'Classified',
  security: 'Classified',
  transport_coord: 'Classified',
  hr_specialist: 'Classified',
  // Fallback
  custom: 'Classified',
}

// ─── Authoritative driver mapping by position type ────────────────────────────

export const POSITION_DRIVER: Record<string, string> = {
  // Fixed
  ceo_director: 'fixed',
  principal: 'fixed',
  asst_principal: 'fixed',
  coo: 'fixed',
  cfo: 'fixed',
  office_mgr: 'fixed',
  counselor: 'fixed',
  social_worker: 'fixed',
  psychologist: 'fixed',
  nutrition_mgr: 'fixed',
  facilities_mgr: 'fixed',
  it_coordinator: 'fixed',
  security: 'fixed',
  transport_coord: 'fixed',
  hr_specialist: 'fixed',
  registrar: 'fixed',
  // Per Pupil
  teacher_elem: 'per_pupil',
  teacher_ms: 'per_pupil',
  teacher_hs: 'per_pupil',
  instructional_coach: 'per_pupil',
  interventionist: 'per_pupil',
  paraeducator: 'per_pupil',
  custodian: 'per_pupil',
  food_service: 'per_pupil',
  substitute_pool: 'per_pupil',
  // SPED — fixed by default (1 FTE is sufficient; user can override)
  sped_teacher: 'fixed',
  // Per Pupil - EL
  el_specialist: 'per_pupil_el',
  // Fallback
  custom: 'fixed',
}

// ─── Students per position (for FTE auto-scaling) ─────────────────────────────

export const POSITION_STUDENTS_PER: Record<string, number> = {
  teacher_elem: 24,
  teacher_ms: 24,
  teacher_hs: 24,
  sped_teacher: 12,
  el_specialist: 30,
  instructional_coach: 200,
  interventionist: 50,
  paraeducator: 48,
  custodian: 200,
  food_service: 100,
  substitute_pool: 200,
  asst_principal: 300,
}

export function getClassification(positionType: string): StaffClassification {
  return POSITION_CLASSIFICATION[positionType] || 'Classified'
}

export function getDriver(positionType: string): string {
  return POSITION_DRIVER[positionType] || 'fixed'
}

export function getStudentsPerPosition(positionType: string): number {
  return POSITION_STUDENTS_PER[positionType] || 0
}

export function classificationToCategory(cls: string): 'certificated' | 'classified' | 'admin' {
  if (cls === 'Administrative') return 'admin'
  if (cls === 'Certificated') return 'certificated'
  return 'classified'
}
