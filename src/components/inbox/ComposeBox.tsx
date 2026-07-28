'use client'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { SENDER_LABEL, type MessageView } from './MessageBubble'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { fetchJson } from '@/lib/fetch-json'
import { formatWhatsAppText } from '@/lib/whatsapp-format'
import { TemplatePreviewBubble, type PreviewButton, type PreviewCard } from './TemplatePreviewBubble'

type QuickReplyTemplate = { id: string; name: string; category: string | null; body: string }
type OfficialTemplate = {
  id: string
  name: string
  body: string
  variables: string[] | null
  metaStatus: string
  format: string
  cards?: PreviewCard[] | null
  offerTitle?: string | null
  buttons?: PreviewButton[] | null
  couponButtonText?: string | null
}
type TemplateApiRow = QuickReplyTemplate &
  Omit<OfficialTemplate, 'id' | 'name' | 'body'> & { type: string }
type MediaKind = 'image' | 'video' | 'audio' | 'document'
type UploadedMedia = { url: string; type: MediaKind; mimeType: string; fileName: string }
// A local, not-yet-uploaded selection -- exists purely so the rich preview (actual thumbnail
// for image/video) can show up the instant a file is picked, without waiting on the upload
// round trip. `previewUrl` is a local blob: URL (see URL.createObjectURL), never sent anywhere.
type PendingFile = { file: File; previewUrl: string; kind: MediaKind }

const UNCATEGORIZED_LABEL = 'Lainnya'
const ATTACHMENT_ICON: Record<MediaKind, string> = { image: '🖼️', video: '🎞️', audio: '🎵', document: '📎' }

function mediaKindFromMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

