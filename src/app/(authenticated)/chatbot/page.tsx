'use client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldError } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { SectionNav, SectionNavLayout, SectionNavPane } from '@/components/ui/section-nav'
import { FormSection } from '@/components/settings/section'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { fetchJson } from '@/lib/fetch-json'

type Settings = {
  workingHoursStart: string | null
  workingHoursEnd: string | null
  offHoursAutoReply: string | null
  botAutoReplyAll: boolean
  skipBotForIndonesianNumbers: boolean
  handoffOnHumanRequest: boolean
  catalogSyncedAt: string | null
  fallbackReply: string | null
  handoffReply: string | null
  ollamaModel: string
}
type GateStatus = { readyForApproval: boolean; blocking: string[] }
type CatalogPackageSummary = { packageKey: string; title: string; destinationTokens: string[]; priceIdr: number | null }
type CatalogSummary = { syncedAt: string | null; packageCount: number; packages: CatalogPackageSummary[] }
type Role = 'ADMIN' | 'AGENT' | null

/**
 * Bagian-bagian halaman ini, dan urutannya di sidebar kedua.
 *
 * Urutannya bukan abjad melainkan seberapa sering disentuh dan seberapa mahal kalau salah:
 * tiga sakelar yang bisa mendiamkan bot ke semua orang lebih dulu, nama model yang praktis
 * tidak pernah diubah paling belakang sebelum katalog yang read-only.
 */
const CHATBOT_SECTIONS = [
  { id: 'kapan', label: 'Kapan bot menjawab' },
  { id: 'jam', label: 'Jam kerja tim' },
  { id: 'kalimat', label: 'Kalimat bot' },
  { id: 'model', label: 'Model LLM' },
  { id: 'katalog', label: 'Katalog paket' },
] as const

type ChatbotSectionId = (typeof CHATBOT_SECTIONS)[number]['id']

/**
 * Satu baris sakelar: keadaan yang berlaku sekarang (lencana), akibatnya kalau dibiarkan
 * begitu, lalu tombol yang membaliknya.
 *
 * Urutannya sengaja begitu. Sakelar-sakelar di halaman ini yang paling mahal kalau salah
 * ditekan — bot diam ke semua orang, atau bot mulai membalas nomor yang seharusnya dipegang
 * agen — jadi kalimat akibatnya harus sudah terbaca sebelum jari sampai ke tombolnya, bukan
 * setelahnya.
 */
function SwitchRow({ badge, action, children }: { badge: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div>{badge}</div>
        <p className="text-sm text-ink-muted">{children}</p>
      </div>
      {action}
    </div>
  )
}

/**
 * Everything about the bot itself, in one place -- previously split between Pengaturan's
 * "Bot & Otomasi" card and "Jam kerja & auto-reply" card, with no view at all into what the
 * bot's own knowledge base actually contains or which model it's calling. Pengaturan keeps
 * only channel/number/user-admin concerns, which aren't specific to the bot.
 */
