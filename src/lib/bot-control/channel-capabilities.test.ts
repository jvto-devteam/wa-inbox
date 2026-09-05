/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  CHANNEL_CAPABILITIES,
  capabilityOf,
  supportsCapability,
  officialOnlyCapabilities,
  channelForCapability,
} from './channel-capabilities'

describe('CHANNEL_CAPABILITIES', () => {
  it('matches what wa-coexist can actually do', () => {
    // src/lib/coexist/client.ts exposes send_message and send_file_url and nothing else.
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.send_text).toBe(true)
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.send_media).toBe(true)
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.send_template).toBe(false)
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.send_buttons).toBe(false)
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.send_list).toBe(false)
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.send_carousel).toBe(false)
  })

  it('records that Unofficial can never receive a webhook', () => {
    // Every inbound message arrives through Meta. This is the channel policy's first rule.
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.receive_webhook).toBe(false)
    expect(CHANNEL_CAPABILITIES.OFFICIAL.receive_webhook).toBe(true)
  })

  it('records that Unofficial reports no delivery or read status', () => {
    // sendCoexistText/Media return `{}` -- there is no provider id to correlate against.
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.delivery_status).toBe(false)
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.read_receipt).toBe(false)
  })

  it('marks Unofficial campaigns LIMITED rather than allowed or forbidden', () => {
    // A plain `true` would read as "go ahead" on the channel most likely to get banned for it.
    expect(CHANNEL_CAPABILITIES.UNOFFICIAL.campaign).toBe('LIMITED')
  })
})

describe('supportsCapability', () => {
  it('treats LIMITED as not supported without a guard', () => {
    expect(supportsCapability('UNOFFICIAL', 'campaign')).toBe(false)
    expect(capabilityOf('UNOFFICIAL', 'campaign')).toBe('LIMITED')
  })

  it('reports plain support correctly', () => {
    expect(supportsCapability('UNOFFICIAL', 'send_text')).toBe(true)
    expect(supportsCapability('UNOFFICIAL', 'send_template')).toBe(false)
    expect(supportsCapability('OFFICIAL', 'send_template')).toBe(true)
  })
})

describe('officialOnlyCapabilities', () => {
  it('lists exactly the capabilities Unofficial cannot do', () => {
    expect(officialOnlyCapabilities().sort()).toEqual(
      ['campaign', 'delivery_status', 'read_receipt', 'receive_webhook', 'send_buttons', 'send_carousel', 'send_list', 'send_template'].sort()
    )
  })

  it('never lists a capability both channels support', () => {
    expect(officialOnlyCapabilities()).not.toContain('send_text')
    expect(officialOnlyCapabilities()).not.toContain('send_media')
  })
})

describe('channelForCapability', () => {
  it('keeps ordinary sends on Unofficial — the default outbound channel', () => {
    expect(channelForCapability('send_text')).toBe('UNOFFICIAL')
    expect(channelForCapability('send_media')).toBe('UNOFFICIAL')
    expect(channelForCapability('send_audio')).toBe('UNOFFICIAL')
  })

  it('routes an official-only capability to Official, and only that capability', () => {
    expect(channelForCapability('send_template')).toBe('OFFICIAL')
    expect(channelForCapability('send_carousel')).toBe('OFFICIAL')
  })
})
