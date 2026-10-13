import { NextResponse } from 'next/server'
import { authenticateOrgRequest } from '@/lib/apiAuth'
import { buildPortfolioPdfHtml, type PortfolioPdfPayload } from '@/lib/portfolioPdf'

export async function POST(request: Request) {
  // Org-level users only (org_admin / super_admin): 401 signed out, 403 otherwise (P2-FU-02).
  const auth = await authenticateOrgRequest()
  if (auth instanceof NextResponse) return auth

  const payload = await request.json() as PortfolioPdfPayload

  // The builder escapes every name and label: the page writes this into a same-origin window.
  return new NextResponse(buildPortfolioPdfHtml(payload), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
