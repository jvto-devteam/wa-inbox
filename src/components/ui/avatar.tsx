import { cn } from '@/lib/utils'

/**
 * Avatar generik: foto kalau ada, kalau tidak inisial di atas warna yang ditentukan oleh
 * nama. Warna deterministik supaya orang yang sama selalu berwarna sama di daftar
 * percakapan, di panel kontak, dan di halaman kontak -- itu yang membuat daftar panjang
 * bisa dipindai tanpa membaca.
 *
 * src/components/ContactAvatar.tsx adalah pembungkus tipis di atas ini (kontrak lamanya
 * dipertahankan). Jangan menduplikasi logika inisial/warna di tempat ketiga.
 */

// Delapan pasang tint/tinta yang tetap tenang: cukup berbeda untuk dibedakan sekilas, cukup
// pucat untuk tidak melawan aksen. Kelas ditulis literal (bukan dirangkai) supaya pemindai
// kelas Tailwind melihatnya.
const AVATAR_TONES = [
  'bg-[#E7EBF1] text-[#3E4C63]',
  'bg-[#E1E9F8] text-[#1E4B96]',
  'bg-[#DDEEEB] text-[#17614F]',
  'bg-[#E9E5F6] text-[#4B3A86]',
  'bg-[#F5EBD8] text-[#7A5410]',
  'bg-[#F7E4E4] text-[#8E3A38]',
  'bg-[#E2EFE0] text-[#37622F]',
  'bg-[#DEEBF1] text-[#1F5570]',
] as const

/**
 * Hash yang sengaja sederhana dan stabil: nama yang sama -> nada yang sama, selamanya, di
 * server maupun di klien. Tidak ada Math.random dan tidak ada id database di sini, karena
 * kontak yang sama bisa muncul sebelum punya id (mis. pratinjau kiriman baru).
 */
export function avatarToneFor(name: string | null): string {
  const key = (name ?? '').trim().toLowerCase()
  if (!key) return AVATAR_TONES[0]
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100000
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

/** "bruno figarola" -> "BF" (max 2), atau "B" kalau maxInitials 1. "" -> "?". */
export function initialsOf(name: string | null, maxInitials = 2): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, maxInitials)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

export function Avatar({
  name,
  src,
  alt,
  maxInitials = 2,
  className,
}: {
  name: string | null
  src?: string | null
  alt?: string
  maxInitials?: number
  className?: string
}) {
  if (src) {
    return (
      // next/image butuh domain remote yang di-allowlist di muka, dan itu tidak cocok untuk
      // URL foto per-kontak yang baru diketahui saat runtime.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? name ?? 'Avatar'}
        className={cn('size-8 shrink-0 rounded-full bg-surface-sunken object-cover', className)}
      />
    )
  }

  return (
    <div
      aria-hidden={alt === '' ? true : undefined}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium select-none',
        avatarToneFor(name),
        className
      )}
    >
      {initialsOf(name, maxInitials)}
    </div>
  )
}
