import type { ResolverTopic } from '@/lib/bot/module-resolver'
import type { SalesClassification } from '@/lib/bot/types'

export const TOPIC_LABEL_NAMES: Record<ResolverTopic, string> = {
  inclusions: 'Yang termasuk',
  price: 'Harga',
  private_tour: 'Tur privat',
  vehicle: 'Kendaraan',
  rooming: 'Kamar',
  hotel: 'Hotel',
  route_endpoint: 'Titik awal & akhir',
  destination_readiness: 'Kesiapan destinasi',
  booking: 'Pemesanan',
  payment: 'Pembayaran',
  cancellation: 'Pembatalan',
  blue_fire: 'Blue fire',
  greeting: 'Salam',
  general: 'Umum',
}

export const JOB_LABEL_NAMES: Record<SalesClassification['job'], string> = {
  J1: 'Cari paket',
  J2: 'Harga & nilai',
  J3: 'Rute & waktu',
  J4: 'Cek ketersediaan',
  J5: 'Keluhan & serah ke agen',
}

/** Id yang tidak dikenal (baris lama, nilai di luar enum) tampil apa adanya. */
export function topicLabelName(topic: string): string {
  return Object.prototype.hasOwnProperty.call(TOPIC_LABEL_NAMES, topic) ? TOPIC_LABEL_NAMES[topic as ResolverTopic] : topic
}

export function jobLabelName(job: string): string {
  return Object.prototype.hasOwnProperty.call(JOB_LABEL_NAMES, job) ? JOB_LABEL_NAMES[job as SalesClassification['job']] : job
}
