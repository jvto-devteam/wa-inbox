// Pengurai format teks WhatsApp untuk pratinjau template di /new: *tebal*, _miring_, ~coret~,
// ```mono```, dan tautan. Aturannya meniru WhatsApp: penanda harus menempel pada kata (tidak diawali/
// diakhiri spasi) dan diapit awal/akhir baris, spasi, atau tanda baca. Menghasilkan token, bukan HTML,
// supaya teks template tidak pernah disisipkan sebagai markup.

export type WaToken =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 's' | 'm'; v: string }
  | { t: 'link'; v: string }

const KIND: Record<string, 'b' | 'i' | 's'> = { '*': 'b', _: 'i', '~': 's' }
const RE = /```([^`]+?)```|(^|[\s([{"'])([*_~])(\S(?:[^\n]*?\S)?)\3(?=$|[\s.,!?:;)\]}"'])|(https?:\/\/[^\s]+|\b(?:jvto\.me|[a-z0-9-]+\.(?:com|id|co\.id))\/[^\s]*)/gi

export function waTokens(line: string): WaToken[] {
  const out: WaToken[] = []
  const push = (tok: WaToken) => {
    const last = out[out.length - 1]
    if (tok.t === 'text' && last && last.t === 'text') last.v += tok.v
    else if (tok.t !== 'text' || tok.v) out.push(tok)
  }
  let i = 0
  RE.lastIndex = 0
  for (let m = RE.exec(line); m; m = RE.exec(line)) {
    push({ t: 'text', v: line.slice(i, m.index) })
    if (m[1] !== undefined) push({ t: 'm', v: m[1] })
    else if (m[3] !== undefined) {
      push({ t: 'text', v: m[2] })
      push({ t: KIND[m[3]], v: m[4] })
    } else push({ t: 'link', v: m[5] })
    i = m.index + m[0].length
  }
  push({ t: 'text', v: line.slice(i) })
  return out
}

/** Baris-baris pesan, masing-masing sudah menjadi token. */
export function waLines(text: string): WaToken[][] {
  return text.replace(/\r\n/g, '\n').split('\n').map(waTokens)
}
