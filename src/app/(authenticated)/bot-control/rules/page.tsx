'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { RuleRegistryTable, type RuleRow } from '@/components/bot-control/RuleRegistryTable'
import { listBotRules, listRuleCategories, type RuleSettingsKey } from '@/lib/bot-control/rule-registry'
import { fetchJson } from '@/lib/fetch-json'

/** Only the two columns any rule is switched by. */
type SettingsFlags = Record<RuleSettingsKey, boolean>

/**
 * The bot's rules, as a reference page.
 *
 * --- Why there is nothing to press here ---
 *
 * This page used to fetch `/api/bot-control/rules`, which layered database rows over the static
 * registry and handed back an edit surface per rule, backed by six routes and a
 * draft → review → approve → publish state machine. For ten rows that will never become eleven,
 * eight of which are hardcoded behaviour no row could change. The registry is a static list in
 * the bundle, so it is read straight from there — no request, no loading state, nothing that can
 * fail.
 *
 * The one thing that genuinely varies is the live state of the two rules that ARE switches, and
 * that comes from `Settings` — the same two booleans /chatbot writes. A failed read leaves them
 * `undefined`, which the table renders as "tidak terbaca" rather than as off.
 */
export default function RulesRegistryPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [flags, setFlags] = useState<SettingsFlags | null>(null)

  useEffect(() => {
    fetchJson<SettingsFlags>('/api/settings')
      .then((s) =>
        setFlags({
          skipBotForIndonesianNumbers: s.skipBotForIndonesianNumbers,
          handoffOnHumanRequest: s.handoffOnHumanRequest,
        })
      )
      // Left null on purpose: the two switchable rules then show "tidak terbaca" instead of a
      // guess, and the other eight still render, because nothing about them depends on this.
      .catch(() => setFlags(null))
  }, [])

  const rules = useMemo<RuleRow[]>(
    () =>
      listBotRules().map((rule) => ({
        ...rule,
        // null = no switch exists; undefined = there is one but its column was unreadable.
        enabled: rule.settingsKey ? flags?.[rule.settingsKey] : null,
      })),
    [flags]
  )

  // Difilter di klien, sengaja: seluruh registry ada sepuluh baris dan sudah ada di bundle.
  const categories = useMemo(() => listRuleCategories(), [])
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
          Aturan yang benar-benar mengikat bot hari ini, beserta file yang menegakkannya. Daftar ini hanya untuk dibaca.
        </p>
        {/* Said plainly, because "kenapa tidak ada tombolnya" is the first question this page
            raises, and an operator who goes looking for a switch that does not exist will
            eventually convince themselves they found one. */}
        <p className="text-xs text-muted-foreground">
          Delapan aturan di bawah ditegakkan langsung oleh kode dan hanya berubah lewat deploy. Dua sisanya punya
          sakelar di{' '}
          <Link href="/chatbot" className="text-brand hover:underline">
            Chatbot
          </Link>
          , dan default jalur kirim diatur di{' '}
          <Link href="/settings" className="text-brand hover:underline">
            Pengaturan
          </Link>
          .
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

      <Card className="p-3">
        <RuleRegistryTable rules={visible} />
      </Card>
    </main>
  )
}
