import { LegacyPage } from '@/components/new/LegacyPage'

// Halaman lama /ai-office (belum ada padanan baru) di dalam aplikasi baru: isi dan logikanya tetap, hanya kulitnya
// baru. Kantor 3D butuh tinggi layar penuh (legacy-full di new.css).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <LegacyPage className="legacy-full">{children}</LegacyPage>
}
