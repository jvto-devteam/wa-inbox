/**
 * Gambar per kiriman: tautan gambar yang dikirim program pemanggil, dipakai menggantikan
 * `SystemTemplate.imageUrl` untuk satu pesan.
 *
 * Dibuat untuk pickup sign — papan bernama tamu yang dipegang kru di bandara/stasiun, dibuat
 * per booking di javavolcano-touroperator. Sebelum ini setiap template hanya punya satu gambar
 * tetap untuk semua pelanggan.
 *
 * Host dibatasi, tidak bebas: alamat ini diteruskan apa adanya ke penyedia WhatsApp, yang lalu
 * mengunduhnya. Tanpa daftar putih, siapa pun yang memegang API key bisa membuat JVTO mengirim
 * gambar dari server mana pun ke nomor pelanggan.
 */
export const ALLOWED_IMAGE_HOSTS = [
  'legacy.javavolcano-touroperator.com',
  'javavolcano-touroperator.com',
  'jvto.me',
] as const

export function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (ALLOWED_IMAGE_HOSTS as readonly string[]).includes(parsed.hostname)
  } catch {
    return false
  }
}
