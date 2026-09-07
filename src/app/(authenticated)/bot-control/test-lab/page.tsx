'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { TestLab, useConversationOptions, type SimulationResult } from '@/components/bot-control/TestLab'
import { SavedTestCases } from '@/components/bot-control/SavedTestCases'
import { fetchJson } from '@/lib/fetch-json'

type Session = { role: 'ADMIN' | 'AGENT' }
type Mode = 'simulate' | 'saved'

/** What a simulation is turned into when the operator saves it. */
type DraftCase = {
  name: string
  category: string
  inputText: string
  expectedStatus: string
  expectedContains: string
  expectedNotContains: string
}

export default function TestLabPage() {
  const conversations = useConversationOptions()
  const [mode, setMode] = useState<Mode>('simulate')
  const [role, setRole] = useState<Session['role'] | null>(null)

  const [lastRun, setLastRun] = useState<{ input: string; result: SimulationResult } | null>(null)
  const [draft, setDraft] = useState<DraftCase | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedToken, setSavedToken] = useState(0)

  // Creating and running test cases is open to an AGENT (SDD §13); the API enforces it, this
  // only avoids rendering controls whose every press would 403.
  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  function openSaveDialog() {
    if (!lastRun) return
    setSaveError(null)
    setDraft({
      // Seeded from what the bot ACTUALLY did, so an operator saving a correct run gets a
      // regression test with one click. When the run was wrong, they edit the expectation
      // before saving — which is why this is a form and not a one-click save.
      name: lastRun.input.slice(0, TITLE_MAX),
      category: '',
      inputText: lastRun.input,
      expectedStatus: lastRun.result.status,
      expectedContains: '',
      expectedNotContains: '',
    })
  }

  async function saveCase() {
    if (!draft || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await fetchJson('/api/bot-control/test-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          category: draft.category.trim() || undefined,
          inputText: draft.inputText.trim(),
          expectedStatus: draft.expectedStatus || undefined,
          expectedContains: draft.expectedContains.trim() || undefined,
          expectedNotContains: draft.expectedNotContains.trim() || undefined,
        }),
      })
      setDraft(null)
      // Reloads the saved list and moves the operator to it, so the case they just wrote is
      // visible rather than saved into somewhere they have to go looking for.
      setSavedToken((n) => n + 1)
      setMode('saved')
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan kasus uji')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Test Lab</h1>
        <p className="text-sm text-muted-foreground">
          Menjalankan decision engine yang sebenarnya terhadap sebuah pesan, tanpa mengirim apa pun ke WhatsApp.
        </p>
        {/* Stated up front because it is the guarantee the whole page rests on, and because the
            sandbox detour is otherwise invisible to an operator picking a real conversation. */}
        <p className="text-xs text-muted-foreground">
          Tidak ada pesan yang dikirim, tidak ada outbound job yang dibuat, dan data percakapan asli tidak diubah —
          simulasi selalu berjalan di percakapan sandbox.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant={mode === 'simulate' ? 'default' : 'outline'} size="sm" onClick={() => setMode('simulate')}>
          Simulasi sekali jalan
        </Button>
        <Button variant={mode === 'saved' ? 'default' : 'outline'} size="sm" onClick={() => setMode('saved')}>
          Kasus uji tersimpan
        </Button>
      </div>

      {/* Kept mounted, not unmounted, when the operator switches tabs: a simulation that took
          thirty seconds and an LLM call should still be there when they come back. */}
      <div hidden={mode !== 'simulate'} className="space-y-3">
        <TestLab conversations={conversations} onResult={(input, result) => setLastRun({ input, result })} />

        {lastRun && (
          <Card className="flex flex-wrap items-center gap-2 p-3">
            <p className="text-xs text-muted-foreground">
              Simpan simulasi ini sebagai kasus uji supaya dijalankan ulang sebelum setiap publish.
            </p>
            <Button variant="outline" size="sm" className="ml-auto" onClick={openSaveDialog}>
              Simpan sebagai test case
            </Button>
          </Card>
        )}
      </div>

      <div hidden={mode !== 'saved'}>
        <SavedTestCases canRun={role !== null} refreshToken={savedToken} />
      </div>

      {draft && (
        <Modal onClose={() => setDraft(null)} className="w-full max-w-lg space-y-3 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-navy">Simpan sebagai kasus uji</h2>
            <p className="text-xs text-muted-foreground">
              Ekspektasi diisi dari hasil simulasi barusan. Kalau balasannya justru yang salah, ubah dulu sebelum
              disimpan.
            </p>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Nama</span>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-label="Nama kasus uji"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Kategori (opsional)</span>
            <Input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="Pricing, Handoff, ..."
              aria-label="Kategori kasus uji"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Pesan pelanggan</span>
            <Input
              value={draft.inputText}
              onChange={(e) => setDraft({ ...draft, inputText: e.target.value })}
              aria-label="Pesan pelanggan kasus uji"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            Status yang diharapkan: <span className="font-mono text-navy">{draft.expectedStatus}</span>
          </p>

          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Balasan harus memuat (opsional)</span>
            <Input
              value={draft.expectedContains}
              onChange={(e) => setDraft({ ...draft, expectedContains: e.target.value })}
              placeholder="Rp"
              aria-label="Balasan harus memuat"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Balasan tidak boleh memuat (opsional)</span>
            <Input
              value={draft.expectedNotContains}
              onChange={(e) => setDraft({ ...draft, expectedNotContains: e.target.value })}
              placeholder="tidak tahu"
              aria-label="Balasan tidak boleh memuat"
            />
          </label>

          {saveError && <p className="text-xs text-destructive">{saveError}</p>}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={saveCase}
              disabled={saving || draft.name.trim().length === 0 || draft.inputText.trim().length === 0}
            >
              {saving ? 'Menyimpan...' : 'Simpan kasus uji'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Batal
            </Button>
          </div>
        </Modal>
      )}
    </main>
  )
}

/** A name is a label in a list, not the whole message. */
const TITLE_MAX = 120
