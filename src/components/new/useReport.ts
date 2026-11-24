'use client'

import { useMemo } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { buildReport, type Report } from '@/lib/new/report'
import { reportRows } from '@/lib/new/report-mock'

/** Laporan inquiry → booking dari DATA CONTOH untuk rentang [from, to]; dipakai Laporan dan Dashboard /new. */
export function useReport(from: string, to: string): { loading: boolean; data?: Report; error?: string } {
  const data = useMemo(() => {
    const today = jakartaDay(new Date())
    return buildReport(reportRows(today), from, to, 8, today)
  }, [from, to])
  return { loading: false, data }
}
