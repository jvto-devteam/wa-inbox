'use client'

// Bot (DATA ASLI kecuali tab Agent). Route yang dipakai sama dengan /chatbot, /bot-control/* dan
// /settings/knowledge-gaps:
//   GET/PATCH /api/settings, POST /api/bot/mode & /api/bot/indonesia-filter (membalik nilai dan menulis
//   ulang botEnabled semua percakapan -> selalu dikonfirmasi), GET /api/bot-control/knowledge/sources,
//   POST .../[id]/publish, GET /api/bot/knowledge-gaps, POST /api/inbox/gaps/[id]/resolve,
//   POST /api/bot-control/simulate (dry-run), GET /api/bot-control/decisions, GET /api/bot-control/audit-logs.
// Tulis butuh admin (server menolak 403); tombol tulis dimatikan untuk non-admin.
import { useState } from 'react'
import { accuracy } from '@/lib/new/logic'
import { AGD, AGENT_KEYS, AGS, AGT, MODES } from '@/lib/new/mock-data'
import type { AgentKey, AgentMode, State } from '@/lib/new/types'
import { StatStrip } from '../Blocks'
import { useItemTap, useNew } from '../store'
import { apiSend, useApi, useIsAdmin, type ApiState } from '../useApi'

type Css = React.CSSProperties & Record<`--${string}`, string>
const TABS: State['btab'][] = ['Perilaku', 'Agent', 'Knowledge', 'Uji', 'Log']

export interface BotSettingsApi {
  botAutoReplyAll: boolean
  skipBotForIndonesianNumbers: boolean
  handoffOnHumanRequest: boolean
  fallbackReply: string | null
  handoffReply: string | null
  workingHoursStart: string | null
  workingHoursEnd: string | null
}
interface Source { id: string; title: string; status: string; summary: string | null; managed: boolean; latestRevision: { id: string; version: number; status: string } | null; hasDraft: boolean }
interface Gap { id: string; conversationId: string | null; contactName: string | null; topic: string | null; messageText: string | null; missingQuestion: string | null; createdAt: string; resolvedAt: string | null }
interface Decision { id: string; contactName: string | null; status: string; inboundPreview: string | null; startedAt: string; conversationId: string | null }
interface Audit { id: string; actorName: string | null; action: string; entityType: string; entityKey: string | null; reason: string | null; createdAt: string }
interface Sim { status: string; reply: string | null; warnings: string[]; latencyMs: number; wouldSendViaChannel?: string }

const DEC_TONE: Record<string, string> = { REPLIED: 'good', CLARIFIED: 'info', HANDOFF: 'warn', FAILED: 'bad', SKIPPED: 'neu' }
const SIM_TEXT: Record<string, string> = { WOULD_REPLY: 'Bot akan menjawab', WOULD_CLARIFY: 'Bot akan bertanya balik', WOULD_HANDOFF: 'Bot akan menyerahkan ke tim', FAILED: 'Gagal' }
const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const startOfTodayIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

function Sw({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <label className="sw"><input type="checkbox" checked={on} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} /><i /></label>
}

function useSettingsActions(settings: ApiState<BotSettingsApi>) {
  const st = useNew()
  const flip = (path: string, field: 'botAutoReplyAll' | 'skipBotForIndonesianNumbers', next: boolean, ask: string, done: string) => {
    st.sheet(ask, [{ label: 'Ya, terapkan', danger: !next || field === 'skipBotForIndonesianNumbers', run: async () => {
      try {
        const r = await apiSend<Record<string, boolean>>(path, 'POST')
        if (settings.data) settings.setData({ ...settings.data, [field]: r[field] })
        st.toast(done)
      } catch (e) { st.toast((e as Error).message) }
    } }])
  }
  return {
    setAuto: (v: boolean) => flip('/api/bot/mode', 'botAutoReplyAll', v,
      v ? 'Nyalakan bot untuk SEMUA chat? Bot akan menjawab di setiap percakapan.' : 'Matikan bot untuk SEMUA chat? Tim membalas manual.',
      v ? 'Bot menjawab semua chat. Berlaku langsung.' : 'Bot dimatikan. Tim membalas manual.'),
    setSkip: (v: boolean) => flip('/api/bot/indonesia-filter', 'skipBotForIndonesianNumbers', v,
      v ? 'Lewati nomor Indonesia? Bot berhenti menjawab chat bernomor +62.' : 'Jawab juga nomor Indonesia? Bot mulai menjawab chat bernomor +62.',
      v ? 'Nomor Indonesia dilewati bot.' : 'Bot kini juga menjawab nomor Indonesia.'),
    patch: async (body: Partial<BotSettingsApi>, done: string) => {
      try {
        const r = await apiSend<BotSettingsApi>('/api/settings', 'PATCH', body)
        settings.setData(r)
        st.toast(done)
        return true
      } catch (e) { st.toast((e as Error).message); return false }
    },
  }
}

