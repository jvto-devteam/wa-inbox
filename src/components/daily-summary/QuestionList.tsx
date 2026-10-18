import { normalizeQuestion, type ConversationReview } from '@/lib/daily-summary/payload-schema'

/**
 * Pertanyaan pelanggan dengan tanda teks (bukan hanya warna); ringkasan lama tanpa tanda.
 * Dipakai tab "Ringkasan chat" di Inbox dan tampilan per tanggal di /summary.
 */
export function QuestionList({ questions }: { questions: ConversationReview['pertanyaan'] }) {
  if (questions.length === 0) return null
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-ink-subtle">Yang ditanyakan</p>
      <ul aria-label="Yang ditanyakan" className="space-y-1 text-sm text-ink">
        {questions.map((raw, i) => {
          const q = normalizeQuestion(raw)
          return (
            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <span>{q.teks}</span>
              {q.terjawab === true && <span className="text-xs font-medium text-success">✅ terjawab</span>}
              {q.terjawab === false && <span className="text-xs font-medium text-warning">⏳ belum</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
