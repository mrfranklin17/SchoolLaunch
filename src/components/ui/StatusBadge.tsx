import type { ReactNode } from 'react'
import { HEALTH_COLORS, type HealthStatus } from '@/lib/healthThresholds'

/** Badge status — the shared health vocabulary (R-HEALTH-01). */
export type Status = HealthStatus

/** Default badge labels per status (FPF wording). */
export const STATUS_LABELS: Record<Status, string> = {
  meets: 'Meets',
  approaching: 'Approaching',
  fails: 'Does Not Meet',
  na: 'N/A',
}

export interface StatusBadgeProps {
  status: Status
  label?: string
  icon?: ReactNode
}

export function StatusBadge({ status, label, icon }: StatusBadgeProps) {
  const colors = HEALTH_COLORS[status]
  const text = label ?? STATUS_LABELS[status]

  return (
    <span
      data-status={status}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap"
      style={{
        background: colors.cssBg,
        color: colors.cssFg,
        borderColor: colors.cssBorder,
      }}
    >
      {icon ?? (
        <span
          aria-hidden="true"
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: colors.hexDot }}
        />
      )}
      <span>{text}</span>
    </span>
  )
}