function Perilaku({ settings, admin }: { settings: ApiState<BotSettingsApi>; admin: boolean }) {
  const S = settings.data!
  const act = useSettingsActions(settings)
  const [fb, setFb] = useState(S.fallbackReply ?? '')
  const [hr, setHr] = useState(S.handoffReply ?? '')
  const dirty = fb !== (S.fallbackReply ?? '') || hr !== (S.handoffReply ?? '')
  const hours = S.workingHoursStart && S.workingHoursEnd ? S.workingHoursStart + '–' + S.workingHoursEnd + ' WIB' : 'belum diatur'
  return (
    <div className="grid g2">
      <div className="card">
        <h3>Mode bot</h3>
        <p className="hint">{admin ? 'Berlaku langsung setelah dikonfirmasi' : 'Hanya admin yang bisa mengubah'}</p>
        <div className="set"><div><b>Bot menjawab semua chat</b><span className="h">Mengubah bot di semua percakapan</span></div><Sw on={S.botAutoReplyAll} disabled={!admin} label="Mode bot semua chat" onChange={act.setAuto} /></div>
        <div className="set"><div><b>Lewati nomor Indonesia</b><span className="h">Chat +62 dibalas tim sendiri</span></div><Sw on={S.skipBotForIndonesianNumbers} disabled={!admin} label="Lewati nomor Indonesia" onChange={act.setSkip} /></div>
        <div className="set"><div><b>Serahkan bila tamu minta manusia</b><span className="h">Lapisan eskalasi LLM</span></div><Sw on={S.handoffOnHumanRequest} disabled={!admin} label="Serahkan bila tamu minta manusia" onChange={(v) => act.patch({ handoffOnHumanRequest: v }, v ? 'Eskalasi ke tim menyala' : 'Eskalasi ke tim dimatikan')} /></div>
        <div className="set">
          <div><b>Jam kerja {hours}</b><span className="h">Hanya menambah satu kalimat pada pesan serah-terima. Bot tetap menjawab 24/7.</span></div>
          <a className="pill neu" href="/new/bot/pengaturan">Ubah</a>
        </div>
      </div>
      <div className="card">
        <h3>Kalimat cadangan</h3>
        <p className="hint">Kosong = pakai bawaan kode</p>
        <label className="f">Balasan cadangan<textarea className="ta" value={fb} disabled={!admin} placeholder="(bawaan kode)" onChange={(e) => setFb(e.target.value)} /></label>
        <label className="f">Balasan serah-terima<textarea className="ta" value={hr} disabled={!admin} placeholder="(bawaan kode)" onChange={(e) => setHr(e.target.value)} /></label>
        <button className="btn pri" disabled={!admin || !dirty} onClick={() => act.patch({ fallbackReply: fb, handoffReply: hr }, 'Tersimpan dan langsung berlaku')}>Simpan</button>
      </div>
    </div>
  )
}

