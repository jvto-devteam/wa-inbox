import { LegacyPage } from '@/components/new/LegacyPage'

// Halaman lama /settings (belum ada padanan baru) di dalam aplikasi baru: isi dan logikanya tetap, hanya kulitnya baru.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <LegacyPage>{children}</LegacyPage>
}
