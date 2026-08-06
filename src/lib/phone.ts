// Phone numbers throughout this app (Contact.phone) are stored exactly as Meta's WhatsApp
// Cloud API sends them: plain E.164 digits, country code first, no leading "+" (e.g.
// "6282143403501" for an Indonesian number, "12025551234" for a US one) -- see inbound.ts's
// contact upsert, which writes `message.from`/`echo.to` verbatim.

/** True for an Indonesian phone number (country code 62), false otherwise (including empty/malformed input). */
export function isIndonesianNumber(phone: string): boolean {
  return /^62\d+$/.test(phone)
}
