// Halaman lama di dalam /new: tautan kembali ke menu /new asalnya + LegacyFrame (kulit /new, tautan dalam tetap di /new).
import Link from 'next/link'
import { LegacyFrame } from './LegacyFrame'

export function LegacyPage({ back, children }: { back: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="view fx legacy-page">
      <Link className="btn sm legacy-back" href={back.href}>‹ {back.label}</Link>
      <LegacyFrame>{children}</LegacyFrame>
    </section>
  )
}
