import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchMessengerProfileLink } from '@/lib/meta/messenger-profile'
import { buildChannelContact, resolveChannelContact, __resetChannelContactCacheForTests } from './contact-channel'

vi.mock('@/lib/meta/messenger-profile', () => ({ fetchMessengerProfileLink: vi.fn() }))

describe('buildChannelContact', () => {
  it('WhatsApp: nomor dengan + dan tautan wa.me', () => {
    expect(buildChannelContact({ platform: 'WHATSAPP', externalId: '6281234567890', displayName: null })).toEqual({
      platform: 'WHATSAPP', platformLabel: 'WhatsApp', value: '+6281234567890',
      href: 'https://wa.me/6281234567890', linkLabel: 'Chat di WhatsApp',
    })
  })

  it('Email: alamat dengan tautan mailto', () => {
    expect(buildChannelContact({ platform: 'EMAIL', externalId: 'sinta@example.com', displayName: 'Sinta' })).toMatchObject({
      platformLabel: 'Email', value: 'sinta@example.com', href: 'mailto:sinta@example.com', linkLabel: 'Kirim email',
    })
  })

  it('Instagram dengan username: @username dan tautan profil', () => {
    expect(buildChannelContact({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: 'Sinta', igUsername: 'sinta.jvto' })).toMatchObject({
      platformLabel: 'Instagram', value: '@sinta.jvto', href: 'https://www.instagram.com/sinta.jvto/', linkLabel: 'Buka profil Instagram',
    })
  })

  it('Instagram tanpa username: nama saja, tanpa tautan', () => {
    expect(buildChannelContact({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: 'Sinta', igUsername: null })).toMatchObject({
      value: 'Sinta', href: null, linkLabel: null,
    })
  })

  it('Instagram: username yang tidak sah tidak pernah jadi tautan', () => {
    expect(buildChannelContact({ platform: 'INSTAGRAM', externalId: 'x', displayName: null, igUsername: 'a/../../evil' }).href).toBeNull()
  })

  it('Facebook: nama dan tautan percakapan di inbox Page (profil PSID tidak bisa dibuka)', () => {
    expect(buildChannelContact({ platform: 'FACEBOOK', externalId: 'psid_1', displayName: 'David', fbThreadPath: '/123/inbox/456/?section=messages' })).toMatchObject({
      platformLabel: 'Facebook', value: 'David', href: 'https://www.facebook.com/123/inbox/456/?section=messages',
      linkLabel: 'Buka percakapan di Facebook',
    })
  })

  it('Facebook: path yang bukan path relatif (mis. //evil.com) tidak pernah jadi tautan', () => {
    expect(buildChannelContact({ platform: 'FACEBOOK', externalId: 'p', displayName: null, fbThreadPath: '//evil.com/x' }).href).toBeNull()
    expect(buildChannelContact({ platform: 'FACEBOOK', externalId: 'p', displayName: null, fbThreadPath: null })).toMatchObject({
      value: 'Pengguna Facebook', href: null,
    })
  })
})

describe('resolveChannelContact', () => {
  beforeEach(() => {
    __resetChannelContactCacheForTests()
    vi.mocked(fetchMessengerProfileLink).mockReset().mockResolvedValue({ igUsername: 'sinta.jvto', fbThreadPath: null })
  })

  it('WhatsApp dan Email tidak memanggil Graph API', async () => {
    await resolveChannelContact({ platform: 'WHATSAPP', externalId: '628123', displayName: null })
    await resolveChannelContact({ platform: 'EMAIL', externalId: 'a@b.com', displayName: null })
    expect(fetchMessengerProfileLink).not.toHaveBeenCalled()
  })

  it('Instagram mengambil username sekali lalu memakai cache', async () => {
    const first = await resolveChannelContact({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: 'Sinta' }, 0)
    const second = await resolveChannelContact({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: 'Sinta' }, 1000)
    expect(first.value).toBe('@sinta.jvto')
    expect(second.value).toBe('@sinta.jvto')
    expect(fetchMessengerProfileLink).toHaveBeenCalledTimes(1)
    expect(fetchMessengerProfileLink).toHaveBeenCalledWith('igsid_1', 'INSTAGRAM')
  })

  it('cache kedaluwarsa setelah 6 jam', async () => {
    await resolveChannelContact({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: null }, 0)
    await resolveChannelContact({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: null }, 6 * 60 * 60 * 1000 + 1)
    expect(fetchMessengerProfileLink).toHaveBeenCalledTimes(2)
  })

  it('pencarian yang gagal (tanpa hasil) dicoba lagi lebih cepat, setelah 10 menit', async () => {
    vi.mocked(fetchMessengerProfileLink).mockResolvedValue({ igUsername: null, fbThreadPath: null })
    await resolveChannelContact({ platform: 'FACEBOOK', externalId: 'psid_1', displayName: 'David' }, 0)
    await resolveChannelContact({ platform: 'FACEBOOK', externalId: 'psid_1', displayName: 'David' }, 5 * 60 * 1000)
    expect(fetchMessengerProfileLink).toHaveBeenCalledTimes(1)
    await resolveChannelContact({ platform: 'FACEBOOK', externalId: 'psid_1', displayName: 'David' }, 10 * 60 * 1000 + 1)
    expect(fetchMessengerProfileLink).toHaveBeenCalledTimes(2)
  })
})
