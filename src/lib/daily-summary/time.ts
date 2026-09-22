/**
 * Batas hari Asia/Jakarta, dihitung di JS -- bukan `AT TIME ZONE` di SQL. Kolom waktu di skema
 * ini `TIMESTAMP` tanpa zona, sehingga hasil `AT TIME ZONE` bergantung pada TimeZone sesi
 * database; instant UTC yang dihitung di sini tidak.
 *
 * Jakarta tidak punya DST, jadi satu hari selalu tepat 24 jam sejak 00:00 +07:00.
 */
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

const jakartaDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false
  const start = new Date(`${value}T00:00:00+07:00`)
  return !Number.isNaN(start.getTime()) && jakartaDayKey(start) === value
}

/** "YYYY-MM-DD" hari Jakarta tempat `at` jatuh. */
export function jakartaDayKey(at: Date): string {
  return jakartaDateFormat.format(at)
}

/** [start, end) hari Jakarta `dateKey`, sebagai instant UTC. */
export function jakartaDayRange(dateKey: string): { start: Date; end: Date } {
  if (!isDateKey(dateKey)) throw new Error(`Tanggal tidak valid: ${dateKey}`)
  const start = new Date(`${dateKey}T00:00:00+07:00`)
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

/** Hari Jakarta sebelum hari tempat `now` jatuh -- yang diringkas job 00:00 WIB. */
export function previousJakartaDayKey(now: Date): string {
  const { start } = jakartaDayRange(jakartaDayKey(now))
  return jakartaDayKey(new Date(start.getTime() - 1))
}
