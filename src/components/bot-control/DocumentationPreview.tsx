'use client'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Preview + download + copy for the generated documentation.
 *
 * The Markdown is rendered inside a <pre>, not parsed into HTML. That is deliberate: this
 * document is meant to be handed to someone as a FILE, so what the operator previews should be
 * byte-for-byte what they will send. A prettified HTML render would show something the
 * recipient never receives, and would also mean interpreting text that includes rule
 * descriptions and knowledge paths as markup.
 */
export function DocumentationPreview() {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (loading) return
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      // Not fetchJson: this endpoint answers with text/markdown, and fetchJson would try to
      // parse the document as JSON and throw on the first heading.
      const res = await fetch('/api/bot-control/export-docs')
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Gagal membuat dokumentasi')
        return
      }
      setMarkdown(await res.text())
      setGeneratedAt(new Date())
    } catch {
      setError('Gagal membuat dokumentasi')
    } finally {
      setLoading(false)
    }
  }

  function download() {
    if (!markdown) return
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'wa-inbox-bot-documentation.md'
    anchor.click()
    // Revoked immediately after the click: the blob is held in memory until it is released,
    // and an operator regenerating a large document repeatedly would leak one copy per export.
    URL.revokeObjectURL(url)
  }

  async function copy() {
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
    } catch {
      // Clipboard access is denied outside a secure context and in some embedded browsers.
      // Saying so beats a button that silently does nothing.
      setError('Tidak bisa menyalin — clipboard diblokir oleh browser.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={loading}>
          {loading ? 'Membuat...' : markdown ? 'Buat ulang' : 'Buat dokumentasi'}
        </Button>
        <Button variant="outline" onClick={download} disabled={!markdown}>
          Unduh Markdown
        </Button>
        <Button variant="outline" onClick={copy} disabled={!markdown}>
          {copied ? 'Tersalin' : 'Salin'}
        </Button>
        {generatedAt && (
          <span className="text-xs text-muted-foreground">Dibuat: {generatedAt.toLocaleString('id-ID')}</span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {markdown && (
        <Card className="p-0">
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed">{markdown}</pre>
        </Card>
      )}

      {!markdown && !loading && !error && (
        <p className="text-sm text-muted-foreground">
          Belum ada dokumen. Tekan &ldquo;Buat dokumentasi&rdquo; untuk membuatnya dari kondisi sistem saat ini.
        </p>
      )}
    </div>
  )
}
