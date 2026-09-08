import { Avatar } from '@/components/ui/avatar'

// Real photo when Contact.avatarUrl is populated (see enrichContactAvatar in
// src/lib/inbound.ts, which best-effort fetches it from wa-coexist), else a colored initial
// circle -- the same fallback WhatsApp/Meta Business Suite itself shows for a contact with no
// retrievable photo.
//
// Sejak Tahap 1A ini hanya pembungkus tipis di atas <Avatar> supaya logika inisial dan warna
// hidup di satu tempat. Kontraknya tidak berubah: `size` tetap string kelas Tailwind, dan
// inisialnya tetap SATU huruf -- nama kontak WhatsApp sering satu untai tak terstruktur, jadi
// huruf kedua lebih sering jadi sampah daripada informasi (beda dengan Account.name di AppNav,
// yang diketik admin dan pantas dapat dua huruf).
export function ContactAvatar({
  name,
  avatarUrl,
  size = 'size-10',
}: {
  name: string | null
  avatarUrl: string | null
  size?: string
}) {
  return (
    <Avatar name={name} src={avatarUrl} alt={name ?? 'Kontak'} maxInitials={1} className={size} />
  )
}
