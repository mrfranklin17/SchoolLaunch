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
