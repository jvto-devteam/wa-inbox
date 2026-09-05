'use client'
/**
 * TEMPLATE: client component wa-inbox yang memuat data dari API.
 *
 * Salin ke `src/components/<area>/<Nama>.tsx` dan ganti bagian bertanda TODO. File ini
 * sengaja ditulis agar lolos `tsc --noEmit` dan `eslint` apa adanya.
 *
 * Aturan yang WAJIB ikut tersalin (CLAUDE.md §2, §5, §6):
 *
 * 1. Pakai `fetchJson<T>()`, JANGAN `fetch().then(r => r.json())`. Middleware menjawab sesi
 *    mati dengan 401 `{ error }`; pola telanjang memasukkan objek error itu ke state yang
 *    bertipe array, lalu `.map()` melempar dan halaman blank — bukan kembali ke /login.
 * 2. Tiga state eksplisit: loading, error, kosong. "Kosong" dan "gagal" TIDAK BOLEH terlihat
 *    sama — operator harus bisa membedakan "belum ada data" dari "gagal memuat".
 * 3. Dilarang `any`. Bentuk data dari API dideklarasikan sebagai `type` di file ini.
 * 4. Teks UI berbahasa Indonesia; nama variabel/fungsi berbahasa Inggris.
 * 5. Pakai primitive di `@/components/ui/` — jangan bikin Card/Badge/Button versi sendiri.
 * 6. Efek yang mengambil data harus tahan race: respons yang datang telat dari filter lama
 *    tidak boleh menimpa hasil filter yang sedang aktif.
 */
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { fetchJson } from '@/lib/fetch-json'

// TODO: ganti dengan bentuk response API yang sebenarnya (lihat kontrak di guidebook §20).
type Item = {
  key: string
  name: string
  category: string
}

type Props = {
  // Data awal boleh dioper dari server component supaya render pertama tidak kosong.
  // Komponen tetap harus benar saat prop ini tidak diberikan.
  initialItems?: Item[]
}

export function ComponentTemplate({ initialItems }: Props) {
  const [items, setItems] = useState<Item[]>(initialItems ?? [])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(initialItems === undefined)
  const [error, setError] = useState<string | null>(null)

  // Filter berubah -> tandai loading DI SINI, di handler, bukan di dalam efek.
  // Memanggil setState secara sinkron di badan efek memicu render berantai dan ditolak oleh
  // aturan react-hooks/set-state-in-effect; menaruhnya di handler adalah bentuk idiomatiknya
  // dan tetap menampilkan "Memuat..." tepat saat filter berubah.
  function changeQuery(next: string) {
    setQuery(next)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    // `cancelled` menutup race antar-request: mengetik cepat di kotak cari melepas beberapa
    // request sekaligus, dan tanpa penjaga ini respons yang paling lambat — bukan yang paling
    // baru — yang berakhir di state.
    let cancelled = false

    // TODO: ganti endpoint. Query di-encode, jangan diinterpolasi mentah.
    fetchJson<{ items: Item[] }>(`/api/bot-control/rules?q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
      })
      .catch((err: unknown) => {
        // fetchJson sudah mengirim browser ke /login kalau penyebabnya 401, jadi yang sampai
        // sini adalah kegagalan sungguhan yang layak ditampilkan.
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Gagal memuat data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [query])

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-navy">TODO: Judul Panel</h2>
        <Input
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="Cari..."
          aria-label="Cari"
          className="w-56"
        />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}

      {/* Kegagalan tampil sebagai kegagalan, bukan sebagai daftar kosong. */}
      {!loading && error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada data.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between py-2">
              <span className="text-sm text-foreground">{item.name}</span>
              <Badge variant="muted">{item.category}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
