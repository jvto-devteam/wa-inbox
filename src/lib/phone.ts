// Phone numbers throughout this app (Contact.phone) are stored exactly as Meta's WhatsApp
// Cloud API sends them: plain E.164 digits, country code first, no leading "+" (e.g.
// "6282143403501" for an Indonesian number, "12025551234" for a US one) -- see inbound.ts's
// contact upsert, which writes `message.from`/`echo.to` verbatim.

/** True for an Indonesian phone number (country code 62), false otherwise (including empty/malformed input). */
// `phone` is nullable since Task 9 (Contact.phone -- contacts born on a channel without a
// phone number, IG/FB/email, never match this and are never treated as Indonesian).
export function isIndonesianNumber(phone: string | null): boolean {
  return phone != null && /^62\d+$/.test(phone)
}

/**
 * Turns a phone number typed by a human or stored by another system into the Contact.phone
 * form above. Used on the system-template API (src/lib/system-templates/send.ts), where numbers
 * arrive from javavolcano-touroperator's booking form as "+62 812-3456-7890", "0812...", etc.
 *
 * A leading 0 is Indonesian local format and becomes 62 -- JVTO's own staff numbers are written
 * that way (e.g. "082143403501" in TypeformController). Returns null for anything that is not
 * plausibly a phone number, so the caller can refuse it instead of messaging garbage.
 */
export function normalizePhoneNumber(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}
