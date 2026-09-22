import { describe, it, expect } from 'vitest'
import {
  BOOKING_SHORT_VARIABLE,
  NEW_LINK,
  OLD_LINK,
  TARGET_KEYS,
  planSwitch,
  type TemplateRow,
} from './switch-booking-short-link'
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'
import { renderSystemTemplate, validateTemplateBody } from '@/lib/system-templates/render'

const slug = { name: 'booking_slug', required: true }
const row = (key: string, body: string, variables = [slug]): TemplateRow => ({ key, body, variables })

describe('planSwitch', () => {
  it('targets exactly the seeded templates that carry the portal link', () => {
    const withLink = SYSTEM_TEMPLATE_SEEDS.filter((seed) => seed.body.includes(OLD_LINK)).map((seed) => seed.key)
    expect([...TARGET_KEYS].sort()).toEqual(withLink.sort())
  })

  it('replaces the link and declares booking_short, producing a body that validates and renders', () => {
    const seeds = SYSTEM_TEMPLATE_SEEDS.filter((seed) => (TARGET_KEYS as readonly string[]).includes(seed.key))
    const plan = planSwitch(seeds.map((seed) => row(seed.key, seed.body, seed.variables)))

    expect(plan.update).toHaveLength(TARGET_KEYS.length)
    for (const update of plan.update) {
      expect(update.body).not.toContain(OLD_LINK)
      expect(update.body).toContain(NEW_LINK)
      expect(update.variables).toContainEqual(BOOKING_SHORT_VARIABLE)
      expect(validateTemplateBody(update.body, update.variables)).toEqual([])

      const values = Object.fromEntries(update.variables.map((variable) => [variable.name, variable.example ?? 'x']))
      const rendered = renderSystemTemplate({ body: update.body, variables: update.variables }, { ...values, booking_short: 'Ab3dE5fG7h' })
      expect(rendered.ok && rendered.text).toContain('https://jvto.me/b/Ab3dE5fG7h')
    }
  })

  it('leaves an operator-edited link alone and reports it', () => {
    const plan = planSwitch([row('trip_concluded', 'See https://example.com/custom')])
    expect(plan.update).toEqual([])
    expect(plan.skipped).toContainEqual(expect.objectContaining({ key: 'trip_concluded' }))
  })

  it('is idempotent: a switched template is reported, not rewritten', () => {
    const first = planSwitch([row('trip_concluded', `Portal: ${OLD_LINK}`)])
    const again = planSwitch([row('trip_concluded', first.update[0].body, first.update[0].variables)])
    expect(again.update).toEqual([])
    expect(again.alreadySwitched).toEqual(['trip_concluded'])
  })

  it('does not declare booking_short twice', () => {
    const plan = planSwitch([row('trip_concluded', `Portal: ${OLD_LINK}`, [slug, BOOKING_SHORT_VARIABLE])])
    expect(plan.update[0].variables.filter((variable) => variable.name === 'booking_short')).toHaveLength(1)
  })

  it('reports templates missing from the database', () => {
    const plan = planSwitch([])
    expect(plan.skipped.map((skip) => skip.key).sort()).toEqual([...TARGET_KEYS].sort())
  })
})
