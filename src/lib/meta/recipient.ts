/**
 * Tujuan pesan WhatsApp Cloud API: nomor (`to`) atau BSUID (`recipient`).
 *
 * Pengguna WhatsApp ber-username bisa tanpa nomor; Meta mengizinkan kirim ke BSUID-nya lewat `recipient` -- dipakai HANYA
 * bila `to` dikosongkan ("Used only when `to` is omitted or empty", Meta: Service messages > Send to a BSUID), jadi satu
 * permintaan tidak pernah membawa keduanya. Hanya jalur Official (Cloud API) yang bisa: wa-coexist bekerja dengan nomor.
 *
 * Versi Graph: jalur nomor tetap di versi bawaan `metaFetch`; kirim ke BSUID memakai `BSUID_GRAPH_VERSION`, versi yang
 * dipakai contoh dokumentasi Meta untuk `recipient` -- versi bawaan lama kita tidak terjamin mengenali kolom itu.
 */
export type MetaRecipient = string | { bsuid: string }

export const BSUID_GRAPH_VERSION = 'v27.0'

export function recipientFields(to: MetaRecipient): { to: string } | { recipient_type: 'individual'; recipient: string } {
  return typeof to === 'string' ? { to } : { recipient_type: 'individual', recipient: to.bsuid }
}

/** Versi Graph untuk permintaan kirim ke tujuan ini; undefined = versi bawaan klien. */
export function graphVersionFor(to: MetaRecipient): string | undefined {
  return typeof to === 'string' ? undefined : BSUID_GRAPH_VERSION
}
