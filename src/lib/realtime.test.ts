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
})
