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
