'use client'

import type { AgentKey } from '@/lib/new/types'

/** Tandai jawaban agent salah; koreksi (bila ada) menjadi draf knowledge. */
export function markWrong(
  d: { agst: Record<AgentKey, { ok: number; bad: number }>; kn: { title: string; status: 'PUBLISHED' | 'DRAFT'; ver: string; text?: string }[] },
  ag: AgentKey,
  src: string,
  fix: string,
) {
  d.agst[ag].bad++
  if (fix) d.kn.push({ title: 'Koreksi: ' + src.replace(/^Knowledge: /, '').slice(0, 40), status: 'DRAFT', ver: 'v1', text: fix })
}
