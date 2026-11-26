// Peta alamat halaman LAMA yang sudah digantikan halaman baru (owner 2026-11-26: aplikasi baru menggantikan yang lama di
// root). Satu sumber untuk dua hal: pengalihan permanen di next.config.ts (bookmark, tautan di notifikasi/pesan lama) dan
// LegacyFrame (tautan di DALAM komponen lama yang dipasang di aplikasi baru). /dashboard dan /inbox tidak ada di sini:
// alamatnya sama, isinya yang baru. Halaman lama tanpa padanan (/templates, /settings, /bot-control, /ai-office) tetap
// di alamatnya.
const MAP: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^\/contacts\/([^/]+)\/?$/, (m) => '/kontak/' + m[1]],
  [/^\/contacts\/?$/, () => '/kontak'],
  [/^\/summary\/?$/, () => '/antrean'],
  [/^\/chatbot\/?$/, () => '/bot/pengaturan'],
  [/^\/bot-control\/knowledge\/?$/, () => '/bot/knowledge'],
  [/^\/settings\/knowledge-gaps\/?$/, () => '/bot/celah'],
  [/^\/bot-control\/decisions\/?$/, () => '/bot/keputusan'],
  // pratinjau lama /new/* -> root
  [/^\/new\/?$/, () => '/dashboard'],
  [/^\/new(\/.+)$/, (m) => m[1]],
]

/** Alamat baru untuk alamat halaman lama (`pathname` tanpa query); null = bukan alamat lama. */
export function newPathFor(pathname: string): string | null {
  for (const [re, to] of MAP) {
    const m = pathname.match(re)
    if (m) return to(m)
  }
  return null
}

/** Pengalihan untuk next.config.ts (sementara/307 supaya peramban tidak menyimpannya selamanya; query ikut terbawa). */
export const LEGACY_REDIRECTS: { source: string; destination: string; permanent: false }[] = [
  { source: '/contacts/:id', destination: '/kontak/:id', permanent: false },
  { source: '/contacts', destination: '/kontak', permanent: false },
  { source: '/summary', destination: '/antrean', permanent: false },
  { source: '/chatbot', destination: '/bot/pengaturan', permanent: false },
  { source: '/bot-control/knowledge', destination: '/bot/knowledge', permanent: false },
  { source: '/settings/knowledge-gaps', destination: '/bot/celah', permanent: false },
  { source: '/bot-control/decisions', destination: '/bot/keputusan', permanent: false },
  { source: '/new', destination: '/dashboard', permanent: false },
  { source: '/new/:path*', destination: '/:path*', permanent: false },
]
