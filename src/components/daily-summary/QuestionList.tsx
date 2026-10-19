'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { conversationHref } from '@/components/daily-summary/conversation-href'
import { normalizePoint, normalizePromise, normalizeQuestion, type ConversationReview } from '@/lib/daily-summary/payload-schema'
import { scrollToThreadMessage } from '@/lib/inbox/message-anchor'

/**
 * Daftar "Yang ditanyakan", "Janji tim", dan "Poin penting" dari satu ringkasan LLM. Dipakai tab "Ringkasan
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

type CheckItem = { teks: string; done: boolean | null; messageId: string | null }

/**
 * Daftar bertanda ✅/⏳ (teks, bukan hanya warna); `done: null` (ringkasan lama berupa string) tampil
 * tanpa tanda. Satu komponen untuk pertanyaan dan janji supaya tanda dan tautannya tidak berbeda.
 */
function CheckList({
  label,
  items,
  doneText,
  conversationId,
}: {
  label: string
  items: CheckItem[]
  /** Tanda untuk `done: true`, mis. "terjawab" atau "ditepati". */
  doneText: string
  conversationId?: string
}) {
  if (items.length === 0) return null
  return (
    <ListBlock label={label}>
      <ul aria-label={label} className="space-y-1 text-sm text-ink">
        {items.map((item, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <ItemText teks={item.teks} messageId={item.messageId} conversationId={conversationId} />
            {item.done === true && <span className="text-xs font-medium text-success">✅ {doneText}</span>}
            {item.done === false && <span className="text-xs font-medium text-warning">⏳ belum</span>}
          </li>
        ))}
      </ul>
    </ListBlock>
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
  const items = questions.map((raw) => {
    const q = normalizeQuestion(raw)
    return { teks: q.teks, done: q.terjawab, messageId: q.messageId }
  })
  return <CheckList label="Yang ditanyakan" items={items} doneText="terjawab" conversationId={conversationId} />
}

/** Janji tim kepada pelanggan: ✅ ditepati / ⏳ belum, dengan aturan tautan yang sama. */
export function PromiseList({ promises, conversationId }: { promises: ConversationReview['janjiTim']; conversationId?: string }) {
  // `?? []`: ringkasan yang tidak lewat skema (cache klien lama) bisa tidak membawa `janjiTim`.
  const items = (promises ?? []).map((raw) => {
    const p = normalizePromise(raw)
    return { teks: p.teks, done: p.terpenuhi, messageId: p.messageId }
  })
  return <CheckList label="Janji tim" items={items} doneText="ditepati" conversationId={conversationId} />
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
