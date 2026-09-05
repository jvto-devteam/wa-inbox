'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { RuleRegistryTable, type RuleRow } from '@/components/bot-control/RuleRegistryTable'
import { fetchJson } from '@/lib/fetch-json'

export default function RulesRegistryPage() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchJson<{ rules: RuleRow[] }>('/api/bot-control/rules')
      .then((data) => setRules(data.rules))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat aturan'))
      .finally(() => setLoading(false))
  }, [])

  // Difilter di klien, sengaja: seluruh registry ada sepuluh baris dan dimuat sekali. Menaruh
  // filter di server hanya menambah round-trip per ketikan tanpa mengurangi apa pun yang
  // dikirim.
  const categories = useMemo(() => [...new Set(rules.map((r) => r.category))], [rules])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rules.filter((rule) => {
      if (category && rule.category !== category) return false
      if (!needle) return true
      return (
        rule.name.toLowerCase().includes(needle) ||
        rule.key.toLowerCase().includes(needle) ||
        rule.description.toLowerCase().includes(needle)
      )
    })
  }, [rules, query, category])

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Rules Registry</h1>
        <p className="text-sm text-muted-foreground">
          Aturan yang benar-benar mengikat bot hari ini, beserta file yang menegakkannya. Read-only pada fase ini —
          kolom &ldquo;Dapat diubah&rdquo; menunjukkan mana yang nanti aman dikelola dari UI.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari aturan..."
          aria-label="Cari aturan"
          className="w-64"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && (
        <Card className="p-3">
          <RuleRegistryTable rules={visible} />
        </Card>
      )}
    </main>
  )
}
