'use client'

import { useState, useId, useEffect, cloneElement, isValidElement, ReactElement } from 'react'

type Position = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: React.ReactNode
  children: ReactElement
  position?: Position
  className?: string
  multiline?: boolean
}

// Padding (not margin) separates the bubble from the trigger, so the gap is part of the
// tooltip and the pointer can cross onto it without leaving the hover area.
const POSITION_CLASSES: Record<Position, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 pb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 pt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 pr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 pl-1.5',
}

/** Elements that take keyboard focus on their own. */
const FOCUSABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary'])

/**
 * Hover/focus tooltip (S4-03). For assistive tech it behaves like a native description:
 * - the text is always in the DOM (hidden while closed) and the trigger always points at it
 *   with aria-describedby, so a screen reader reads it when the trigger gets focus;
 * - a trigger that can't take focus (an info icon span or svg) is made focusable, and a
 *   labelled non-interactive trigger gets role="img", so keyboard and screen-reader users
 *   can reach it and hear its label;
 * - Escape closes it, and the pointer can move onto it without it closing (WCAG 1.4.13).
 */
export default function Tooltip({ content, children, position = 'top', className = '', multiline = false }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!isValidElement(children)) return children
  if (content == null || content === false || content === '') return children

  const childProps = children.props as {
    onFocus?: (e: React.FocusEvent) => void
    onBlur?: (e: React.FocusEvent) => void
    tabIndex?: number
    role?: string
    'aria-label'?: string
    'aria-describedby'?: string
    disabled?: boolean
  }
  const tag = typeof children.type === 'string' ? children.type : null
  const needsFocus = tag !== null && !FOCUSABLE_TAGS.has(tag) && childProps.tabIndex === undefined
  const describedBy = [childProps['aria-describedby'], id].filter(Boolean).join(' ')

  const trigger = cloneElement(children, {
    'aria-describedby': describedBy,
    ...(needsFocus ? { tabIndex: 0 } : {}),
    // A label on a plain span is ignored by screen readers; role="img" makes it count.
    ...(tag !== null && !FOCUSABLE_TAGS.has(tag) && !childProps.role && (childProps['aria-label'] || tag === 'svg')
      ? { role: 'img', ...(childProps['aria-label'] ? {} : { 'aria-label': 'More information' }) }
      : {}),
    onFocus: (e: React.FocusEvent) => { setOpen(true); childProps.onFocus?.(e) },
    onBlur: (e: React.FocusEvent) => { setOpen(false); childProps.onBlur?.(e) },
  } as Record<string, unknown>)

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {trigger}
      <span role="tooltip" id={id} hidden={!open} className={`absolute z-50 ${POSITION_CLASSES[position]}`}>
        <span
          className={`block rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg ${multiline ? 'whitespace-pre-line text-left w-max max-w-xs' : 'whitespace-nowrap'} ${className}`}
        >
          {content}
        </span>
      </span>
    </span>
  )
}
