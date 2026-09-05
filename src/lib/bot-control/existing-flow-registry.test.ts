/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  EXISTING_BOT_FLOW_KEY,
  EXISTING_FLOWS,
  WHATSAPP_EXISTING_BOT_FLOW,
  getExistingFlow,
  listExistingFlows,
} from './existing-flow-registry'

// The 28 nodes the guidebook (section 8) makes mandatory, in the order it lists them. Spelled
// out here rather than derived from the registry so the test can actually fail: a list built
// from the thing under test would agree with any registry, including an empty one.
const REQUIRED_NODE_IDS = [
  'meta-webhook-received',
  'signature-verified',
  'payload-normalized',
  'conversation-upserted',
  'default-bot-policy-checked',
  'burst-debounce',
  'fresh-bot-enabled-check',
  'rate-limit-check',
  'decide-and-respond',
  'escalation-keyword-check',
  'escalation-llm-check',
  'booking-lookup',
  'booking-context-reply',
  'deployment-gate',
  'sales-need-classification',
  'destination-match',
  'route-integrity-gate',
  'package-pool-narrowing',
  'topic-classification',
  'trip-preference-check',
  'knowledge-resolution',
  'llm-composition',
  'reply-verification',
  'outbound-policy-resolution',
  'unofficial-send',
  'official-template-send',
  'handoff-alert',
  'knowledge-gap-log',
]

const flow = WHATSAPP_EXISTING_BOT_FLOW
const nodeIds = new Set(flow.nodes.map((n) => n.id))

describe('whatsapp-existing-bot-v1 flow', () => {
  it('is registered under the mandated key', () => {
    expect(flow.key).toBe(EXISTING_BOT_FLOW_KEY)
    expect(EXISTING_BOT_FLOW_KEY).toBe('whatsapp-existing-bot-v1')
  })

  it('contains all 28 mandatory nodes, in the mandated order', () => {
    expect(flow.nodes).toHaveLength(28)
    expect(flow.nodes.map((n) => n.id)).toEqual(REQUIRED_NODE_IDS)
  })

  it('numbers steps 1..28 with no gaps or repeats', () => {
    expect(flow.nodes.map((n) => n.order)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1))
  })

  it('gives every node a name, description, source file and at least one possible output', () => {
    for (const node of flow.nodes) {
      expect(node.name, `${node.id} name`).not.toBe('')
      // A one-word "description" would satisfy a truthiness check while telling an operator
      // nothing, which is the exact failure this page exists to prevent.
      expect(node.description.length, `${node.id} description`).toBeGreaterThan(40)
      expect(node.sourceFile, `${node.id} sourceFile`).toMatch(/^src\/.+\.tsx?$/)
      expect(node.possibleOutputs.length, `${node.id} possibleOutputs`).toBeGreaterThan(0)
    }
  })

  it('points every node at a source file that really exists', () => {
    // The registry is hand-maintained documentation of live code, so its one systemic risk is
    // drift. A renamed or deleted module fails here instead of silently turning the Flow Map
    // into fiction.
    const repoRoot = path.resolve(__dirname, '../../..')
    for (const node of flow.nodes) {
      expect(existsSync(path.join(repoRoot, node.sourceFile)), `${node.id} -> ${node.sourceFile}`).toBe(true)
    }
  })

  it('has no duplicate node ids', () => {
    expect(nodeIds.size).toBe(flow.nodes.length)
  })

  it('only draws edges between nodes that exist', () => {
    for (const edge of flow.edges) {
      expect(nodeIds.has(edge.from), `edge from ${edge.from}`).toBe(true)
      expect(nodeIds.has(edge.to), `edge to ${edge.to}`).toBe(true)
    }
  })

  it('leaves no node unreachable from the webhook entry point', () => {
    // A node with no inbound edge renders in the list but is a dead end in the map — either a
    // missing edge or a step that no longer runs. Both are worth failing on.
    const withInbound = new Set(flow.edges.map((e) => e.to))
    const orphans = flow.nodes.filter((n) => n.id !== 'meta-webhook-received' && !withInbound.has(n.id))
    expect(orphans.map((n) => n.id)).toEqual([])
  })

  it('routes the reply through outbound policy before any send node', () => {
    // The channel policy is the flow's single most important claim: nothing reaches a send
    // step without passing the resolver that picks Unofficial by default.
    const sendNodes = ['unofficial-send', 'official-template-send']
    for (const sendNode of sendNodes) {
      const inbound = flow.edges.filter((e) => e.to === sendNode)
      expect(inbound.length, `${sendNode} inbound edges`).toBeGreaterThan(0)
      expect(inbound.every((e) => e.from === 'outbound-policy-resolution'), sendNode).toBe(true)
    }
  })
})

describe('listExistingFlows', () => {
  it('summarises each flow with its real node count', () => {
    expect(listExistingFlows()).toEqual([
      {
        key: 'whatsapp-existing-bot-v1',
        name: 'WhatsApp Existing Bot',
        version: 1,
        description: flow.description,
        nodesCount: 28,
        status: 'ACTIVE',
      },
    ])
  })

  it('covers every registered flow', () => {
    expect(listExistingFlows()).toHaveLength(EXISTING_FLOWS.length)
  })
})

describe('getExistingFlow', () => {
  it('returns the full definition for a known key', () => {
    expect(getExistingFlow('whatsapp-existing-bot-v1')?.nodes).toHaveLength(28)
  })

  it('returns null for an unknown key rather than throwing', () => {
    expect(getExistingFlow('does-not-exist')).toBeNull()
  })
})
