'use client'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Bot, BotOff, FileText, Film, Image as ImageIcon, Music, Paperclip, Plus, SendHorizontal, X } from 'lucide-react'
import { SENDER_LABEL, type MessageView } from './MessageBubble'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Card } from '@/components/ui/card'
import { fetchJson } from '@/lib/fetch-json'
import { formatWhatsAppText } from '@/lib/whatsapp-format'
import { TemplatePreviewBubble, type PreviewButton, type PreviewCard } from './TemplatePreviewBubble'
import { bookingVariableFields, resolveVariableField, type VariableField } from '@/lib/booking/variable-fields'
import { extractVariableNumbers, interpolateVariables } from '@/lib/template-variables'
import type { BookingData } from '@/lib/booking/client'

// Maps a variable's 1-indexed position (as a string key, e.g. "1" for {{1}}) to a
// src/lib/booking/variable-fields.ts field key, chosen once at template-creation time --
// applies to OFFICIAL `variables` (positional) and QUICK_REPLY `{{n}}` alike.
type VariableBindings = Record<string, string> | null
type QuickReplyTemplate = { id: string; name: string; category: string | null; body: string; variableBindings?: VariableBindings }
type OfficialTemplate = {
  id: string
  name: string
  body: string
  variables: string[] | null
  variableBindings?: VariableBindings
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
const ATTACHMENT_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
}
// Placeholder kotak tulis. Bentuk lamanya 'Reply on WhatsApp...' -- satu-satunya kalimat
// berbahasa Inggris di layar yang seluruhnya berbahasa Indonesia, dan ia menyebut aplikasi
// lain, bukan pekerjaan yang sedang dilakukan di sini.
export const COMPOSER_PLACEHOLDER = 'Tulis balasan ke pelanggan...'
// Batas tumbuh kotak tulis, dalam piksel. Di atas ini ia menggulung sendiri alih-alih terus
// mendorong riwayat percakapan keluar layar -- kira-kira enam baris di 15px/22px.
const COMPOSER_MAX_HEIGHT = 132

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

