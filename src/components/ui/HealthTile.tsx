import { formatCurrency, formatPercent, formatDays } from '@/lib/format'
import { StatusBadge, type Status } from './StatusBadge'

export type ValueFormat = 'compact' | 'percent' | 'currency' | 'days' | 'number'

export interface HealthTileProps {
  label: string
  value: number
  status: Status
  sublabel?: string
  valueFormat: ValueFormat
}

const STATUS_BORDER: Record<Status, string> = {
  meets: 'var(--teal-500)',
  approaching: 'var(--amber-500)',
  fails: 'var(--rose-500)',
  na: 'var(--border-medium)',
}

function formatValue(value: number, format: ValueFormat): string {
  if (format === 'percent') return formatPercent(value)
  if (format === 'currency') return formatCurrency(value, 'accounting')
  if (format === 'days') return formatDays(value)
  if (format === 'number') return Math.round(value).toLocaleString('en-US')
  return formatCurrency(value, 'compact')
}

export function HealthTile({ label, value, status, sublabel, valueFormat }: HealthTileProps) {
  return (
    <div
      data-testid="health-tile"
      className="bg-white border border-l-4 rounded-xl p-5 flex flex-col gap-2"
      style={{
        borderLeftColor: STATUS_BORDER[status],
        borderTopColor: 'var(--border-subtle)',
        borderRightColor: 'var(--border-subtle)',
        borderBottomColor: 'var(--border-subtle)',
        boxShadow: 'var(--shadow-1)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
        <StatusBadge status={status} />
      </div>
      <div className="font-tabular text-[28px] leading-tight font-semibold text-slate-900">
        {formatValue(value, valueFormat)}
      </div>
      {sublabel && <div className="text-xs text-slate-500">{sublabel}</div>}
    </div>
  )
}
