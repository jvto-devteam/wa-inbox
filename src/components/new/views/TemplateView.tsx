'use client'

// Menu Template pesan (DATA ASLI): teks pesan sistem yang dikirim legacy/new-backoffice lewat wa-inbox.
// Baca GET /api/system-templates, tulis PATCH /api/system-templates/[key] -- route yang sama dengan
// /templates → Template Sistem (keduanya admin). Menonaktifkan template membuat permintaan kirimnya
// ditolak, jadi selalu dikonfirmasi dulu.
import { useState } from 'react'
import { AGS } from '@/lib/new/mock-data'
import { TPL_CATS, exampleValues, initialTemplates, tplAgent, tplCategory } from '@/lib/new/templates'
import type { Tpl } from '@/lib/new/types'
import { renderSystemTemplate, validateTemplateBody } from '@/lib/system-templates/render'
import { Banner, StatStrip } from '../Blocks'
import { NAV_ICON } from '../icons'
import { useNew } from '../store'
import { WaBubble } from '../WaBubble'
import { apiSend, useApi } from '../useApi'

type Css = React.CSSProperties & Record<`--${string}`, string>
const AUD = { CUSTOMER: ['info', 'Tamu'], INTERNAL: ['neu', 'Internal'] } as const

/** Bentuk baris dari API (description boleh null). */
interface ApiTpl extends Omit<Tpl, 'description'> { description: string | null; updatedAt?: string }
const toTpl = (t: ApiTpl): Tpl => ({ ...t, description: t.description ?? '' })

