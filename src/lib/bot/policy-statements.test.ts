import { describe, it, expect } from 'vitest'
import { AVAILABILITY_POLICY, NO_GUARANTEE_POLICY, NOT_STANDARD_PACKAGE_POLICY, POLICY_STATEMENTS } from './policy-statements'

// Kedua kalimat ini ikut prompt. Memindahkannya ke modul sendiri (2026-09-14) tidak boleh mengubah
// satu karakter pun dari yang sebelumnya dikirim ke model -- teks pembanding di bawah diekstrak
// mekanis dari knowledge.ts sebelum pemindahan.
describe('policy-statements', () => {
  it('kalimat ketersediaan identik dengan yang dulu tertulis di knowledge.ts', () => {
    expect(AVAILABILITY_POLICY).toBe("Nearly always available -- exact availability for a specific date is confirmed automatically at checkout, so encourage the customer to go ahead and book rather than asking for their dates first \"to verify\".")
  })

  it('kalimat tanpa jaminan akses identik dengan yang dulu tertulis di knowledge.ts', () => {
    expect(NO_GUARANTEE_POLICY).toBe("Attraction access such as Blue Fire, along with weather and sunrise, cannot be guaranteed; it depends on current conditions and the authorities.")
  })

  // Ditambahkan 2026-09-14: kalimat ini ikut prompt lewat catatan alternatif terdekat di
  // orchestrator.ts (matchTierNote). Pemindahannya tidak boleh mengubah prompt satu karakter pun --
  // teks pembanding diekstrak mekanis dari orchestrator.ts sebelum pemindahan.
  it('kalimat paket tidak standar identik dengan yang dulu tertulis di orchestrator.ts', () => {
    expect(NOT_STANDARD_PACKAGE_POLICY).toBe("Be upfront that the exact combination they wanted isn't a standard package, and mention that our team can adjust the specifics after booking if needed.")
  })

  it('hanya memuat pernyataan kebijakan, bukan larangan guardrail', () => {
    expect(POLICY_STATEMENTS.map((p) => p.line)).toEqual([AVAILABILITY_POLICY, NO_GUARANTEE_POLICY, NOT_STANDARD_PACKAGE_POLICY])
    for (const p of POLICY_STATEMENTS) expect(p.line).not.toMatch(/NEVER/)
  })
})
