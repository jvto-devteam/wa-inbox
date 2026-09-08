import { formatWhatsAppText } from '@/lib/whatsapp-format'

export type PreviewButton = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phoneNumber?: string }
export type PreviewCard = { mediaType: 'IMAGE' | 'VIDEO'; mediaUrl: string; bodyText: string; buttons: PreviewButton[] }
export type PreviewHeader =
  | { type: 'NONE' }
  | { type: 'TEXT'; text: string }
  | { type: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; mediaUrl: string }
export type TemplatePreviewData = {
  name: string
  body: string
  format: string
  header?: PreviewHeader | null
  footer?: string | null
  cards?: PreviewCard[] | null
  offerTitle?: string | null
  buttons?: PreviewButton[] | null
  couponButtonText?: string | null
}

const BUTTON_ICON: Record<PreviewButton['type'], string> = { QUICK_REPLY: '', URL: '🔗 ', PHONE_NUMBER: '📞 ' }

/**
 * A real WhatsApp-bubble-style preview -- the same visual language waba-jvto's own
 * TemplateInlinePreview uses (a beige wallpaper wrapper around a white rounded bubble, blue
 * button rows) so an agent picking a template sees roughly what the customer will actually
 * get, not just a name on a badge. Unlike waba-jvto's version (which only shows a gray
 * placeholder box for media, since it has no real image to load), carousel cards here use
 * their actual mediaUrl -- wa-inbox always has one, so a placeholder would be a downgrade.
 */
export function TemplatePreviewBubble({ template, onClick }: { template: TemplatePreviewData; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Latar hangat WhatsApp dipertahankan: ia menandai "beginilah yang dilihat pelanggan",
      // bukan permukaan aplikasi ini. Yang dibuang: bayangan di gelembungnya (garis yang
      // memisahkan sekarang) dan hover scale -- kartu yang membesar di bawah kursor adalah
      // gerakan tanpa makna. Sekarang bingkainya yang menegas ke warna aksen saat dipilih.
      className="focus-ring block w-full rounded-lg border border-transparent bg-[#e5ddd5] p-2 text-left transition-colors hover:border-accent"
    >
      <div className="mx-auto max-w-56 overflow-hidden rounded-md border border-black/5 bg-surface">
        {template.format === 'LTO' && template.offerTitle && (
          <div className="bg-warning-subtle px-2.5 py-1 text-[11px] font-medium text-warning">{template.offerTitle}</div>
        )}
        {template.header?.type === 'TEXT' && (
          <p className="px-2.5 pt-2 text-xs font-semibold text-ink">{template.header.text}</p>
        )}
        {template.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(template.header.type) && (
          <div className="p-2.5 pb-0">
            {template.header.type === 'VIDEO' ? (
              <video src={template.header.mediaUrl} className="h-24 w-full rounded object-cover" muted />
            ) : template.header.type === 'IMAGE' ? (
              <img src={template.header.mediaUrl} alt="" className="h-24 w-full rounded object-cover" />
            ) : (
              <div className="flex h-16 items-center justify-center rounded bg-black/5 text-2xl">📎</div>
            )}
          </div>
        )}
        <div className="space-y-1.5 p-2.5">
          <p className="line-clamp-3 text-xs text-ink">{formatWhatsAppText(template.body)}</p>
          {template.footer && <p className="text-[11px] text-ink-subtle">{template.footer}</p>}
          {template.format === 'CAROUSEL' && template.cards && template.cards.length > 0 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {template.cards.map((c, i) => (
                <div key={i} className="w-20 shrink-0 overflow-hidden rounded-sm border border-line">
                  {c.mediaType === 'VIDEO' ? (
                    <video src={c.mediaUrl} className="h-14 w-full object-cover" muted />
                  ) : (
                    <img src={c.mediaUrl} alt={c.bodyText} className="h-14 w-full object-cover" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {template.format === 'COUPON' && template.couponButtonText && (
          <div className="border-t border-line py-1.5 text-center text-[11px] font-medium text-accent">
            {template.couponButtonText}
          </div>
        )}
        {template.buttons && template.buttons.length > 0 && (
          <div className="divide-y divide-line border-t border-line">
            {template.buttons.slice(0, 3).map((b, i) => (
              <div key={i} className="py-1.5 text-center text-[11px] font-medium text-accent">
                {BUTTON_ICON[b.type]}
                {b.text}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 truncate text-center text-[10px] font-medium text-ink-muted">{template.name}</p>
    </button>
  )
}
