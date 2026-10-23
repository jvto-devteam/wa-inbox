import { describe, expect, it } from 'vitest'
import { agentUpdateFromEvent } from './state'

const at = '2026-10-23T01:00:00.000Z'

describe('agentUpdateFromEvent', () => {
  it('ai.activity: mulai = bekerja, selesai = selesai di meja atau mengantar (deliver), gagal = error', () => {
    expect(agentUpdateFromEvent({ type: 'ai.activity', agent: 'ringkasan', state: 'mulai', label: 'Meringkas', conversationId: 'c1', at })?.live.mode).toBe('working')
    expect(agentUpdateFromEvent({ type: 'ai.activity', agent: 'topik', state: 'selesai', label: 'Label: price', conversationId: 'c1', at })?.live.mode).toBe('done')
    expect(agentUpdateFromEvent({ type: 'ai.activity', agent: 'booking', state: 'selesai', label: 'Memproses 1 permintaan', conversationId: 'c1', at, deliver: true })).toEqual({
      agent: 'booking',
      live: { mode: 'handoff', label: 'Memproses 1 permintaan', conversationId: 'c1', at },
    })
    expect(agentUpdateFromEvent({ type: 'ai.activity', agent: 'booking', state: 'gagal', label: 'Gagal', conversationId: 'c1', at })?.live.mode).toBe('error')
  })

  it('pipeline.step (bot): label langkah dari steps.ts, kirim = selesai, serahkan = mengantar ke admin, berhenti = tidak perlu dibalas', () => {
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'susun-balasan', status: 'mulai', at })).toEqual({
      agent: 'bot',
      live: { mode: 'working', label: 'Susun balasan dari knowledge', conversationId: 'c1', at },
    })
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'llm-composition', status: 'mulai', at })?.live.label).toBe('Susun balasan dari knowledge')
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'kirim-balasan', status: 'selesai', at })?.live).toMatchObject({ mode: 'done', label: 'Balasan terkirim ke tamu' })
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'serahkan-agen', status: 'mulai', at })?.live.mode).toBe('handoff')
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'gerbang-bot', status: 'berhenti', at })?.live).toMatchObject({ mode: 'done', label: 'Tidak perlu dibalas bot' })
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'susun-balasan', status: 'gagal', at })?.live.mode).toBe('error')
  })

  it('langkah ekstraksi booking di jalur samping diabaikan (sudah dilaporkan lewat ai.activity)', () => {
    expect(agentUpdateFromEvent({ type: 'pipeline.step', conversationId: 'c1', stepId: 'ekstrak-booking', status: 'mulai', at })).toBeNull()
  })
})
