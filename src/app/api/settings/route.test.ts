import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { SAFETY_BOUNDS } from '@/lib/outbound/safety-bounds'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { GET, PATCH } from './route'

// `vi.mock` factories are hoisted above regular imports and `let`/`const`
// declarations, so the mock instance must be constructed inline inside the
// factory rather than via an outer variable — otherwise the factory throws
// "Cannot access ... before initialization".
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const adminCookie = { cookie: 'wa_inbox_session=tok' }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
})

describe('GET /api/settings', () => {
  it('returns the singleton settings row', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      defaultChannel: 'OFFICIAL',
      workingHoursStart: null,
      workingHoursEnd: null,
      offHoursAutoReply: null,
      botAutoReplyAll: true,
      catalogSyncedAt: null,
    } as never)

    const res = await GET()

    expect((await res.json()).defaultChannel).toBe('OFFICIAL')
  })
})

describe('PATCH /api/settings', () => {
  it('updates defaultChannel when called by an admin', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, defaultChannel: 'UNOFFICIAL' } as never)

    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect((await res.json()).defaultChannel).toBe('UNOFFICIAL')
  })

  it('updates ollamaModel when called by an admin', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, ollamaModel: 'mistral' } as never)

    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ ollamaModel: 'mistral' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { ollamaModel: 'mistral' },
    })
  })

  it('rejects invalid payloads', async () => {
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ defaultChannel: 'NOT_A_CHANNEL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  /**
   * The working-hours window now decides whether an out-of-hours handoff carries
   * `offHoursAutoReply` (see offHoursHandoffNotice in src/lib/bot/runtime-integration.ts). The
   * runtime ignores a window it cannot parse, so junk stored here would silently disable the
   * feature -- the "the box is filled in but nothing happens" failure these columns were fixed
   * to stop. Rejecting it at the door is the only place an operator finds out.
   */
  it('menolak jam kerja yang bukan HH:MM', async () => {
    for (const bad of [{ workingHoursStart: 'pagi' }, { workingHoursEnd: '25:00' }, { workingHoursEnd: '9:00' }]) {
      const res = await PATCH(new Request('http://localhost/api/settings', {
        method: 'PATCH',
        headers: adminCookie,
        body: JSON.stringify(bad),
      }))
      expect(res.status).toBe(400)
    }
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menyimpan jam kerja kosong sebagai NULL, sehingga fitur mati alih-alih menyimpan string kosong', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)

    const res = await PATCH(new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ workingHoursStart: '', workingHoursEnd: '17:00', offHoursAutoReply: '   ' }),
    }))

    expect(res.status).toBe(200)
    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { workingHoursStart: null, workingHoursEnd: '17:00', offHoursAutoReply: null },
    })
  })

  it('rejects when the caller is not an admin', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      headers: adminCookie,
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const req = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})

/**
 * The outbound safety thresholds, and the floors that used to be enforced somewhere else.
 *
 * These four numbers moved here from a channel-policy row whose draft → review → approve →
 * publish cycle validated them on the way in. That cycle is gone: they are ordinary columns now,
 * saved straight from the Pengaturan form, which makes THIS route the only thing standing
 * between a typo and a WhatsApp number that gets blocked.
 *
 * A floor is not a nicety here. Zero on `campaignRatePerMinute` does not loosen the limit, it
 * disables the gate; a duplicate window of 0 ms disables duplicate detection. Both are behaviour
 * changes dressed as settings.
 */
describe('PATCH /api/settings — ambang pengaman outbound', () => {
  function patch(body: unknown) {
    return PATCH(
      new Request('http://localhost/api/settings', {
        method: 'PATCH',
        headers: adminCookie,
        body: JSON.stringify(body),
      })
    )
  }

  it('menyimpan angka yang berada di dalam batas', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, campaignRatePerMinute: 40 } as never)

    const res = await patch({ campaignRatePerMinute: 40 })

    expect(res.status).toBe(200)
    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { campaignRatePerMinute: 40 },
    })
  })

  it('menolak nol pada batas campaign — itu mematikan gerbangnya, bukan melonggarkannya', async () => {
    const res = await patch({ campaignRatePerMinute: 0 })

    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menolak jendela duplikat di bawah lantainya', async () => {
    // Below a second, "identical message just sent" stops being detectable and the check
    // becomes decorative.
    expect((await patch({ duplicateWindowMs: SAFETY_BOUNDS.duplicateWindowMs.min - 1 })).status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menerima nilai tepat di lantai dan di langit-langit', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)

    expect((await patch({ duplicateWindowMs: SAFETY_BOUNDS.duplicateWindowMs.min })).status).toBe(200)
    expect((await patch({ campaignRatePerMinute: SAFETY_BOUNDS.campaignRatePerMinute.max })).status).toBe(200)
  })

  it('menolak setiap ambang yang melewati langit-langitnya', async () => {
    for (const [field, bounds] of Object.entries(SAFETY_BOUNDS)) {
      const res = await patch({ [field]: bounds.max + 1 })
      expect(res.status, field).toBe(400)
    }
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menolak ambang pecahan, karena kolomnya bilangan bulat', async () => {
    expect((await patch({ providerFailureThreshold: 2.5 })).status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('TIDAK PERNAH menulis pausedProviders, berapa pun yang dikirim pemanggil', async () => {
    // The one thing this route must not be able to touch. A provider pause is an emergency
    // action set during an incident; an operator saving an unrelated setting — or anyone POSTing
    // this endpoint by hand — must not be able to lift it. Zod strips the unknown key, so the
    // request succeeds and the field simply never reaches the update.
    mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)

    const res = await patch({ campaignRatePerMinute: 25, pausedProviders: [] })

    expect(res.status).toBe(200)
    expect(mockPrisma.settings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { campaignRatePerMinute: 25 },
    })
  })

  it('mencatat SIAPA yang mengubah pengaman outbound, dengan nama field saja', async () => {
    // Loosening `duplicateWindowMs` does not soften the duplicate check, it turns it off — and
    // the number itself is always visible on the page, so the row only needs to say who touched
    // which knob and when.
    mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)

    await patch({ duplicateWindowMs: SAFETY_BOUNDS.duplicateWindowMs.min, campaignRatePerMinute: 25 })

    expect(writeBotAuditLog).toHaveBeenCalledTimes(1)
    expect(writeBotAuditLog).toHaveBeenCalledWith({
      action: 'UPDATE',
      entityType: 'BOT_SETTING',
      entityKey: 'campaignRatePerMinute, duplicateWindowMs',
      actorId: 'acc_admin',
      actorName: 'Admin Satu',
    })
  })

  it('TIDAK PERNAH menyimpan nilai yang dikirim, hanya nama fieldnya', async () => {
    // A value is where a pasted token would ride into the history table. The names come from
    // the Zod schema, so nothing free-form can reach this row at all.
    mockPrisma.settings.update.mockResolvedValue({ id: 1 } as never)

    await patch({ ollamaModel: 'llama3', fallbackReply: 'token rahasia sk-abcdefghijklmnop1234' })

    const written = JSON.stringify(vi.mocked(writeBotAuditLog).mock.calls[0][0])
    expect(written).not.toContain('llama3')
    expect(written).not.toContain('sk-abcdefghijklmnop1234')
    expect(written).toContain('fallbackReply, ollamaModel')
  })

  it('tidak mencatat apa pun saat PATCH ditolak', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })

    expect((await patch({ campaignRatePerMinute: 25 })).status).toBe(403)
    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })
})