export default function ChatbotPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [gateStatus, setGateStatus] = useState<GateStatus | null>(null)
  const [catalogSummary, setCatalogSummary] = useState<CatalogSummary | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [syncing, setSyncing] = useState(false)
  const [active, setActive] = useState<ChatbotSectionId>('kapan')

  const [workingHoursStart, setWorkingHoursStart] = useState('')
  const [workingHoursEnd, setWorkingHoursEnd] = useState('')
  const [offHoursAutoReply, setOffHoursAutoReply] = useState('')
  const [savingHours, setSavingHours] = useState(false)

  const [fallbackReply, setFallbackReply] = useState('')
  const [handoffReply, setHandoffReply] = useState('')
  const [savingSentences, setSavingSentences] = useState(false)
  const [sentenceError, setSentenceError] = useState<string | null>(null)

  const [ollamaModel, setOllamaModel] = useState('')
  const [savingModels, setSavingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  useEffect(() => {
    fetchJson<Settings>('/api/settings').then(setSettings).catch(() => {})
    fetchJson<GateStatus>('/api/bot/gate-status').then(setGateStatus).catch(() => {})
    fetchJson<CatalogSummary>('/api/bot/catalog-summary').then(setCatalogSummary).catch(() => {})
    // Same tolerant pattern as Pengaturan: a 401 here just means the gated (admin-only)
    // controls below stay hidden, not that the whole page fails to render.
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : { role: null }))
      .then((data) => setRole(data.role ?? null))
      .catch(() => setRole(null))
  }, [])

  // Same derive-during-render sync as Pengaturan's working-hours fields: only ever populated
  // from what the server actually confirmed, never a value the page guessed at.
  const [syncedSettings, setSyncedSettings] = useState<Settings | null>(null)
  if (settings && settings !== syncedSettings) {
    setSyncedSettings(settings)
    setWorkingHoursStart(settings.workingHoursStart ?? '')
    setWorkingHoursEnd(settings.workingHoursEnd ?? '')
    setOffHoursAutoReply(settings.offHoursAutoReply ?? '')
    // '' for null on purpose: an empty box IS "pakai kalimat bawaan", the same state the
    // server stores as NULL, so the two round-trip into each other without a special case.
    setFallbackReply(settings.fallbackReply ?? '')
    setHandoffReply(settings.handoffReply ?? '')
    setOllamaModel(settings.ollamaModel)
  }

  async function toggleBotMode() {
    try {
      const { botAutoReplyAll } = await fetchJson<{ botAutoReplyAll: boolean }>('/api/bot/mode', { method: 'POST' })
      setSettings((prev) => (prev ? { ...prev, botAutoReplyAll } : prev))
    } catch {
      // Badge keeps showing the last confirmed state — never a guessed one.
    }
  }

  async function toggleIndonesiaFilter() {
    try {
      const { skipBotForIndonesianNumbers } = await fetchJson<{ skipBotForIndonesianNumbers: boolean }>(
        '/api/bot/indonesia-filter',
        { method: 'POST' }
      )
      setSettings((prev) => (prev ? { ...prev, skipBotForIndonesianNumbers } : prev))
    } catch {
      // Badge keeps showing the last confirmed state — never a guessed one.
    }
  }

  /**
   * The escalation-classifier switch, saved the moment it is pressed.
   *
   * Deliberately the same edit-save-live pattern as the two switches above it, and deliberately
   * not the draft/review/approve/publish cycle this used to sit behind as a versioned rule
   * row. It is one boolean with two states; the approval round-trip was longer than the change.
   */
  async function toggleHandoffClassifier() {
    if (!settings) return
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ handoffOnHumanRequest: !settings.handoffOnHumanRequest }),
        })
      )
    } catch {
      // Badge keeps showing the last confirmed state — never a guessed one.
    }
  }

  async function saveWorkingHours() {
    setSavingHours(true)
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ workingHoursStart, workingHoursEnd, offHoursAutoReply }),
        })
      )
    } catch {
      // Leaves the form on the values the server last confirmed.
    } finally {
      setSavingHours(false)
    }
  }

  /**
   * Edit, save, live -- the same pattern as the bot On/Off switch above, and deliberately not a
   * draft/review/publish cycle. These are two sentences; the round trip that would have to be
   * approved is longer than the sentences themselves.
   */
  async function saveSentences() {
    setSentenceError(null)
    setSavingSentences(true)
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ fallbackReply, handoffReply }),
        })
      )
    } catch {
      setSentenceError('Gagal menyimpan kalimat bot')
    } finally {
      setSavingSentences(false)
    }
  }

  async function saveModels() {
    if (!ollamaModel.trim()) return
    setModelError(null)
    setSavingModels(true)
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ ollamaModel: ollamaModel.trim() }),
        })
      )
    } catch {
      setModelError('Gagal menyimpan model')
    } finally {
      setSavingModels(false)
    }
  }

  async function syncCatalog() {
    setSyncing(true)
    try {
      await fetchJson('/api/bot/sync-catalog', { method: 'POST' })
      await Promise.all([
        fetchJson<Settings>('/api/settings').then(setSettings),
        fetchJson<GateStatus>('/api/bot/gate-status').then(setGateStatus),
        fetchJson<CatalogSummary>('/api/bot/catalog-summary').then(setCatalogSummary),
      ])
    } catch {
      // The "terakhir disinkron" timestamp and package list just stay as they were.
    } finally {
      setSyncing(false)
    }
  }

  if (!settings || !gateStatus || !catalogSummary) {
    return (
      <main aria-busy="true" className="mx-auto w-full max-w-[1400px] p-6">
        <Skeleton className="h-6 w-32" />
        <div className="mt-8 flex flex-col gap-8">
          <SkeletonText lines={4} />
          <SkeletonText lines={3} />
          <SkeletonText lines={3} />
        </div>
      </main>
    )
  }

  const admin = hasAdminPowers(role)

  return (
    <main className="mx-auto w-full max-w-[1400px] p-6">
      <PageHeader
        title="Chatbot"
        description="Apa yang bot lakukan, dan kalimat apa yang diucapkannya. Setiap perubahan di halaman ini berlaku begitu disimpan — tidak ada antrean persetujuan."
      />

      {/* Sidebar kedua, di dalam halaman. Lima bagian ini dulu ditumpuk sekaligus dalam grid
          dua kolom, dan pemilik menandainya terbaca "asal taruh": bagian yang tingginya berbeda
          jauh (tiga sakelar vs tabel katalog) tidak pernah sejajar antar-kolom.
          Satu bagian pada satu waktu menghapus masalah itu sekaligus memberi tiap bagian
          lebar penuh — yang justru dibutuhkan katalog.
          Bentuknya <SectionNav>, komponen yang sama dengan /settings dan /bot-control. Item di
          sini <button> sungguhan, bukan tautan palsu: tidak ada URL yang berubah saat bagian
          diganti. */}
      <SectionNavLayout className="mt-6">
        <SectionNav
          label="Bagian pengaturan Chatbot"
          items={CHATBOT_SECTIONS.map((s) => ({ id: s.id, label: s.label, onSelect: () => setActive(s.id) }))}
          activeId={active}
        />

        <SectionNavPane>
          {active === 'kapan' && (
            <FormSection
              title="Kapan bot menjawab"
              description="Tiga sakelar yang menentukan percakapan mana yang dijawab bot dan kapan percakapan diserahkan ke agen."
            >
              <SwitchRow
                badge={
                  <Badge variant={settings.botAutoReplyAll ? 'success' : 'warning'}>
                    Bot: {settings.botAutoReplyAll ? 'On (Semua Chat)' : 'Off (Manual per Chat)'}
                  </Badge>
                }
                action={
                  /* Tombol sakelar di bagian ini BUKAN aksen. Keadaannya sudah dibawa oleh <Badge>
                     di sebelahnya; tombolnya hanya membalik keadaan itu, dan tiga tombol aksen
                     berjajar membuat tidak ada satu pun yang terbaca sebagai aksi utama halaman.
                     Arah "matikan" tetap memakai destructive karena akibatnya memang berbeda. */
                  admin ? (
                    <Button
                      onClick={toggleBotMode}
                      variant={settings.botAutoReplyAll ? 'destructive' : 'outline'}
                      size="sm"
                    >
                      {settings.botAutoReplyAll ? 'Matikan (Off)' : 'Aktifkan untuk Semua Chat (On)'}
                    </Button>
                  ) : undefined
                }
              >
                On: bot balas otomatis di semua percakapan. Off: bot nonaktif secara default — agen bisa mengaktifkan bot
                secara manual per percakapan lewat tombol di dalam chat.
              </SwitchRow>

              <SwitchRow
                badge={
                  <Badge variant={settings.skipBotForIndonesianNumbers ? 'warning' : 'success'}>
                    Nomor Indonesia: {settings.skipBotForIndonesianNumbers ? 'Tidak dibalas bot' : 'Dibalas bot'}
                  </Badge>
                }
                action={
                  admin ? (
                    <Button
                      onClick={toggleIndonesiaFilter}
                      variant={settings.skipBotForIndonesianNumbers ? 'outline' : 'destructive'}
                      size="sm"
                    >
                      {settings.skipBotForIndonesianNumbers
                        ? 'Aktifkan Bot untuk Nomor Indonesia'
                        : 'Nonaktifkan Bot untuk Nomor Indonesia'}
                    </Button>
                  ) : undefined
                }
              >
                Saat aktif, bot tidak pernah membalas otomatis ke nomor WhatsApp Indonesia (kode +62) — percakapan langsung
                diam, agen yang menangani manual. Nomor negara lain tetap dibalas bot seperti biasa.
              </SwitchRow>

              <SwitchRow
                badge={
                  <Badge variant={settings.handoffOnHumanRequest ? 'success' : 'warning'}>
                    Alihkan ke manusia: {settings.handoffOnHumanRequest ? 'Aktif' : 'Hanya kata kunci'}
                  </Badge>
                }
                action={
                  admin ? (
                    <Button
                      onClick={toggleHandoffClassifier}
                      variant={settings.handoffOnHumanRequest ? 'destructive' : 'outline'}
                      size="sm"
                    >
                      {settings.handoffOnHumanRequest
                        ? 'Matikan Deteksi Tambahan'
                        : 'Alihkan ke manusia saat customer memintanya'}
                    </Button>
                  ) : undefined
                }
              >
                Saat aktif, bot juga memakai LLM untuk menangkap permintaan bicara dengan manusia yang tidak memakai kata
                kunci baku — komplain, frustrasi, kalimat berputar. Saat dimatikan, hanya kata kunci eksplisit
                (&ldquo;mau bicara dengan manusia&rdquo; dan sejenisnya) yang memicu handoff; kata kunci itu tidak pernah
                bisa dimatikan dari sini.
              </SwitchRow>
            </FormSection>
          )}

          {active === 'jam' && (
            <FormSection
              title="Jam kerja tim"
              description="Bot tetap menjawab 24 jam, di dalam maupun di luar jam ini. Yang berubah hanya satu: di luar jam ini, pelanggan yang dialihkan ke tim (handoff) ikut diberi tahu kapan tim membalas. Jam dihitung menurut waktu Indonesia Barat (WIB), bukan jam server."
            >
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Mulai" htmlFor="working-hours-start">
                    <Input
                      id="working-hours-start"
                      type="time"
                      value={workingHoursStart}
                      onChange={(e) => setWorkingHoursStart(e.target.value)}
                      disabled={!admin}
                    />
                  </Field>
                  <Field label="Selesai" htmlFor="working-hours-end">
                    <Input
                      id="working-hours-end"
                      type="time"
                      value={workingHoursEnd}
                      onChange={(e) => setWorkingHoursEnd(e.target.value)}
                      disabled={!admin}
                    />
                  </Field>
                </div>
                <Field
                  label="Kalimat tambahan saat handoff di luar jam kerja"
                  htmlFor="off-hours-auto-reply"
                  hint="Ditambahkan setelah kalimat handoff, bukan menggantikannya. Kosongkan kalau tidak ingin menambah apa-apa — dan kalau salah satu jam di atas kosong, kalimat ini tidak pernah dikirim."
                >
                  <Textarea
                    id="off-hours-auto-reply"
                    rows={3}
                    value={offHoursAutoReply}
                    onChange={(e) => setOffHoursAutoReply(e.target.value)}
                    disabled={!admin}
                    placeholder="Contoh: Saat ini di luar jam operasional kami. Tim akan membalas pada jam kerja berikutnya."
                  />
                </Field>
                {admin && (
                  <div>
                    <Button onClick={saveWorkingHours} size="sm" disabled={savingHours}>
                      {savingHours ? 'Menyimpan...' : 'Simpan jam kerja'}
                    </Button>
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {active === 'kalimat' && (
            <FormSection
              title="Kalimat bot"
              description="Dua kalimat yang diucapkan bot apa adanya. Disimpan langsung — begitu ditekan Simpan, percakapan berikutnya sudah memakainya."
            >
              <div className="space-y-4">
                <Field
                  label="Balasan saat bot tidak tahu jawabannya"
                  htmlFor="fallback-reply"
                  hint="Kosongkan untuk memakai kalimat bawaan."
                >
                  <Textarea
                    id="fallback-reply"
                    rows={3}
                    value={fallbackReply}
                    onChange={(e) => setFallbackReply(e.target.value)}
                    disabled={!admin}
                    placeholder="Contoh: Maaf, saya belum punya jawabannya. Saya cek dulu ya."
                  />
                </Field>
                <Field
                  label="Kalimat saat percakapan dialihkan ke manusia"
                  htmlFor="handoff-reply"
                  hint="Kosongkan untuk memakai kalimat bawaan."
                >
                  <Textarea
                    id="handoff-reply"
                    rows={3}
                    value={handoffReply}
                    onChange={(e) => setHandoffReply(e.target.value)}
                    disabled={!admin}
                    placeholder="Contoh: Terima kasih! Saya hubungkan dengan tim kami, mereka akan segera membalas."
                  />
                </Field>
                {admin && (
                  <div>
                    <Button onClick={saveSentences} size="sm" disabled={savingSentences}>
                      {savingSentences ? 'Menyimpan...' : 'Simpan kalimat bot'}
                    </Button>
                  </div>
                )}
                {sentenceError && <FieldError>{sentenceError}</FieldError>}
              </div>
            </FormSection>
          )}

          {active === 'model' && (
            <FormSection
              title="Model LLM"
              description="Semua balasan bot diproses lokal lewat Ollama di VPS yang sama — tidak ada penyedia hosted (OpenAI dkk) yang pernah dihubungi, jadi teks pelanggan dan data booking tidak pernah keluar server. Model default adalah gemma4:31b-cloud, tag cloud Ollama sendiri (sama seperti yang dipakai chatbot-web)."
            >
              <div className="space-y-4">
                <Field label="Model Ollama" htmlFor="ollama-model" className="max-w-sm">
                  <Input
                    id="ollama-model"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    disabled={!admin}
                  />
                </Field>
                {admin && (
                  <div>
                    <Button onClick={saveModels} size="sm" disabled={savingModels || !ollamaModel.trim()}>
                      {savingModels ? 'Menyimpan...' : 'Simpan model'}
                    </Button>
                  </div>
                )}
                {modelError && <FieldError>{modelError}</FieldError>}
              </div>
            </FormSection>
          )}

          {active === 'katalog' && (
            <FormSection
              title="Pengetahuan (katalog paket)"
              description="Paket yang boleh disebut bot. Katalog dibaca dari berkas, bukan diketik di sini; sinkron menariknya ulang."
              actions={
                admin ? (
                  <Button onClick={syncCatalog} variant="outline" size="sm" disabled={syncing}>
                    {syncing ? 'Menyinkron...' : 'Sinkron Sekarang'}
                  </Button>
                ) : undefined
              }
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <dt className="text-ink-muted">Terakhir disinkron</dt>
                      <dd className="font-mono text-ink">
                        {catalogSummary.syncedAt ? new Date(catalogSummary.syncedAt).toLocaleString('id-ID') : 'Belum pernah'}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="text-ink-muted">Gerbang penerapan</dt>
                      <dd>
                        <Badge variant={gateStatus.readyForApproval ? 'success' : 'warning'}>
                          {gateStatus.readyForApproval ? 'Siap' : `Terkunci: ${gateStatus.blocking.join(', ')}`}
                        </Badge>
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href="/settings/knowledge-gaps"
                    className="focus-ring rounded-sm text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    Lihat pertanyaan tak terjawab
                  </Link>
                </div>

                {catalogSummary.packageCount === 0 ? (
                  <EmptyState
                    title="Belum ada paket tersinkron."
                    description="Bot belum punya satu pun paket untuk disebut. Tekan Sinkron Sekarang setelah katalog diperbarui."
                    className="rounded-lg border border-line bg-surface"
                  />
                ) : (
                  <div className="rounded-lg border border-line bg-surface">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Paket</TableHead>
                          <TableHead className="w-[40%]">Destinasi</TableHead>
                          <TableHead className="w-44 text-right">Harga</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {catalogSummary.packages.map((p) => (
                          <TableRow key={p.packageKey}>
                            <TableCell className="font-medium text-ink">{p.title}</TableCell>
                            <TableCell className="text-ink-muted">{p.destinationTokens.join(', ')}</TableCell>
                            <TableCell className="text-right font-mono whitespace-nowrap text-ink-muted">
                              {p.priceIdr != null ? `Rp ${p.priceIdr.toLocaleString('id-ID')}` : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </FormSection>
          )}
        </SectionNavPane>
      </SectionNavLayout>
    </main>
  )
}
