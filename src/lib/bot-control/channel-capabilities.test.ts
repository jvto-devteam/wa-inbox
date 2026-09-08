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
  CHANNEL_CAPABILITY_KEYS,
  preferredChannelForCapability,
  type ChannelCapability,
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

/**
 * The nine keys a send path may route, and the channel each one lands on.
 *
 * These used to be an editable per-capability table on the Channel Policy page — a form whose
 * default row said exactly what the matrix above says, and whose only other possible use was to
 * contradict a provider's API. The form is gone and the matrix answers directly, so these tests
 * are what stands between "the editable layer was removed" and "messages started going out over
 * a different channel".
 */
describe('CHANNEL_CAPABILITY_KEYS', () => {
  it('names only capabilities the matrix actually describes', () => {
    const known = new Set(Object.keys(CHANNEL_CAPABILITIES.OFFICIAL))
    for (const key of CHANNEL_CAPABILITY_KEYS) expect(known.has(key), key).toBe(true)
  })

  it('leaves out the capabilities a caller cannot dispatch', () => {
    // receive_webhook/delivery_status/read_receipt describe what a channel does to us. Routing
    // them would be meaningless, and offering them would imply a send path that does not exist.
    const keys: readonly string[] = CHANNEL_CAPABILITY_KEYS
    expect(keys).not.toContain('receive_webhook')
    expect(keys).not.toContain('delivery_status')
    expect(keys).not.toContain('read_receipt')
  })
})

describe('preferredChannelForCapability', () => {
  it('counts LIMITED as capable, which is the only place it differs from channelForCapability', () => {
    // The whole reason this function exists. `supportsCapability` answers false for a LIMITED
    // capability, so `channelForCapability` promotes campaign to Official; the published policy
    // row said UNOFFICIAL_LIMITED, which resolved to Unofficial. Keeping both answers separate
    // is what let the editable layer be removed without moving any traffic.
    expect(preferredChannelForCapability('campaign')).toBe('UNOFFICIAL')
    expect(channelForCapability('campaign')).toBe('OFFICIAL')
  })

  it('keeps ordinary sends on Unofficial and official-only features on Official', () => {
    expect(preferredChannelForCapability('send_text')).toBe('UNOFFICIAL')
    expect(preferredChannelForCapability('send_media')).toBe('UNOFFICIAL')
    expect(preferredChannelForCapability('send_document')).toBe('UNOFFICIAL')
    expect(preferredChannelForCapability('send_audio')).toBe('UNOFFICIAL')
    expect(preferredChannelForCapability('send_template')).toBe('OFFICIAL')
    expect(preferredChannelForCapability('send_buttons')).toBe('OFFICIAL')
    expect(preferredChannelForCapability('send_list')).toBe('OFFICIAL')
    expect(preferredChannelForCapability('send_carousel')).toBe('OFFICIAL')
  })

  it('has no capability that both channels refuse, so it never returns null today', () => {
    // Null is the "cannot be sent at all" answer `isCapabilityDisabled` reads. Under the old
    // policy row that state was reachable by an operator picking DISABLED in a dropdown; nothing
    // else ever produced it, and production never did. Pinned so the day a capability arrives
    // that Official cannot carry either, this test is what says the refusal branch went live.
    for (const capability of Object.keys(CHANNEL_CAPABILITIES.OFFICIAL) as ChannelCapability[]) {
      expect(preferredChannelForCapability(capability), capability).not.toBeNull()
    }
  })
})
