/**
 * Id DOM pembungkus satu pesan di ThreadView. Dipakai tautan "Lihat pesan" di tab Ringkasan chat
 * untuk menggulung ulang ke pesan yang SUDAH tersorot: klik kedua pada butir yang sama tidak
 * mengubah URL, jadi efek sorot di ThreadView tidak terpicu lagi.
 */
export function threadMessageDomId(messageId: string): string {
  return `pesan-${messageId}`
}

/** Menggulung ke pesan bila sedang dirender di halaman ini; tidak melakukan apa pun bila tidak ada. */
export function scrollToThreadMessage(messageId: string): void {
  if (typeof document === 'undefined') return
  document.getElementById(threadMessageDomId(messageId))?.scrollIntoView({ block: 'center' })
}
