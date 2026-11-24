import { describe, expect, it } from 'vitest'
import { renderSystemTemplate } from '@/lib/system-templates/render'
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'
import { exampleValues, initialTemplates, tplAgent, tplCategory } from './templates'

describe('template pesan /new', () => {
  it('memuat semua template sistem dari seed', () => {
    expect(initialTemplates().map((t) => t.key)).toEqual(SYSTEM_TEMPLATE_SEEDS.map((t) => t.key))
  })

  it('setiap template seed punya kategori (template baru wajib dipetakan)', () => {
    expect(SYSTEM_TEMPLATE_SEEDS.filter((t) => tplCategory(t.key) === 'Lainnya').map((t) => t.key)).toEqual([])
  })

  it('template agent reminder: tamu, crew, vendor', () => {
    expect(tplAgent('payment_reminder_balance')).toBe('reminder')
    expect(tplAgent('trip_information_airport')).toBe('reminder')
    expect(tplAgent('trip_concluded')).toBe('reminder')
    expect(tplAgent('crew_reminder_personal')).toBe('crew')
    expect(tplAgent('internal_bali_transport_reminder')).toBe('vendor')
    expect(tplAgent('internal_new_booking')).toBeUndefined()
  })

  it('pratinjau dengan nilai contoh tergambar untuk setiap template', () => {
    for (const t of initialTemplates()) {
      const r = renderSystemTemplate(t, exampleValues(t))
      expect(r.ok, t.key).toBe(true)
    }
  })
})
