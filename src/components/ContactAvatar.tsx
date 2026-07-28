// Real photo when Contact.avatarUrl is populated (see enrichContactAvatar in
// src/lib/inbound.ts, which best-effort fetches it from wa-coexist), else a colored initial
// circle -- the same fallback WhatsApp/Meta Business Suite itself shows for a contact with no
// retrievable photo. next/image needs a known remote domain allowlisted ahead of time, which
// doesn't fit a per-contact runtime URL, so this is a plain <img>.
export function ContactAvatar({
  name,
  avatarUrl,
  size = 'size-10',
}: {
  name: string | null
  avatarUrl: string | null
  size?: string
}) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name ?? 'Kontak'} className={`${size} shrink-0 rounded-full object-cover`} />
    )
  }
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-navy text-sm font-medium text-white`}>
      {initial}
    </div>
  )
}
