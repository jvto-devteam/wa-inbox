'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/label'

/**
 * Layar masuk.
 *
 * Bentuknya mengikuti pola dua panel di Code/watsapin (`app/(auth)/layout.tsx`): panel bermerek
 * di kiri, formulirnya di kanan. Yang DIPINJAM adalah polanya, bukan tokennya — warna, huruf,
 * dan primitifnya tetap milik sistem desain wa-inbox, supaya layar ini tidak jadi satu-satunya
 * halaman yang terlihat berasal dari aplikasi lain.
 *
 * Dua penyimpangan yang disengaja dari watsapin:
 *
 *  1. **Tidak ada foto.** watsapin memakai `/photos/auth-*.jpg`; berkas seperti itu tidak ada di
 *     repo ini, dan menautkan gambar yang tidak ada hanya menghasilkan panel kosong di produksi.
 *     Panel kirinya memakai gradien navy JVTO — warna yang sama dengan rail aplikasi, sehingga
 *     layar masuk sudah mengenalkan bentuk yang akan dilihat operator setelah masuk.
 *  2. **Tidak ada tautan daftar.** wa-inbox alat internal satu bisnis; akun dibuat admin di
 *     Pengaturan. "Daftar gratis" di sini akan menjanjikan pintu yang tidak ada.
 *
 * Panel kiri disembunyikan di bawah `md` dengan alasan yang sama seperti sumbernya: di ponsel ia
 * hanya akan mendorong formulirnya ke bawah layar.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json()
        setError(body.error)
        return
      }
      router.push('/dashboard')
    } catch {
      setError('Tidak bisa menghubungi server. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    // min-h-dvh, bukan min-h-screen: 100vh menyimpang dari tinggi viewport ponsel yang sebenarnya
    // saat bilah browser muncul dan hilang.
    <div className="grid min-h-dvh md:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-ink md:block">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-24 size-96 rounded-full bg-accent/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -bottom-32 size-96 rounded-full bg-accent/15 blur-3xl"
        />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="size-8 rounded-md object-contain" />
            <span className="text-base font-semibold text-white">JVTO WA Inbox</span>
          </div>

          <div className="max-w-md">
            <h2 className="text-xl leading-tight font-semibold text-white">
              Semua percakapan pelanggan, di satu layar.
            </h2>
            <p className="mt-3 text-base text-white/60">
              Inbox WhatsApp dan chatbot Java Volcano Tour Operator — balas pelanggan, lihat
              bookingnya, dan periksa apa yang dijawab bot.
            </p>
          </div>

          <p className="text-xs text-white/40">Alat internal JVTO</p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-surface px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="size-7 rounded-md object-contain" />
            <span className="text-base font-semibold text-ink">JVTO WA Inbox</span>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <h1 className="text-lg font-semibold text-ink">Masuk</h1>
              <p className="mt-1 text-sm text-ink-muted">
                Belum punya akses? Minta admin membuatkan akun di Pengaturan.
              </p>
            </div>

            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>

            <Field label="Kata sandi" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {/* role="alert" supaya pembaca layar mengumumkan kegagalan masuk; tanpa itu satu-
                satunya tanda gagal adalah teks yang muncul diam-diam di tengah formulir. */}
            {error && (
              <p
                role="alert"
                className="rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger"
              >
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={loading} className="w-full">
              {loading ? 'Masuk...' : 'Masuk'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
