// Logika murni pratinjau /new, dipisah dari komponen supaya bisa diuji.
export function accuracy(st: { ok: number; bad: number }): number {
  const t = st.ok + st.bad
  return t ? Math.round((st.ok / t) * 100) : 0
}

export function initials(n: string): string {
  return n.slice(0, 2).toUpperCase()
}