function TemplateDrawer({ t, onClose, onSaved, onToggle }: { t: Tpl; onClose: () => void; onSaved: (t: Tpl) => void; onToggle: (t: Tpl, on: boolean) => void }) {
  const { toast } = useNew()
  const [body, setBody] = useState(t.body)
  const [busy, setBusy] = useState(false)
  const errs = validateTemplateBody(body, t.variables)
  const prev = renderSystemTemplate({ body, variables: t.variables }, exampleValues(t))
  const ag = tplAgent(t.key)
  const dirty = body !== t.body
  const seed = initialTemplates().find((x) => x.key === t.key)
  const save = async () => {
    setBusy(true)
    try {
      const r = await apiSend<ApiTpl>('/api/system-templates/' + encodeURIComponent(t.key), 'PATCH', { body })
      onSaved(toTpl(r))
      toast('Tersimpan. Pesan berikutnya memakai teks ini.')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="drawer" role="dialog" aria-label="Edit template pesan">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 16 }}>{t.name}</b>
          <div className="mut sm" style={{ fontFamily: 'ui-monospace,Menlo,monospace', overflowWrap: 'anywhere' }}>{t.key}</div>
        </div>
        <button className="btn sm" aria-label="Tutup" onClick={onClose}>✕</button>
      </div>
      <div style={{ margin: '8px 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={'pill ' + AUD[t.audience][0]}>{AUD[t.audience][1]}</span>
        <span className="pill neu">{tplCategory(t.key)}</span>
        {ag && <span className="ag" style={{ '--c': `var(${AGS[ag][1]})` } as Css}>{AGS[ag][0]}</span>}
      </div>
      {t.description && <p className="hint">{t.description}</p>}
      <div className="box">
        <div className="set" style={{ padding: 0 }}>
          <div><b>Aktif</b><span className="h">Nonaktif = permintaan kirim dengan template ini ditolak</span></div>
          <label className="sw">
            <input type="checkbox" checked={t.isActive} aria-label="Template aktif" onChange={(e) => onToggle(t, e.target.checked)} />
            <i />
          </label>
        </div>
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Isi pesan</h4>
        <textarea className="ta" style={{ minHeight: 200, fontSize: 13 }} aria-label="Isi pesan" value={body} onChange={(e) => setBody(e.target.value)} />
        {errs.map((e) => <p key={e} className="sm" style={{ color: 'var(--bad)', margin: '4px 0 0' }}>{e}</p>)}
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Variabel</h4>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {t.variables.map((v) => (
            <button key={v.name} type="button" className="pill neu" title={(v.description || '') + (v.example ? ' · contoh: ' + v.example : '')}
              onClick={() => setBody((b) => b + '{' + v.name + '}')}>
              {'{' + v.name + '}'}{v.required ? ' *' : ''}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>* wajib. Klik untuk menambahkan ke akhir teks. Variabel opsional yang kosong membuang barisnya.</p>
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Pratinjau di WhatsApp (nilai contoh)</h4>
        {prev.ok ? <WaBubble text={prev.text} imageUrl={t.imageUrl} /> : <div className="log">Variabel wajib kosong: {prev.missing.join(', ')}</div>}
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        <button className="btn pri" disabled={!dirty || errs.length > 0 || busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        {seed && seed.body !== body && <button className="btn" onClick={() => setBody(seed.body)}>Isi dengan teks awal</button>}
        {dirty && <button className="btn" onClick={() => setBody(t.body)}>Batalkan perubahan</button>}
      </div>
    </div>
  )
}

export function TemplateView() {
  const st = useNew()
  const { s, set, toast } = st
  const api = useApi<{ items: ApiTpl[] }>('/api/system-templates')
  const [open, setOpen] = useState<string | null>(null)
  const all = (api.data?.items ?? []).map(toTpl)
  const q = s.tq.trim().toLowerCase()
  const cats = ['Semua', ...TPL_CATS, 'Lainnya'].filter((c) => c === 'Semua' || all.some((t) => tplCategory(t.key) === c))
  const L = all.filter((t) =>
    (s.tcat === 'Semua' || tplCategory(t.key) === s.tcat) &&
    (!q || (t.name + ' ' + t.key + ' ' + t.description).toLowerCase().includes(q)))
  const off = all.filter((t) => !t.isActive).length
  const tamu = all.filter((t) => t.audience === 'CUSTOMER').length

  const replace = (t: Tpl) => {
    if (!api.data) return
    api.setData({ items: api.data.items.map((x) => (x.key === t.key ? { ...x, ...t } : x)) })
  }
  const toggle = (t: Tpl, on: boolean) => {
    const run = async () => {
      try {
        const r = await apiSend<ApiTpl>('/api/system-templates/' + encodeURIComponent(t.key), 'PATCH', { isActive: on })
        replace(toTpl(r))
        toast(on ? 'Template diaktifkan' : 'Template dinonaktifkan: permintaan kirimnya kini ditolak')
      } catch (e) {
        toast((e as Error).message)
      }
    }
    if (on) run()
    else st.sheet('Nonaktifkan "' + t.name + '"? Pesan yang memakai template ini tidak akan terkirim.', [{ label: 'Nonaktifkan', danger: true, run }])
  }
  const current = open ? all.find((t) => t.key === open) : undefined

  if (api.code === 403) {
    return (
      <section className="view fx" id="v-template">
        <Banner tone="off" icon={NAV_ICON.template} title="Hanya admin" sub="Template pesan sistem hanya bisa dilihat dan diubah akun admin." />
      </section>
    )
  }

  return (
    <section className="view fx" id="v-template">
      <Banner
        tone={api.error ? 'off' : off ? 'warn' : 'info'}
        icon={NAV_ICON.template}
        title={api.loading ? 'Memuat template…' : api.error ? 'Gagal memuat template' : all.length + ' template pesan sistem'}
        sub={api.error || (api.loading ? undefined : tamu + ' ke tamu · ' + (all.length - tamu) + ' internal · ' + (off ? off + ' nonaktif' : 'semua aktif') + ' · dikirim legacy & new-backoffice lewat wa-inbox')}
        right={api.error ? <button className="btn sm" onClick={api.reload}>Coba lagi</button> : undefined}
      />
      <StatStrip
        id="t-hk"
        items={[
          ...(['Reminder', 'Konfirmasi', 'Kabar perubahan'] as const).map((c) => ({
            label: c, value: all.filter((t) => tplCategory(t.key) === c).length, on: s.tcat === c, onClick: () => set((d) => { d.tcat = c }),
          })),
          { label: 'Nonaktif', value: off, tone: off ? 'bad' as const : undefined },
        ]}
      />
      <div className="tabs" id="t-chips">
        {cats.map((c) => (
          <button key={c} className={c === s.tcat ? 'on' : ''} onClick={() => set((d) => { d.tcat = c })}>
            {c}<i>{c === 'Semua' ? all.length : all.filter((t) => tplCategory(t.key) === c).length}</i>
          </button>
        ))}
      </div>
      <div className="g-bar">
        <input className="in" placeholder="Cari nama atau kunci template" aria-label="Cari template"
          value={s.tq} onChange={(e) => { const v = e.target.value; set((d) => { d.tq = v }) }} />
      </div>
      <div className="tpw-grid" id="t-list">
        {api.loading ? <div className="pg-card mut" style={{ textAlign: 'center' }}>Memuat…</div> : L.length ? L.map((t) => {
          const ag = tplAgent(t.key)
          const r = renderSystemTemplate(t, exampleValues(t))
          return (
            <div key={t.key} className={'tpw' + (t.isActive ? '' : ' off')} role="button" tabIndex={0}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('label,input,button')) setOpen(t.key) }}
              onKeyDown={(e) => { if (e.key === 'Enter') setOpen(t.key) }}>
              <div className="tpw-h">
                <div className="n">
                  <b>{t.name}</b>
                  <div className="p">
                    <span className={'pill ' + AUD[t.audience][0]}>Ke {AUD[t.audience][1].toLowerCase()}</span>
                    <span className="pill neu">{tplCategory(t.key)}</span>
                    {ag && <span className="ag" style={{ '--c': `var(${AGS[ag][1]})` } as Css}>{AGS[ag][0]}</span>}
                    {!t.isActive && <span className="pill bad">Nonaktif</span>}
                  </div>
                </div>
                <label className="sw" title={t.isActive ? 'Aktif' : 'Nonaktif'}>
                  <input type="checkbox" checked={t.isActive} aria-label={'Aktif: ' + t.name} onChange={(e) => toggle(t, e.target.checked)} />
                  <i />
                </label>
              </div>
              <WaBubble text={r.ok ? r.text : t.body} imageUrl={t.imageUrl} clamp />
              <div className="tpw-f"><code>{t.key}</code>{t.description && <span title={t.description}>· {t.description.length > 70 ? t.description.slice(0, 70) + '…' : t.description}</span>}</div>
            </div>
          )
        }) : <div className="pg-card mut" style={{ textAlign: 'center' }}>{api.error ? 'Tidak bisa memuat template.' : 'Tidak ada template.'}</div>}
      </div>
      {current && (
        <div id="t-drawer" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <TemplateDrawer key={current.key + (current.body.length)} t={current} onClose={() => setOpen(null)} onSaved={replace} onToggle={toggle} />
        </div>
      )}
    </section>
  )
}
