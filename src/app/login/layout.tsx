import { Figtree } from 'next/font/google'
import '../(app)/new.css'

// /login di luar grup (app) (tanpa sesi, tanpa NotificationListener), tetapi memakai huruf dan CSS desain yang sama
// dengan aplikasi supaya layar masuk senada (owner 2026-11-26).
const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={figtree.variable}>{children}</div>
}
