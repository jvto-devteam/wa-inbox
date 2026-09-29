import { describe, it, expect } from 'vitest'
import { isAutomatedEmail } from './automated'
import type { GmailMessage } from './types'

function message(headers: Array<{ name: string; value: string }>, labelIds: string[] = ['INBOX']): GmailMessage {
  return {
    id: 'gm_1',
    threadId: 'th_1',
    labelIds,
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Sinta <sinta@example.com>' }, ...headers] },
  }
}

const human = { address: 'sinta@example.com', name: 'Sinta' }

describe('isAutomatedEmail', () => {
  it('email biasa dari manusia bukan otomatis', () => {
    expect(isAutomatedEmail(message([]), human)).toBe(false)
  })

  it('header milis/massal menandai otomatis', () => {
    expect(isAutomatedEmail(message([{ name: 'List-Unsubscribe', value: '<mailto:u@x.com>' }]), human)).toBe(true)
    expect(isAutomatedEmail(message([{ name: 'List-Id', value: 'News <news.x.com>' }]), human)).toBe(true)
    expect(isAutomatedEmail(message([{ name: 'Precedence', value: 'bulk' }]), human)).toBe(true)
    expect(isAutomatedEmail(message([{ name: 'precedence', value: 'List' }]), human)).toBe(true)
  })

  it('Auto-Submitted menandai otomatis, kecuali nilainya "no"', () => {
    expect(isAutomatedEmail(message([{ name: 'Auto-Submitted', value: 'auto-replied' }]), human)).toBe(true)
    expect(isAutomatedEmail(message([{ name: 'Auto-Submitted', value: 'no' }]), human)).toBe(false)
  })

  it('alamat pengirim mesin menandai otomatis', () => {
    for (const address of ['noreply@klook.com', 'no-reply@bank.co.id', 'do-not-reply@x.com', 'mailer-daemon@googlemail.com', 'notifications@github.com', 'notification@x.com', 'bounce+abc@x.com', 'postmaster@x.com']) {
      expect(isAutomatedEmail(message([]), { address, name: null })).toBe(true)
    }
  })

  it('nama lokal yang hanya MIRIP mesin tidak ikut tertandai', () => {
    for (const address of ['noreen@example.com', 'notifikasi.budi@example.com', 'replyguy@example.com']) {
      expect(isAutomatedEmail(message([]), { address, name: null })).toBe(false)
    }
  })

  it('kategori Gmail Promosi/Sosial/Update/Forum menandai otomatis; Personal tidak', () => {
    for (const label of ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']) {
      expect(isAutomatedEmail(message([], ['INBOX', label]), human)).toBe(true)
    }
    expect(isAutomatedEmail(message([], ['INBOX', 'CATEGORY_PERSONAL']), human)).toBe(false)
  })

  it('pengirim tak dikenal (from null) tanpa sinyal lain bukan otomatis', () => {
    expect(isAutomatedEmail(message([]), null)).toBe(false)
  })
})