// Lets an agent fill a template variable (OFFICIAL {{n}} param or QUICK_REPLY {{n}} in the raw
// body) from the current conversation's contact/booking data instead of typing it by hand --
// e.g. the customer's name, the booked package, the remaining balance. `fields` is computed
// once per conversation (see ThreadView) from whatever the real booking API actually returned,
// so the options offered here are exactly whatever data exists for THIS customer, no more.
function VariableSourceSelect({ fields, onPick }: { fields: VariableField[]; onPick: (value: string) => void }) {
  if (fields.length === 0) return null
  return (
    <select
      aria-label="Isi dari data booking/kontak"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value)
        e.target.value = ''
      }}
      className="field-focus select-chevron h-8 shrink-0 rounded-md border border-line-strong bg-surface pr-6 pl-2 text-xs text-ink-muted outline-none"
    >
      <option value="">Isi dari data...</option>
      {fields.map((f, i) => (
        <option key={i} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  )
}

export function ComposeBox({
  conversationId,
  botEnabled,
  replyingTo,
  contactName = null,
  bookingData = null,
  isTest = false,
  onCancelReply,
  onSent,
  onBotToggled,
}: {
  conversationId: string
  botEnabled: boolean
  replyingTo?: MessageView | null
  // This conversation's contact name + real booking payload -- resolves a template variable
  // bound to a data field (src/lib/booking/variable-fields.ts) at selection time, and backs
  // the manual "Isi dari data..." picker for anything left unbound.
  contactName?: string | null
  bookingData?: BookingData | null
  // The pinned sandbox conversation (src/lib/test-conversation.ts): every send here is
  // simulated as if it were the customer's own inbound message, dispatched through
  // /api/conversations/[id]/test-message instead of /api/send, so nothing ever reaches a
  // real WhatsApp number. Channel/attachments/templates are all agent-outbound concepts
  // that don't apply to "typing as the customer", so they're hidden in this mode.
  isTest?: boolean
  onCancelReply?: () => void
  onSent: (m: MessageView) => void
  onBotToggled: (enabled: boolean) => void
}) {
  const variableFields = bookingVariableFields(contactName, bookingData)
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // The OFFICIAL template currently being filled in (its variables need values before it can
  // be dispatched) -- null means the picker is just showing the list, not a param form.
  const [templateForm, setTemplateForm] = useState<OfficialTemplate | null>(null)
  const [templateParamValues, setTemplateParamValues] = useState<string[]>([])
  const [templateSending, setTemplateSending] = useState(false)
  // QUICK_REPLY {{n}} variables -- mirrors templateForm/templateParamValues above, but for the
  // plain-text quick-reply path (no Cloud API dispatch, no LTO/COUPON runtime fields). null
  // means the picker is just showing the list, not a param form.
  const [quickReplyForm, setQuickReplyForm] = useState<{ template: QuickReplyTemplate; varNumbers: number[] } | null>(null)
  const [quickReplyParamValues, setQuickReplyParamValues] = useState<string[]>([])
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

  // Kotak tulis tumbuh mengikuti isinya, bukan mengikuti jumlah baris baru. Bentuk sebelumnya
  // menghitung '\n' (rows={text.split('\n').length}), jadi satu paragraf panjang yang
  // membungkus ke lima baris di layar tetap ditampilkan setinggi satu baris dan operator
  // menulis ke dalam lubang intip. Diukur dari scrollHeight sesudah tinggi dikembalikan ke
  // auto -- satu-satunya cara membaca tinggi konten sebenarnya yang sudah menyusut.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    // jsdom melaporkan scrollHeight 0; jangan menulis tinggi 0px ke elemen sungguhan.
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [text])

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
      const res = await fetch(isTest ? `/api/conversations/${conversationId}/test-message` : '/api/send', {
        method: 'POST',
        body: JSON.stringify(
          isTest
            ? { text }
            : { conversationId, text: text || undefined, channel, replyToId: replyingTo?.id, media: attachment ?? undefined }
        ),
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
      // A test-room send simulates the customer's own inbound message -- the bot's reply (if
      // any) arrives separately through the same SSE broadcast a real inbound message would
      // trigger (see ThreadView's message.created handler), not from this response.
      onSent(
        isTest
          ? {
              id: message.id,
              direction: 'INBOUND',
              content: text,
              channel: message.channel,
              sentBy: 'CUSTOMER',
              deliveryStatus: message.deliveryStatus,
              createdAt: message.createdAt,
              botTrace: null,
              type: 'text',
              mediaUrl: null,
              mimeType: null,
              fileName: null,
              replyTo: null,
            }
          : {
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
            }
      )
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

  // A binding chosen at template-creation time (Template.variableBindings, keyed by 1-indexed
  // position) resolves automatically against THIS conversation's contact/booking data -- the
  // agent never has to pick it again per send. A position with no binding just starts blank,
  // same as before; the manual "Isi dari data..." picker (VariableSourceSelect) still covers
  // that case, and either way the agent can edit the pre-filled value before sending.
  function resolveBoundValue(bindings: VariableBindings | undefined, position: number): string {
    const key = bindings?.[String(position)]
    return key ? (resolveVariableField(key, contactName, bookingData) ?? '') : ''
  }

  // A quick reply with no {{n}} placeholders pastes straight into the text input, same as
  // before. One that has them opens the same kind of param form OFFICIAL templates use, so the
  // agent fills real values (bound ones pre-filled, the rest optionally from variableFields)
  // before it lands in the input.
  function selectTemplate(t: QuickReplyTemplate) {
    const varNumbers = extractVariableNumbers(t.body)
    if (varNumbers.length === 0) {
      setText(t.body)
      setPickerOpen(false)
      return
    }
    setQuickReplyForm({ template: t, varNumbers })
    setQuickReplyParamValues(varNumbers.map((n) => resolveBoundValue(t.variableBindings, n)))
  }

  function confirmQuickReply() {
    if (!quickReplyForm) return
    const valuesByNumber = Object.fromEntries(
      quickReplyForm.varNumbers.map((n, i) => [n, quickReplyParamValues[i] ?? ''])
    )
    setText(interpolateVariables(quickReplyForm.template.body, valuesByNumber))
    setPickerOpen(false)
    setQuickReplyForm(null)
    setQuickReplyParamValues([])
  }

  function selectOfficialTemplate(t: OfficialTemplate) {
    // LTO/COUPON always need a runtime value only the agent can supply (a real expiration or
    // a real code) -- unlike a variable-less BASIC/CAROUSEL template, there's no zero-input
    // path to dispatch these immediately.
    if ((t.variables && t.variables.length > 0) || t.format === 'LTO' || t.format === 'COUPON') {
      setTemplateForm(t)
      setTemplateParamValues((t.variables ?? []).map((_, i) => resolveBoundValue(t.variableBindings, i + 1)))
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
    // Menempel di dasar kolom thread. `shrink-0` supaya ia tidak pernah diperas oleh riwayat
    // di atasnya: kotak tulis adalah alat kerja, bukan sisa ruang.
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface p-2.5">
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 rounded-sm border-l-2 border-accent bg-surface-sunken px-2.5 py-1.5 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-ink">Membalas {SENDER_LABEL[replyingTo.sentBy] ?? replyingTo.sentBy}</p>
            <p className="truncate text-ink-muted">
              {replyingTo.content ? formatWhatsAppText(replyingTo.content) : replyingTo.type && replyingTo.type !== 'text' ? `[${replyingTo.type}]` : ''}
            </p>
          </div>
          <IconButton
            size="sm"
            label="Batalkan balasan"
            icon={<X strokeWidth={2} />}
            onClick={onCancelReply}
          />
        </div>
      )}
      {/* Siapa yang menjawab chat ini, dan tombol untuk menukarnya. Sebelumnya dua tombol pil
          berwarna kuning/hijau tanpa kalimat apa pun di sebelahnya, jadi keadaan sekarang
          harus disimpulkan dari tombolnya sendiri -- yang justru menyebut keadaan BERIKUTNYA. */}
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        {botEnabled ? (
          <Bot aria-hidden="true" className="size-3.5 shrink-0 text-ink-subtle" strokeWidth={1.75} />
        ) : (
          <BotOff aria-hidden="true" className="size-3.5 shrink-0 text-ink-subtle" strokeWidth={1.75} />
        )}
        <span className="min-w-0 truncate">
          {botEnabled ? 'Bot menjawab chat ini otomatis' : 'Chat ini dijawab agen'}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={toggleBot} className="ml-auto">
          {botEnabled ? 'Ambil Alih dari Bot' : 'Aktifkan Bot untuk Chat Ini'}
        </Button>
      </div>
      {attachmentError && (
        <p role="alert" className="text-xs text-danger">
          {attachmentError}
        </p>
      )}
      {pendingFile && (
        <div className="relative w-fit max-w-40 rounded-md border border-line bg-surface-sunken p-1.5">
          <button
            type="button"
            onClick={() => {
              clearPendingFile()
              setAttachment(null)
            }}
            aria-label="Batalkan lampiran"
            className="focus-ring absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-ink text-white hover:bg-ink/85"
          >
            <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
          </button>
          {pendingFile.kind === 'image' ? (
            <img src={pendingFile.previewUrl} alt={pendingFile.file.name} className="h-28 w-full rounded object-cover" />
          ) : pendingFile.kind === 'video' ? (
            // No controls -- this is a compose-time preview, not a player; the browser shows
            // the first frame by default with no autoplay/interaction needed.
            <video src={pendingFile.previewUrl} className="h-28 w-full rounded object-cover" muted />
          ) : (
            <div className="flex items-center gap-1.5 px-1 py-6 text-xs text-ink">
              {(() => {
                const Icon = ATTACHMENT_ICON[pendingFile.kind]
                return <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
              })()}
              <span className="min-w-0 truncate">{pendingFile.file.name}</span>
            </div>
          )}
          {uploading && <p className="mt-1 text-center text-[10px] text-ink-muted">Mengunggah...</p>}
        </div>
      )}
      {pickerOpen && templateForm && (
        <Card className="space-y-3 p-3">
          <h4 className="text-base font-semibold text-ink">Kirim Template: {templateForm.name}</h4>
          {templateForm.variables?.map((varName, i) => (
            <div key={varName} className="space-y-1">
              <label htmlFor={`tpl-param-${i}`} className="text-xs font-medium text-ink-muted">
                {varName}
              </label>
              <div className="flex gap-1.5">
                <Input
                  id={`tpl-param-${i}`}
                  aria-label={varName}
                  value={templateParamValues[i] ?? ''}
                  onChange={(e) =>
                    setTemplateParamValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                />
                <VariableSourceSelect
                  fields={variableFields}
                  onPick={(value) => setTemplateParamValues((prev) => prev.map((v, idx) => (idx === i ? value : v)))}
                />
              </div>
            </div>
          ))}
          {templateForm.format === 'LTO' && (
            <div className="space-y-1">
              <label htmlFor="tpl-lto-expiration" className="text-xs font-medium text-ink-muted">
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
              <label htmlFor="tpl-coupon-code" className="text-xs font-medium text-ink-muted">
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
      {pickerOpen && quickReplyForm && (
        <Card className="space-y-3 p-3">
          <h4 className="text-base font-semibold text-ink">Balasan Cepat: {quickReplyForm.template.name}</h4>
          {quickReplyForm.varNumbers.map((n, i) => (
            <div key={n} className="space-y-1">
              <label htmlFor={`qr-param-${i}`} className="text-xs font-medium text-ink-muted">
                {`{{${n}}}`}
              </label>
              <div className="flex gap-1.5">
                <Input
                  id={`qr-param-${i}`}
                  aria-label={`{{${n}}}`}
                  value={quickReplyParamValues[i] ?? ''}
                  onChange={(e) =>
                    setQuickReplyParamValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                />
                <VariableSourceSelect
                  fields={variableFields}
                  onPick={(value) => setQuickReplyParamValues((prev) => prev.map((v, idx) => (idx === i ? value : v)))}
                />
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={confirmQuickReply}>
              Gunakan Balasan
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQuickReplyForm(null)
                setQuickReplyParamValues([])
              }}
            >
              Batal
            </Button>
          </div>
        </Card>
      )}
      {pickerOpen && !templateForm && !quickReplyForm && (
        <Card className="max-h-80 space-y-3 overflow-y-auto p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              {channel === 'OFFICIAL' ? 'TEMPLATE RESMI (META)' : 'BALASAN CEPAT'}
            </h4>
            <IconButton
              size="sm"
              label="Tutup daftar template"
              icon={<X strokeWidth={2} />}
              onClick={() => setPickerOpen(false)}
            />
          </div>
          {/* Only the templates sendable on whichever channel is currently selected: an
              OFFICIAL template is a real Cloud API dispatch (see sendTemplate) that has no
              Unofficial equivalent, and a QUICK_REPLY template never goes through Meta at all
              -- it just pastes its body into the plain-text input, which only makes sense for
              the channel actually selected below. */}
          {channel === 'OFFICIAL' ? (
            officialTemplates.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">Belum ada template resmi yang disetujui.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {officialTemplates.map((t) => (
                  <TemplatePreviewBubble key={t.id} template={t} onClick={() => selectOfficialTemplate(t)} />
                ))}
              </div>
            )
          ) : templates.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-muted">Belum ada balasan cepat.</p>
          ) : (
            Object.entries(templatesByCategory).map(([category, items]) => (
              <div key={category} className="space-y-1.5">
                {/* .toUpperCase() transforms the actual text node (not just CSS text-transform)
                    so a category heading can never collide with an item's own `name` text when
                    they happen to be the same string — RTL's getByText/findByText would otherwise
                    throw on the ambiguous match. */}
                <h5 className="text-[10px] font-semibold tracking-wide text-ink-subtle">
                  {category.toUpperCase()}
                </h5>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((t) => (
                    <TemplatePreviewBubble key={t.id} template={{ ...t, format: 'TEXT' }} onClick={() => selectTemplate(t)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>
      )}
      {templateError && (
        <p role="alert" className="text-xs text-danger">
          {templateError}
        </p>
      )}
      {sendError && (
        <p role="alert" className="text-xs text-danger">
          {sendError}
        </p>
      )}
      {/* Satu baris alat: jalur kirim, lampiran/template, kotak tulis, kirim. items-end supaya
          tombol tetap sejajar dasar kotak tulis saat kotaknya tumbuh, bukan melompat ke tengah. */}
      <div className="flex items-end gap-1.5">
        {!isTest && (
          <>
            <Select
              value={channel}
              onChange={(e) => selectChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')}
              className="w-auto shrink-0 text-sm"
              aria-label="Channel"
            >
              <option value="OFFICIAL">Official</option>
              <option value="UNOFFICIAL">Unofficial</option>
            </Select>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttachmentSelected} />
            <div ref={attachMenuRef} className="relative shrink-0">
              {/* A single "+" trigger for everything besides plain text -- Foto & Video, Dokumen,
                  and Template are three peers in the same menu, not a separate standalone
                  "Template" button living outside it. */}
              <IconButton
                variant="outline"
                label="Tambah lampiran atau template"
                icon={<Plus strokeWidth={2} />}
                aria-expanded={attachMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAttachMenuOpen((prev) => !prev)}
                disabled={uploading}
              />
              {attachMenuOpen && (
                <Card role="menu" className="absolute bottom-full left-0 z-10 mb-1.5 w-48 space-y-0.5 p-1 shadow-popover">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pickAttachment('media')}
                    className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-base text-ink hover:bg-surface-sunken"
                  >
                    <ImageIcon aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                    Foto &amp; Video
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pickAttachment('document')}
                    className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-base text-ink hover:bg-surface-sunken"
                  >
                    <Paperclip aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                    Dokumen
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openTemplatePicker}
                    className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-base text-ink hover:bg-surface-sunken"
                  >
                    <FileText aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                    Template
                  </button>
                </Card>
              )}
            </div>
          </>
        )}
        {/* max-h-33 = 33 x 4px = 132px = COMPOSER_MAX_HEIGHT di atas. Kelas literal, bukan
            dirangkai dari konstanta, supaya pemindai kelas Tailwind melihatnya. */}
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Plain Enter sends. Shift/Ctrl/Cmd+Enter falls through to the textarea's own
            // default behavior (insert a newline) -- nothing to handle for those explicitly.
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={isTest ? 'Ketik sebagai customer untuk menguji bot...' : COMPOSER_PLACEHOLDER}
          aria-label="Pesan"
          rows={1}
          className="max-h-33 min-h-8 resize-none py-1.5 text-md leading-snug"
        />
        <Button onClick={send} disabled={sending || uploading} className="shrink-0">
          <SendHorizontal aria-hidden="true" className="size-4" strokeWidth={1.75} />
          Kirim
        </Button>
      </div>
      <p className="text-[11px] text-ink-subtle">
        Enter mengirim. Shift + Enter membuat baris baru.
      </p>
    </div>
  )
}
