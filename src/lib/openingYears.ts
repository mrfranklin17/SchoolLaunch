/**
 * Opening-year choices for onboarding (P-UX-06): this year and the next five, plus the school's
 * saved year when it falls outside that window, so a saved choice always has an option.
 */
export function openingYearOptions(saved?: number | null, currentYear = new Date().getFullYear()): number[] {
  const years = Array.from({ length: 6 }, (_, i) => currentYear + i)
  if (saved && Number.isInteger(saved) && !years.includes(saved)) years.push(saved)
  return years.sort((a, b) => a - b)
}
