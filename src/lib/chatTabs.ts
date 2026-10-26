/**
 * Phase 6e: the dashboard tab the chat panel is open on. The panel shows prompts for that tab,
 * and /api/chat tells the model where the founder is, so "this" and "here" resolve to the tab's
 * items. Pure; shared by the panel and the route (which accepts only these keys).
 */

export interface ChatTab {
  key: string
  label: string
  /** Prompts offered in the panel's empty state on this tab (WA charter wording). */
  suggestions: string[]
}

const TABS: Record<string, ChatTab> = {
  '/dashboard': {
    key: 'overview',
    label: 'Overview',
    suggestions: ['What are the biggest risks in our financial model?', 'What enrollment do I need to break even in Year 1?'],
  },
  '/dashboard/revenue': {
    key: 'revenue',
    label: 'Revenue',
    suggestions: ['Which revenue lines depend most on our demographics?', 'What happens to revenue if FRL is 10 points lower?'],
  },
  '/dashboard/staffing': {
    key: 'staffing',
    label: 'Staffing',
    suggestions: ['Can I afford a full-time instructional coach in Year 1?', 'Move one position to half-time and show me the effect.'],
  },
  '/dashboard/operations': {
    key: 'operations',
    label: 'Operations',
    suggestions: ['What if rent is $25,000 a month?', 'Which operations lines look high for our size?'],
  },
  '/dashboard/cashflow': {
    key: 'cashflow',
    label: 'Cash Flow',
    suggestions: ['When is our lowest cash month in Year 1, and why?', 'How much startup capital do we need to stay above 30 days of cash?'],
  },
  '/dashboard/multiyear': {
    key: 'multiyear',
    label: 'Multi-Year',
    suggestions: ['Which year is tightest, and what drives it?', 'What happens if we add a grade a year later?'],
  },
  '/dashboard/scenarios': {
    key: 'scenarios',
    label: 'Scenarios',
    suggestions: ['What separates our conservative and base cases most?', 'What would make the conservative case meet every measure?'],
  },
  '/dashboard/advisory': {
    key: 'advisory',
    label: 'Advisory Panel',
    suggestions: ['Which advisor concern should we fix first?', 'Set up the change the Staffing Advisor recommends.'],
  },
  '/dashboard/alignment': {
    key: 'alignment',
    label: 'Alignment Review',
    suggestions: ['Where does our narrative disagree with our numbers?', 'What should we fix before submitting?'],
  },
  '/dashboard/scorecard': {
    key: 'scorecard',
    label: 'Commission Scorecard',
    suggestions: ['Which measure is closest to failing, and how do we fix it?', 'What would it take to meet every measure in Year 1?'],
  },
  '/dashboard/settings': {
    key: 'settings',
    label: 'Settings',
    suggestions: ['How does our retention rate affect Year 5 enrollment?', 'Which of our rates differ from the WA defaults?'],
  },
  '/dashboard/inbox': {
    key: 'inbox',
    label: 'Inbox',
    suggestions: ['What would these requests do to our cash?', 'Summarize the changes waiting for review.'],
  },
}

const BY_KEY = new Map(Object.values(TABS).map((t) => [t.key, t]))

/** The tab for a dashboard path, or null (the Ask page and anything else). */
export function chatTabForPath(pathname: string): ChatTab | null {
  return TABS[pathname] ?? null
}

/** The tab for a key sent by the client, or null when it isn't one of ours. */
export function chatTabForKey(key: unknown): ChatTab | null {
  return typeof key === 'string' ? BY_KEY.get(key) ?? null : null
}

/** The system-prompt line telling the model which tab the founder has open. */
export function currentTabPrompt(tab: ChatTab): string {
  return `WHERE THE FOUNDER IS: they are asking from the ${tab.label} tab. When they say "this", "here" or name something loosely, prefer the items on that tab; ask if it is still ambiguous.`
}
