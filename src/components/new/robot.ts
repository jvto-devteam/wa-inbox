// Robot per agent (helm putih, visor oval, mata pil menyala, aksesori sesuai skill).
// SVG statis dari artifact; isinya konstanta, tidak pernah memuat masukan pengguna.
import type { AgentKey } from '@/lib/new/types'

const BOT_PAL: Record<AgentKey, string[]> = {
  balas: ['#2a2fd6', '#c026d3', '#38bdf8', '#ffffff', '#dbeafe'],
  poin: ['#4c1d95', '#db2777', '#f0abfc', '#fffbd1', '#facc15'],
  note: ['#064e4a', '#0d9488', '#5eead4', '#fef9c3', '#fde047'],
  ringkas: ['#05070d', '#1e293b', '#cbd5e1', '#ffffff', '#e2e8f0'],
  reminder: ['#312e81', '#ea580c', '#fdba74', '#fffbd1', '#facc15'],
  vendor: ['#111827', '#7f1d1d', '#fca5a5', '#ffffff', '#fecaca'],
  lead: ['#052e16', '#16a34a', '#6ee7b7', '#fffbd1', '#facc15'],
}

const BOT_ACC: Record<AgentKey, string> = {
  balas: '<path d="M13 56C10 30 29 19 50 19s40 11 37 37" stroke="#1b2038" stroke-width="3.6" fill="none" stroke-linecap="round"/><path d="M15 64q-2 17 14 20" stroke="#1b2038" stroke-width="2.8" fill="none" stroke-linecap="round"/><circle cx="31" cy="84" r="3.6" fill="#1b2038"/>',
  poin: '<path d="M76 24l2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1" stroke-linejoin="round"/>',
  note: '<g transform="rotate(24 82 40)"><rect x="79" y="20" width="6" height="26" rx="1.5" fill="#fbbf24"/><path d="M79 46h6l-3 7z" fill="#f5d0a9"/><path d="M81 51.5l1 1.8 1-1.8z" fill="#334155"/><rect x="79" y="17" width="6" height="5" rx="2" fill="#f472b6"/></g>',
  ringkas: '<circle cx="41" cy="58" r="14.5" fill="none" stroke="#fbbf24" stroke-width="2.6"/><circle cx="59" cy="58" r="14.5" fill="none" stroke="#fbbf24" stroke-width="2.6"/><path d="M55.5 56q-5.5-3-11 0" stroke="#fbbf24" stroke-width="2.4" fill="none"/>',
  reminder: '<g transform="translate(60 1)"><path d="M1 18q0-10 7-10t7 10z" fill="#fbbf24"/><rect x="0" y="18" width="16" height="2.6" rx="1.3" fill="#f59e0b"/><circle cx="8" cy="23.5" r="2" fill="#f59e0b"/><path d="M-3 7q-2 3-1 7M19 7q2 3 1 7" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".85"/></g>',
  vendor: '<path d="M17 47C17 29 32 21 50 21s33 8 33 26z" fill="#1b2038"/><rect x="46" y="42" width="42" height="5.5" rx="2.7" fill="#1b2038"/><circle cx="50" cy="33" r="4.2" fill="#fbbf24"/>',
  lead: '<g transform="translate(76 31)"><circle r="8.5" fill="#fff"/><circle r="6" fill="#ef4444"/><circle r="3.4" fill="#fff"/><circle r="1.5" fill="#ef4444"/></g>',
}

export function robotSvg(k: AgentKey): string {
  const q = BOT_PAL[k]
  const i = 'b' + k
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>'
    + '<radialGradient id="' + i + 'h" cx=".35" cy=".25" r=".95"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef4fb"/><stop offset="1" stop-color="#c3d3e6"/></radialGradient>'
    + '<radialGradient id="' + i + 'b" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c8de"/></radialGradient>'
    + '<linearGradient id="' + i + 'v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + q[0] + '"/><stop offset="1" stop-color="' + q[1] + '"/></linearGradient>'
    + '<linearGradient id="' + i + 'e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + q[3] + '"/><stop offset="1" stop-color="' + q[4] + '"/></linearGradient>'
    + '<pattern id="' + i + 'p" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".55" fill="#fff" opacity=".28"/></pattern>'
    + '<clipPath id="' + i + 'c"><ellipse cx="50" cy="58" rx="29" ry="21"/></clipPath>'
    + '<filter id="' + i + 'g" x="-60%" y="-30%" width="220%" height="160%"><feGaussianBlur stdDeviation="3"/></filter></defs>'
    + '<rect x="47.4" y="14" width="5.2" height="16" rx="2.6" fill="#1b2038"/>'
    + '<circle cx="50" cy="10" r="7.6" fill="url(#' + i + 'b)"/><ellipse cx="47.6" cy="7.4" rx="2.6" ry="1.8" fill="#fff" opacity=".9"/>'
    + '<rect x="12.6" y="36" width="2.8" height="13" rx="1.4" fill="#1b2038"/><rect x="84.6" y="36" width="2.8" height="13" rx="1.4" fill="#1b2038"/>'
    + '<rect x="8" y="48" width="12" height="25" rx="6" fill="url(#' + i + 'b)"/><rect x="80" y="48" width="12" height="25" rx="6" fill="url(#' + i + 'b)"/>'
    + '<path d="M50 24C71 24 87 38 87 59S71 91 50 91 13 80 13 59 29 24 50 24z" fill="url(#' + i + 'h)"/>'
    + '<ellipse cx="38" cy="33" rx="13" ry="5" fill="#fff" opacity=".7" transform="rotate(-18 38 33)"/>'
    + '<ellipse cx="50" cy="58" rx="31.5" ry="23.5" fill="' + q[2] + '" opacity=".95"/>'
    + '<ellipse cx="50" cy="58" rx="29" ry="21" fill="url(#' + i + 'v)"/>'
    + '<g clip-path="url(#' + i + 'c)"><rect x="20" y="36" width="60" height="44" fill="url(#' + i + 'p)"/><ellipse cx="42" cy="44" rx="22" ry="7" fill="#fff" opacity=".13"/></g>'
    + '<g filter="url(#' + i + 'g)" opacity=".75"><rect x="36" y="45" width="11.5" height="26" rx="5.75" fill="' + q[4] + '"/><rect x="52.5" y="45" width="11.5" height="26" rx="5.75" fill="' + q[4] + '"/></g>'
    + '<rect x="36" y="45" width="11.5" height="26" rx="5.75" fill="url(#' + i + 'e)"/><rect x="52.5" y="45" width="11.5" height="26" rx="5.75" fill="url(#' + i + 'e)"/>'
    + '<path d="M37 53h9.5M37 58h9.5M37 63h9.5M53.5 53H63M53.5 58H63M53.5 63H63" stroke="#000" stroke-width=".6" opacity=".1"/>'
    + '<path d="M30 82q20 11 40 0" stroke="#7f93b3" stroke-width="1.4" fill="none" opacity=".35"/>'
    + BOT_ACC[k] + '</svg>'
}
