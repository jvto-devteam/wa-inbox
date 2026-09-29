import type { Platform } from '@prisma/client'
import { fetchMessengerProfileLink } from '@/lib/meta/messenger-profile'
import { PLATFORM_LABEL } from './platform'

/**
 * Info kontak per platform untuk panel kanan Inbox: apa yang ditampilkan (nomor, alamat,
 * @username, nama) dan ke mana ia menaut di platform asalnya.
 *
 * Tautan hanya dibentuk dari nilai yang lolos validasi -- username IG dari pola resmi IG, path
 * FB hanya path relatif satu garis miring. Nilai dari API pihak ketiga yang dirangkai langsung
 * ke href adalah celah open-redirect (`//evil.com`) atau path traversal yang menunggu terjadi.
 */
export type ChannelContact = {
  platform: Platform
  platformLabel: string
  value: string
  /** Null = tidak ada tautan yang bisa dibuat (mis. username IG belum diketahui). */
  href: string | null
  linkLabel: string | null
}

export type ChannelIdentityInput = {
  platform: Platform
  externalId: string
  displayName: string | null
}

const IG_USERNAME = /^[A-Za-z0-9._]{1,30}$/
const FB_RELATIVE_PATH = /^\/(?!\/)[^\s]*$/

export function buildChannelContact(
  input: ChannelIdentityInput & { igUsername?: string | null; fbThreadPath?: string | null },
): ChannelContact {
  const base = { platform: input.platform, platformLabel: PLATFORM_LABEL[input.platform] }

  switch (input.platform) {
    case 'WHATSAPP': {
      const digits = input.externalId.replace(/\D/g, '')
      return { ...base, value: `+${digits}`, href: `https://wa.me/${digits}`, linkLabel: 'Chat di WhatsApp' }
    }
    case 'EMAIL':
      return { ...base, value: input.externalId, href: `mailto:${input.externalId}`, linkLabel: 'Kirim email' }
    case 'INSTAGRAM': {
      const username = input.igUsername && IG_USERNAME.test(input.igUsername) ? input.igUsername : null
      if (!username) return { ...base, value: input.displayName ?? 'Pengguna Instagram', href: null, linkLabel: null }
      return {
        ...base,
        value: `@${username}`,
        href: `https://www.instagram.com/${username}/`,
        linkLabel: 'Buka profil Instagram',
      }
    }
    case 'FACEBOOK': {
      // Profil orangnya tidak bisa ditautkan: Meta tidak membuka profil dari PSID. Yang ada hanya
      // percakapannya di inbox Page (lihat fetchMessengerProfileLink).
      const path = input.fbThreadPath && FB_RELATIVE_PATH.test(input.fbThreadPath) ? input.fbThreadPath : null
      return {
        ...base,
        value: input.displayName ?? 'Pengguna Facebook',
        href: path ? `https://www.facebook.com${path}` : null,
        linkLabel: path ? 'Buka percakapan di Facebook' : null,
      }
    }
  }
}

/**
 * Cache di memori proses: panel dibuka berkali-kali untuk percakapan yang sama, dan username IG
 * atau link thread FB jarang berubah. Hasil kosong (Graph gagal/lambat) disimpan lebih singkat
 * supaya tautan muncul sendiri begitu Graph pulih, tanpa menunggu 6 jam.
 */
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000
const EMPTY_TTL_MS = 10 * 60 * 1000
const linkCache = new Map<string, { expiresAt: number; igUsername: string | null; fbThreadPath: string | null }>()

export async function resolveChannelContact(identity: ChannelIdentityInput, nowMs: number = Date.now()): Promise<ChannelContact> {
  if (identity.platform !== 'INSTAGRAM' && identity.platform !== 'FACEBOOK') return buildChannelContact(identity)

  const key = `${identity.platform}:${identity.externalId}`
  let cached = linkCache.get(key)
  if (!cached || cached.expiresAt <= nowMs) {
    const found = await fetchMessengerProfileLink(identity.externalId, identity.platform)
    const empty = found.igUsername === null && found.fbThreadPath === null
    cached = { ...found, expiresAt: nowMs + (empty ? EMPTY_TTL_MS : SUCCESS_TTL_MS) }
    linkCache.set(key, cached)
  }
  return buildChannelContact({ ...identity, igUsername: cached.igUsername, fbThreadPath: cached.fbThreadPath })
}

export function __resetChannelContactCacheForTests(): void {
  linkCache.clear()
}
