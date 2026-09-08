'use client'

import { useState } from 'react'
import { Check, Copy, Inbox, MoreHorizontal, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldHint, Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'

/**
 * Halaman penilaian fondasi tampilan. Bukan bagian dari aplikasi: tidak didaftarkan di
 * navigasi mana pun, dan digerbang mati di produksi oleh src/app/dev/layout.tsx.
 *
 * Gunanya satu: melihat seluruh token dan setiap primitif dalam semua keadaannya di satu
 * layar, supaya keputusan soal fondasi diambil sebelum 18 halaman lain ikut memakainya.
 */

const SURFACES = [
  ['--color-canvas', '#F6F8FA', 'latar aplikasi', 'bg-canvas'],
  ['--color-surface', '#FFFFFF', 'panel, permukaan utama', 'bg-surface'],
  ['--color-surface-sunken', '#F1F4F8', 'area inset, hover di atas canvas', 'bg-surface-sunken'],
  ['--color-line', '#E1E6ED', 'garis rambut', 'bg-line'],
  ['--color-line-strong', '#CBD3DE', 'pembatas yang ditegaskan', 'bg-line-strong'],
] as const

const INKS = [
  ['--color-ink', '#0B1B3D', 'teks utama (navy JVTO)', 'bg-ink'],
  ['--color-ink-muted', '#5A6A83', 'teks sekunder', 'bg-ink-muted'],
  ['--color-ink-subtle', '#8A96AB', 'tersier, placeholder', 'bg-ink-subtle'],
] as const

const ACCENTS = [
  ['--color-accent', '#1E56C8', 'aksen tunggal', 'bg-accent'],
  ['--color-accent-hover', '#1A4AAC', 'hover aksi utama', 'bg-accent-hover'],
  ['--color-accent-subtle', '#EAF0FC', 'latar bernuansa aksen', 'bg-accent-subtle'],
] as const

const SEMANTIC = [
  ['--color-success', '#17795E', 'berhasil', 'bg-success'],
  ['--color-success-subtle', '#E6F4EF', '', 'bg-success-subtle'],
  ['--color-warning', '#9A6510', 'perlu perhatian', 'bg-warning'],
  ['--color-warning-subtle', '#FDF3E3', '', 'bg-warning-subtle'],
  ['--color-danger', '#B3261E', 'gagal, merusak', 'bg-danger'],
  ['--color-danger-subtle', '#FCEDEC', '', 'bg-danger-subtle'],
] as const

const TYPE_SCALE = [
  ['text-xs', '11 / 16', 'meta, timestamp', 'text-xs'],
  ['text-sm', '12.5 / 18', 'label, sel tabel', 'text-sm'],
  ['text-base', '13.5 / 20', 'default UI', 'text-base'],
  ['text-md', '15 / 22', 'isi pesan, teks yang dibaca lama', 'text-md'],
  ['text-lg', '17 / 24', 'judul halaman', 'text-lg'],
  ['text-xl', '20 / 28', 'jarang', 'text-xl'],
] as const

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {note ? <p className="mt-1 max-w-2xl text-base text-ink-muted">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Swatch({ name, hex, desc, cls }: { name: string; hex: string; desc: string; cls: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
      <div className={`size-8 shrink-0 rounded-md border border-line ${cls}`} />
      <div className="min-w-0">
        <div className="font-mono text-sm text-ink">{name}</div>
        <div className="text-xs text-ink-muted">
          <span className="font-mono">{hex}</span>
          {desc ? ` — ${desc}` : ''}
        </div>
      </div>
    </div>
  )
}

/** Kotak contoh dengan judul kecil, dipisah garis rambut — bukan kartu. */
function Demo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <div className="mb-2 font-mono text-xs tracking-wide text-ink-subtle uppercase">{title}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export default function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">Sistem desain wa-inbox</h1>
          <Badge variant="warning">hanya dev</Badge>
        </div>
        <p className="mt-1.5 max-w-2xl text-base text-ink-muted">
          Tenang &amp; rapat. Terang saja, tanpa mode gelap. Satu aksen, dibelanjakan hanya untuk state
          nav aktif, aksi utama, dan penanda belum dibaca. Garis rambut memisahkan, bukan bayangan.
        </p>
      </header>

      <div className="flex flex-col gap-8">
        <Section id="warna" title="Warna" note="Netral condong dingin. ink memakai navy JVTO, bukan slate generik.">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink-muted">Permukaan &amp; garis</h3>
              {SURFACES.map(([n, h, d, c]) => (
                <Swatch key={n} name={n} hex={h} desc={d} cls={c} />
              ))}
              <h3 className="mt-4 mb-1 text-sm font-semibold text-ink-muted">Tinta</h3>
              {INKS.map(([n, h, d, c]) => (
                <Swatch key={n} name={n} hex={h} desc={d} cls={c} />
              ))}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink-muted">Aksen (tunggal)</h3>
              {ACCENTS.map(([n, h, d, c]) => (
                <Swatch key={n} name={n} hex={h} desc={d} cls={c} />
              ))}
              <h3 className="mt-4 mb-1 text-sm font-semibold text-ink-muted">Semantik (bukan aksen)</h3>
              {SEMANTIC.map(([n, h, d, c]) => (
                <Swatch key={n} name={n} hex={h} desc={d} cls={c} />
              ))}
            </div>
          </div>
        </Section>

        <Section
          id="tipografi"
          title="Tipografi"
          note="IBM Plex Sans untuk UI, IBM Plex Mono untuk data. Bobot hanya 400 / 500 / 600."
        >
          <div className="border-t border-line">
            {TYPE_SCALE.map(([name, metric, use, cls]) => (
              <div key={name} className="flex items-baseline gap-4 border-b border-line py-2">
                <div className="w-24 shrink-0 font-mono text-xs text-ink-subtle">{name}</div>
                <div className="w-16 shrink-0 font-mono text-xs text-ink-subtle tabular-nums">{metric}</div>
                <div className={`flex-1 text-ink ${cls}`}>Tur Bromo sunrise, 2 orang</div>
                <div className="hidden w-56 shrink-0 text-xs text-ink-muted sm:block">{use}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <div className="mb-1 text-sm font-medium text-ink-muted">400 regular</div>
              <p className="text-base font-normal text-ink">Balas cepat, lihat apa yang bot lakukan.</p>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-ink-muted">500 medium</div>
              <p className="text-base font-medium text-ink">Balas cepat, lihat apa yang bot lakukan.</p>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-ink-muted">600 semibold</div>
              <p className="text-base font-semibold text-ink">Balas cepat, lihat apa yang bot lakukan.</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-line bg-surface p-3">
            <div className="mb-2 text-sm font-medium text-ink-muted">
              Angka tabular — kolom kanan harus benar-benar sejajar
            </div>
            <div className="flex flex-col font-mono text-base text-ink tabular-nums">
              <div className="flex justify-between border-b border-line py-1">
                <span>+62 821-4340-3501</span>
                <span>1.850.000</span>
              </div>
              <div className="flex justify-between border-b border-line py-1">
                <span>+62 811-1111-9</span>
                <span>11.000</span>
              </div>
              <div className="flex justify-between py-1">
                <span>+62 877-0000-0000</span>
                <span>999.999.999</span>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="bentuk"
          title="Bentuk &amp; kedalaman"
          note="Radius 4 / 6 / 8. Hanya dua bayangan di seluruh sistem, keduanya untuk overlay sungguhan. Kartu dan panel biasa tidak boleh punya bayangan."
        >
          <div className="flex flex-wrap gap-4">
            {[
              ['rounded-sm', '4px'],
              ['rounded-md', '6px'],
              ['rounded-lg', '8px'],
              ['rounded-full', 'pil / avatar'],
            ].map(([cls, label]) => (
              <div key={cls} className="flex flex-col items-center gap-1.5">
                <div className={`size-14 border border-line-strong bg-surface ${cls}`} />
                <div className="font-mono text-xs text-ink-subtle">{cls}</div>
                <div className="text-xs text-ink-muted">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex size-20 items-center justify-center rounded-lg border border-line bg-surface text-xs text-ink-muted">
                kartu
              </div>
              <div className="font-mono text-xs text-ink-subtle">tanpa bayangan</div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex size-20 items-center justify-center rounded-lg border border-line bg-surface text-xs text-ink-muted shadow-popover">
                popover
              </div>
              <div className="font-mono text-xs text-ink-subtle">shadow-popover</div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex size-20 items-center justify-center rounded-lg border border-line bg-surface text-xs text-ink-muted shadow-modal">
                modal
              </div>
              <div className="font-mono text-xs text-ink-subtle">shadow-modal</div>
            </div>
          </div>
        </Section>

        <Section
          id="kepadatan"
          title="Kepadatan"
          note="Tombol 32 default / 28 kecil / 36 besar. Input 32. Baris tabel 36, sel 8×12. Grid spasi 4px."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-subtle">28px</span>
              <Button size="sm">Kecil</Button>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-subtle">32px</span>
              <Button>Default</Button>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-subtle">36px</span>
              <Button size="lg">Besar</Button>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-subtle">32px</span>
              <Input className="w-40" placeholder="Input 32px" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-subtle">32px</span>
              <Select defaultValue="a">
                <option value="a">Select 32px</option>
                <option value="b">Opsi kedua</option>
              </Select>
            </div>
          </div>
        </Section>

        <Section id="button" title="Button" note="variant × size × disabled. Fokus keyboard: Tab ke tombol mana pun.">
          <div className="rounded-lg border border-line bg-surface px-4">
            {(['default', 'outline', 'secondary', 'ghost', 'destructive'] as const).map((v) => (
              <Demo key={v} title={v}>
                <Button variant={v} size="sm">
                  Kecil
                </Button>
                <Button variant={v}>Simpan perubahan</Button>
                <Button variant={v} size="lg">
                  Besar
                </Button>
                <Button variant={v}>
                  <Check className="size-4" />
                  Dengan ikon
                </Button>
                <Button variant={v} disabled>
                  Disabled
                </Button>
              </Demo>
            ))}
          </div>
        </Section>

        <Section id="icon-button" title="IconButton" note="label wajib — ia yang jadi aria-label. Bungkus dengan Tooltip kalau perlu pengingat visual.">
          <div className="rounded-lg border border-line bg-surface px-4">
            {(['ghost', 'outline', 'default', 'destructive'] as const).map((v) => (
              <Demo key={v} title={v}>
                <IconButton variant={v} size="sm" label="Cari" icon={<Search />} />
                <IconButton variant={v} label="Salin nomor" icon={<Copy />} />
                <IconButton variant={v} size="lg" label="Muat ulang" icon={<RefreshCw />} />
                <IconButton variant={v} label="Hapus" icon={<Trash2 />} disabled />
                <Tooltip content="Aksi lain">
                  <IconButton variant={v} label="Aksi lain" icon={<MoreHorizontal />} />
                </Tooltip>
              </Demo>
            ))}
          </div>
        </Section>

        <Section id="badge" title="Badge">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>default</Badge>
            <Badge variant="brand">brand</Badge>
            <Badge variant="success">terkirim</Badge>
            <Badge variant="warning">menunggu</Badge>
            <Badge variant="destructive">gagal</Badge>
            <Badge variant="muted">arsip</Badge>
            <Badge variant="success">
              <Check className="size-3" />
              dengan ikon
            </Badge>
            <Badge variant="muted" className="font-mono">
              24
            </Badge>
          </div>
        </Section>

        <Section id="form" title="Field, Label, Input, Select, Textarea" note="Fokus: border menegas + cincin lembut. Disabled dan invalid punya rupanya sendiri.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama tamu" htmlFor="ds-name" required hint="Seperti tertulis di paspor.">
              <Input id="ds-name" placeholder="Bruno Figarola" />
            </Field>
            <Field label="Nomor WhatsApp" htmlFor="ds-phone" error="Nomor harus diawali 62.">
              <Input id="ds-phone" defaultValue="0821-4340-3501" aria-invalid="true" className="font-mono" />
            </Field>
            <Field label="Paket tur" htmlFor="ds-tour">
              <Select id="ds-tour" defaultValue="bromo" className="w-full">
                <option value="bromo">Bromo Sunrise</option>
                <option value="ijen">Ijen Blue Fire</option>
                <option value="merapi">Merapi Lava Tour</option>
              </Select>
            </Field>
            <Field label="Terkunci" htmlFor="ds-locked" hint="Contoh keadaan disabled.">
              <Input id="ds-locked" defaultValue="Tidak bisa diubah" disabled />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Catatan" htmlFor="ds-note" hint="Terlihat oleh operator lain, tidak dikirim ke tamu.">
                <Textarea id="ds-note" rows={3} placeholder="Minta jemput jam 00.30 di Hotel Bromo Permai…" />
              </Field>
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
              <Label>Label biasa</Label>
              <Label required>Label wajib</Label>
              <FieldHint>Ini petunjuk field.</FieldHint>
              <FieldError>Ini galat field.</FieldError>
              <label className="flex items-center gap-1.5 text-base text-ink">
                <input type="checkbox" defaultChecked /> checkbox native (accent-color)
              </label>
            </div>
          </div>
        </Section>

        <Section id="avatar" title="Avatar" note="Warna ditentukan oleh nama, jadi orang yang sama selalu berwarna sama di seluruh aplikasi.">
          <div className="flex flex-wrap items-center gap-3">
            {['Bruno Figarola', 'Siti Aminah', 'Wayan Sudira', 'Klook Guest', 'Hendra Wijaya', 'Yuki Tanaka', 'Anna Novak', 'Budi Santoso'].map(
              (n) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <Avatar name={n} />
                  <span className="max-w-20 truncate text-xs text-ink-muted">{n}</span>
                </div>
              )
            )}
            <div className="flex flex-col items-center gap-1">
              <Avatar name={null} />
              <span className="text-xs text-ink-muted">tanpa nama</span>
            </div>
            <div className="flex items-end gap-2">
              <Avatar name="Bruno Figarola" className="size-6 text-xs" />
              <Avatar name="Bruno Figarola" />
              <Avatar name="Bruno Figarola" className="size-10" />
              <Avatar name="Bruno Figarola" className="size-12 text-md" />
            </div>
          </div>
        </Section>

        <Section
          id="daftar"
          title="Daftar dan tabel — bukan kartu"
          note="Daftar adalah daftar, tabel adalah tabel, dipisah garis rambut. Card dipakai hanya untuk pengelompokan sungguhan."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="border-b border-line px-3 py-2 text-sm font-semibold text-ink">Percakapan</div>
              {[
                { name: 'Bruno Figarola', msg: 'Besok jadi jemput jam berapa?', time: '09:42', unread: 3 },
                { name: 'Siti Aminah', msg: 'Terima kasih, sudah transfer.', time: '09:15', unread: 0 },
                { name: 'Wayan Sudira', msg: 'Ijen masih buka untuk minggu depan?', time: 'Kemarin', unread: 0 },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 hover:bg-surface-sunken">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-base font-medium text-ink">{c.name}</span>
                      <span className="shrink-0 font-mono text-xs text-ink-subtle">{c.time}</span>
                    </div>
                    <div className="truncate text-sm text-ink-muted">{c.msg}</div>
                  </div>
                  {c.unread > 0 ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-medium text-white tabular-nums">
                      {c.unread}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tamu</TableHead>
                    <TableHead>Paket</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Nilai</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ['Bruno Figarola', 'Bromo Sunrise', 'success', 'Lunas', '1.850.000'],
                    ['Siti Aminah', 'Ijen Blue Fire', 'warning', 'DP', '750.000'],
                    ['Wayan Sudira', 'Merapi Lava', 'destructive', 'Batal', '0'],
                  ].map(([nama, paket, v, status, nilai]) => (
                    <TableRow key={nama}>
                      <TableCell className="font-medium text-ink">{nama}</TableCell>
                      <TableCell className="text-ink-muted">{paket}</TableCell>
                      <TableCell>
                        <Badge variant={v as 'success' | 'warning' | 'destructive'}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{nilai}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Section>

        <Section id="card" title="Card" note="Untuk pengelompokan sungguhan. Tanpa bayangan; garisnya yang memisahkan.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Kesehatan nomor</CardTitle>
                <Badge variant="success">aktif</Badge>
              </CardHeader>
              <CardBody className="flex flex-col gap-2">
                <div className="flex justify-between text-base">
                  <span className="text-ink-muted">Token resmi</span>
                  <span className="font-medium text-ink">valid</span>
                </div>
                <div className="flex justify-between text-base">
                  <span className="text-ink-muted">Pesan 24 jam</span>
                  <span className="font-mono font-medium text-ink tabular-nums">1.204</span>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sedang memuat</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1">
                    <SkeletonText lines={2} />
                  </div>
                </div>
                <SkeletonText lines={3} />
              </CardBody>
            </Card>
          </div>
        </Section>

        <Section id="empty" title="EmptyState">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState
                icon={<Inbox />}
                title="Belum ada percakapan"
                description="Pesan masuk dari WhatsApp akan muncul di sini."
              />
            </div>
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState
                icon={<Search />}
                title="Tidak ada hasil"
                description="Tidak ada kontak yang cocok dengan “bromo 2 pax”."
                action={<Button variant="outline">Hapus filter</Button>}
              />
            </div>
          </div>
        </Section>

        <Section id="overlay" title="Tooltip &amp; Modal" note="Dua-duanya overlay sungguhan — satu-satunya tempat bayangan boleh dipakai.">
          <div className="flex flex-wrap items-center gap-6">
            <Tooltip content="Muncul di atas" side="top">
              <Button variant="outline">Tooltip atas</Button>
            </Tooltip>
            <Tooltip content="Muncul di bawah" side="bottom">
              <Button variant="outline">Tooltip bawah</Button>
            </Tooltip>
            <Tooltip content="Kanan" side="right">
              <Button variant="outline">Tooltip kanan</Button>
            </Tooltip>
            <Tooltip content="Kiri" side="left">
              <Button variant="outline">Tooltip kiri</Button>
            </Tooltip>
            <Button onClick={() => setModalOpen(true)}>Buka modal</Button>
          </div>
          {modalOpen ? (
            <Modal onClose={() => setModalOpen(false)}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-md font-semibold text-ink">Hapus template?</h3>
                <IconButton label="Tutup" icon={<X />} size="sm" onClick={() => setModalOpen(false)} />
              </div>
              <p className="text-base text-ink-muted">
                Template “Konfirmasi jemput Bromo” akan dihapus. Percakapan yang sudah memakainya tidak
                berubah.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setModalOpen(false)}>
                  Batal
                </Button>
                <Button variant="destructive" onClick={() => setModalOpen(false)}>
                  Hapus
                </Button>
              </div>
            </Modal>
          ) : null}
        </Section>

        <Section id="skeleton" title="Skeleton">
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="ml-auto h-3 w-12" />
            </div>
            <SkeletonText lines={4} />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
