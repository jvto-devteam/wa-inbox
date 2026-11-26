// Halaman lama di dalam aplikasi baru: (opsional) tautan kembali ke menu asalnya + LegacyFrame (kulit desain baru,
// tautan di dalamnya diarahkan ke padanan barunya). Halamannya sendiri tidak diubah.
import Link from 'next/link'
import { LegacyFrame } from './LegacyFrame'

export function LegacyPage({ back, className, children }: { back?: { href: string; label: string }; className?: string; children: React.ReactNode }) {
  return (
    <section className={'view fx legacy-page' + (className ? ' ' + className : '')}>
      {back && <Link className="btn sm legacy-back" href={back.href}>‹ {back.label}</Link>}
      <LegacyFrame>{children}</LegacyFrame>
    </section>
  )
}
