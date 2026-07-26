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
})
