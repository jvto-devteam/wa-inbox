/**
 * Kata yang diabaikan saat mencocokkan pertanyaan pelanggan dengan entri knowledge.
 *
 * Modul sendiri, tanpa satu impor pun, dan itu load-bearing: daftar ini dipakai pencocok di
 * runtime-integration.ts (server, menyeret prisma/pg) DAN oleh default tag di FixAnswerPanel
 * (komponen browser). Mengimpornya langsung dari runtime-integration.ts ke komponen browser
 * menyeret `dns`/`fs`/`net`/`tls` ke bundle klien -- `next build` gagal, sementara test, tsc,
 * dan eslint semuanya hijau karena tidak ada satu pun yang membangun bundle browser.
 * Terjadi di deploy 2026-09-14 dan mematikan produksi sampai dipindah ke sini.
 *
 * Satu daftar untuk keduanya: tag yang tersaring oleh pencocok tidak pernah bisa memenangkan
 * overlap kata, jadi menyarankannya ke operator hanya membuang tempat.
 */
export const MATCHER_STOPWORDS: ReadonlySet<string> = new Set([
  // Question words and fillers, Indonesian.
  'yang', 'untuk', 'dari', 'dengan', 'atau', 'dan', 'ada', 'apa', 'apakah', 'adakah', 'bisa',
  'bisakah', 'boleh', 'saya', 'kami', 'kita', 'anda', 'ini', 'itu', 'berapa', 'kapan', 'dimana',
  'mana', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'mohon', 'tolong', 'terima',
  'kasih', 'selamat', 'halo', 'hallo', 'sudah', 'belum', 'akan', 'juga', 'saja', 'kalau', 'jika',
  'tapi', 'tetapi', 'karena', 'tersebut', 'tentang', 'seperti', 'punya', 'ingin', 'pengen',
  // English.
  'the', 'and', 'for', 'with', 'you', 'are', 'what', 'can', 'how', 'where', 'when', 'does',
  'have', 'this', 'that', 'there', 'would', 'could', 'should', 'please', 'thanks', 'hello',
  'about', 'from', 'your', 'much', 'many',
])
