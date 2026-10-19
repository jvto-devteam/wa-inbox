'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { conversationHref } from '@/components/daily-summary/SummaryQueue'
import { normalizePoint, normalizeQuestion, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { scrollToThreadMessage } from '@/lib/inbox/message-anchor'

/**
 * Daftar "Yang ditanyakan" dan "Poin penting" dari satu ringkasan LLM. Dipakai tab "Ringkasan
 * chat" di Inbox dan tampilan per tanggal di /summary.
 *
 * Butir yang membawa `messageId` (pesan sumbernya di transkrip, lihat review.ts) menjadi tautan ke
 * `/inbox?conversation=<id>&message=<messageId>&lihat=1`: thread menggulung ke pesan itu dan menyorotnya
 * tanpa membuka panel perbaikan bot.
 * Ringkasan lama (string polos) dan butir yang sumbernya tidak diketahui tampil sebagai teks biasa.
 */

/** Teks butir: tautan ke pesan sumber bila diketahui, teks biasa bila tidak. */
function ItemText({ teks, messageId, conversationId }: { teks: string; messageId: string | null; conversationId?: string }) {
  if (!messageId || !conversationId) return <span>{teks}</span>
  return (
    <Link
      // `lihat`: membaca sumber poin, bukan memperbaiki jawaban bot -- panel perbaikan tetap tertutup.
      href={conversationHref(conversationId, messageId, { lihat: true })}
      scroll={false}
      // URL yang sama (butir yang sama diklik lagi) tidak memicu efek sorot di ThreadView; gulung
      // langsung bila pesannya sedang dirender. Di /summary tidak ada thread, jadi ini no-op.
      onClick={() => scrollToThreadMessage(messageId)}
      aria-label={`Lihat pesan: ${teks}`}
      title="Lihat pesan di chat"
      className="focus-ring rounded-sm text-ink underline decoration-ink-subtle decoration-dotted underline-offset-2 hover:text-accent hover:decoration-solid"
    >
      {teks}
    </Link>
  )
}

function ListBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      {children}
    </div>
  )
}

/** Pertanyaan pelanggan dengan tanda teks (bukan hanya warna); ringkasan lama tanpa tanda. */
export function QuestionList({
  questions,
  conversationId,
}: {
  questions: ConversationReview['pertanyaan']
  /** Tanpa ini butir tidak pernah jadi tautan. */
  conversationId?: string
}) {
  if (questions.length === 0) return null
  return (
    <ListBlock label="Yang ditanyakan">
      <ul aria-label="Yang ditanyakan" className="space-y-1 text-sm text-ink">
        {questions.map((raw, i) => {
          const q = normalizeQuestion(raw)
          return (
            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <ItemText teks={q.teks} messageId={q.messageId} conversationId={conversationId} />
              {q.terjawab === true && <span className="text-xs font-medium text-success">✅ terjawab</span>}
              {q.terjawab === false && <span className="text-xs font-medium text-warning">⏳ belum</span>}
            </li>
          )
        })}
      </ul>
    </ListBlock>
  )
}

/** Poin penting (tanggal, jumlah orang, paket, dll.), dengan aturan tautan yang sama. */
export function PointList({ points, conversationId }: { points: ConversationReview['poinPenting']; conversationId?: string }) {
  if (points.length === 0) return null
  return (
    <ListBlock label="Poin penting">
      <ul aria-label="Poin penting" className="list-disc space-y-0.5 pl-4 text-sm text-ink">
        {points.map((raw, i) => {
          const p = normalizePoint(raw)
          return (
            <li key={i}>
              <ItemText teks={p.teks} messageId={p.messageId} conversationId={conversationId} />
            </li>
          )
        })}
      </ul>
    </ListBlock>
  )
}
