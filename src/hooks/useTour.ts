'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSchoolSession } from '@/contexts/SchoolSessionContext'

export type TourName =
  | 'overview'
  | 'revenue'
  | 'staffing'
  | 'operations'
  | 'cashflow'
  | 'multiyear'
  | 'ask'
  | 'advisory'
  | 'alignment'
  | 'scorecard'
  | 'settings'
  | 'portfolio'
  | 'portfolio-school'

export type UserRole = 'school_ceo' | 'org_admin' | 'super_admin'

interface TourState {
  /** Has the user completed the overview tour at least once? */
  tourCompleted: boolean
  /** Which tours (overview + per-tab) have been completed */
  completedTours: TourName[]
  /** Currently running tour, or null */
  activeTour: TourName | null
  /** User role */
  role: UserRole | null
  /** True while loading from DB */
  loading: boolean
  /** Start the overview tour */
  startOverviewTour: () => void
  /** Start a per-tab deep-dive tour */
  startTabTour: (tab: TourName) => void
  /** Mark a tour as complete (called by Joyride callback) */
  markTourComplete: (tour: TourName) => void
  /** Dismiss the per-tab banner without taking the tour */
  dismissTabBanner: (tab: TourName) => void
  /** Reset all tour progress */
  resetTours: () => void
  /** Stop the currently running tour */
  stopTour: () => void
  /** Tabs whose banner was dismissed (superset of completedTours) */
  dismissedTabs: TourName[]
}

export function useTour(): TourState {
  const [supabase] = useState(() => createClient())
  const session = useSchoolSession()
  const [tourCompleted, setTourCompleted] = useState(true) // default true to avoid flash
  const [completedTours, setCompletedTours] = useState<TourName[]>([])
  const [dismissedTabs, setDismissedTabs] = useState<TourName[]>([])
  const [activeTour, setActiveTour] = useState<TourName | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [seeded, setSeeded] = useState(false)

  // Seed tour state from the session's role rows (newest row, as before) once it resolves.
  // Adjusting state during render (not in an effect) avoids an extra render pass.
  if (!seeded && !session.loading) {
    setSeeded(true)
    const data = session.roles[0]
    if (data) {
      setRole(data.role as UserRole)
      setTourCompleted(data.tour_completed ?? false)
      const tours = (data.completed_tours as TourName[]) || []
      setCompletedTours(tours)
      setDismissedTabs(tours) // already-completed tours are auto-dismissed
    }
  }
  const loading = !seeded

  // Persist to DB
  const userId = session.userId
  const persist = useCallback(async (completed: boolean, tours: TourName[]) => {
    if (!userId) return
    await supabase
      .from('user_roles')
      .update({ tour_completed: completed, completed_tours: tours })
      .eq('user_id', userId)
  }, [supabase, userId])

  const startOverviewTour = useCallback(() => {
    setActiveTour('overview')
  }, [])

  const startTabTour = useCallback((tab: TourName) => {
    setActiveTour(tab)
  }, [])

  const markTourComplete = useCallback((tour: TourName) => {
    setActiveTour(null)
    const isOverview = tour === 'overview'
    setCompletedTours(prev => {
      const next = prev.includes(tour) ? prev : [...prev, tour]
      setDismissedTabs(d => d.includes(tour) ? d : [...d, tour])
      if (isOverview) {
        setTourCompleted(true)
        persist(true, next)
      } else {
        persist(tourCompleted, next)
      }
      return next
    })
  }, [tourCompleted, persist])

  const dismissTabBanner = useCallback((tab: TourName) => {
    setDismissedTabs(prev => prev.includes(tab) ? prev : [...prev, tab])
  }, [])

  const stopTour = useCallback(() => {
    setActiveTour(null)
  }, [])

  const resetTours = useCallback(() => {
    setTourCompleted(false)
    setCompletedTours([])
    setDismissedTabs([])
    setActiveTour(null)
    persist(false, [])
  }, [persist])

  return {
    tourCompleted,
    completedTours,
    activeTour,
    role,
    loading,
    startOverviewTour,
    startTabTour,
    markTourComplete,
    dismissTabBanner,
    resetTours,
    stopTour,
    dismissedTabs,
  }
}