function Agents() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const setMode = (k: AgentKey, m: AgentMode) => {
    set((d) => { d.agm[k] = m })
    toast(AGS[k][0] + ': ' + MODES.find((x) => x[0] === m)![1] + '. Berlaku langsung.')
  }
  const lastRun = (k: AgentKey) => {
    const e = s.ae.find((x) => x.a === k && x.d === 'Hari ini')
    return e ? e.t + ' (' + e.c + ')' : 'belum ada hari ini'
  }
  return (
    <>
      <div className="bt-ban warn" style={{ marginBottom: 12 }}>
        <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg></span>
        <div className="tx"><b>Data contoh</b><span>Mode per agent dan jeda semua agent belum tersambung ke sistem. Perubahan di tab ini tidak memengaruhi bot.</span></div>
      </div>
      <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3>Jeda semua agent</h3>
          <p className="hint" style={{ margin: 0 }}>Semua agent berhenti bertindak. Chat tetap masuk dan bisa dibalas manual.</p>
        </div>
        <span className={'pill ' + (s.pause ? 'bad' : 'good')}>{s.pause ? 'Dijeda' : 'Berjalan'}</span>
        <button className={'btn ' + (s.pause ? 'pri' : 'bad')} onClick={() => { const p = !s.pause; set((d) => { d.pause = p }); toast(p ? 'Semua agent dijeda' : 'Semua agent dilanjutkan') }}>
          {s.pause ? 'Lanjutkan semua' : 'Jeda semua'}
        </button>
      </div>
      <div className="card">
        <h3>Agent</h3>
        <p className="hint">Mode menentukan seberapa jauh agent boleh bertindak. Berlaku langsung setelah dipilih.</p>
        {AGENT_KEYS.map((k) => {
          const m = s.agm[k]
          const items = MODES.map(([mk, ml]) => ({ label: ml, checked: m === mk, run: () => setMode(k, mk) }))
          const tot = s.agst[k].ok + s.agst[k].bad
          return (
            <div key={k} className="item" onClick={tap(AGS[k][0] + ' · mode', items)}>
              <div>
                <span className="ag" style={{ '--c': `var(${AGS[k][1]})` } as Css}>{AGS[k][0]}</span>{' '}
                {s.pause ? <span className="pill bad">Dijeda</span> : m === 'mati' ? <span className="pill neu">Mati</span> : null}
                <p>{AGD[k]}</p>
                {AGT[k] && (
                  <p className="agt" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {AGT[k]!.map(([t, w]) => <span key={t} className="pill neu">{t} · {w}</span>)}
                  </p>
                )}
                <p>
                  Akurasi <b>{accuracy(s.agst[k])}%</b> dari {tot} penilaian · Terakhir: {lastRun(k)}
                  {k === 'lead' && ' · ' + s.lead.booking + ' dari ' + s.lead.dikirim + ' lead akhirnya booking'}
                </p>
              </div>
              <span className="mval">{MODES.find((x) => x[0] === m)![1]}</span>
              <div className="seg agseg" role="group" aria-label={'Mode ' + AGS[k][0]}>
                {MODES.map(([mk, ml]) => <button key={mk} className={m === mk ? 'on' : ''} onClick={() => setMode(k, mk)}>{ml}</button>)}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Knowledge({ sources, gaps, admin }: { sources: ApiState<{ items: Source[]; total: number }>; gaps: ApiState<Gap[]>; admin: boolean }) {
  const st = useNew()
  const items = (sources.data?.items ?? []).filter((x) => x.status !== 'ARCHIVED')
  const drafts = items.filter((x) => x.hasDraft)
  const open = (gaps.data ?? []).filter((g) => !g.resolvedAt)
  const publish = (x: Source) => st.sheet('Terbitkan "' + x.title + '"? Bot langsung memakai versi ini.', [{ label: 'Terbitkan', run: async () => {
    try {
      await apiSend('/api/bot-control/knowledge/sources/' + x.id + '/publish', 'POST', {})
      sources.reload()
      st.toast('"' + x.title + '" terbit dan langsung dipakai bot')
    } catch (e) { st.toast((e as Error).message) }
  } }])
  const resolve = async (g: Gap) => {
    try {
      await apiSend('/api/inbox/gaps/' + g.id + '/resolve', 'POST')
      if (gaps.data) gaps.setData(gaps.data.map((x) => (x.id === g.id ? { ...x, resolvedAt: new Date().toISOString() } : x)))
      st.toast('Celah ditandai selesai')
    } catch (e) { st.toast((e as Error).message) }
  }
  const sorted = [...drafts, ...items.filter((x) => !x.hasDraft)]
  return (
    <div className="grid g2">
      <div className="card">
        <div className="pg-card-h" style={{ margin: 0 }}><h3>Knowledge</h3><a className="btn sm" href="/new/bot/knowledge" style={{ marginLeft: 'auto' }}>Kelola / + Tambah</a></div>
        <p className="hint">{items.filter((x) => x.status === 'PUBLISHED').length} terbit · {drafts.length} punya draf. Revisi yang terbit tidak bisa diubah; perubahan = versi baru.</p>
        <div className="db-scroll" style={{ maxHeight: 460 }}>
          {sources.loading ? <div className="mut">Memuat…</div> : sources.error ? <div className="mut">{sources.error}</div> : sorted.map((x) => (
            <div key={x.id} className="item">
              <div style={{ minWidth: 0 }}><b>{x.title}</b><p>{x.latestRevision ? 'Versi ' + x.latestRevision.version : 'Belum ada revisi'}{x.summary ? ' · ' + x.summary : ''}</p></div>
              {x.hasDraft ? (
                <div className="acts">
                  <span className="pill warn">DRAF</span>
                  {admin && <button className="btn sm" onClick={() => publish(x)}>Terbitkan</button>}
                </div>
              ) : <span className={'pill ' + (x.status === 'PUBLISHED' ? 'good' : 'neu')}>{x.status === 'PUBLISHED' ? 'TERBIT' : x.status}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="pg-card-h" style={{ margin: 0 }}><h3>Celah knowledge</h3><a className="btn sm" href="/new/bot/celah" style={{ marginLeft: 'auto' }}>Semua</a></div>
        <p className="hint">Pertanyaan tamu yang belum ada jawabannya · {open.length} terbuka</p>
        <div className="db-scroll" style={{ maxHeight: 460 }}>
          {gaps.loading ? <div className="mut">Memuat…</div> : gaps.error ? <div className="mut">{gaps.error}</div> : open.length ? open.slice(0, 50).map((g) => (
            <div key={g.id} className="item">
              <div style={{ minWidth: 0 }}>
                <b>{g.missingQuestion || g.messageText || '(tanpa teks)'}</b>
                <p>{g.contactName || 'Tanpa nama'}{g.topic ? ' · ' + g.topic : ''} · {when(g.createdAt)}</p>
              </div>
              <div className="acts">
                {g.conversationId && <a className="btn sm" href={'/new/inbox?conversation=' + g.conversationId}>Chat</a>}
                <button className="btn sm" onClick={() => resolve(g)}>Selesai</button>
              </div>
            </div>
          )) : <div className="mut">Tidak ada celah terbuka.</div>}
        </div>
      </div>
    </div>
  )
}

function Uji({ admin }: { admin: boolean }) {
  const [q, setQ] = useState('What time does Ijen open?')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Sim | string | null>(null)
  const run = async () => {
    setBusy(true)
    try { setRes(await apiSend<Sim>('/api/bot-control/simulate', 'POST', { message: q, dryRun: true })) } catch (e) { setRes((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h3>Simulator (dry-run)</h3>
      <p className="hint">Memakai bot sungguhan, tetapi tidak pernah mengirim pesan dan tidak membuat pekerjaan outbound.{admin ? '' : ' Hanya admin.'}</p>
      <label className="f">Pesan tamu<input className="in" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && admin && q.trim()) run() }} /></label>
      <button className="btn pri" disabled={!admin || busy || !q.trim()} onClick={run}>{busy ? 'Menjalankan…' : 'Coba jawab'}</button>
      {res && (typeof res === 'string' ? <div className="log" style={{ marginTop: 10, color: 'var(--bad)' }}>{res}</div> : (
        <div className="log" style={{ marginTop: 10 }}>
          {'[DRY-RUN, tidak ada pesan terkirim]\n'}
          {(SIM_TEXT[res.status] || res.status) + ' · ' + res.latencyMs + ' ms\n'}
          {res.reply ? '\nBalasan:\n' + res.reply + '\n' : ''}
          {res.warnings.length ? '\nPeringatan:\n- ' + res.warnings.join('\n- ') : ''}
        </div>
      ))}
    </div>
  )
}

function Log({ admin }: { admin: boolean }) {
  const { s, set } = useNew()
  const dec = useApi<{ items: Decision[] }>('/api/bot-control/decisions?limit=30')
  const aud = useApi<{ items: Audit[] }>(admin ? '/api/bot-control/audit-logs?limit=30' : null)
  type Row = { k: 'Keputusan' | 'Audit'; at: string; title: string; sub: string; tone: string; tag: string; href?: string }
  const rows: Row[] = [
    ...(dec.data?.items ?? []).map((d): Row => ({ k: 'Keputusan', at: d.startedAt, title: (d.contactName || 'Tanpa nama') + ' · ' + (d.inboundPreview || ''), sub: 'Keputusan bot', tone: DEC_TONE[d.status] || 'neu', tag: d.status, href: d.conversationId ? '/new/inbox?conversation=' + d.conversationId : undefined })),
    ...(aud.data?.items ?? []).map((a): Row => ({ k: 'Audit', at: a.createdAt, title: (a.actorName || 'Sistem') + ' · ' + a.action + ' ' + a.entityType + (a.entityKey ? ' (' + a.entityKey + ')' : ''), sub: a.reason || 'Perubahan pengaturan bot', tone: 'neu', tag: a.action })),
  ].sort((x, y) => y.at.localeCompare(x.at))
  const tabs = admin ? ['Semua', 'Keputusan', 'Audit'] : ['Semua', 'Keputusan']
  const lf = tabs.includes(s.lf) ? s.lf : 'Semua'
  return (
    <>
      <div className="chips">
        {tabs.map((t) => <button key={t} className={t === lf ? 'on' : ''} onClick={() => set((d) => { d.lf = t })}>{t}</button>)}
        <a className="btn sm" href="/new/bot/keputusan" style={{ marginLeft: 'auto' }}>Log lengkap</a>
      </div>
      <div className="card">
        {dec.loading ? <div className="mut">Memuat…</div> : rows.filter((r) => lf === 'Semua' || r.k === lf).map((r, i) => (
          <div key={i} className="item">
            <div style={{ minWidth: 0 }}>
              <span className={'pill ' + r.tone}>{r.tag}</span> <b style={{ marginLeft: 6 }}>{r.href ? <a href={r.href}>{r.title}</a> : r.title}</b>
              <p>{r.sub}</p>
            </div>
            <span className="mut sm" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</span>
          </div>
        ))}
        {dec.error && <div className="mut">{dec.error}</div>}
      </div>
    </>
  )
}

export function BotView() {
  const { s, set } = useNew()
  const admin = useIsAdmin() === true
  const settings = useApi<BotSettingsApi>('/api/settings')
  const sources = useApi<{ items: Source[]; total: number }>('/api/bot-control/knowledge/sources?limit=200')
  const gaps = useApi<Gap[]>('/api/bot/knowledge-gaps')
  const today = useApi<{ total: number }>('/api/bot-control/decisions?limit=1&dateFrom=' + encodeURIComponent(startOfTodayIso()))
  const act = useSettingsActions(settings)
  const S = settings.data
  const pub = (sources.data?.items ?? []).filter((x) => x.status === 'PUBLISHED').length
  const allK = (sources.data?.items ?? []).filter((x) => x.status !== 'ARCHIVED').length
  const openGaps = (gaps.data ?? []).filter((g) => !g.resolvedAt).length
  return (
    <section className="view fx" id="v-bot">
      <div className={'bt-ban' + (!S ? ' info' : S.botAutoReplyAll ? '' : ' off')}>
        <span className="ic" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></svg></span>
        <div className="tx">
          <b>{!S ? (settings.error ? 'Gagal memuat pengaturan bot' : 'Memuat…') : S.botAutoReplyAll ? 'Bot menjawab semua chat' : 'Bot dimatikan, tim membalas manual'}</b>
          <span>{S ? (S.skipBotForIndonesianNumbers ? 'Nomor Indonesia dilewati' : 'Semua nomor dijawab') + ' · ' + (S.handoffOnHumanRequest ? 'serahkan ke tim bila diminta' : 'tanpa eskalasi') + ' · bot tetap 24/7' : settings.error || ''}</span>
        </div>
        {S && <Sw on={S.botAutoReplyAll} disabled={!admin} label="Bot menjawab semua chat" onChange={act.setAuto} />}
      </div>
      <StatStrip
        id="b-hk"
        items={[
          { label: 'Mode bot', value: S ? (S.botAutoReplyAll ? 'Otomatis' : 'Manual') : '…', on: s.btab === 'Perilaku', onClick: () => set((d) => { d.btab = 'Perilaku' }) },
          { label: 'Knowledge terbit', value: sources.data ? pub + '/' + allK : '…', on: s.btab === 'Knowledge', onClick: () => set((d) => { d.btab = 'Knowledge' }) },
          { label: 'Celah knowledge', value: gaps.data ? openGaps : '…', tone: openGaps ? 'warn' : undefined, onClick: () => set((d) => { d.btab = 'Knowledge' }) },
          { label: 'Keputusan hari ini', value: today.data ? today.data.total : '…', on: s.btab === 'Log', onClick: () => set((d) => { d.btab = 'Log' }) },
        ]}
      />
      <div className="tabs" id="b-tabs">
        {TABS.map((k) => <button key={k} className={k === s.btab ? 'on' : ''} onClick={() => set((d) => { d.btab = k })}>{k}</button>)}
      </div>
      <div id="b-body">
        {s.btab === 'Perilaku' ? (S ? <Perilaku key={(S.fallbackReply ?? '') + '|' + (S.handoffReply ?? '')} settings={settings} admin={admin} /> : <div className="card mut">{settings.error || 'Memuat…'}</div>)
          : s.btab === 'Agent' ? <Agents />
          : s.btab === 'Knowledge' ? <Knowledge sources={sources} gaps={gaps} admin={admin} />
          : s.btab === 'Uji' ? <Uji admin={admin} />
          : <Log admin={admin} />}
      </div>
    </section>
  )
}
