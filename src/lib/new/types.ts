// Tipe untuk pratinjau /new (port artifact "New WA Inbox"). Semua data di sini DATA CONTOH;
// belum ada yang dibaca dari atau ditulis ke database.

export type ViewKey = 'hub' | 'inbox' | 'antrean' | 'ringkasan' | 'agent' | 'kontak' | 'template' | 'bot'
export type ChannelKey = 'wa' | 'kl' | 'ml' | 'ig'
export type AgentKey = 'balas' | 'poin' | 'note' | 'ringkas' | 'reminder' | 'crew' | 'vendor' | 'lead'
export type AgentMode = 'mati' | 'draf' | 'otomatis'
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neu'

export interface MsgMeta {
  ag: AgentKey
  src: string
  why: string
  fb?: 'salah'
  fix?: string
}

/** s = penanda sistem, g = tamu, b = bot, a = admin. */
export interface Msg {
  k: 's' | 'g' | 'b' | 'a'
  text: string
  time?: string
  meta?: MsgMeta
}

export interface Conv {
  id: number
  n: string
  ch: ChannelKey
  un: number
  t: string
  bot: boolean
  last: string
  lb: string
  lead?: boolean
  msgs: Msg[]
  bk: { kode: string; paket: string; tgl: string; jemput: string; bayar: [Tone, string] }
  rg: string[]
  kt: { tel: string; neg: string; lab: string }
  note?: string
  wait?: boolean
  /** draf balasan (agent Balas) + sumbernya */
  dr?: string
  drs?: string
  /** draf cadangan saat tamu menunggu */
  dr2?: string
  /** draf follow-up lead */
  drl?: string
  /** draf dibuang */
  drx?: boolean
  /** isi kotak balasan yang sedang diedit */
  edit?: string
  rem?: boolean
}

export type AtKey = 'Balas' | 'Tindak lanjut' | 'Janji tim' | 'Reminder'
export interface AtItem {
  n: string
  d: string
  w: string
}

export interface Sched {
  d: string
  t: string
  a: AgentKey
  c: string
  ti: string
}

export type AeStatus = 'ok' | 'gagal' | 'tunggu' | 'batal'

export type Cek =
  | { k: 'msg'; m: string }
  | { k: 'poin'; day: string; kind: string; n?: string }
  | { k: 'note' }
  | { k: 'ring' }
  | { k: 'booking' }
  | { k: 'out'; m?: string }
  | { k: 'antrean'; tab: AtKey; n: string }

export interface AgentEvent {
  d: string
  t: string
  a: AgentKey
  c: string
  s: AeStatus
  ti: string
  i: string
  o: string
  r: boolean
  h: Cek
  src?: string
  why?: string
  fb?: 'salah'
  fix?: string
}

export type PointKind = 'komplain' | 'bayar' | 'jemput' | 'keputusan' | 'lokasi' | 'trip' | 'kebutuhan'
export interface DaySummary {
  t: string
  a: number
  j: number
  p: [PointKind, string, string][]
}

export interface Contact {
  n: string
  ch: string
  lab: string
  kode: string
  last: string
  ringkas: string
}

export interface Knowledge {
  title: string
  status: 'PUBLISHED' | 'DRAFT'
  ver: string
  text?: string
}

/** Template pesan sistem (reminder, konfirmasi, kabar internal) yang dikirim program lain lewat wa-inbox. */
export interface Tpl {
  key: string
  name: string
  description: string
  audience: 'CUSTOMER' | 'INTERNAL'
  body: string
  imageUrl: string | null
  variables: { name: string; required: boolean; example?: string; description?: string }[]
  isActive: boolean
}

export interface BotSettings {
  auto: boolean
  skip: boolean
  hand: boolean
  fb: string
  hr: string
}

export interface State {
  cv: Conv[]
  at: Record<AtKey, AtItem[]>
  sj: Sched[]
  ae: AgentEvent[]
  agm: Record<AgentKey, AgentMode>
  agst: Record<AgentKey, { ok: number; bad: number }>
  lead: { dikirim: number; booking: number }
  pause: boolean
  kn: Knowledge[]
  gap: string[]
  bs: BotSettings
  tpl: Tpl[]
  // UI yang dibawa lintas halaman (mis. dari Dashboard langsung ke tab tertentu)
  icv: number
  ifl: string
  itab: 'Booking' | 'Ringkasan' | 'Kontak'
  atab: AtKey | 'Follow-up agent'
  sjag: string
  sjday: string
  rday: string
  rkind: string
  rregen: number
  rtab: 'poin' | 'chat'
  aday: string
  aag: string
  ast: string
  aq: string
  kq: string
  kl: string
  tcat: string
  tq: string
  btab: 'Perilaku' | 'Agent' | 'Knowledge' | 'Uji' | 'Log'
  lf: string
}