// Two entry points into the same hidden input, distinguished only by which file types the OS
// picker offers -- both ultimately upload through the identical path, since the server
// classifies the real type itself regardless of which menu item the agent clicked.
const ATTACH_ACCEPT: Record<'media' | 'document', string> = {
  media: 'image/*,video/*',
  document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,audio/*',
}

export function ComposeBox({
  conversationId,
  botEnabled,
  replyingTo,
  onCancelReply,
  onSent,
  onBotToggled,
}: {
  conversationId: string
  botEnabled: boolean
  replyingTo?: MessageView | null
  onCancelReply?: () => void
  onSent: (m: MessageView) => void
  onBotToggled: (enabled: boolean) => void
}) {
  const [text, setText] = useState('')
  // Seeded from the org-wide Settings.defaultChannel ("Default jalur kirim" in
  // Pengaturan) below, not left as a hardcoded literal: ComposeBox always puts
  // an explicit `channel` in its /api/send body, and resolveChannel lets an
  // explicit value win, so a hardcoded 'OFFICIAL' here made that setting dead
  // configuration for every human-agent send. 'OFFICIAL' remains the fallback
  // for the pre-fetch render and for a failed settings fetch.
  const [channel, setChannel] = useState<'OFFICIAL' | 'UNOFFICIAL'>('OFFICIAL')
  const [sending, setSending] = useState(false)
  const [templates, setTemplates] = useState<QuickReplyTemplate[]>([])
  const [officialTemplates, setOfficialTemplates] = useState<OfficialTemplate[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<UploadedMedia | null>(null)
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  // The OFFICIAL template currently being filled in (its variables need values before it can
  // be dispatched) -- null means the picker is just showing the list, not a param form.
  const [templateForm, setTemplateForm] = useState<OfficialTemplate | null>(null)
  const [templateParamValues, setTemplateParamValues] = useState<string[]>([])
  const [templateSending, setTemplateSending] = useState(false)
  // LTO/COUPON runtime values -- both are per-send, never reused from the template's own
  // submission-time example/placeholder (see submitLtoTemplate/submitCouponTemplate).
  const [ltoExpiration, setLtoExpiration] = useState('')
  const [couponCode, setCouponCode] = useState('')
  // Guards the seed below against clobbering a deliberate per-message override:
  // if the agent picks a channel before the settings fetch resolves, their
  // choice wins.
  const channelTouched = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/settings')
        // No optimistic seeding: a non-ok response or a network failure leaves
        // the compose box on the 'OFFICIAL' fallback rather than on some
        // half-read value.
        if (!res.ok) return
        const s = (await res.json()) as { defaultChannel?: 'OFFICIAL' | 'UNOFFICIAL' }
        if (cancelled || channelTouched.current) return
        if (s.defaultChannel === 'OFFICIAL' || s.defaultChannel === 'UNOFFICIAL') setChannel(s.defaultChannel)
      } catch {
        // Fall back to 'OFFICIAL' — an unreachable settings endpoint must not
        // leave the agent unable to send.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function selectChannel(value: 'OFFICIAL' | 'UNOFFICIAL') {
    channelTouched.current = true
    setChannel(value)
  }

  // Same dismiss-on-outside-click/Escape pattern as AppNav's account menu.
  useEffect(() => {
    if (!attachMenuOpen) return
    function onPointerDown(e: MouseEvent) {
      if (!attachMenuRef.current?.contains(e.target as Node)) setAttachMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAttachMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [attachMenuOpen])

  // The local preview blob: URL is only ever useful for as long as this component (or this
  // particular selection) is alive -- revoking it whenever a selection is replaced or cleared
  // avoids leaking one blob per attachment for the lifetime of the tab.
  function clearPendingFile() {
    setPendingFile((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
  }

  // The agent's typed message is real work that only exists in this input. A non-ok /api/send
  // response (an expired session's 401, or a 500) used to be read as if it were a Message:
  // `onSent` appended a bubble with `id: undefined` (a duplicate React key the second time it
  // failed) and an empty delivery badge, and `setText('')` threw away what they had written
  // mid-conversation with a customer. So: confirm the send first, and on failure keep the
  // text exactly where it is and say so inline — same rule as the template picker above.
  async function send() {
    if ((!text.trim() && !attachment) || sending || uploading) return
    setSendError(null)
    setSending(true)
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          text: text || undefined,
          channel,
          replyToId: replyingTo?.id,
          media: attachment ?? undefined,
        }),
      })
      if (!res.ok) {
        // fetchJson isn't used here: on a 401 it navigates away immediately, which would
        // discard the draft just as surely as clearing the input did. Losing a half-written
        // reply is the exact failure this fixes, so the message stays on screen and the agent
        // decides when to re-authenticate.
        setSendError(
          res.status === 401 ? 'Sesi berakhir — masuk kembali lalu kirim ulang' : 'Gagal mengirim pesan — coba lagi'
        )
        return
      }
      const message = await res.json()
      onSent({
        id: message.id,
        direction: 'OUTBOUND',
        content: text || null,
        channel,
        sentBy: 'AGENT',
        deliveryStatus: message.deliveryStatus,
        createdAt: new Date().toISOString(),
        botTrace: null,
        // The attachment's own upload URL, not anything the API response carries -- it's
        // already a normal https URL (see /api/uploads), renderable as-is without waiting
        // for a later re-fetch to resolve it through the Official-channel media proxy.
        type: attachment?.type,
        mediaUrl: attachment?.url ?? null,
        mimeType: attachment?.mimeType ?? null,
        fileName: attachment?.fileName ?? null,
        replyTo: replyingTo ? { id: replyingTo.id, content: replyingTo.content, type: replyingTo.type ?? 'text', sentBy: replyingTo.sentBy } : null,
      })
      setText('')
      setAttachment(null)
      clearPendingFile()
    } catch {
      setSendError('Gagal mengirim pesan — coba lagi')
    } finally {
      setSending(false)
    }
  }

  async function uploadAttachment(file: File) {
    setAttachmentError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/uploads', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setAttachmentError(data?.error ?? 'Gagal mengunggah lampiran')
        clearPendingFile()
        return
      }
      setAttachment(data as UploadedMedia)
    } catch {
      setAttachmentError('Gagal mengunggah lampiran')
      clearPendingFile()
    } finally {
      setUploading(false)
    }
  }

  function pickAttachment(kind: 'media' | 'document') {
    setAttachMenuOpen(false)
    if (fileInputRef.current) fileInputRef.current.accept = ATTACH_ACCEPT[kind]
    fileInputRef.current?.click()
  }

  function handleAttachmentSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    clearPendingFile()
    setPendingFile({ file, previewUrl: URL.createObjectURL(file), kind: mediaKindFromMime(file.type) })
    uploadAttachment(file)
  }

  async function toggleBot() {
    try {
      const { botEnabled: newValue } = await fetchJson<{ botEnabled: boolean }>(
        `/api/conversations/${conversationId}/toggle-bot`,
        { method: 'POST' }
      )
      onBotToggled(newValue)
    } catch {
      setSendError('Gagal mengambil alih dari bot')
    }
  }

  // Fetch failures here must not leave the picker in a half-open, silently-broken state
  // (same rule LabelPicker's attach/detach follow) — catch the error, surface it inline,
  // and never call setPickerOpen(true) on a request that didn't actually succeed. Template is
  // one of the three attach-menu options (alongside Foto & Video / Dokumen) rather than its
  // own standalone button, so this only ever opens the picker -- closing it is handled by the
  // "Batal"/selection actions already in the picker itself.
  async function openTemplatePicker() {
    setAttachMenuOpen(false)
    setTemplateError(null)
    try {
      const res = await fetch('/api/templates')
      if (!res.ok) {
        setTemplateError('Gagal memuat template')
        return
      }
      const all = (await res.json()) as TemplateApiRow[]
      setTemplates(all.filter((t) => t.type === 'QUICK_REPLY'))
      // Only APPROVED templates are actually sendable via the real Cloud API dispatch --
      // Meta rejects a send attempt for anything still PENDING/REJECTED, so there is no
      // point offering those here.
      setOfficialTemplates(all.filter((t) => t.type === 'OFFICIAL' && t.metaStatus === 'APPROVED'))
      setPickerOpen(true)
    } catch {
      setTemplateError('Gagal memuat template')
    }
  }

  function selectTemplate(body: string) {
    setText(body)
    setPickerOpen(false)
  }

  function selectOfficialTemplate(t: OfficialTemplate) {
    // LTO/COUPON always need a runtime value only the agent can supply (a real expiration or
    // a real code) -- unlike a variable-less BASIC/CAROUSEL template, there's no zero-input
    // path to dispatch these immediately.
    if ((t.variables && t.variables.length > 0) || t.format === 'LTO' || t.format === 'COUPON') {
      setTemplateForm(t)
      setTemplateParamValues(new Array(t.variables?.length ?? 0).fill(''))
      setLtoExpiration('')
      setCouponCode('')
      return
    }
    sendTemplate(t, [])
  }

  // Dispatches a real Cloud API template message (type: 'template'), as opposed to
  // selectTemplate above, which just pastes a QUICK_REPLY's body into the plain-text input.
  // `ltoExpiration`/`couponCode` are read from component state rather than taken as arguments:
  // the only caller that can ever have them populated is the "Kirim Template" button below,
  // which already has them in scope via the same closure.
  async function sendTemplate(t: OfficialTemplate, bodyParams: string[]) {
    setSendError(null)
    setTemplateSending(true)
    try {
      const res = await fetch('/api/send/template', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          templateId: t.id,
          bodyParams,
          expirationTimeMs: t.format === 'LTO' && ltoExpiration ? new Date(ltoExpiration).getTime() : undefined,
          couponCode: t.format === 'COUPON' && couponCode ? couponCode : undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSendError(data?.error ?? 'Gagal mengirim template')
        return
      }
      const message = await res.json()
      onSent({
        id: message.id,
        direction: 'OUTBOUND',
        content: message.content,
        channel: 'OFFICIAL',
        sentBy: 'AGENT',
        deliveryStatus: message.deliveryStatus,
        createdAt: new Date().toISOString(),
        botTrace: null,
        type: 'template',
        templatePayload: message.templatePayload,
      })
      setPickerOpen(false)
      setTemplateForm(null)
      setTemplateParamValues([])
      setLtoExpiration('')
      setCouponCode('')
    } catch {
      setSendError('Gagal mengirim template')
    } finally {
      setTemplateSending(false)
    }
  }

  const templatesByCategory = templates.reduce<Record<string, QuickReplyTemplate[]>>((acc, t) => {
    const category = t.category ?? UNCATEGORIZED_LABEL
    ;(acc[category] ??= []).push(t)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-white p-3">
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 rounded border-l-2 border-brand bg-secondary px-2.5 py-1.5 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-brand">Membalas {SENDER_LABEL[replyingTo.sentBy] ?? replyingTo.sentBy}</p>
            <p className="truncate text-muted-foreground">
              {replyingTo.content ? formatWhatsAppText(replyingTo.content) : replyingTo.type && replyingTo.type !== 'text' ? `[${replyingTo.type}]` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Batalkan balasan"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}
      {botEnabled && (
        <button
          type="button"
          onClick={toggleBot}
          className="badge self-start cursor-pointer bg-amber-50 text-amber-700"
        >
          Ambil Alih dari Bot
        </button>
      )}
      {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}
      {pendingFile && (
        <div className="relative w-fit max-w-40 rounded border border-border bg-secondary p-1.5">
          <button
            type="button"
            onClick={() => {
              clearPendingFile()
              setAttachment(null)
            }}
            aria-label="Batalkan lampiran"
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-navy text-xs text-white shadow"
          >
            ✕
          </button>
          {pendingFile.kind === 'image' ? (
            <img src={pendingFile.previewUrl} alt={pendingFile.file.name} className="h-28 w-full rounded object-cover" />
          ) : pendingFile.kind === 'video' ? (
            // No controls -- this is a compose-time preview, not a player; the browser shows
            // the first frame by default with no autoplay/interaction needed.
            <video src={pendingFile.previewUrl} className="h-28 w-full rounded object-cover" muted />
          ) : (
            <div className="flex items-center gap-1.5 px-1 py-6 text-xs">
              <span className="text-lg">{ATTACHMENT_ICON[pendingFile.kind]}</span>
              <span className="min-w-0 truncate">{pendingFile.file.name}</span>
            </div>
          )}
          {uploading && <p className="mt-1 text-center text-[10px] text-muted-foreground">Mengunggah...</p>}
        </div>
      )}
      {pickerOpen && templateForm && (
        <Card className="space-y-3 p-3">
          <h4 className="text-sm font-medium">Kirim Template: {templateForm.name}</h4>
          {templateForm.variables?.map((varName, i) => (
            <div key={varName} className="space-y-1">
              <label htmlFor={`tpl-param-${i}`} className="text-xs text-muted-foreground">
                {varName}
              </label>
              <Input
                id={`tpl-param-${i}`}
                aria-label={varName}
                value={templateParamValues[i] ?? ''}
                onChange={(e) =>
                  setTemplateParamValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                }
              />
            </div>
          ))}
          {templateForm.format === 'LTO' && (
            <div className="space-y-1">
              <label htmlFor="tpl-lto-expiration" className="text-xs text-muted-foreground">
                Waktu kadaluarsa penawaran
              </label>
              <Input
                id="tpl-lto-expiration"
                aria-label="Waktu kadaluarsa penawaran"
                type="datetime-local"
                value={ltoExpiration}
                onChange={(e) => setLtoExpiration(e.target.value)}
              />
            </div>
          )}
          {templateForm.format === 'COUPON' && (
            <div className="space-y-1">
              <label htmlFor="tpl-coupon-code" className="text-xs text-muted-foreground">
                Kode kupon
              </label>
              <Input
                id="tpl-coupon-code"
                aria-label="Kode kupon"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                templateSending ||
                (templateForm.format === 'LTO' && !ltoExpiration) ||
                (templateForm.format === 'COUPON' && !couponCode.trim())
              }
              onClick={() => sendTemplate(templateForm, templateParamValues)}
            >
              Kirim Template
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setTemplateForm(null)}>
              Batal
            </Button>
          </div>
        </Card>
      )}
      {pickerOpen && !templateForm && (
        <Card className="max-h-80 space-y-3 overflow-y-auto p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground">
              {channel === 'OFFICIAL' ? 'TEMPLATE RESMI (META)' : 'BALASAN CEPAT'}
            </h4>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              aria-label="Tutup daftar template"
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          {/* Only the templates sendable on whichever channel is currently selected: an
              OFFICIAL template is a real Cloud API dispatch (see sendTemplate) that has no
              Unofficial equivalent, and a QUICK_REPLY template never goes through Meta at all
              -- it just pastes its body into the plain-text input, which only makes sense for
              the channel actually selected below. */}
          {channel === 'OFFICIAL' ? (
            officialTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada template resmi yang disetujui.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {officialTemplates.map((t) => (
                  <TemplatePreviewBubble key={t.id} template={t} onClick={() => selectOfficialTemplate(t)} />
                ))}
              </div>
            )
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada balasan cepat.</p>
          ) : (
            Object.entries(templatesByCategory).map(([category, items]) => (
              <div key={category} className="space-y-1.5">
                {/* .toUpperCase() transforms the actual text node (not just CSS text-transform)
                    so a category heading can never collide with an item's own `name` text when
                    they happen to be the same string — RTL's getByText/findByText would otherwise
                    throw on the ambiguous match. */}
                <h5 className="text-[10px] font-semibold tracking-wide text-muted-foreground">
                  {category.toUpperCase()}
                </h5>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((t) => (
                    <TemplatePreviewBubble key={t.id} template={{ ...t, format: 'TEXT' }} onClick={() => selectTemplate(t.body)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>
      )}
      {templateError && <p className="text-xs text-destructive">{templateError}</p>}
      {sendError && <p className="text-xs text-destructive">{sendError}</p>}
      <div className="flex items-center gap-2">
        <Select
          value={channel}
          onChange={(e) => selectChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')}
          className="w-auto"
          aria-label="Channel"
        >
          <option value="OFFICIAL">Official</option>
          <option value="UNOFFICIAL">Unofficial</option>
        </Select>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttachmentSelected} />
        <div ref={attachMenuRef} className="relative">
          {/* A single "+" trigger for everything besides plain text -- Foto & Video, Dokumen,
              and Template are three peers in the same menu, not a separate standalone
              "Template" button living outside it. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Tambah lampiran atau template"
            onClick={() => setAttachMenuOpen((prev) => !prev)}
            disabled={uploading}
          >
            +
          </Button>
          {attachMenuOpen && (
            <Card className="absolute bottom-full left-0 z-10 mb-1 w-44 space-y-0.5 p-1">
              <button
                type="button"
                onClick={() => pickAttachment('media')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                🖼️ Foto &amp; Video
              </button>
              <button
                type="button"
                onClick={() => pickAttachment('document')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                📄 Dokumen
              </button>
              <button
                type="button"
                onClick={openTemplatePicker}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                📋 Template
              </button>
            </Card>
          )}
        </div>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Reply on WhatsApp..."
          aria-label="Pesan"
        />
        <Button onClick={send} disabled={sending || uploading}>
          Kirim
        </Button>
      </div>
    </div>
  )
}
