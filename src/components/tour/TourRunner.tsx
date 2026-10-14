'use client'

import { useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useSearchParams } from 'next/navigation'
import type { CallBackProps } from 'react-joyride'
import { useTourContext } from './TourContext'
import { getOverviewSteps, getTabSteps } from './tourSteps'

// Dynamic import to avoid SSR issues with react-joyride
const Joyride = dynamic(() => import('react-joyride'), { ssr: false })

const JOYRIDE_STYLES = {
  options: {
    primaryColor: '#0D9488',
    zIndex: 10000,
    arrowColor: '#fff',
    backgroundColor: '#fff',
    overlayColor: 'rgba(0, 0, 0, 0.5)',
    textColor: '#334155',
  },
  tooltip: {
    borderRadius: 12,
    fontSize: 14,
    padding: '20px 24px',
    fontFamily: 'var(--font-heading-var), "DM Sans", system-ui, sans-serif',
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: 8,
  },
  tooltipContent: {
    fontSize: 14,
    lineHeight: 1.6,
    color: '#475569',
    padding: '8px 0 0',
  },
  buttonNext: {
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 18px',
  },
  buttonBack: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 500,
    marginRight: 8,
  },
  buttonSkip: {
    color: '#94a3b8',
    fontSize: 12,
  },
  spotlight: {
    borderRadius: 12,
  },
  beacon: {
    display: 'none' as const,
  },
}

export default function TourRunner() {
  const pathname = usePathname()
  const {
    activeTour,
    tourCompleted,
    role,
    loading,
    startOverviewTour,
    markTourComplete,
    stopTour,
  } = useTourContext()

  const searchParams = useSearchParams()
  const autoStartedRef = useRef(false)

  // Auto-start overview tour ONLY when arriving from onboarding completion
  useEffect(() => {
    if (loading || autoStartedRef.current || tourCompleted || activeTour) return
    if (!role) return
    // Only auto-start on the overview dashboard or portfolio page
    const isHome = pathname === '/dashboard' || pathname === '/portfolio'
    if (!isHome) return

    // Require proof the user just came from onboarding:
    // either ?onboarding=complete query param or sessionStorage flag
    const fromOnboarding =
      searchParams.get('onboarding') === 'complete' ||
      sessionStorage.getItem('onboarding_just_completed') === 'true'

    if (!fromOnboarding) return
    // Test hook: ?skipTour=1 lands on the dashboard without the overlay.
    if (searchParams.get('skipTour') === '1') return

    // Clear the sessionStorage flag so it doesn't trigger again on refresh
    sessionStorage.removeItem('onboarding_just_completed')

    autoStartedRef.current = true
    const timer = setTimeout(() => {
      startOverviewTour()
    }, 1000)
    return () => clearTimeout(timer)
  }, [loading, tourCompleted, activeTour, role, pathname, searchParams, startOverviewTour])

  // P-UX-02: leaving the page a tour started on ends it, so its overlay never covers another tab.
  // An overview the founder walked away from counts as seen and won't auto-start again.
  const tourPathRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTour) {
      tourPathRef.current = null
      return
    }
    if (tourPathRef.current === null) {
      tourPathRef.current = pathname
      return
    }
    if (pathname !== tourPathRef.current) {
      tourPathRef.current = null
      if (activeTour === 'overview') markTourComplete('overview')
      else stopTour()
    }
  }, [activeTour, pathname, markTourComplete, stopTour])

  const handleCallback = useCallback((data: CallBackProps) => {
    const { status, action } = data
    const finishedStatuses: string[] = ['finished', 'skipped']

    if (finishedStatuses.includes(status as string)) {
      if (activeTour) {
        markTourComplete(activeTour)
      }
    }
    // If user closes via overlay click or escape — also mark overview complete
    // so it won't auto-start again
    if (action === 'close') {
      if (activeTour === 'overview') {
        markTourComplete('overview')
      } else {
        stopTour()
      }
    }
  }, [activeTour, markTourComplete, stopTour])

  if (!activeTour || loading) return null

  const steps = activeTour === 'overview'
    ? getOverviewSteps(role)
    : getTabSteps(activeTour, role)

  if (steps.length === 0) return null

  return (
    <Joyride
      steps={steps}
      run={true}
      continuous
      showSkipButton
      showProgress
      scrollToFirstStep={true}
      scrollOffset={100}
      disableScrollParentFix={false}
      disableOverlayClose={false}
      spotlightClicks={false}
      styles={JOYRIDE_STYLES}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip Tour',
      }}
      callback={handleCallback}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  )
}
