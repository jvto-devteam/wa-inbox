import { notFound } from 'next/navigation'

/**
 * Gerbang untuk seluruh /dev/*.
 *
 * Halaman di bawah sini adalah alat kerja internal (mis. /dev/design-system, tempat menilai
 * fondasi tampilan) dan sengaja TIDAK dilindungi login -- karena itu ia tidak boleh ada sama
 * sekali di produksi. Gerbangnya di layout, bukan di masing-masing halaman, supaya halaman
 * /dev berikutnya ikut tergerbang tanpa harus ingat menambahkannya.
 *
 * notFound() dipakai, bukan redirect: di produksi rute ini harus terlihat seperti memang
 * tidak pernah ada.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <>{children}</>
}
