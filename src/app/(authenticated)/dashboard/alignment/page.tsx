'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useScenario } from '@/lib/ScenarioContext'
import { buildSchoolContextString } from '@/lib/buildSchoolContext'
import { computeFPFScorecard } from '@/lib/budgetEngine'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { usePermissions } from '@/hooks/usePermissions'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PageHeader } from '@/components/ui/PageHeader'
import { AlignmentSkeleton } from '../_skeletons'

interface Misalignment {
  severity: 'critical' | 'important' | 'minor'
  title: string
  narrativeSays: string
  budgetShows: string
  recommendation: string
  dimension: string
}

interface Strength {
  title: string
  description: string
}

interface AlignmentResult {
  overallAlignment: 'strong' | 'moderate' | 'weak'
  summary: string
  misalignments: Misalignment[]
  strengths: Strength[]
}

interface SavedReview {
  id: string
  narrative_filename: string | null
  overall_alignment: string
  summary: string
  misalignments: Misalignment[]
  strengths: Strength[]
  created_at: string
}

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  important: { label: 'Important', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', dot: 'bg-amber-500', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  minor: { label: 'Minor', bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-300', dot: 'bg-slate-400', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
}

const ALIGNMENT_CONFIG = {
  strong: { label: 'Strong Alignment', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', dot: 'bg-emerald-500' },
  moderate: { label: 'Moderate Alignment', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', dot: 'bg-amber-500' },
  weak: { label: 'Weak Alignment', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' },
}

const PROGRESS_STEPS = [
  'Reading your narrative...',
  'Cross-referencing with financial model...',
  'Checking instructional alignment...',
  'Evaluating staffing and demographics...',
  'Reviewing growth and facility plans...',
  'Preparing findings...',
]

export default function AlignmentPage() {
  const {
    schoolData: { schoolId, schoolName, profile, positions, projections, gradeExpansionPlan, loading },
    pathway,
    preOpenCash,
    multiYear,
  } = useScenario()
  const supabase = createClient()
  const { canEdit } = usePermissions()
  useDocumentTitle('Alignment Review', schoolName)

  // P-UX-20: single source of truth — the dashboard's engine run (pathway-aware) and its
  // preOpenCash (computeCarryForward) back BOTH the projections and the scorecard.
  const scorecard = useMemo(
    () => computeFPFScorecard(multiYear, preOpenCash, false),
    [multiYear, preOpenCash]
  )

  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [result, setResult] = useState<AlignmentResult | null>(null)
  const [savedReview, setSavedReview] = useState<SavedReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [injectionWarning, setInjectionWarning] = useState<{ patterns: string[] } | null>(null)
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load most recent saved review
  useEffect(() => {
    if (!schoolId || loading) return
    async function loadReview() {
      const { data } = await supabase
        .from('alignment_reviews')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (data) {
        setSavedReview(data as SavedReview)
        setResult({
          overallAlignment: data.overall_alignment as AlignmentResult['overallAlignment'],
          summary: data.summary,
          misalignments: data.misalignments as Misalignment[],
          strengths: data.strengths as Strength[],
        })
      }
      setLoadingSaved(false)
    }
    loadReview()
  }, [schoolId, loading, supabase])

  // Progress animation during analysis
  useEffect(() => {
    if (!analyzing) { setProgressStep(0); return }
    const timers: ReturnType<typeof setTimeout>[] = []
    PROGRESS_STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setProgressStep(i + 1), (i + 1) * 2000))
    })
    return () => timers.forEach(clearTimeout)
  }, [analyzing])

  async function extractText(f: File): Promise<string> {
    if (f.name.endsWith('.txt')) {
      return f.text()
    }
    if (f.name.endsWith('.pdf')) {
      const formData = new FormData()
      formData.append('file', f)
      // Read as ArrayBuffer and send to server for pdf-parse
      const buffer = await f.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )
      return `__PDF_BASE64__${base64}`
    }
    if (f.name.endsWith('.doc') || f.name.endsWith('.docx')) {
      throw new Error('Please save your document as PDF or plain text for upload.')
    }
    return f.text()
  }

  const handleAnalyze = useCallback(async () => {
    if (!file || !schoolName || !schoolId) return
    setAnalyzing(true)
    setError(null)
    setResult(null)
    setInjectionWarning(null)

    try {
      let narrativeText = await extractText(file)

      // If PDF, extract on server
      if (narrativeText.startsWith('__PDF_BASE64__')) {
        const pdfRes = await fetch('/api/alignment/extract-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: narrativeText.replace('__PDF_BASE64__', '') }),
        })
        if (!pdfRes.ok) throw new Error('Failed to extract text from PDF')
        const pdfData = await pdfRes.json()
        narrativeText = pdfData.text
      }

      if (!narrativeText || narrativeText.trim().length < 50) {
        throw new Error('The uploaded file appears to be empty or too short. Please upload a document with your application narrative.')
      }

      const schoolContext = buildSchoolContextString(schoolName, profile, positions, projections, gradeExpansionPlan, multiYear, pathway === 'wa_charter' ? scorecard : undefined, pathway)

      const res = await fetch('/api/alignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, narrativeText, schoolContext }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Analysis failed (${res.status})`)
      }

      const analysis: AlignmentResult & { injection_suspected?: boolean; suspected_patterns?: string[] } = await res.json()
      setResult(analysis)
      if (analysis.injection_suspected) {
        setInjectionWarning({ patterns: analysis.suspected_patterns ?? [] })
      }

      // Sort misalignments by severity
      const severityOrder = { critical: 0, important: 1, minor: 2 }
      analysis.misalignments.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

      // Save to Supabase
      const { error: saveError } = await supabase.from('alignment_reviews').insert({
        school_id: schoolId,
        narrative_filename: file.name,
        narrative_excerpt: narrativeText.slice(0, 500),
        overall_alignment: analysis.overallAlignment,
        summary: analysis.summary,
        misalignments: analysis.misalignments,
        strengths: analysis.strengths,
      })
      if (saveError) console.error('Failed to save review:', saveError)

      setSavedReview({
        id: '',
        narrative_filename: file.name,
        overall_alignment: analysis.overallAlignment,
        summary: analysis.summary,
        misalignments: analysis.misalignments,
        strengths: analysis.strengths,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.')
    }
    setAnalyzing(false)
  }, [file, schoolName, schoolId, profile, positions, projections, gradeExpansionPlan, multiYear, scorecard, pathway, supabase])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (loading || loadingSaved) {
    return <AlignmentSkeleton />
  }

  const displayResult = result
  const timestamp = savedReview?.created_at

  return (
    <div className="max-w-4xl animate-fade-in">
      <div data-tour="alignment-header">
        <PageHeader
          title="Application Alignment Review"
          subtitle="Upload your draft application narrative and we'll check it against your financial model for misalignments the Commission would flag."
        />
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {injectionWarning && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <div className="font-medium mb-1">Heads up — your narrative contains language that looks like it's trying to redirect the reviewer AI.</div>
          <div className="text-amber-700">
            We flagged{' '}
            {injectionWarning.patterns.length > 0
              ? injectionWarning.patterns.join(', ').replace(/_/g, ' ')
              : 'suspicious override patterns'}
            . The review still ran against your real financial model and you can trust the misalignments below, but if you didn&apos;t mean to include this kind of language, re-upload a cleaner draft before sharing the analysis with your board or the Commission.
          </div>
        </div>
      )}

      {/* Upload area — editors and owners only */}
      {canEdit && <div data-tour="alignment-input" className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-teal-400 bg-teal-50/50'
              : file
              ? 'border-emerald-300 bg-emerald-50/30'
              : 'border-slate-300 hover:border-teal-400 hover:bg-slate-50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
          {file ? (
            <div>
              <svg className="w-8 h-8 text-emerald-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-slate-800">{file.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{formatSize(file.size)}</p>
              <p className="text-xs text-teal-600 mt-2">Click to choose a different file</p>
            </div>
          ) : (
            <div>
              <svg className="w-10 h-10 text-slate-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-slate-700">Drop your application narrative here, or click to browse</p>
              <p className="text-xs text-slate-500 mt-1">PDF or plain text, up to 10MB</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-slate-400 max-w-lg">
            We recommend uploading the following sections: Executive Summary, Educational Program, Staffing Plan, Growth Plan, and Community Need. You don&apos;t need the full application — the key narrative sections are enough.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={!file || analyzing}
            className="px-5 py-2.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0 ml-4"
          >
            {analyzing ? 'Analyzing...' : 'Analyze Alignment'}
          </button>
        </div>
      </div>}

      {/* Loading state */}
      {analyzing && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm mb-6 animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-6 h-6 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
            <span className="text-sm font-medium text-slate-700">Analyzing your application...</span>
          </div>
          <div className="space-y-3">
            {PROGRESS_STEPS.map((step, i) => (
              <div key={i} className={`flex items-center gap-2.5 transition-opacity duration-300 ${
                i < progressStep ? 'opacity-100' : 'opacity-0'
              }`}>
                <svg className="w-4 h-4 text-teal-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-slate-600">{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {displayResult && !analyzing && (
        <div data-tour="alignment-results" className="space-y-6 animate-fade-in-up">
          {/* Part A: Alignment Score */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${ALIGNMENT_CONFIG[displayResult.overallAlignment].bg}`}>
                <svg className={`w-7 h-7 ${ALIGNMENT_CONFIG[displayResult.overallAlignment].text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${ALIGNMENT_CONFIG[displayResult.overallAlignment].bg} ${ALIGNMENT_CONFIG[displayResult.overallAlignment].text}`}>
                  <span className={`w-2 h-2 rounded-full ${ALIGNMENT_CONFIG[displayResult.overallAlignment].dot}`} />
                  {ALIGNMENT_CONFIG[displayResult.overallAlignment].label}
                </span>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{displayResult.summary}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500 pt-3 border-t border-slate-100">
              <span>{displayResult.misalignments.filter(m => m.severity === 'critical').length} critical</span>
              <span>{displayResult.misalignments.filter(m => m.severity === 'important').length} important</span>
              <span>{displayResult.misalignments.filter(m => m.severity === 'minor').length} minor</span>
              <span>{displayResult.strengths.length} strengths</span>
            </div>
          </div>

          {/* Part B: Misalignment Findings */}
          {displayResult.misalignments.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Misalignment Findings</h2>
              <div className="space-y-3">
                {displayResult.misalignments.map((m, i) => {
                  const cfg = SEVERITY_CONFIG[m.severity]
                  return (
                    <div key={i} className={`bg-white border-l-4 ${cfg.border} border border-slate-200 rounded-xl p-5 shadow-sm`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <svg className={`w-4 h-4 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
                          </svg>
                          <h3 className="font-semibold text-slate-800 text-sm">{m.title}</h3>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      </div>
                      <div className="space-y-2.5 text-sm">
                        <div>
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Narrative says</span>
                          <p className="text-slate-600 mt-0.5 italic">&ldquo;{m.narrativeSays}&rdquo;</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Budget shows</span>
                          <p className="text-slate-700 mt-0.5 font-medium">{m.budgetShows}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                          <span className="text-xs font-medium text-teal-600 uppercase tracking-wide">Recommendation</span>
                          <p className="text-slate-700 mt-0.5">{m.recommendation}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Part C: Alignment Strengths */}
          {displayResult.strengths.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Alignment Strengths</h2>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                {displayResult.strengths.map((s, i) => (
                  <div key={i} className={`flex items-start gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                    <svg className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <span className="text-sm font-medium text-slate-800">{s.title}</span>
                      <p className="text-sm text-slate-600 mt-0.5">{s.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom actions */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-700">Want to discuss a finding?</div>
              <div className="text-xs text-slate-500 mt-0.5">Ask SchoolLaunch to explain any misalignment in detail or suggest budget changes.</div>
            </div>
            <Link
              href="/dashboard/ask"
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors flex-shrink-0"
            >
              Ask SchoolLaunch
            </Link>
          </div>

          {timestamp && (
            <p className="text-xs text-slate-400 text-right">
              Last analyzed: {new Date(timestamp).toLocaleString()}
              {savedReview?.narrative_filename && ` — ${savedReview.narrative_filename}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
