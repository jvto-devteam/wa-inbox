/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./send', async (orig) => ({ ...(await orig<typeof import('./send')>()), sendPushToAll: vi.fn().mockResolvedValue(undefined) }))

import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import { sendPushToAll } from './send'
import { buildProblemPayload, notifyNewProblems, problemsOf } from './problems'

const base: ConversationReview = {
  status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'tamu_existing', topik: 't', pertanyaan: [], poinPenting: [], janjiTim: [], profil: [], statusAgen: '', langkahBerikut: '',
}
const withLabels = (...labels: [ConversationReview['profil'][number]['label'], string][]) => ({ ...base, profil: labels.map(([label, messageId]) => ({ label, messageId })) })
const payloads = () => vi.mocked(sendPushToAll).mock.calls.map((c) => c[0])

beforeEach(() => vi.mocked(sendPushToAll).mockClear())

describe('problemsOf', () => {
  it('hanya lima label masalah (owner 2026-11-27), urut prioritas', () => {
    const r = withLabels(['sensitif_harga', 'm0'], ['kendala_bayar', 'm1'], ['komplain', 'm2'], ['keselamatan', 'm3'], ['mendesak', 'm4'], ['refund_batal', 'm5'], ['belum_pasti', 'm6'])
    expect(problemsOf(r).map((p) => p.label)).toEqual(['keselamatan', 'komplain', 'mendesak', 'refund_batal', 'kendala_bayar'])
  })
})

describe('notifyNewProblems', () => {
  it('ringkasan pertama dengan komplain = satu push; isi tanpa teks pesan, ketuk membuka pesan bukti', async () => {
    expect(await notifyNewProblems('c1', null, withLabels(['komplain', 'm9']), 'Sophie')).toBe(1)
    expect(payloads()).toEqual([{ title: 'Ada komplain: Sophie', body: 'Ringkasan AI menandai masalah di chat ini — ketuk untuk melihat', url: '/inbox?conversation=c1&message=m9', tag: 'problem:c1:komplain' }])
  })

  it('label yang sudah ada di ringkasan sebelumnya tidak dikabarkan lagi, walau buktinya bergeser', async () => {
    expect(await notifyNewProblems('c1', withLabels(['komplain', 'm1']), withLabels(['komplain', 'm2'], ['mendesak', 'm3']), 'Sophie')).toBe(1)
    expect(payloads().map((p) => p.tag)).toEqual(['problem:c1:mendesak'])
  })

  it('label non-masalah tidak memicu; ringkasan lama berbentuk aneh dianggap tanpa label', async () => {
    expect(await notifyNewProblems('c1', 'rusak', withLabels(['sensitif_harga', 'm1']), null)).toBe(0)
    expect(await notifyNewProblems('c1', { profil: 'x' }, withLabels(['keselamatan', 'm1']), null)).toBe(1)
    expect(payloads()[0].title).toBe('Insiden keselamatan: Pelanggan')
  })

  it('nama berupa nomor HP disaring', () => {
    expect(buildProblemPayload({ conversationId: 'c1', label: 'komplain', messageId: 'm1', contactName: '081234567890' }).title).not.toMatch(/0812/)
  })
})
