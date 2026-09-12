import { describe, it, expect, vi } from 'vitest'
import { broadcast, subscribe } from './realtime'

describe('realtime pub/sub', () => {
  it('delivers a broadcast event to a subscribed listener', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'message.created', conversationId: 'conv_1', message: { id: 'm1' } })
    expect(listener).toHaveBeenCalledWith({ type: 'message.created', conversationId: 'conv_1', message: { id: 'm1' } })
    unsubscribe()
  })

  it('stops delivering events after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    unsubscribe()
    broadcast({ type: 'message.created', conversationId: 'conv_1', message: { id: 'm2' } })
    expect(listener).not.toHaveBeenCalled()
  })

  it('delivers a message.updated event distinctly from message.created', () => {
    // Meta delivery receipts (sent/delivered/read/failed) mutate an existing message row
    // long after it was created; subscribers must be able to tell "replace this bubble"
    // from "append a new one".
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    const message = { id: 'm1', deliveryStatus: 'DELIVERED' }
    broadcast({ type: 'message.updated', conversationId: 'conv_1', message })
    expect(listener).toHaveBeenCalledWith({ type: 'message.updated', conversationId: 'conv_1', message })
    unsubscribe()
  })

  it('delivers a handoff.alert event distinctly from message.created', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    expect(listener).toHaveBeenCalledWith({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    unsubscribe()
  })

  it('mengirim knowledge.gap tanpa isi pesan apa pun', () => {
    // Lencana lonceng hanya perlu tahu ADA gap baru; daftarnya diambil ulang dari
    // /api/inbox/gaps. Membawa kalimat pelanggan ke setiap tab terbuka tidak diperlukan.
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'knowledge.gap', conversationId: 'conv_1' })
    expect(listener).toHaveBeenCalledWith({ type: 'knowledge.gap', conversationId: 'conv_1' })
    unsubscribe()
  })
})

describe('isolasi listener saat broadcast', () => {
  it('tetap mengirim ke listener berikutnya walau satu listener melempar', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const diterima: string[] = []
    const lepas1 = subscribe(() => {
      throw new Error('controller sudah ditutup')
    })
    const lepas2 = subscribe((event) => diterima.push(event.type))

    broadcast({ type: 'handoff.alert', conversationId: 'conv_1', contactName: null })

    // Tanpa isolasi, listener kedua tidak pernah dipanggil sama sekali.
    expect(diterima).toEqual(['handoff.alert'])
    expect(spy).toHaveBeenCalled()
    lepas1()
    lepas2()
    spy.mockRestore()
  })

  it('tidak melempar ke pemanggil walau SEMUA listener melempar', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const lepas = subscribe(() => {
      throw new Error('rusak')
    })

    // Pemanggilnya adalah jalur pesan pelanggan; ia tidak boleh ikut mati.
    expect(() =>
      broadcast({ type: 'conversation.cleared', conversationId: 'conv_1' }),
    ).not.toThrow()

    lepas()
    spy.mockRestore()
  })
})
