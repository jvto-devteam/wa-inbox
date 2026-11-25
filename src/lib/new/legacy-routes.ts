// Peta halaman lama -> halaman /new (owner 2026-11-26: "tidak ada link mengarah ke page lama"). Dipakai pembungkus
// LegacyFrame untuk tautan di DALAM komponen lama yang dipasang di /new, dan diuji bersama pemeriksa yang memastikan
// kode /new sendiri tidak menulis alamat halaman lama.
const MAP: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^\/inbox\/?$/, () => '/new/inbox'],
  [/^\/contacts\/([^/]+)\/?$/, (m) => '/new/kontak/' + m[1]],
  [/^\/contacts\/?$/, () => '/new/kontak'],
  [/^\/summary\/?$/, () => '/new/antrean'],
  [/^\/dashboard\/?$/, () => '/new/dashboard'],
  [/^\/chatbot\/?$/, () => '/new/bot/pengaturan'],
  [/^\/bot-control\/knowledge\/?$/, () => '/new/bot/knowledge'],
  [/^\/settings\/knowledge-gaps\/?$/, () => '/new/bot/celah'],
  [/^\/bot-control\/decisions\/?$/, () => '/new/bot/keputusan'],
]

/** Halaman /new untuk alamat halaman lama (`pathname` tanpa query); null = tidak ada padanannya. */
export function newPathFor(pathname: string): string | null {
  for (const [re, to] of MAP) {
    const m = pathname.match(re)
    if (m) return to(m)
  }
  return null
}

/** Pola alamat halaman lama yang dipetakan (untuk pemeriksa di test). */
export const LEGACY_PATTERNS: readonly RegExp[] = MAP.map(([re]) => re)
