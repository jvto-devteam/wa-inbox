'use client'

// Menu Template pesan: teks pesan sistem (reminder, konfirmasi, kabar internal) yang dikirim
// legacy/new-backoffice lewat wa-inbox. Di pratinjau /new, simpan hanya mengubah salinan di browser;
// editor yang benar-benar berlaku tetap /templates → Template Sistem.
import { useState } from 'react'
import { AGS } from '@/lib/new/mock-data'
import { TPL_CATS, exampleValues, initialTemplates, tplAgent, tplCategory } from '@/lib/new/templates'
import { renderSystemTemplate, validateTemplateBody } from '@/lib/system-templates/render'
import { useNew } from '../store'

type Css = React.CSSProperties & Record<`--${string}`, string>
const AUD = { CUSTOMER: ['info', 'Tamu'], INTERNAL: ['neu', 'Internal'] } as const

export function TemplateDrawer({ tplKey, onClose }: { tplKey: string; onClose: () => void }) {
  const { s, set, toast } = useNew()
  const t = s.tpl.find((x) => x.key === tplKey)
  const [body, setBody] = useState(t?.body ?? '')
  if (!t) return null
  const errs = validateTemplateBody(body, t.variables)
  const prev = renderSystemTemplate({ body, variables: t.variables }, exampleValues(t))
  const ag = tplAgent(t.key)
  const dirty = body !== t.body
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
            <input type="checkbox" checked={t.isActive} aria-label="Template aktif"
              onChange={(e) => { const on = e.target.checked; set((d) => { const x = d.tpl.find((y) => y.key === t.key); if (x) x.isActive = on }); toast(on ? 'Template diaktifkan' : 'Template dinonaktifkan') }} />
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
        <h4>Pratinjau dengan contoh</h4>
        <div className="log">{prev.ok ? prev.text : 'Variabel wajib kosong: ' + prev.missing.join(', ')}</div>
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        <button className="btn pri" disabled={!dirty || errs.length > 0} onClick={() => {
          set((d) => { const x = d.tpl.find((y) => y.key === t.key); if (x) x.body = body })
          toast('Tersimpan (pratinjau, belum ke server)')
        }}>Simpan</button>
        <button className="btn" onClick={() => {
          const seed = initialTemplates().find((x) => x.key === t.key)
          if (seed) setBody(seed.body)
        }}>Kembalikan teks awal</button>
      </div>
    </div>
  )
}

export function TemplateView() {
  const st = useNew()
  const { s, set } = st
  const q = s.tq.trim().toLowerCase()
  const cats = ['Semua', ...TPL_CATS, 'Lainnya'].filter((c) => c === 'Semua' || s.tpl.some((t) => tplCategory(t.key) === c))
  const L = s.tpl.filter((t) =>
    (s.tcat === 'Semua' || tplCategory(t.key) === s.tcat) &&
    (!q || (t.name + ' ' + t.key + ' ' + t.description).toLowerCase().includes(q)))
  const off = s.tpl.filter((t) => !t.isActive).length
  const kpi: [string, number, string][] = [
    ['Template', s.tpl.length, 'pesan sistem'],
    ['Ke tamu', s.tpl.filter((t) => t.audience === 'CUSTOMER').length, 'reminder & konfirmasi'],
    ['Internal', s.tpl.filter((t) => t.audience === 'INTERNAL').length, 'crew, vendor, hotel, tim'],
    ['Nonaktif', off, off ? 'permintaan kirim ditolak' : 'semua aktif'],
  ]
  return (
    <section className="view fx" id="v-template">
      <div className="grid g4" id="t-kpi" style={{ marginBottom: 12 }}>
        {kpi.map((k) => <div key={k[0]} className="card kpi"><div className="l">{k[0]}</div><div className="v">{k[1]}</div><div className="d">{k[2]}</div></div>)}
      </div>
      <div className="chips" id="t-chips">
        {cats.map((c) => (
          <button key={c} className={c === s.tcat ? 'on' : ''} onClick={() => set((d) => { d.tcat = c })}>
            {c} {c === 'Semua' ? s.tpl.length : s.tpl.filter((t) => tplCategory(t.key) === c).length}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <input className="in" placeholder="Cari nama atau kunci template" aria-label="Cari template" style={{ maxWidth: 320 }}
          value={s.tq} onChange={(e) => { const v = e.target.value; set((d) => { d.tq = v }) }} />
      </div>
      <div className="card" id="t-list">
        {L.length ? L.map((t) => {
          const ag = tplAgent(t.key)
          return (
            <div key={t.key} className="item" style={{ cursor: 'pointer' }} onClick={(e) => {
              if ((e.target as HTMLElement).closest('label,input,button')) return
              st.drawer({ kind: 'template', key: t.key })
            }}>
              <div style={{ minWidth: 0 }}>
                <b>{t.name}</b>{' '}
                <span className={'pill ' + AUD[t.audience][0]}>{AUD[t.audience][1]}</span>{' '}
                <span className="pill neu">{tplCategory(t.key)}</span>{' '}
                {ag && <span className="ag" style={{ '--c': `var(${AGS[ag][1]})`, marginLeft: 4 } as Css}>{AGS[ag][0]}</span>}
                <p style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12 }}>{t.key}</p>
                {t.description && <p>{t.description}</p>}
              </div>
              <label className="sw" title={t.isActive ? 'Aktif' : 'Nonaktif'}>
                <input type="checkbox" checked={t.isActive} aria-label={'Aktif: ' + t.name}
                  onChange={(e) => { const on = e.target.checked; set((d) => { const x = d.tpl.find((y) => y.key === t.key); if (x) x.isActive = on }) }} />
                <i />
              </label>
            </div>
          )
        }) : <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Tidak ada template.</div>}
      </div>
    </section>
  )
}
