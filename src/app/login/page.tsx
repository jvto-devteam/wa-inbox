'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeNextPath } from '@/lib/auth/next-path'

/**
 * Layar masuk, desain yang sama dengan aplikasi (owner 2026-11-26: "senada dengan style yang baru"): token .nwa di
 * (app)/new.css, kotak logo JV seperti sidebar, panel gradien biru seperti kartu sapaan Dashboard, kolom .in dan tombol
 * .btn.pri. Tidak ada tautan daftar: akun dibuat admin di Pengaturan. Panel kiri disembunyikan di ponsel supaya
 * formulirnya tidak terdorong ke bawah layar.
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
      // Kembali ke halaman yang tadi dibuka (`?next=`, hanya jalur internal), bawaan /dashboard.
      router.push(safeNextPath(new URLSearchParams(window.location.search).get('next')))
    } catch {
      setError('Tidak bisa menghubungi server. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="nwa login">
      <div className="lg-hero" aria-hidden="true">
        <svg className="hr" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="4" /><circle cx="9.5" cy="12" r="1" /><circle cx="14.5" cy="12" r="1" /><path d="M12 6V3M9 21h6" /></svg>
        <div className="brand-lg"><span className="logo">JV</span><div><b>WA Inbox</b><span>JVTO</span></div></div>
        <div>
          <h2>Semua percakapan tamu, di satu layar.</h2>
          <p>Inbox WhatsApp dan chatbot Java Volcano Tour Operator: balas tamu, lihat bookingnya, dan periksa apa yang dijawab bot.</p>
        </div>
        <span className="lg-foot">Alat internal JVTO</span>
      </div>

      <div className="lg-side">
        <form onSubmit={onSubmit} className="card lg-card">
          <div className="brand-lg lg-mbrand"><span className="logo">JV</span><div><b>WA Inbox</b><span>JVTO</span></div></div>
          <h1>Masuk</h1>
          <p className="sub">Belum punya akses? Minta admin membuatkan akun di Pengaturan.</p>

          <label className="f" htmlFor="email">
            Email
            <input id="email" className="in" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="f" htmlFor="password">
            Kata sandi
            <input id="password" className="in" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          {/* role="alert" supaya pembaca layar mengumumkan kegagalan masuk. */}
          {error && <p role="alert" className="lg-err">{error}</p>}

          <button type="submit" className="btn pri lg-btn" disabled={loading}>
            {loading ? 'Masuk...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  )
}
