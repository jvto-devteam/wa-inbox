/**
 * What each WhatsApp channel can actually do.
 *
 * The matrix is not decoration: it is the thing that stops a feature from being dispatched down
 * a channel that will silently drop it. wa-coexist's WatZap-compatible API (src/lib/coexist/
 * client.ts) exposes exactly two send calls — `send_message` (text) and `send_file_url` (media,
 * with an optional caption). It has no template, button, list or carousel endpoint at all, and
 * it returns no message id, so there is nothing to correlate a delivery or read receipt against.
 * Every `false` below is that concrete limitation, not caution.
 *
 * `campaign: 'LIMITED'` for Unofficial is deliberately a third value rather than true/false.
 * Bulk sending over an unofficial channel is possible but is exactly what gets a number banned,
 * so it must be gated by the safety guard and throttled — a plain `true` would read as "go
 * ahead", and a plain `false` would be a lie about what the provider can technically do.
 */
export type ChannelCapability =
  | 'receive_webhook'
  | 'send_text'
  | 'send_media'
  | 'send_document'
  | 'send_audio'
  | 'send_template'
  | 'send_carousel'
  | 'send_buttons'
  | 'send_list'
  | 'delivery_status'
  | 'read_receipt'
  | 'campaign'

export type CapabilityValue = boolean | 'LIMITED'

export type OutboundChannel = 'OFFICIAL' | 'UNOFFICIAL'

export const CHANNEL_CAPABILITIES: Record<OutboundChannel, Record<ChannelCapability, CapabilityValue>> = {
  OFFICIAL: {
    receive_webhook: true,
    send_text: true,
    send_media: true,
    send_document: true,
    // Meta has no distinct audio message type on the Cloud API send path either, but it does
    // accept audio as its own media type -- unlike wa-coexist, which has to disguise it as a
    // document (see sendMessage's `type === 'audio' ? 'document'` mapping).
    send_audio: true,
    send_template: true,
    send_carousel: true,
    send_buttons: true,
    send_list: true,
    delivery_status: true,
    read_receipt: true,
    campaign: true,
  },
  UNOFFICIAL: {
    // wa-coexist never receives: every inbound message arrives through the Meta webhook.
    receive_webhook: false,
    send_text: true,
    send_media: true,
    send_document: true,
    // Rides send_file_url as a document; the local Message.type keeps it labelled 'audio' so
    // the bubble still renders a player. Capability-wise the file does arrive.
    send_audio: true,
    send_template: false,
    send_carousel: false,
    send_buttons: false,
    send_list: false,
    // sendCoexistText/Media return `{}` -- no provider message id, so no status correlation.
    delivery_status: false,
    read_receipt: false,
    campaign: 'LIMITED',
  },
}

/**
 * The capabilities a SEND path can ask to route.
 *
 * A subset of `ChannelCapability`: `receive_webhook`, `delivery_status` and `read_receipt`
 * describe what a channel does to us, not something a caller can dispatch, so routing them
 * would be meaningless. The list is pinned by channel-capabilities.test.ts against the matrix
 * above, so a key that no channel describes cannot be added here.
 *
 * These nine used to be an editable per-capability channel table in the channel policy row —
 * a form where an operator picked a channel per capability. The form is gone: which channel
 * can carry a template is a fact about wa-coexist's API, not an opinion, and the one shape it
 * could take that the matrix cannot ("route this to a channel that cannot carry it") was
 * corrected back by `resolveChannelForCapability` anyway.
 */
export const CHANNEL_CAPABILITY_KEYS = [
  'send_text',
  'send_media',
  'send_document',
  'send_audio',
  'send_template',
  'send_buttons',
  'send_list',
  'send_carousel',
  'campaign',
] as const

export type ChannelCapabilityKey = (typeof CHANNEL_CAPABILITY_KEYS)[number]

export function capabilityOf(channel: OutboundChannel, capability: ChannelCapability): CapabilityValue {
  return CHANNEL_CAPABILITIES[channel][capability]
}

/** True only for an unambiguous yes. 'LIMITED' is deliberately NOT supported without a guard. */
export function supportsCapability(channel: OutboundChannel, capability: ChannelCapability): boolean {
  return CHANNEL_CAPABILITIES[channel][capability] === true
}

/** Capabilities only Official can do — the badge list guidebook §15 asks the UI to show. */
export function officialOnlyCapabilities(): ChannelCapability[] {
  return (Object.keys(CHANNEL_CAPABILITIES.OFFICIAL) as ChannelCapability[]).filter(
    (capability) =>
      CHANNEL_CAPABILITIES.OFFICIAL[capability] === true && CHANNEL_CAPABILITIES.UNOFFICIAL[capability] !== true
  )
}

/**
 * Picks the channel that can actually carry a capability, keeping Unofficial the default.
 *
 * This is the rule CLAUDE.md §3 turns into code: Unofficial unless the feature genuinely cannot
 * go that way, in which case Official is used *for that feature only*. It never promotes an
 * ordinary text or media send to Official.
 */
export function channelForCapability(capability: ChannelCapability): OutboundChannel {
  return supportsCapability('UNOFFICIAL', capability) ? 'UNOFFICIAL' : 'OFFICIAL'
}

/**
 * Which channel SHOULD carry a capability, counting 'LIMITED' as capable.
 *
 * The difference from `channelForCapability` above is `campaign`, and it is the whole reason
 * this function exists rather than reusing that one. `campaign` is 'LIMITED' on Unofficial:
 * bulk sending over an unofficial number is possible but is exactly what gets the number
 * banned. `supportsCapability` deliberately answers false for it, so `channelForCapability`
 * would promote every campaign to Official — a different answer from the one this app has
 * actually been giving.
 *
 * This reproduces, from the matrix alone, the nine routing answers the default channel-policy
 * row gave before that table was removed:
 *
 *   send_text / send_media / send_document / send_audio -> UNOFFICIAL
 *   send_template / send_buttons / send_list / send_carousel -> OFFICIAL
 *   campaign -> UNOFFICIAL   (the row said UNOFFICIAL_LIMITED; "limited" is a rate concern
 *                             the safety guard applies, not a different channel)
 *
 * Returns null when NEITHER channel can carry it. That is not a routing answer, and every
 * caller is already committed to sending something — see `channelForCapabilityPolicy`. No
 * entry in the matrix is false on both channels today, so the branch is defensive: it exists
 * so that adding a capability nothing implements produces "do not send" rather than a
 * confident wrong channel.
 */
export function preferredChannelForCapability(capability: ChannelCapability): OutboundChannel | null {
  if (CHANNEL_CAPABILITIES.UNOFFICIAL[capability] !== false) return 'UNOFFICIAL'
  if (CHANNEL_CAPABILITIES.OFFICIAL[capability] !== false) return 'OFFICIAL'
  return null
}
