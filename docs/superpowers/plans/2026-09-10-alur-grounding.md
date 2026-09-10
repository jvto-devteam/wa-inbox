# Perubahan Alur Grounding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot hanya membaca fakta yang relevan dengan pertanyaan, dengan aturan yang tidak pernah ikut disaring — supaya jawabannya benar sesuai knowledge dan aturan JVTO.

**Architecture:** Fakta pindah dari konstanta di `knowledge.ts` ke `KnowledgeRevision` yang bertopik, disaring per giliran oleh topik hasil klasifikasi. Aturan (`GUARDRAIL_INSTRUCTION`, `DISCLOSURES`) tetap di kode dan tidak pernah digerbang. Klasifikasi fakta dijalankan **saat simpan**, sekali per revisi, sehingga runtime tetap deterministik.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Prisma 7 · PostgreSQL · Vitest · Ollama lokal (`gemma4:31b-cloud`)

**Spec:** Artifact "Menyaring Sebelum Menjawab" — https://claude.ai/code/artifact/64208567-c521-4d08-a060-5abb9766cc2f

---

## Global Constraints

Diambil verbatim dari `CLAUDE.md`. Setiap task tunduk pada semuanya.

- **§5** Dilarang `any`. Pakai `unknown` atau tipe yang sesuai.
- **§5** Simulator (`src/lib/bot-control/simulator.ts`) DILARANG memanggil `sendMessage` atau membuat `OutboundJob`.
- **§5** Jangan overwrite `KnowledgeSource` bertipe `MANUAL`. Penjaga `type` di `knowledge-workflow.ts` tidak boleh dilonggarkan.
- **§5** Dilarang menjalankan `npx prisma migrate dev` terhadap database produksi — `DATABASE_URL` di repo ini menunjuk VPS produksi.
- **§6** Setiap mutation: `getSession` → `hasAdminPowers()` → validasi Zod → `writeBotAuditLog` bila mengubah apa yang bot lakukan → transaksi Prisma bila >1 tulisan.
- **§6** Response error selalu `{ error: string }`. Jangan bocorkan pesan error mentah atau secret.
- **§7** Migrasi produksi: `prisma migrate diff` offline → tinjau SQL → `prisma migrate deploy` → export PATH nvm Node 22.
- **§8** Sebelum commit: `npm test` · `npx tsc --noEmit` · `npx eslint .` (0 error).
- **§9** Klaim tentang perilaku sistem harus berasal dari call site-nya. Angka dihitung ulang dari kode, tidak disalin.
- Revisi `PUBLISHED` **immutable**. Setiap perubahan = revisi baru.
- `ARCHIVED` ditulis sistem, bukan dipilih operator.

---

## Gerbang & Keputusan

Prinsip plan ini: **apa pun yang bisa diputuskan dari bukti yang sudah diverifikasi, dieksekusi di sini.** Yang tersisa sebagai gerbang hanya hal yang benar-benar tidak bisa diselesaikan tanpa pemilik.

### Empat gerbang yang SAH — berhenti dan tunggu operator

| # | Di mana | Kenapa ini bukan sesuatu yang bisa diputuskan sendiri |
| --- | --- | --- |
| **G1** | GERBANG KEPUTUSAN, setelah Task 3 | Ambang 85% adalah usulan saya, bukan fakta terukur. Kalau hasilnya di bawah itu, **arah kerjanya berubah** — perbaiki classifier dulu, atau terima risikonya — dan itu pertukaran biaya/risiko yang milik operator. Cabang di atas ambang berjalan sendiri tanpa bertanya. |
| **G2** | Task 11, Step 1 — kebenaran 11 blok fakta bisnis | Tidak ada apa pun di repo yang bisa memberi tahu apakah deposit masih 20% atau pelunasan masih H-3. Hanya JVTO yang tahu. Memindahkan fakta usang **memindahkan kesalahan lalu membuatnya terlihat sudah ditinjau.** |
| **G3** | Task 19 — isi `luggage_rule` | Kebijakan koper JVTO tidak ada di mana pun di repo. Mengarangnya persis pelanggaran yang seluruh guardrail bot ini cegah. |
| **G4** | Task 15, Step 7 — `migrate deploy` ke produksi | Menyentuh database produksi. CLAUDE.md §7 mewajibkan tinjauan SQL manusia sebelum diterapkan. |

### Yang TIDAK jadi gerbang — dieksekusi tuntas di plan ini

Empat hal yang sebelumnya saya catat sebagai "tertunda", ternyata sudah punya bukti cukup untuk diputuskan sekarang:

- **`CLAUDE.md:175` basi** → Task 0. Commit `90676c2 chore(migration): selesaikan right-sizing di produksi` terverifikasi ada. Ini fakta, bukan dugaan. Diperbaiki sekarang, bukan dicatat sebagai utang.
- **Dua entri DRAFT "can i see blue fire?"** → **bukan penghalang.** Keduanya berstatus `DRAFT`, jadi loader tidak pernah membacanya dan bot tidak terpengaruh sama sekali. Fase 2 mengisi rak dengan entri baru; dua draft yatim tidak ada hubungannya. Dibereskan sebagai kebersihan di Task 12, bukan gerbang.
- **`hotel` dan `rooming` memetakan ke modul yang sama** → **bukan cacat.** Terverifikasi: blok 6 prompt mengirim `overnights` (nama hotel) dan `roomingAssumption` **tanpa syarat topik**, jadi kedua pertanyaan tetap menerima fakta lengkap. Tidak ada fakta yang hilang. Task-nya dihapus, dan tabel cacat di dokumen rencana ikut dikoreksi di Task 0.
- **Gerbang eval tertutup** → sudah dibuktikan tertutup dengan menjalankannya, dan `approve:deployment` terverifikasi ada. Langkah "pastikan tertutup" dihapus — itu mengulang verifikasi yang sudah selesai.

---

## File Structure

| Berkas | Tanggung jawab | Aksi |
| --- | --- | --- |
| `scripts/measure-topic-accuracy.ts` | Ukur akurasi `classifyTopicViaLLM` terhadap pesan produksi | Create |
| `scripts/measure-prompt-size.ts` | Ukur token prompt vs `num_ctx` model | Create |
| `scripts/measure-followup-signal.ts` | Klasifikasi respons pelanggan setelah balasan bot | Create |
| `src/lib/bot-control/knowledge-body.ts` | Skema body knowledge — tambah `topics` | Modify |
| `src/lib/bot/fact-topic-classifier.ts` | Klasifikasi **multi-topik** untuk satu fakta | Create |
| `src/lib/bot/runtime-integration.ts` | Gerbang topik + jaring nol-hasil + `allManagedFacts()` untuk Mode 3 | Modify |
| `src/lib/bot-control/knowledge-workflow.ts` | Panggil classifier saat simpan | Modify |
| `src/components/bot-control/KnowledgeEditor.tsx` | Multi-select topik | Modify |
| `src/components/bot-control/KnowledgeSourceTable.tsx` | Kolom topik | Modify |
| `src/lib/bot/knowledge.ts` | Hapus `GENERAL_FAQ_FALLBACK`; dedup grounding | Modify |
| `src/lib/bot/orchestrator.ts` | Managed di cabang tanpa-destinasi (R26); FAQ dihapus dari tiga cabang (R27); kerusakan knowledge → hiccup | Modify |
| `src/lib/bot/reply-verifier.ts` | Deteksi frasa jaminan di balasan | Modify |
| `prisma/schema.prisma` | Kolom `topic`/`job` di `BotDecisionRun` (R38: tanpa `stage`) | Modify |
| `src/lib/bot-control/decision-recorder.ts` | Tulis dua kolom itu | Modify |

---

## PRA-FASE — Dokumentasi

### Task 0: Bereskan dokumentasi yang sudah terbukti salah

Dikerjakan lebih dulu karena keduanya **sudah dibuktikan**, dan salah satunya sedang memblokir penalaran tentang migrasi di Fase 4.

**Files:**
- Modify: `CLAUDE.md:175`
- Modify: `docs/superpowers/plans/2026-09-10-alur-grounding.md` (dokumen ini — tabel cacat)

**Interfaces:** tidak ada. Murni dokumentasi.

- [ ] **Step 1: Perbaiki klaim migrasi yang basi**

`CLAUDE.md:175` berbunyi `### Migrasi right-sizing (belum diterapkan ke produksi per 2026-09-08)`. Commit `90676c2 chore(migration): selesaikan right-sizing di produksi` membuktikan sebaliknya.

Ganti judul bagian itu dan kalimat pembukanya menjadi:

```markdown
### Migrasi right-sizing (selesai di produksi 2026-09-08)

Kode dan database produksi sudah sinkron sejak commit `90676c2`. Prosedur yang dipakai —
termasuk dua jebakan yang nyaris merugikan — ada di `docs/right-size-migration/RUNBOOK.md`.
Urutan yang terbukti aman dan sebaiknya diulang untuk migrasi destruktif berikutnya:
cadangkan → SELECT verifikasi → migrasi aditif → deploy kode → verifikasi sehat →
migrasi destruktif.
```

Kalau tidak diperbaiki, siapa pun yang membaca konstitusi akan menolak migrasi Task 16 atas alasan yang sudah tidak berlaku ("dua migrasi menumpuk memperburuk rollback").

- [ ] **Step 2: Koreksi artifact rencana**

Artifact "Menyaring Sebelum Menjawab" masih memuat `hotel` vs `rooming` sebagai cacat 06 dan menjadwalkannya di Fase 4. Terverifikasi bukan cacat — hapus barisnya dari bagian 01 dan dari daftar Fase 4, ganti dengan catatan bahwa blok 6 sudah mengirim `overnights` dan `roomingAssumption` tanpa syarat topik.

Dokumen plan ini sendiri **sudah dikoreksi** — tabel cakupan di Self-Review sudah mencatatnya sebagai bukan-cacat. Tidak ada yang perlu dikerjakan di sini.

- [ ] **Step 3: Commit**

Utang dokumentasi diperbaiki di commit yang sama dengan keputusan yang menghasilkannya — bukan ditumpuk jadi pekerjaan terpisah.

```bash
git add CLAUDE.md
git commit -m "docs: right-sizing sudah selesai di produksi sejak 90676c2"
```

---

## FASE 0 — Ukur dulu (GATING)

Tiga task ini **read-only** dan **tidak mengubah perilaku bot**. Hasilnya menentukan apakah Fase 1–2 dikerjakan atau dibatalkan.

### Task 1: Ukur akurasi klasifikasi topik

Fase 1 membuat kebenaran jawaban bergantung penuh pada klasifikasi. Hari ini tidak ada satu pun angka tentang akurasinya — `topic-classifier.test.ts` menguji mekanik dengan LLM yang di-mock, bukan akurasi.

**Files:**
- Create: `scripts/measure-topic-accuracy.ts`
- Modify: `package.json` (daftarkan script)

**Interfaces:**
- Consumes: `classifyTopicViaLLM(job, message, model)` dari `src/lib/bot/topic-classifier.ts`
- Produces: laporan TSV ke stdout — tidak dipakai task lain

- [ ] **Step 1: Tulis skrip pengukur**

```typescript
/**
 * Ukur akurasi classifyTopicViaLLM terhadap pesan pelanggan sungguhan.
 *
 * READ-ONLY. Tidak ada INSERT/UPDATE/DELETE.
 *
 * Keluarannya TSV supaya bisa ditinjau manual: baris mana yang salah, dan ke arah mana.
 * Angka akurasi ini adalah GERBANG untuk Fase 1 (lihat plan).
 */
import { config } from 'dotenv'

config()

async function main() {
  const { prisma } = await import('@/lib/db')
  const { classifyTopicViaLLM } = await import('@/lib/bot/topic-classifier')

  const limit = Number(process.argv[2] ?? 100)
  const runs = await prisma.botDecisionRun.findMany({
    where: { inboundText: { not: '' } },
    select: { id: true, inboundText: true, trace: true },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })

  console.log(['run_id', 'topik_sekarang', 'topik_ulang', 'cocok', 'pesan'].join('\t'))
  let same = 0
  let compared = 0

  for (const run of runs) {
    const recorded = topicFromTrace(run.trace)
    const again = await classifyTopicViaLLM(null, run.inboundText)
    if (recorded) {
      compared++
      if (recorded === again.topic) same++
    }
    console.log(
      [run.id, recorded ?? '-', again.topic, recorded ? String(recorded === again.topic) : '-',
       run.inboundText.replace(/\s+/g, ' ').slice(0, 80)].join('\t')
    )
  }

  console.error(`\nKonsistensi ulang-klasifikasi: ${same}/${compared}`)
  console.error('CATATAN: ini konsistensi, BUKAN kebenaran. Kolom topik_ulang wajib ditinjau manual')
  console.error('terhadap pesannya untuk mendapat akurasi sebenarnya.')
  await prisma.$disconnect()
}

/** Topik yang tercatat di trace run ini, kalau ada. */
function topicFromTrace(trace: unknown): string | null {
  if (!Array.isArray(trace)) return null
  for (const step of trace) {
    if (typeof step !== 'object' || step === null) continue
    const detail = (step as Record<string, unknown>).detail
    if (typeof detail !== 'string') continue
    const found = detail.match(/topik "([a-z_]+)"/)
    if (found) return found[1]
  }
  return null
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Daftarkan script**

Di `package.json`, bagian `scripts`, tambahkan:

```json
"measure:topic-accuracy": "tsx scripts/measure-topic-accuracy.ts"
```

- [ ] **Step 3: Jalankan atas 100 run terakhir**

Run: `npm run measure:topic-accuracy -- 100 > /tmp/topik.tsv`
Expected: file TSV terisi, dan di stderr muncul angka konsistensi.

- [ ] **Step 4: Tinjau manual 30 baris**

Buka `/tmp/topik.tsv`, baca kolom `pesan` dan `topik_ulang` untuk 30 baris acak. Tandai benar/salah sendiri. Hitung akurasi.

**Ini langkah manusia, tidak bisa diotomatiskan** — tidak ada label kebenaran di database.

- [ ] **Step 5: Commit skripnya**

```bash
git add scripts/measure-topic-accuracy.ts package.json
git commit -m "feat(eval): skrip ukur akurasi klasifikasi topik terhadap pesan produksi"
```

---

### Task 2: Ukur panjang prompt vs jendela konteks

`llm.ts` tidak pernah mengirim `options.num_ctx`, jadi jendela konteks = default model dan tidak pernah diukur. Kalau prompt melebihi, Ollama memotong diam-diam — dan `GUARDRAIL_INSTRUCTION` ada di blok ke-20 dari 20.

**Files:**
- Create: `scripts/measure-prompt-size.ts`
- Modify: `package.json` (daftarkan script)

**Interfaces:**
- Consumes: `process.env.OLLAMA_URL`, `Settings.ollamaModel`
- Produces: laporan ke stdout

- [ ] **Step 1: Tulis skrip**

```typescript
/**
 * Bandingkan panjang prompt nyata terhadap jendela konteks model.
 *
 * READ-ONLY terhadap database. Satu panggilan /api/show ke Ollama (tidak menghasilkan inferensi).
 *
 * Menjawab satu pertanyaan: apakah prompt bot terpotong diam-diam?
 */
import { config } from 'dotenv'

config()

/** Perkiraan kasar: 1 token ~ 4 karakter. Cukup untuk membandingkan orde besaran. */
const estimateTokens = (text: string): number => Math.round(text.length / 4)

async function main() {
  const { prisma } = await import('@/lib/db')

  const settings = await prisma.settings.findFirst({ select: { ollamaModel: true } })
  const model = settings?.ollamaModel ?? 'gemma4:31b-cloud'

  const show = await fetch(`${process.env.OLLAMA_URL}/api/show`, {
    method: 'POST',
    body: JSON.stringify({ model }),
  })
  const info: unknown = await show.json()
  const numCtx = findContextLength(info)

  const runs = await prisma.botDecisionRun.findMany({
    select: { id: true, inboundText: true, replyText: true, trace: true },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  const sizes = runs.map((run) => estimateTokens(JSON.stringify(run.trace)))
  sizes.sort((a, b) => a - b)

  console.log(`Model            : ${model}`)
  console.log(`num_ctx model    : ${numCtx ?? 'TIDAK DIKETAHUI — /api/show tidak melaporkannya'}`)
  console.log(`num_ctx dikirim  : TIDAK (llm.ts tidak mengirim options.num_ctx)`)
  console.log(`Trace token p50  : ${sizes[Math.floor(sizes.length / 2)] ?? 0}`)
  console.log(`Trace token p95  : ${sizes[Math.floor(sizes.length * 0.95)] ?? 0}`)
  console.log(`Trace token maks : ${sizes[sizes.length - 1] ?? 0}`)
  console.log('')
  console.log('CATATAN: trace BUKAN prompt. Ia proksi orde besaran saja.')
  console.log('Angka pasti hanya bisa didapat dengan mencatat panjang system prompt di orchestrator.')
  await prisma.$disconnect()
}

/** Cari nilai context length di respons /api/show, apa pun nama kuncinya. */
function findContextLength(info: unknown): number | null {
  if (typeof info !== 'object' || info === null) return null
  const detail = (info as Record<string, unknown>).model_info
  if (typeof detail !== 'object' || detail === null) return null
  for (const [key, value] of Object.entries(detail)) {
    if (key.endsWith('.context_length') && typeof value === 'number') return value
  }
  return null
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Daftarkan script**

```json
"measure:prompt-size": "tsx scripts/measure-prompt-size.ts"
```

- [ ] **Step 3: Jalankan**

Run: `npm run measure:prompt-size`
Expected: `num_ctx` model tercetak. Kalau `TIDAK DIKETAHUI`, catat itu — artinya harus dipastikan dari Modelfile di VPS.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-prompt-size.ts package.json
git commit -m "feat(eval): skrip bandingkan panjang prompt terhadap jendela konteks model"
```

---

### Task 3: Ukur sinyal tindak lanjut pelanggan

Pesan pelanggan **berikutnya** adalah nilai untuk balasan bot sebelumnya. Data ini sudah ada di database dan belum pernah dibaca oleh apa pun.

**Files:**
- Create: `scripts/measure-followup-signal.ts`
- Modify: `package.json` (daftarkan script)

**Interfaces:**
- Consumes: `prisma.botDecisionRun`, `prisma.message`
- Produces: ringkasan per kategori ke stdout

- [ ] **Step 1: Tulis skrip**

```typescript
/**
 * Nilai untuk tiap balasan bot: apa yang pelanggan tulis SETELAHNYA.
 *
 * READ-ONLY.
 *
 * Ini satu-satunya ukuran kebenaran jawaban yang datanya sudah tersedia hari ini.
 * Klasifikasinya sengaja kasar dan berbasis kata — tujuannya orde besaran, bukan presisi.
 */
import { config } from 'dotenv'

config()

type Verdict = 'mengulang' | 'mengoreksi' | 'lanjut' | 'tidak_ada_respons'

const CORRECTION_MARKERS = ['no,', 'no i mean', 'i meant', 'not that', 'bukan itu', 'maksud saya']

async function main() {
  const { prisma } = await import('@/lib/db')

  const runs = await prisma.botDecisionRun.findMany({
    where: { status: 'REPLIED' },
    select: { id: true, conversationId: true, inboundText: true, finishedAt: true },
    orderBy: { startedAt: 'desc' },
    take: 300,
  })

  const tally: Record<Verdict, number> = {
    mengulang: 0, mengoreksi: 0, lanjut: 0, tidak_ada_respons: 0,
  }

  for (const run of runs) {
    if (!run.finishedAt) continue
    const next = await prisma.message.findFirst({
      where: {
        conversationId: run.conversationId,
        direction: 'INBOUND',
        createdAt: { gt: run.finishedAt },
      },
      select: { body: true },
      orderBy: { createdAt: 'asc' },
    })
    tally[verdictFor(run.inboundText, next?.body ?? null)]++
  }

  const total = Object.values(tally).reduce((sum, n) => sum + n, 0)
  console.log(`Dari ${total} balasan bot:\n`)
  for (const [name, count] of Object.entries(tally)) {
    const pct = total ? ((count / total) * 100).toFixed(1) : '0.0'
    console.log(`  ${name.padEnd(18)} ${String(count).padStart(4)}  ${pct}%`)
  }
  console.log('\n"mengulang" dan "mengoreksi" adalah kandidat jawaban GAGAL.')
  await prisma.$disconnect()
}

/** Seberapa mirip pesan berikutnya dengan pesan sebelumnya — proksi kasar untuk "diulang". */
function verdictFor(previous: string, next: string | null): Verdict {
  if (!next) return 'tidak_ada_respons'
  const low = next.toLowerCase()
  if (CORRECTION_MARKERS.some((marker) => low.includes(marker))) return 'mengoreksi'
  if (overlapRatio(previous, next) >= 0.6) return 'mengulang'
  return 'lanjut'
}

/** Rasio kata (≥4 huruf) pesan lama yang muncul lagi di pesan baru. */
function overlapRatio(a: string, b: string): number {
  const words = (text: string) =>
    new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))
  const before = words(a)
  if (before.size === 0) return 0
  const after = words(b)
  let hits = 0
  for (const word of before) if (after.has(word)) hits++
  return hits / before.size
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Daftarkan script**

```json
"measure:followup": "tsx scripts/measure-followup-signal.ts"
```

- [ ] **Step 3: Jalankan**

Run: `npm run measure:followup`
Expected: persentase per kategori tercetak.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-followup-signal.ts package.json
git commit -m "feat(eval): ukur sinyal tindak lanjut pelanggan sebagai proksi kebenaran jawaban"
```

---

### 🛑 GERBANG G1 — keputusan setelah Task 1–3

Dua dari tiga hasil **berjalan sendiri** tanpa bertanya. Hanya satu yang benar-benar berhenti.

| Hasil pengukuran | Tindakan | Berhenti? |
| --- | --- | --- |
| Akurasi klasifikasi **≥ 85%** | Lanjut ke Fase 1 seperti tertulis. | tidak |
| Prompt **melebihi** `num_ctx` | Kerjakan Fase 2 **sebelum** Fase 1 — ini perbaikan bug, bukan kerapian. Prompt yang terpotong membuang `GUARDRAIL_INSTRUCTION` lebih dulu (blok ke-20 dari 20). | tidak |
| Akurasi klasifikasi **< 85%** | **BERHENTI.** Gerbang topik akan membuang fakta benar lebih sering daripada menyaring yang salah. | **ya** |

**Kenapa cabang ketiga adalah gerbang:** angka 85% adalah usulan saya, bukan sesuatu yang terukur dari sistem ini. Kalau akurasinya di bawah itu, pilihannya — perbaiki classifier dulu (mahal, menunda semuanya) atau jalan terus sambil menerima sebagian jawaban jadi lebih buruk — adalah pertukaran biaya terhadap risiko yang milik operator, bukan milik saya.

Hasil `mengulang` + `mengoreksi` dari Task 3 **tidak menghentikan apa pun.** Ia baseline untuk dibandingkan di Task 16 Step 5. Kalau angkanya sudah rendah (<5%), itu tetap dicatat sebagai konteks — tapi Fase 1–4 tetap jalan, karena nilainya bukan hanya memperbaiki jawaban melainkan membuat fakta bisa dikelola tanpa deploy.

---

## FASE 1 — Sumbu topik pada knowledge

### Task 4: Field `topics` pada skema body knowledge

`knowledgeItemSchema` memakai `.strict()`, jadi field baru harus ditambahkan eksplisit atau penyimpanan ditolak. Field dibuat **opsional** supaya nol revisi lama rusak.

**Files:**
- Modify: `src/lib/bot-control/knowledge-body.ts:41-49`
- Modify: `src/lib/bot/module-resolver.ts` (ekspor `RESOLVER_TOPICS`)
- Modify: `src/lib/bot/topic-classifier.ts` (`VALID_TOPICS` memakai `RESOLVER_TOPICS` — Ruling R22)
- Create: `scripts/verify-published-revisions-parse.ts`
- Modify: `package.json` (daftarkan script)
- Test: `src/lib/bot-control/knowledge-body.test.ts`

**Interfaces:**
- Consumes: `ResolverTopic` dari `src/lib/bot/module-resolver.ts`
- Produces: `KnowledgeItem.topics?: ResolverTopic[]` — dibaca Task 5, ditulis Task 8 (workflow) dan Task 9 (UI)

> **Ruling R22:** di commit yang sama, ganti salinan tangan 14 topik di `src/lib/bot/topic-classifier.ts` (`const VALID_TOPICS = new Set<ResolverTopic>([...14 literal])`) dengan `new Set<ResolverTopic>(RESOLVER_TOPICS)`. `RESOLVER_TOPICS` dibuat justru sebagai sumber tunggal; dua daftar tangan adalah bahaya yang sudah pernah terjadi di repo ini (`ATTRACTION_TRIGGER_PHRASES` bergeser dari salinannya). Nol perubahan perilaku; `topic-classifier.test.ts` harus tetap hijau.
>
> **Ruling R21:** relasi dari `KnowledgeRevision` ke sumbernya bernama `knowledgeSource` (`schema.prisma`), bukan `source`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/lib/bot-control/knowledge-body.test.ts`:

```typescript
it('menerima topics yang valid', () => {
  const result = validateKnowledgeBody({
    items: [{ question: 'Berapa deposit?', answer: '20% dari total.', topics: ['payment'] }],
  })
  expect(result.ok).toBe(true)
})

it('menolak topik di luar 14 nilai ResolverTopic', () => {
  const result = validateKnowledgeBody({
    items: [{ question: 'Q', answer: 'A', topics: ['tidak_ada_topik_ini'] }],
  })
  expect(result.ok).toBe(false)
})

it('item tanpa topics tetap valid — nol revisi lama rusak', () => {
  const result = validateKnowledgeBody({ items: [{ question: 'Q', answer: 'A' }] })
  expect(result.ok).toBe(true)
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot-control/knowledge-body.test.ts`
Expected: FAIL — `topics` ditolak `.strict()` sebagai `unrecognized_keys`.

- [ ] **Step 3: Tambahkan field**

Di `src/lib/bot-control/knowledge-body.ts`, di atas `knowledgeItemSchema`:

```typescript
import { RESOLVER_TOPICS } from '@/lib/bot/module-resolver'
```

Lalu di dalam `knowledgeItemSchema`, setelah baris `tags`:

```typescript
    /**
     * Topik yang DILAYANI fakta ini — gerbang relevansi di runtime-integration.ts.
     *
     * OPSIONAL dengan sengaja: item tanpa `topics` berperilaku persis seperti sebelum
     * field ini ada (overlap token), sehingga nol revisi PUBLISHED yang sudah terbit
     * menjadi tidak terbaca. Jangan pernah menjadikannya wajib tanpa backfill terverifikasi.
     *
     * Boleh LEBIH DARI SATU: satu fakta sering melayani beberapa jenis pertanyaan
     * (drop-off Malang yang memuat surcharge melayani route_endpoint DAN price).
     */
    topics: z.array(z.enum(RESOLVER_TOPICS)).max(14).optional(),
```

- [ ] **Step 4: Ekspor daftar topik sebagai nilai**

Di `src/lib/bot/module-resolver.ts`, tepat di atas `export type ResolverTopic`:

```typescript
/** 14 topik, sebagai NILAI — dipakai Zod dan multi-select editor, bukan hanya sebagai tipe. */
export const RESOLVER_TOPICS = [
  'inclusions', 'price', 'private_tour', 'vehicle', 'rooming', 'hotel', 'route_endpoint',
  'destination_readiness', 'booking', 'payment', 'cancellation', 'blue_fire', 'greeting', 'general',
] as const
```

Lalu ubah deklarasi tipenya menjadi turunan, supaya keduanya tidak bisa berbeda:

```typescript
export type ResolverTopic = (typeof RESOLVER_TOPICS)[number]
```

- [ ] **Step 5: Jalankan test**

Run: `npx vitest run src/lib/bot-control/knowledge-body.test.ts`
Expected: PASS.

- [ ] **Step 6: Test parse seluruh revisi PUBLISHED yang ada — WAJIB**

Buat `scripts/verify-published-revisions-parse.ts`:

```typescript
/**
 * Setiap revisi PUBLISHED yang sudah ada HARUS tetap lolos skema body yang baru.
 *
 * Kalau gagal, `readKnowledgeBody` mengembalikan null dan revisi itu dilewati DIAM-DIAM:
 * bot kehilangan knowledge tanpa satu pun error. Ini edge case E1 di PRD.
 *
 * READ-ONLY. Keluar dengan kode 1 kalau ada yang gagal.
 */
import { config } from 'dotenv'

config()

async function main() {
  const { prisma } = await import('@/lib/db')
  const { validateKnowledgeBody } = await import('@/lib/bot-control/knowledge-body')

  const revisions = await prisma.knowledgeRevision.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, version: true, body: true, knowledgeSource: { select: { key: true } } },
  })

  let bad = 0
  for (const revision of revisions) {
    const result = validateKnowledgeBody(revision.body)
    if (!result.ok) {
      bad++
      console.error(`GAGAL  ${revision.knowledgeSource.key} v${revision.version}: ${result.error}`)
    }
  }

  console.log(`${revisions.length - bad}/${revisions.length} revisi PUBLISHED lolos skema.`)
  await prisma.$disconnect()
  if (bad) process.exit(1)
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
```

Daftarkan: `"verify:revisions": "tsx scripts/verify-published-revisions-parse.ts"`

- [ ] **Step 7: Jalankan verifikasi itu**

Run: `npm run verify:revisions`
Expected: semua lolos. **Kalau ada yang gagal, HENTIKAN plan ini** dan perbaiki dulu — jangan lanjut ke Task 5.

- [ ] **Step 8: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot-control/knowledge-body.ts src/lib/bot-control/knowledge-body.test.ts \
        src/lib/bot/module-resolver.ts src/lib/bot/topic-classifier.ts scripts/verify-published-revisions-parse.ts package.json
git commit -m "feat(knowledge): field topics opsional pada item knowledge, plus verifikasi parse revisi terbit"
```

---

### Task 5: Gerbang topik di `managedFactsFor`

**Files:**
- Modify: `src/lib/bot/runtime-integration.ts:171-215`
- Modify: `src/lib/bot/orchestrator.ts` (dua cabang Mode 1/2: katalog `:1518` dan `runNoDestinationBranch` — Ruling R26)
- Test: `src/lib/bot/runtime-integration.test.ts`
- Test: `src/lib/bot/orchestrator.test.ts` (cabang tanpa-destinasi memakai fakta managed)

**Interfaces:**
- Consumes: `KnowledgeItem.topics` (Task 4), `ResolverTopic`
- Produces: `managedFactsFor(message: string, topic: ResolverTopic | null): Promise<ManagedFacts>` — dipanggil `orchestrator.ts` di cabang katalog dan cabang tanpa-destinasi

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/lib/bot/runtime-integration.test.ts`:

```typescript
it('menolak entri bertopik payment saat giliran bertopik route_endpoint', async () => {
  mockEntries([
    { question: 'Berapa deposit?', answer: '20% dari total, dibayar di Surabaya.', topics: ['payment'] },
  ])
  const facts = await managedFactsFor('bisa drop off di surabaya?', 'route_endpoint')
  expect(facts.lines).toEqual([])
})

it('meloloskan entri yang memuat topik aktif', async () => {
  mockEntries([
    { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint', 'price'] },
  ])
  const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint')
  expect(facts.lines).toHaveLength(1)
})

it('entri tanpa topics berperilaku seperti sebelumnya — overlap token', async () => {
  mockEntries([{ question: 'Berapa harga ATV?', answer: 'Rp 300.000.' }])
  const facts = await managedFactsFor('berapa harga paket ATV?', 'route_endpoint')
  expect(facts.lines).toHaveLength(1)
})

// Ruling R30: giliran `general` tidak digerbang — entri bertopik tetap lolos lewat overlap kata.
it('giliran bertopik general tidak digerbang', async () => {
  mockEntries([
    { question: 'Berapa deposit?', answer: '20% dari total, dibayar di Surabaya.', topics: ['payment'] },
  ])
  const facts = await managedFactsFor('deposit bisa dibayar di surabaya?', 'general')
  expect(facts.lines).toHaveLength(1)
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts`
Expected: FAIL — `managedFactsFor` belum menerima argumen kedua.

- [ ] **Step 3: Ubah tanda tangan dan tambahkan gerbang**

Di `src/lib/bot/runtime-integration.ts`, ganti baris 171 dan blok pencocokan di baris 188-193:

```typescript
export async function managedFactsFor(
  message: string,
  topic: ResolverTopic | null,
): Promise<ManagedFacts> {
```

Lalu di dalam loop `for (const entry of managed.entries)`, ganti `entry.items.filter(...)` menjadi:

```typescript
    const matched = entry.items.filter((item) => {
      // Lapis 1 -- gerbang topik. `topics` terisi berarti operator (atau classifier)
      // sudah menyatakan pertanyaan macam apa yang layak dijawab entri ini; kalau topik
      // giliran ini tidak ada di sana, entri itu tidak relevan berapa pun katanya cocok.
      //
      // `topics` KOSONG jatuh ke perilaku sebelum field ini ada. Itu yang membuat migrasi
      // bisa bertahap dan nol revisi lama rusak.
      //
      // Ruling R30 (keputusan operator setelah Gerbang G1, 2026-09-10): giliran tanpa topik
      // spesifik — `general` atau `null` — TIDAK digerbang. Pengukuran Fase 0: 47% lalu
      // lintas memang `general` (pesan tanpa pertanyaan), dan 4 dari 6 salah-klasifikasi
      // melibatkan `general`. Menggerbangnya akan membuang fakta di hampir separuh giliran;
      // melepasnya membuat giliran itu berperilaku persis seperti sebelum field ini ada.
      const specificTopic = topic !== null && topic !== 'general'
      if (specificTopic && item.topics && item.topics.length > 0) {
        if (!item.topics.includes(topic)) return false
      }
      // Lapis 2 -- overlap token. Setelah gerbang, ini alat PERINGKAT, bukan penentu masuk.
      const candidate = tokens(`${item.question} ${(item.tags ?? []).join(' ')}`)
      for (const word of candidate) if (asked.has(word)) return true
      return false
    })
```

Tambahkan import di kepala berkas:

```typescript
import type { ResolverTopic } from './module-resolver'
```

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Perbarui call site di orchestrator**

**Ruling R26 — dua cabang, bukan satu.** Knowledge dirakit di tiga cabang orchestrator (rinciannya di Task 11). Dua di antaranya adalah jalur Mode 1/2 yang sudah punya topik, dan keduanya harus memakai gerbang:

1. **Cabang katalog** (`orchestrator.ts:1518`): `managedFactsFor(inboundText)` → `managedFactsFor(inboundText, resolverTopic)`. Grounding verifier cabang ini sudah memuat `managed.lines` lewat `knowledge.factualLines`.
2. **Cabang tanpa destinasi** (`runNoDestinationBranch` — hari ini **tidak** memanggil `managedFactsFor` sama sekali): panggil `managedFactsFor(inboundText, resolverTopic)`, lalu gabungkan `lines`-nya ke `preDestinationKnowledge.factualLines` **sebelum** cek `factualLines.length > 0`. Kalau digabung sesudahnya, pertanyaan deposit tanpa destinasi yang hanya dijawab knowledge jatuh ke balasan "destinasi mana?". Baris itu juga harus masuk `preDestinationText` supaya verifier bisa menyumber harganya.

Mode 3 **tidak** disentuh di task ini — ia berjalan sebelum klasifikasi sehingga tidak punya topik; lihat Task 11 (Ruling R27).

Tambahkan test di `orchestrator.test.ts`: pertanyaan bertopik `payment` tanpa destinasi, dengan satu entri managed bertopik `payment`, menghasilkan system prompt yang memuat jawaban entri itu. Cabang tanpa-destinasi juga meniru langkah trace `'Knowledge terkelola dipakai'` yang sudah ditulis cabang katalog (judul + versi tiap sumber), supaya keputusannya tetap menyebut sumber knowledge.

**Ruling R32:** `orchestrator.test.ts` hari ini tidak memalsukan `managed-knowledge` — loader asli membaca Prisma palsu, mendapat `undefined`, dan melapor `available: false` di setiap test. Tambahkan di berkas itu:

```typescript
vi.mock('@/lib/bot/managed-knowledge', () => ({ loadPublishedManagedKnowledge: vi.fn() }))
```

dengan default di `beforeEach`: `vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [], available: true, loadedAt: 0 })` — pola yang sama dengan `runtime-integration.test.ts`. Test lama tidak berubah perilaku (hasilnya kosong di kedua kasus). Tanpa ini, Task 12 — yang mengubah `available: false` menjadi balasan "technical hiccup" — akan membalik hampir semua test orkestrator sekaligus.

**Ruling R24:** delapan panggilan test lama `managedFactsFor(msg)` diperbarui ke `managedFactsFor(msg, null)` — entri lama tanpa `topics`, jadi perilakunya identik. Snippet test di Task 5, 6, dan 17 memanggil `mockEntries([...])` — definisikan helper itu SEKALI di `runtime-integration.test.ts`, di atas pola mock yang sudah ada di berkas itu:

```typescript
/** Pasang daftar item sebagai SATU entri managed terbit — di atas helper `entry()` yang sudah ada. */
function mockEntries(items: Array<Record<string, unknown>>) {
  vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
    entries: [entry({ items })],
    available: true,
    loadedAt: 0,
  })
}
```

- [ ] **Step 6: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/runtime-integration.ts src/lib/bot/runtime-integration.test.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "feat(knowledge): gerbang topik pada managed knowledge, token turun jadi alat peringkat"
```

---

### Task 6: Jaring saat gerbang menghasilkan nol

Kalau klasifikasi meleset, gerbang bisa membuang **semua** fakta yang benar. Jawaban miring lebih baik daripada tidak ada jawaban — tapi kejadiannya harus tercatat, bukan disembunyikan.

**Files:**
- Modify: `src/lib/bot/runtime-integration.ts`
- Modify: `src/lib/bot/orchestrator.ts` (dua call site — Ruling R41)
- Test: `src/lib/bot/runtime-integration.test.ts`
- Test: `src/lib/bot/orchestrator.test.ts` (Ruling R41)

**Interfaces:**
- Produces: `ManagedFacts.gateBypassed: boolean` — dibaca Task 17 untuk ditampilkan di trace
- Produces: `managedFactsFor(message, topic, hasCatalogFacts = false)` (Ruling R41)

> **Ruling R41 — jaring hanya saat memang tidak ada jawaban.** Alasan jaring di task ini sendiri: "jawaban miring lebih baik daripada tidak ada jawaban". Kalau katalog sudah punya fakta untuk giliran ini, jawaban ADA — mengulang tanpa gerbang di situ hanya memasukkan kembali entri yang baru ditolak gerbang, kebalikan tujuan plan (bot tidak membaca semua knowledge), dan membuat test penolakan Task 5 (R40) gagal. Terverifikasi: di kedua call site `resolveKnowledgeForTopic` dipanggil SEBELUM `managedFactsFor` (`orchestrator.ts:879`→`:887` dan `:1531`→`:1538`). Maka:
> - Tanda tangan: `managedFactsFor(message, topic, hasCatalogFacts = false)`. Default `false` = perilaku jaring asli plan, supaya snippet task lain yang memanggil dengan dua argumen tetap bermakna sama.
> - Jaring (ulang tanpa gerbang) hanya berjalan bila `!hasCatalogFacts`.
> - Kedua call site mengirim nilai nyata, dihitung SEBELUM baris managed di-push: `preDestinationKnowledge.factualLines.length > 0` (`:887`) dan `knowledge.factualLines.length > 0` (`:1538`).
> - Test tambahan di `runtime-integration.test.ts`: fixture yang sama dengan test bypass, `hasCatalogFacts = true` → `lines` kosong dan `gateBypassed: false`.
> - Test penolakan Task 5 ('menolak entri bertopik payment saat giliran bertopik route_endpoint') dipanggil dengan `true` — `route_endpoint` memang dijawab katalog — supaya ia tetap membuktikan penolakan, bukan berubah jadi kasus bypass.
> - Dua test di `orchestrator.test.ts`, satu per call site (argumen ketiga opsional, jadi `tsc` tidak menangkap call site yang lupa mengirimnya): fakta katalog termock TIDAK kosong + satu entri managed yang topiknya lain tetapi kata-katanya cocok → system prompt TIDAK memuat jawaban entri itu. Pakai pola test cabang tanpa-destinasi yang ditambahkan Task 5, dan pola cabang katalog yang sudah ada di berkas itu.
> - Anchor terkini: `ManagedFacts` di `runtime-integration.ts:120`, `EMPTY` di `:127` (snippet di bawah menyebut 119/126).
> - Biaya kalau salah: giliran yang salah-klasifikasi DAN punya fakta katalog tidak mendapat fakta managed yang benar — tetap terlihat sebagai entri ditolak begitu Task 17 selesai.

> **Ruling R25:** dua assertion lama `toEqual({ lines: [], refs: [] })` di `runtime-integration.test.ts` harus diperbarui menyertakan `gateBypassed: false`, kalau tidak keduanya pecah. `mockEntries` sudah didefinisikan Task 5 (commit 4ea3283, Ruling R24) — pakai helper itu.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('mengulang tanpa gerbang saat gerbang menghasilkan nol, dan menandainya', async () => {
  mockEntries([
    { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
  ])
  const facts = await managedFactsFor('bisa selesai di malang?', 'price')
  expect(facts.lines).toHaveLength(1)
  expect(facts.gateBypassed).toBe(true)
})

it('tidak menandai bypass saat gerbang memang menghasilkan baris', async () => {
  mockEntries([
    { question: 'Bisa selesai di Malang?', answer: 'Bisa.', topics: ['route_endpoint'] },
  ])
  const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint')
  expect(facts.gateBypassed).toBe(false)
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts`
Expected: FAIL — `gateBypassed` belum ada.

- [ ] **Step 3: Implementasi**

Tambahkan ke tipe `ManagedFacts` di `src/lib/bot/runtime-integration.ts:119`:

```typescript
  /**
   * True kalau gerbang topik menghasilkan NOL baris lalu diulang tanpa gerbang.
   *
   * Ini gejala klasifikasi meleset, bukan kondisi normal. Dicatat di trace supaya
   * frekuensinya bisa dihitung -- kalau sering, gerbangnya lebih merugikan daripada
   * menolong dan harus ditinjau ulang.
   */
  gateBypassed: boolean
```

Ubah `EMPTY` di baris 126 jadi `{ lines: [], refs: [], gateBypassed: false }`.

Bungkus badan fungsi jadi helper yang menerima topik, lalu:

```typescript
  const gated = collect(managed, asked, topic)
  if (gated.lines.length > 0) return { ...gated, gateBypassed: false }

  // Gerbang menghasilkan nol. Ini bisa berarti dua hal: memang tidak ada fakta yang
  // relevan (wajar), atau klasifikasi meleset dan fakta yang benar baru saja dibuang
  // (tidak wajar). Kita tidak bisa membedakannya di sini, jadi kita pilih sisi yang
  // lebih murah salahnya -- jawab dengan bahan seadanya, lalu tandai supaya bisa dihitung.
  const ungated = collect(managed, asked, null)
  return { ...ungated, gateBypassed: ungated.lines.length > 0 }
```

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/runtime-integration.ts src/lib/bot/runtime-integration.test.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "feat(knowledge): jaring saat gerbang topik menghasilkan nol baris, ditandai untuk dihitung"
```

---

### Task 7: Classifier fakta — multi-topik

Classifier pesan mengembalikan **tepat satu** topik. Untuk fakta itu salah: satu entri sering melayani beberapa jenis pertanyaan.

**Files:**
- Create: `src/lib/bot/fact-topic-classifier.ts`
- Test: `src/lib/bot/fact-topic-classifier.test.ts`

**Interfaces:**
- Consumes: `callLLM` dari `src/lib/bot/llm.ts`, `RESOLVER_TOPICS` (Task 4)
- Produces: `classifyFactTopics(question: string, answer: string, model?: string): Promise<ResolverTopic[]>` — dipanggil Task 8

> **Ruling R43 — tiga koreksi snippet, terverifikasi terhadap berkas saudaranya `topic-classifier.ts`/`.test.ts`:** (a) test memakai pola repo — import statis + `vi.mock` yang di-hoist (`topic-classifier.test.ts:1-10`), bukan `await import` top-level; (b) kegagalan TIDAK ditelan diam-diam — `classifyTopicViaLLM` mencatat `console.error('topic classification failed', { error })` (`topic-classifier.ts:89`), jadi classifier fakta mencatat dengan cara yang sama; dua test kegagalan memasang `vi.spyOn(console, 'error')` supaya keluaran test bersih dan pencatatannya ditegaskan; (c) contoh deposit di prompt "30%" diganti "20%" — sama dengan katalog (`policy_payment_deposit`: "standard 20%") — supaya prompt tidak menanam angka yang bertentangan dengan fakta JVTO. Biaya kalau salah: nol.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/bot/fact-topic-classifier.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { classifyFactTopics } from './fact-topic-classifier'
import { callLLM } from './llm'

vi.mock('./llm', () => ({ callLLM: vi.fn() }))

describe('classifyFactTopics', () => {
  beforeEach(() => vi.mocked(callLLM).mockReset())

  it('mengembalikan beberapa topik untuk fakta yang melayani lebih dari satu', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["route_endpoint","price"]}')
    const topics = await classifyFactTopics('Bisa drop off di Malang?', 'Bisa, surcharge IDR 250.000.')
    expect(topics).toEqual(['route_endpoint', 'price'])
  })

  it('membuang topik karangan yang tidak ada di 14 nilai resmi', async () => {
    vi.mocked(callLLM).mockResolvedValue('{"topics":["payment","topik_karangan"]}')
    const topics = await classifyFactTopics('Q', 'A')
    expect(topics).toEqual(['payment'])
  })

  it('mengembalikan daftar kosong saat LLM gagal — tidak boleh memblokir penyimpanan', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(callLLM).mockRejectedValue(new Error('timeout'))
    const topics = await classifyFactTopics('Q', 'A')
    expect(topics).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('mengembalikan daftar kosong saat keluaran bukan JSON', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(callLLM).mockResolvedValue('maaf saya tidak paham')
    const topics = await classifyFactTopics('Q', 'A')
    expect(topics).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/fact-topic-classifier.test.ts`
Expected: FAIL — modulnya belum ada.

- [ ] **Step 3: Implementasi**

Buat `src/lib/bot/fact-topic-classifier.ts`:

```typescript
/**
 * Menandai satu FAKTA dengan topik-topik yang dilayaninya.
 *
 * --- Kenapa ini terpisah dari topic-classifier.ts ---
 *
 * Pertanyaannya berbeda, dan bentuk jawabannya ikut berbeda:
 *
 *   pesan pelanggan : "ini pertanyaan tentang apa?"        -> TEPAT SATU topik
 *   fakta knowledge : "fakta ini melayani topik apa saja?" -> SATU ATAU LEBIH
 *
 * Memaksa fakta ke satu topik akan membuangnya dari sisi yang lain: entri drop-off Malang
 * yang memuat surcharge melayani `route_endpoint` DAN `price`, dan pelanggan yang menulis
 * "how much to drop off in malang?" diklasifikasi ke `price`.
 *
 * --- Kenapa dipanggil saat SIMPAN, bukan saat baca ---
 *
 * Sekali per revisi, bukan sekali per giliran. Runtime tetap deterministik: gerbang di
 * runtime-integration.ts hanya membandingkan dua nilai tersimpan, tidak memanggil model.
 * Memanggil model saat baca akan membuat gerbang tidak bisa ditelusuri -- kenapa entri ini
 * lolos kemarin tapi tidak hari ini?
 *
 * --- Kenapa kegagalan mengembalikan daftar kosong ---
 *
 * Daftar kosong = perilaku sebelum field `topics` ada (overlap token). Itu penurunan mutu
 * yang aman. Melempar akan memblokir operator menulis knowledge karena masalah yang tidak
 * ada hubungannya dengan tulisannya.
 */
import { callLLM } from './llm'
import { RESOLVER_TOPICS, type ResolverTopic } from './module-resolver'

const VALID = new Set<string>(RESOLVER_TOPICS)

const FACT_TOPIC_SYSTEM_PROMPT = `You are tagging one FACT from a private tour operator's (JVTO, East Java, Indonesia) knowledge base.

Decide which of these 14 topics this fact could legitimately help answer. A fact may serve SEVERAL topics — tag every one that genuinely applies, but do not tag topics the fact says nothing about.

- "inclusions": what is included/excluded in a package.
- "price": cost, pricing, budget, "how much".
- "private_tour": private vs shared/group, or the guide/driver arrangement.
- "vehicle": vehicle type, capacity, luggage space.
- "rooming": room configuration — twin/double/single bed, room type.
- "hotel": accommodation/hotel standard, overnight stays.
- "route_endpoint": where the trip starts or finishes, drop-off points, the Bali ferry crossing.
- "destination_readiness": safety, difficulty, or what to prepare for a specific destination.
- "booking": how to book, the reservation process.
- "payment": deposit, payment methods, bank transfer, instalments — how or when money changes hands.
- "cancellation": cancellation, refund, reschedule, travel credit.
- "blue_fire": the Blue Fire phenomenon at Ijen specifically.
- "greeting": a plain greeting with no real question.
- "general": broadly useful facts that do not belong to any single topic above.

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"topics": ["<topic>", "..."]}

Examples:

Fact: "Can a Surabaya package finish with drop-off in Malang? — Yes. A surcharge of IDR 250,000 per vehicle applies."
Output: {"topics": ["route_endpoint", "price"]}

Fact: "How much deposit confirms a booking? — 20% of the total."
Output: {"topics": ["payment", "booking"]}

Fact: "All tours are 100% private — your group only, no strangers ever."
Output: {"topics": ["private_tour", "general"]}`

/** Buang pagar kode kalau model menyertakannya walau diminta tidak. */
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export async function classifyFactTopics(
  question: string,
  answer: string,
  model?: string,
): Promise<ResolverTopic[]> {
  try {
    const raw = await callLLM(`${question}\n${answer}`, {
      system: FACT_TOPIC_SYSTEM_PROMPT,
      model,
    })
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) return []
    const topics = (parsed as Record<string, unknown>).topics
    if (!Array.isArray(topics)) return []
    const valid = topics.filter((t): t is ResolverTopic => typeof t === 'string' && VALID.has(t))
    return [...new Set(valid)]
  } catch (error) {
    // Tidak melempar: lihat komentar kepala berkas -- operator tetap bisa menyimpan. Tapi
    // kegagalannya dicatat, sama seperti classifyTopicViaLLM, supaya tidak hilang tanpa jejak.
    console.error('fact topic classification failed', { error })
    return []
  }
}
```

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/lib/bot/fact-topic-classifier.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/fact-topic-classifier.ts src/lib/bot/fact-topic-classifier.test.ts
git commit -m "feat(knowledge): classifier multi-topik untuk fakta, dijalankan saat simpan"
```

---

### Task 8: Isi `topics` otomatis saat operator menyimpan

**Files:**
- Modify: `src/lib/bot-control/knowledge-workflow.ts:121` (`createManagedKnowledge`) dan `:185` (`saveKnowledgeDraft`)
- Test: `src/lib/bot-control/knowledge-workflow.test.ts`

**Interfaces:**
- Consumes: `classifyFactTopics` (Task 7)
- Produces: revisi tersimpan dengan `topics` terisi

> **Ruling R33 — snippet test di bawah skematik; bentuk aslinya:**
> - Tanda tangan asli: `saveKnowledgeDraft(sourceId: string, params: SaveDraftParams, actor)` dengan `SaveDraftParams = { title?, summary?, body: unknown, reason: string }`. Jadi panggil `saveKnowledgeDraft('src-1', { body: { items: [...] }, reason: 'uji' }, actor)` — `sourceId` posisional pertama, item di dalam `body`, `reason` wajib. `createManagedKnowledge(params, actor)` sama: item di `params.body`.
> - `RevisionResult` hanya `{ sourceId, revisionId, version, status, title }` — **tidak ada `revision.body`**. Tegaskan body yang **ditulis**: argumen `data.body` pada penulisan `knowledgeRevision` (create/update, langsung atau di dalam `$transaction`) — cari di fungsinya, jangan menebak.
> - Test "tidak memblokir penyimpanan" menegaskan penulisan tetap terjadi saat classifier mengembalikan `[]`.

> **Ruling R44 — model, urutan, dan cakupan test (terverifikasi di `knowledge-workflow.ts` dan `orchestrator.ts`):**
> - **Model dari Settings.** Bot memberi `settings.ollamaModel` ke setiap classifier (`orchestrator.ts:1255-1256`); tanpa itu classifier fakta memakai konstanta `DEFAULT_OLLAMA_MODEL` di `llm.ts` dan pilihan model operator di /chatbot diabaikan. Baca `prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })` — HANYA bila ada item tanpa `topics` — lalu teruskan `row?.ollamaModel` (baris hilang → `undefined` → default `llm.ts`).
> - **Urutan di `saveKnowledgeDraft`:** sesudah SEMUA penjaga — tipe MANUAL (`:198`), ARCHIVED (`:203`), revisi terakhir ada (`:211`) — dan sebelum `update`/`create`. Di `createManagedKnowledge`: sesudah validasi (`:122-123`), sebelum `prisma.$transaction` (`:125`).
> - **Body yang ditulis** = `{ ...validated.body, items: terisi }` di ketiga titik tulis (`:148`, `:223`, `:240`).
> - **Test** memakai pola berkas yang ada: mock `@/lib/bot/fact-topic-classifier` dengan default `[]` di `beforeEach` (test lama tak berubah), tegaskan `data.body` pada `mockPrisma.knowledgeRevision.update` (jalur draft), `mockPrisma.knowledgeRevision.create` (jalur versi baru), dan `mockTx.knowledgeRevision.create` (createManagedKnowledge). Tambahan di luar tiga snippet: (1) createManagedKnowledge juga mengisi topics; (2) classifier TIDAK dipanggil untuk sumber non-MANUAL (membuktikan urutan penjaga); (3) classifier menerima model dari Settings; (4) Settings tidak dibaca bila semua item sudah punya topics.
> - **Batas yang dilaporkan, bukan diperbaiki di sini:** setelah tersimpan, topik isian classifier tidak bisa dibedakan dari pilihan operator, dan tidak diperbarui bila jawaban diedit kemudian — Task 9 menampilkannya di editor supaya operator memeriksa.
> - Biaya kalau salah: satu query Settings per simpan yang punya item tanpa topik.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('mengisi topics dari classifier saat item disimpan tanpa topics', async () => {
  vi.mocked(classifyFactTopics).mockResolvedValue(['payment'])
  const result = await saveKnowledgeDraft(
    { sourceId: 'src-1', items: [{ question: 'Berapa deposit?', answer: '20%.' }] },
    actor,
  )
  expect(result.revision.body.items[0].topics).toEqual(['payment'])
})

it('TIDAK menimpa topics yang sudah diisi operator', async () => {
  vi.mocked(classifyFactTopics).mockResolvedValue(['payment'])
  const result = await saveKnowledgeDraft(
    { sourceId: 'src-1', items: [{ question: 'Q', answer: 'A', topics: ['booking'] }] },
    actor,
  )
  expect(result.revision.body.items[0].topics).toEqual(['booking'])
})

it('tetap menyimpan saat classifier gagal', async () => {
  vi.mocked(classifyFactTopics).mockResolvedValue([])
  const result = await saveKnowledgeDraft(
    { sourceId: 'src-1', items: [{ question: 'Q', answer: 'A' }] },
    actor,
  )
  expect(result.revision).toBeDefined()
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot-control/knowledge-workflow.test.ts`
Expected: FAIL — `topics` masih undefined.

- [ ] **Step 3: Implementasi**

Di `src/lib/bot-control/knowledge-workflow.ts`, tambahkan helper:

```typescript
/**
 * Isi `topics` untuk item yang belum punya, dari classifier.
 *
 * Pilihan operator MENANG: item yang sudah punya `topics` tidak pernah disentuh. Classifier
 * mengusulkan, manusia memutuskan -- itu yang membuat "kontrol operator jadi nyata" tetap
 * berlaku sambil bebannya turun dari MENULIS jadi MEMERIKSA.
 */
async function fillMissingTopics(items: KnowledgeItem[], model?: string): Promise<KnowledgeItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.topics && item.topics.length > 0) return item
      const topics = await classifyFactTopics(item.question, item.answer, model)
      return topics.length > 0 ? { ...item, topics } : item
    })
  )
}
```

Panggil **sesudah** `validateKnowledgeBody` — helper ini butuh `KnowledgeItem[]` yang sudah bertipe, sedangkan `params.body` masih `unknown` sebelum divalidasi. Di `saveKnowledgeDraft`, panggil juga **sesudah** penjaga `type` MANUAL, supaya tidak ada panggilan LLM untuk sumber yang toh akan ditolak. Di kedua fungsi, panggil **sebelum** `prisma.$transaction` atau penulisan apa pun: panggilan LLM bisa sampai 10 detik per item, dan menjalankannya di dalam transaksi menahan koneksi database selama model berpikir. Hasil classifier sudah tervalidasi ke enum 14 topik, jadi body yang terisi tetap sah (Ruling R33).

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/lib/bot-control/knowledge-workflow.test.ts`
Expected: PASS.

- [ ] **Step 5: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot-control/knowledge-workflow.ts src/lib/bot-control/knowledge-workflow.test.ts
git commit -m "feat(knowledge): isi topics otomatis saat simpan, pilihan operator tetap menang"
```

---

### Task 9: Multi-select topik di editor, dan topik terlihat di tabel

Tanpa ini, salah tanda dari classifier tidak pernah terlihat operator — dan itu risiko utama Task 8.

**Files:**
- Modify: `src/components/bot-control/KnowledgeEditor.tsx`
- Modify: `src/components/bot-control/KnowledgeSourceTable.tsx`
- Modify: `src/components/bot-control/KnowledgeRevisionPanel.tsx`
- Modify: `src/lib/bot-control/knowledge-body.ts` — helper `topicsOfBody` (Ruling R45)
- Modify: `src/app/api/bot-control/knowledge/sources/route.ts` — **GET saja**: `topics` per baris (Ruling R45)
- Modify: `src/app/api/bot-control/knowledge/sources/[id]/revisions/route.ts` — `topics` per revisi, body tetap tidak dikirim (Ruling R45)
- Tanpa perubahan pada handler TULIS (Ruling R35): `POST` di `src/app/api/bot-control/knowledge/sources/route.ts` dan `sources/[id]/draft/route.ts` — keduanya menerima `body: z.unknown()` dan menyerahkan validasi ke `knowledge-workflow` → `validateKnowledgeBody`, jadi `topics` lolos otomatis setelah Task 4
- Test: `src/components/bot-control/KnowledgeEditor.test.tsx`
- Test: `src/components/bot-control/KnowledgeSourceTable.test.tsx`, `src/components/bot-control/KnowledgeRevisionPanel.test.tsx` (Ruling R45)
- Test: `src/lib/bot-control/knowledge-body.test.ts`, `src/app/api/bot-control/knowledge/sources/route.test.ts`, `src/app/api/bot-control/knowledge/sources/[id]/routes.test.ts` (Ruling R45)

**Interfaces:**
- Consumes: `RESOLVER_TOPICS` (Task 4)
- Produces: `topics` terkirim di body request ke `POST/PUT` route knowledge
- Produces: `topics: ResolverTopic[]` per baris di GET sources dan per revisi di GET revisions (Ruling R45)

> **Ruling R45 — data topik belum sampai ke tabel dan panel; snippet test tidak cocok dengan komponen (terverifikasi):**
> - `KnowledgeSourceRow` (`KnowledgeSourceTable.tsx:16`) dan `RevisionRow` (`KnowledgeRevisionPanel.tsx:7`) tidak membawa isi item sama sekali; GET sources hanya memilih `{ id, version, status }` revisi terakhir (`sources/route.ts:72`), dan GET revisions sengaja tanpa body (`revisions/route.ts:13-15`). Badge topik mustahil tanpa perubahan GET. Maka: helper `topicsOfBody(value: unknown): ResolverTopic[]` di `knowledge-body.ts` (gabungan topik semua item, urut `RESOLVER_TOPICS`, `[]` bila body tak terbaca — lewat `readKnowledgeBody`); GET sources menambah `body: true` ke select revisi terakhir dan mengembalikan `topics` per baris; GET revisions menambah `body: true` ke select dan mengembalikan `topics` per revisi — **body itu sendiri tetap tidak dikirim** (alasan di kepala berkas itu tetap berlaku; `topics` paling banyak 14 nilai). `KnowledgeSourceRow.topics` dan `RevisionRow.topics` bertipe `ResolverTopic[]`. R35 tetap berlaku untuk handler TULIS; R45 hanya menyentuh GET.
> - Snippet test di bawah skematik. Props asli: `initial: KnowledgeDraft` + `onSave(draft, reason, activate)`, lewat helper `renderEditor()` yang sudah ada di berkas test. Tombol simpan baru aktif setelah alasan ≥10 karakter diisi, dan ada DUA tombol ("Simpan & aktifkan", "Simpan draft") — pilih dengan nama persis. `@testing-library/user-event` TIDAK terpasang (package.json hanya `@testing-library/react` dan `@testing-library/jest-dom`); menambahkannya berarti mengubah package.json = gerbang pemilik, jadi pakai `fireEvent` seperti test yang ada.
> - Checkbox: `aria-label={`Topik ${topic} item ${index + 1}`}` — satu item → 14 checkbox yang cocok `/topik/i`. Label tampil = id topik apa adanya, sama dengan yang tertulis di trace. Semua centang dilepas → `topics: undefined` (pola `prices`/`links` di berkas yang sama).
> - `RESOLVER_TOPICS` aman diimpor komponen klien: `module-resolver.ts` tidak mengimpor apa pun.
> - Commit menyebut berkas satu per satu (R34), bukan `git add` satu direktori.
> - Test tambahan: `topicsOfBody` (gabungan, urutan, body tak terbaca → `[]`); GET sources dan GET revisions mengembalikan `topics`, dan GET revisions tetap tanpa `body`; badge tampil di tabel dan di panel.
> - Batas yang dilaporkan: mengosongkan semua topik lalu menyimpan akan diisi ulang classifier (Task 8) — operator tidak bisa membuat item "tanpa topik" dari form.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('menampilkan 14 pilihan topik', () => {
  render(<KnowledgeEditor {...baseProps} />)
  expect(screen.getAllByRole('checkbox', { name: /topik/i })).toHaveLength(14)
})

it('mengirim topik terpilih saat disimpan', async () => {
  render(<KnowledgeEditor {...baseProps} />)
  await userEvent.click(screen.getByRole('checkbox', { name: /payment/i }))
  await userEvent.click(screen.getByRole('button', { name: /simpan/i }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ items: [expect.objectContaining({ topics: ['payment'] })] })
  )
})

it('menampilkan topik yang sudah tersimpan sebagai terpilih', () => {
  render(<KnowledgeEditor {...baseProps} initialItems={[{ question: 'Q', answer: 'A', topics: ['booking'] }]} />)
  expect(screen.getByRole('checkbox', { name: /booking/i })).toBeChecked()
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/components/bot-control/KnowledgeEditor.test.tsx`
Expected: FAIL — belum ada checkbox topik.

- [ ] **Step 3: Implementasi**

Di `KnowledgeEditor.tsx`, di samping input `tags`, render satu checkbox per `RESOLVER_TOPICS`, terikat ke `item.topics`. Ikuti pola komponen form yang sudah dipakai berkas ini — jangan memperkenalkan pustaka form baru.

Di `KnowledgeSourceTable.tsx` dan `KnowledgeRevisionPanel.tsx`, tampilkan topik tiap item sebagai badge. **Tujuannya bukan hiasan** — topik yang salah harus terlihat tanpa membuka form.

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/components/bot-control/`
Expected: PASS.

- [ ] **Step 5: Terima `topics` di route API**

**Tidak ada yang diubah di route (Ruling R35, terverifikasi):** `sources/route.ts:115` dan `sources/[id]/draft/route.ts:24` mendeklarasikan `body: z.unknown()` dan meneruskan `parsed.data.body` apa adanya ke `knowledge-workflow`, yang memvalidasi dengan `validateKnowledgeBody`. Begitu skema Task 4 memuat `topics`, route meneruskannya tanpa satu baris pun berubah. Jangan edit handler tulisnya — perubahan GET di Ruling R45 terpisah.

- [ ] **Step 6: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/components/bot-control/KnowledgeEditor.tsx src/components/bot-control/KnowledgeEditor.test.tsx src/components/bot-control/KnowledgeSourceTable.tsx src/components/bot-control/KnowledgeSourceTable.test.tsx src/components/bot-control/KnowledgeRevisionPanel.tsx src/components/bot-control/KnowledgeRevisionPanel.test.tsx src/lib/bot-control/knowledge-body.ts src/lib/bot-control/knowledge-body.test.ts src/app/api/bot-control/knowledge/sources/route.ts src/app/api/bot-control/knowledge/sources/route.test.ts 'src/app/api/bot-control/knowledge/sources/[id]/revisions/route.ts' 'src/app/api/bot-control/knowledge/sources/[id]/routes.test.ts'
git commit -m "feat(ui): pemilih topik di editor knowledge, topik tampil di tabel dan panel revisi"
```

---

## FASE 2 — Pindahkan fakta keluar dari kode

> **GERBANG G2** berlaku di Task 11 Step 1 saja — kebenaran fakta bisnisnya. Task 10 dan sisa Task 11 berjalan tanpa menunggu apa pun.

### Task 10: Buka gerbang eval di working copy

`npm run eval` adalah gerbang mutu utama Fase 2. Sudah dibuktikan menolak jalan (`Deployment gate is CLOSED`) karena `catalog/deployment-approval.json` gitignored dan hanya ada di VPS. `approve:deployment` sudah diverifikasi ada di `package.json`.

> **Ruling R36:** jalankan `npm test` **sebelum** Step 1 dan catat jumlah test lulus. Setelah berkas approval lokal dibuat, jalankan `npm test` lagi — jumlah lulus wajib **identik**. `deployment-gate.test.ts` sendiri terisolasi (katalog di direktori temp), tapi suite lain membaca katalog asli; perbandingan ini membuktikan secara mekanis bahwa berkas approval lokal tidak mengubah hasil suite untuk task sesudahnya. Kalau berbeda: hentikan dan laporkan test mana yang berubah.

**Files:**
- Tidak ada perubahan kode. Hanya menjalankan skrip yang sudah ada.

- [ ] **Step 1: Mint approval lokal**

Run: `npm run approve:deployment -- --approved-by "davidsetyaahr"`
Expected: `catalog/deployment-approval.json` terbentuk.

- [ ] **Step 2: Jalankan eval sebagai baseline**

Run: `npm run eval`
Expected: 13 kasus jalan. **Catat hasilnya** — ini pembanding untuk Task 11.

- [ ] **Step 3: Jangan commit berkas approval**

Run: `git status --short catalog/`
Expected: kosong (berkas itu gitignored). Kalau muncul, **jangan** `git add` — ia VPS-only.

---

### Task 11: Pindahkan blok fakta ke knowledge, hapus `GENERAL_FAQ_FALLBACK`

**Files:**
- Modify: `src/lib/bot/knowledge.ts:58-127` (hapus konstanta)
- Modify: `src/lib/bot/orchestrator.ts` — TIGA cabang (Ruling R27): Mode 3 prompt `:794` + grounding `:818`/`:822`; tanpa-destinasi prompt `:889` + grounding `:917`; katalog prompt `:1755` + grounding `:1806`
- Modify: `src/lib/bot/runtime-integration.ts` (fungsi baru `allManagedFacts()` untuk Mode 3)
- Test: `src/lib/bot/orchestrator.test.ts` (test Mode 3 di sekitar `:357` ditulis ulang)
- Test: `src/lib/bot/knowledge.test.ts` (hapus `describe('GENERAL_FAQ_FALLBACK')`, sekitar `:375-390`)
- Data: entri knowledge baru di database

**Interfaces:**
- Consumes: `topics` (Task 4), gerbang (Task 5)
- Produces: `GENERAL_FAQ_FALLBACK` tidak lagi diekspor · `allManagedFacts(): Promise<ManagedFacts>` (Mode 3)

- [ ] **Step 1 — 🛑 GERBANG G2: operator meninjau kebenaran tiap blok fakta**

**Berhenti di sini.** Untuk tiap blok di `src/lib/bot/knowledge.ts:58-127`, operator menjawab: **masih benar?**

Yang paling mungkin sudah bergeser dan paling mahal kalau salah:

| Klaim di kode | Masih benar? |
| --- | --- |
| Deposit **20%** dari total | ☐ |
| Pelunasan **H-3** sebelum hari pertama | ☐ |
| Booking <6 hari → **100%** penuh | ☐ |
| Dalam 14 hari → boleh diminta penuh | ☐ |
| Ijen **3 km**, 1,5–2 jam | ☐ |
| Bromo 15–20 menit ke bibir kawah | ☐ |
| Screening medis **10–15 menit** | ☐ |
| Musim kering **April–Oktober** | ☐ |

**Kenapa ini gerbang dan bukan sesuatu yang bisa saya putuskan:** tidak ada apa pun di repo, database, atau katalog yang bisa mengonfirmasi angka-angka ini. Ia hanya ada di kepala JVTO. Memindahkan yang usang **memindahkan kesalahan lalu memberinya stempel "sudah ditinjau"** — lebih buruk daripada membiarkannya di kode, karena setelah pindah tidak ada yang curiga lagi.

Blok yang ternyata salah **diperbaiki angkanya saat ditulis jadi entri**, bukan disalin apa adanya lalu dicatat sebagai pekerjaan lain.

- [ ] **Step 2: Bereskan dua entri DRAFT yatim**

Dua `KnowledgeSource` bertajuk "can i see blue fire?" berstatus `v1:DRAFT`. Keduanya **tidak pernah dibaca bot** (loader hanya membaca `PUBLISHED`), jadi ini bukan penghalang — tapi keduanya akan mengotori tabel sumber begitu Fase 2 mengisinya dengan entri sungguhan.

Terbitkan kalau isinya benar, arsipkan kalau tidak. Dikerjakan di sini, bukan ditinggalkan jadi utang.

- [ ] **Step 3: Pilah 11 blok jadi tiga tumpukan**

Buka `src/lib/bot/knowledge.ts:58-127`. Untuk tiap blok, jawab satu pertanyaan: **"kalau ini salah, pelanggan dapat informasi keliru?"**

| Blok | Tumpukan | Topik tujuan |
| --- | --- | --- |
| GENERAL | fakta | seluruh 14 topik |
| BLUE FIRE | fakta | `blue_fire` |
| MEDICAL SCREENING | fakta | `destination_readiness` |
| INCLUSIONS | fakta | `inclusions` |
| EXCLUSIONS | fakta | `inclusions` |
| PAYMENT | fakta | `payment` |
| WHAT TO BRING | fakta | `destination_readiness` |
| BEST TIME | fakta | `blue_fire`, `destination_readiness` |
| PHYSICAL DIFFICULTY | fakta | `destination_readiness` |
| DESTINATIONS | fakta | `general` |
| FERRY / TRANSPORT | fakta | `route_endpoint` |

Semua 11 adalah fakta. **`GUARDRAIL_INSTRUCTION` dan `DISCLOSURES` tidak ikut** — keduanya aturan.

- [ ] **Step 4: Tulis entri knowledge lewat UI, terbitkan**

Untuk tiap blok, buat `KnowledgeSource` baru lewat `/bot-control/knowledge`, isi `question` sebagai kalimat pelanggan (bukan judul internal), `answer` sebagai isi bloknya, dan pilih topiknya. Terbitkan.

Blok GENERAL diberi **seluruh 14 topik** — selalu lolos, tetap bisa diedit. Ini pengganti "baseline minimum" yang sengaja **tidak** di-hardcode.

- [ ] **Step 5: Verifikasi entri terbaca bot**

Run: `npm run verify:revisions`
Expected: semua revisi baru lolos parse.

- [ ] **Step 6: Hapus `GENERAL_FAQ_FALLBACK` dari KETIGA cabang — Ruling R27**

Konstanta ini dirakit ke prompt di tiga cabang, dan di setiap cabang juga masuk ke grounding reply-verifier (harga dan URL yang boleh dikutip). Menghapusnya di satu cabang saja membuat dua cabang lain kehilangan seluruh fakta umum tanpa pengganti — tsc akan menangkap rujukan yang tertinggal, tapi **tidak** menangkap hilangnya fakta.

| Cabang | Prompt | Grounding verifier | Pengganti |
| --- | --- | --- | --- |
| Katalog (destinasi diketahui) | `:1755` | `:1806` (`groundedText`) | sudah ada — `managed.lines` masuk lewat `knowledge.factualLines` (Task 5) |
| Tanpa destinasi | `:889` | `:917` (`preDestinationText`) | sudah ada — dipasang di Task 5 (Ruling R26) |
| Mode 3 (booking) | `:794` | `:818` + `:822` | **baru** — `allManagedFacts()` |

Mode 3 berjalan sebelum klasifikasi, jadi tidak punya topik untuk gerbang. Tambahkan di `runtime-integration.ts`:

```typescript
/**
 * SELURUH fakta managed yang terbit — tanpa gerbang topik dan tanpa saringan overlap kata.
 *
 * Hanya untuk Mode 3. Mode 3 berjalan sebelum klasifikasi sehingga tidak punya topik, dan sebelum
 * fakta JVTO pindah ke knowledge ia selalu menerima blok GENERAL_FAQ_FALLBACK utuh. Fungsi ini
 * menjaga janji itu: pelanggan yang sudah booking tetap menerima semua fakta umum yang dulu
 * diterimanya — hanya sumbernya yang pindah (E5, "Mode 3 tidak tersentuh", secara perilaku).
 */
export async function allManagedFacts(): Promise<ManagedFacts>
```

Isi baris dan `refs`-nya memakai format yang sama dengan `managedFactsFor` (termasuk baris harga dan tautan yang berdiri sendiri, supaya verifier bisa menyumbernya). Di Mode 3, baris itu menggantikan `GENERAL_FAQ_FALLBACK` di prompt **dan** di kedua array grounding.

Test Mode 3 yang ada ("gives Mode 3 access to GENERAL_FAQ_FALLBACK and GUARDRAIL_INSTRUCTION…") ditulis ulang untuk menegaskan Mode 3 menerima `allManagedFacts()` dan `GUARDRAIL_INSTRUCTION`.

Hapus juga importnya kalau sudah tidak dipakai berkas itu.

- [ ] **Step 7: Hapus konstantanya**

Di `src/lib/bot/knowledge.ts`, hapus `export const GENERAL_FAQ_FALLBACK` beserta isinya (baris 58-127). Hapus juga `describe('GENERAL_FAQ_FALLBACK', ...)` di `knowledge.test.ts` — isinya menegaskan fakta bisnis ('Deposit: 20%', 'Revolut', 'gas mask') di konstanta yang sudah tidak ada; jaminan itu pindah ke Gerbang G2, `npm run verify:revisions`, dan `npm run eval`. Jalankan `npx tsc --noEmit` untuk menemukan pemakai lain — **setiap rujukan yang tersisa ditangani per Step 6, bukan sekadar dihapus.**

- [ ] **Step 8: Jalankan eval — GERBANG WAJIB**

Run: `npm run eval`
Expected: **13 kasus lulus, tanpa satu pun ekspektasi diubah.**

Kalau ada yang gagal, itu berarti satu blok mendarat di topik yang salah dan faktanya sekarang tidak terjangkau. **HENTIKAN.** Jangan menyesuaikan ekspektasi — ekspektasi yang berubah berarti perilaku yang berubah, dan itu harus dibahas dengan operator lebih dulu.

- [ ] **Step 9: Bandingkan grounding sebelum/sesudah di Test Lab**

Buka `/bot-control/test-lab`, jalankan 5 skenario nyata dari riset percakapan. Jumlah baris grounding harus **turun atau tetap**, tidak naik.

- [ ] **Step 10: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/knowledge.ts src/lib/bot/knowledge.test.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts src/lib/bot/runtime-integration.ts
git commit -m "feat(knowledge): fakta JVTO pindah dari kode ke knowledge bertopik, GENERAL_FAQ_FALLBACK dihapus"
```

---

## FASE 3 — Penjaga

### Task 12: Knowledge gagal dimuat jadi kerusakan, bukan kondisi normal

Sebelum Fase 2 knowledge cuma pelengkap, jadi "ditelan lalu jalan terus" benar. Sesudahnya ia sumber utama.

**Files:**
- Modify: `src/lib/bot/runtime-integration.ts`
- Modify: `src/lib/bot/orchestrator.ts` (tiga titik — Ruling R46)
- Test: `src/lib/bot/orchestrator.test.ts`
- Test: `src/lib/bot/runtime-integration.test.ts` (Ruling R46)

**Interfaces:**
- Consumes: `ManagedKnowledge.available` (sudah ada di `managed-knowledge.ts:48`)
- Produces: `ManagedFacts.degraded: boolean`

> **Ruling R46 — empat koreksi, terverifikasi di `managed-knowledge.ts` dan `runtime-integration.ts`:**
> - **Urutan pengecekan.** Saat pembacaan gagal, loader mengembalikan `{ entries: [], available: false }` (`managed-knowledge.ts:97` dan `:143`). `managedFactsFor` hari ini keluar lebih dulu di `entries.length === 0` dan `asked.size === 0` — dua-duanya SEBELUM `available` sempat dibaca, jadi kegagalan tersembunyi sebagai "tidak ada knowledge". `degraded` dihitung dari `managed.available === false` SEBELUM kedua early return itu; blok `catch` di `managedFactsFor` sendiri juga menghasilkan `degraded: true`.
> - **Tiga titik, bukan satu.** Knowledge dirakit di cabang tanpa-destinasi, cabang katalog, dan Mode 3 (`allManagedFacts()` dari Task 11, R27). Ketiganya memeriksa `degraded` sebelum menyusun prompt; `allManagedFacts` mengembalikan `ManagedFacts` sehingga membawa `degraded` yang sama.
> - **Balasan bisa diatur operator.** Pakai `await fallbackReplyText(TECHNICAL_HICCUP_REPLY)`, sama dengan cabang katalog-kosong di `orchestrator.ts` (`Settings.fallbackReply`; kosong = default di kode) — bukan konstanta langsung.
> - **Test** memakai tanda tangan asli `decideAndRespond(conversationId, inboundText)` dan skenario yang sudah ada di `orchestrator.test.ts` untuk tiap titik (satu test per titik). Test negatif TIDAK menegaskan `mode !== 'clarify'` (banyak jalur sah berakhir `clarify`), melainkan: tidak ada langkah trace 'Knowledge tidak terbaca' dan balasan bukan teks hiccup. Di `runtime-integration.test.ts`: `available: false` → `degraded: true`, termasuk saat pesan hanya berisi stopword; `available: true` tanpa entri → `degraded: false`.
> - Biaya kalau salah: saat database knowledge terputus, pelanggan menerima permintaan maaf alih-alih jawaban dari separuh pengetahuan — memang itu tujuan task ini.

> **Ruling R32:** Task 5 sudah memasang mock `@/lib/bot/managed-knowledge` di `orchestrator.test.ts` dengan default `{ entries: [], available: true, loadedAt: 0 }`. Test di task ini menyetel `available: false` secara eksplisit lewat `vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue(...)` — nama helper `mockManagedKnowledge` di snippet bersifat skematik. Tanpa default itu, setiap test orkestrator akan melihat `available: false` dan berubah jadi "technical hiccup".

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('menjawab TECHNICAL_HICCUP_REPLY saat pembacaan knowledge gagal', async () => {
  mockManagedKnowledge({ entries: [], available: false, loadedAt: Date.now() })
  const decision = await decideAndRespond(baseInput)
  expect(decision.mode).toBe('clarify')
  expect(decision.reply).toContain('technical hiccup')
})

it('TIDAK menganggap kerusakan saat memang tidak ada sumber terbit', async () => {
  mockManagedKnowledge({ entries: [], available: true, loadedAt: Date.now() })
  const decision = await decideAndRespond(baseInput)
  expect(decision.mode).not.toBe('clarify')
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts`
Expected: FAIL — `available: false` masih ditelan.

- [ ] **Step 3: Implementasi**

Tambahkan `degraded: boolean` ke `ManagedFacts`, di-set dari `managed.available === false`. Perbarui juga konstanta `EMPTY` dengan `degraded: false`. Di `orchestrator.ts`, sebelum menyusun prompt:

```typescript
    // Sebelum Fase 2, knowledge cuma pelengkap dan kegagalan pembacaannya wajar ditelan.
    // Sesudahnya ia memegang seluruh fakta bisnis JVTO, jadi membalas seadanya berarti
    // menjawab dengan percaya diri dari separuh pengetahuan -- tanpa ada yang tahu.
    if (managedFacts.degraded) {
      trace.push('Knowledge tidak terbaca', 'Pembacaan managed knowledge gagal -- menjawab clarify.')
      return { mode: 'clarify', reply: TECHNICAL_HICCUP_REPLY, steps: trace.steps }
    }
```

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/runtime-integration.ts src/lib/bot/runtime-integration.test.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "fix(bot): kegagalan baca knowledge jadi clarify, bukan ditelan diam-diam"
```

---

### Task 13: Dedup baris grounding lintas sumber

Komentar di `knowledge.ts:619-628` mencatat sendiri bahwa screening Ijen dinyatakan 4–5× dalam satu prompt.

**Files:**
- Modify: `src/lib/bot/knowledge.ts` (`resolveKnowledgeForTopic`)
- Test: `src/lib/bot/knowledge.test.ts`

**Interfaces:**
- Produces: `ResolvedKnowledge.factualLines` dan `.detailLines` bebas duplikat
- Produces: `dedupeLines(lines: string[]): string[]` diekspor (Ruling R48)

> **Ruling R48 — kedua test di bawah hampa; diganti kasus yang terukur (dup_check.ts, 2026-09-10):** diukur pada katalog nyata, `destination_readiness`+ijen → `factualLines` 2 baris, 0 kembar; `blue_fire`+ijen → `disclosures` 1 baris, 0 kembar. Kedua test akan lulus TANPA kode dedup. Yang benar-benar kembar hari ini: `blue_fire`+ijen (`'can we see the blue fire at ijen?'`, destinasi `'ijen'`) → `factualLines` 5 baris dengan 1 kembar, dan `detailLines` 4 baris dengan 1 kembar. Maka:
> - Test integrasi memakai kasus `blue_fire` itu dan menegaskan `factualLines` DAN `detailLines` bebas kembar.
> - Helper diekspor sebagai fungsi murni `dedupeLines(lines: string[]): string[]` (normalisasi spasi + huruf kecil, urutan kemunculan pertama dipertahankan) dengan unit test sintetis (varian spasi/huruf besar, urutan tetap). Itu yang membuktikan dedup `disclosures` — tidak ada kasus katalog yang punya disclosure kembar, karena `getTopicDisclosures` + penjaga `includes` (`knowledge.ts:692`) sudah mencegahnya. Dedup tetap diterapkan ke ketiga daftar, masing-masing terpisah.
> - RED dibuktikan: test integrasi gagal di HEAD sebelum dedup (1 kembar), lalu `dup_check.ts` dijalankan ulang sesudahnya dan harus melaporkan 0 kembar di kedua kasus.
> - **Step 5 (`npm run eval`) tertahan gerbang operator Task 10** — `JVTO_DEPLOYMENT_APPROVAL_KEY` tidak ada di `.env` lokal. Step itu dijalankan begitu Task 10 terbuka; bukan alasan menahan task ini.
> - Batas yang dilaporkan: baris managed di-push SESUDAH fungsi ini kembali (`orchestrator.ts`), jadi kembar antara katalog dan knowledge terkelola tidak tertangkap di sini.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('tidak mengembalikan baris fakta yang sama dua kali', () => {
  // Kasus yang tercatat di knowledge.ts sendiri: screening Ijen dinyatakan 4–5x.
  const resolved = resolveKnowledgeForTopic('destination_readiness', 'is the ijen hike difficult?', 'ijen')
  expect(new Set(resolved.factualLines).size).toBe(resolved.factualLines.length)
})

it('tidak mengembalikan disclosure yang sama dua kali', () => {
  const resolved = resolveKnowledgeForTopic('blue_fire', 'can we see the blue fire at ijen?', 'ijen')
  expect(new Set(resolved.disclosures).size).toBe(resolved.disclosures.length)
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/knowledge.test.ts`
Expected: FAIL — ada baris kembar.

- [ ] **Step 3: Implementasi**

Di akhir `resolveKnowledgeForTopic`, sebelum `return`:

```typescript
  // Satu fakta bisa masuk dari empat pintu berbeda (TOPIC_MODULES, resolver destinasi,
  // modul dipicu kata kunci, disclosure). Menyaring lalu mengirim duplikat menyelesaikan
  // setengah masalah -- prompt tetap membengkak, dan pengulangan membuat model menganggap
  // satu fakta lebih penting daripada yang lain tanpa alasan.
  //
  // Dedup pada teks yang sudah dinormalkan spasinya, bukan pada module_id: dua modul
  // berbeda bisa menyatakan kalimat yang sama persis (itu justru kasus yang paling sering).
  const seen = new Set<string>()
  const dedupe = (lines: string[]): string[] =>
    lines.filter((line) => {
      const key = line.replace(/\s+/g, ' ').trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
```

Terapkan pada `factualLines`, `detailLines`, dan `disclosures` — masing-masing dengan `seen` sendiri, supaya sebuah fakta tetap boleh muncul sekali di daftar fakta dan sekali sebagai disclosure kalau memang perannya berbeda.

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/lib/bot/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Eval tidak boleh berubah**

Run: `npm run eval`
Expected: 13 lulus, ekspektasi tidak diubah.

- [ ] **Step 6: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/knowledge.ts src/lib/bot/knowledge.test.ts
git commit -m "feat(bot): dedup baris grounding lintas sumber"
```

---

### Task 14: Verifier menangkap pelanggaran aturan jaminan

`reply-verifier.ts` sengaja hanya memeriksa harga dan URL — headernya menyatakan itu. Tapi tujuan operator adalah "jawaban sesuai aturan", dan larangan menjamin Blue Fire tidak pernah diperiksa pada balasan.

**Files:**
- Modify: `src/lib/bot/reply-verifier.ts`
- Modify: `src/lib/bot/orchestrator.ts` (dua call site `verifyReply` + trace advisory + `summariseVerdict` — Ruling R37/R49)
- Test: `src/lib/bot/reply-verifier.test.ts`
- Test: `src/lib/bot/orchestrator.test.ts` (Ruling R49)

**Interfaces:**
- Consumes: tidak ada dari `knowledge.ts` — daftar frasa sisi balasan milik `reply-verifier.ts` sendiri (Ruling R49)
- Produces: `VerificationResult.guaranteeViolations: string[]`

> **Ruling R37 — tanda tangan asli, snippet di bawah skematik:** `verifyReply(params: { replyText: string; groundedAmounts: number[]; groundedUrls: string[] })` (`reply-verifier.ts`) — satu objek, bukan argumen posisional, dan tidak punya `groundingLines` maupun `topic`. Tambahkan `topic?: string` opsional ke params-nya. Pemanggil satu-satunya adalah `composeVerifiedReply` (`orchestrator.ts`, dua call site), yang sudah membawa `topic: string` — teruskan `params.topic` di keduanya. Test memanggil `verifyReply({ replyText, groundedAmounts: [], groundedUrls: [], topic: 'blue_fire' })`. Batas yang dinyatakan: Mode 3 memberi label tetap non-topik, jadi cek jaminan tidak pernah menyala untuk pelanggan yang sudah booking.

> **Ruling R49 — daftar frasa sisi balasan, negasi per kalimat, dan pencatatan (terverifikasi):**
> - `GUARANTEE_PHRASES` (`knowledge.ts`) = `['guarantee', 'guaranteed', '100%', 'certain', 'definitely be open']` — daftar untuk mendeteksi pelanggan yang MENUNTUT jaminan. Dipakai pada balasan, `'100%'` menandai "All tours are 100% PRIVATE" (baris pertama FAQ) dan `'certain'` menandai "certain conditions"/"certainly". Frekuensi pelanggaran inilah yang kelak memutuskan apakah verifier memblokir, jadi positif palsu merusak keputusan itu. Maka reply-verifier memegang daftar sisi-balasan sendiri: akar `guarantee` (`/\bguarantee(?:d|s)?\b/i`) dan `'definitely be open'`. `knowledge.ts` tidak diubah dan `GUARANTEE_PHRASES` tidak diekspor.
> - Negasi dinilai **per kalimat**, bukan seluruh balasan — "Blue fire is guaranteed! Refunds are not guaranteed." tetap pelanggaran. Pola negasi mencakup `not|never|cannot|can't|can not|isn't|aren't|won't|no`, dengan `be`/`always` opsional.
> - Dicatat, tidak memblokir: `summariseVerdict` (`orchestrator.ts`) ikut membawa `guaranteeViolations`, sehingga tersimpan di `BotDecisionRun.verification` lewat `verificationForDecision` (`decision-recorder.ts:143`) dan bisa dihitung; ditambah satu langkah trace advisory seperti 'Harga perlu dicek'. `orchestrator.ts` masuk Files (dua call site R37 + trace + `summariseVerdict`).
> - Test tambahan: "100% private" dan "certain conditions" pada topik `blue_fire` TIDAK ditandai; "isn't guaranteed" tidak ditandai; negasi di kalimat lain tidak menutupi pelanggaran; satu test orkestrator — balasan `blue_fire` yang memuat "guaranteed" → langkah trace advisory muncul dan `verification.guaranteeViolations` terisi.
> - Biaya kalau salah: janji yang diucapkan dengan kata lain lolos tanpa tercatat — sama dengan hari ini.

- [ ] **Step 1: Ekspor daftar frasa**

**Dibatalkan (Ruling R49):** `knowledge.ts` tidak diubah; daftar frasa sisi balasan didefinisikan di `reply-verifier.ts`.

- [ ] **Step 2: Tulis test yang gagal**

```typescript
it('menandai balasan yang menjanjikan Blue Fire', () => {
  const result = verifyReply('Blue fire is guaranteed in May!', { groundingLines: [], topic: 'blue_fire' })
  expect(result.guaranteeViolations).toContain('guaranteed')
})

it('tidak menandai kata jaminan pada topik yang tidak diatur', () => {
  const result = verifyReply('Your booking is guaranteed once the deposit clears.', { groundingLines: [], topic: 'payment' })
  expect(result.guaranteeViolations).toEqual([])
})

it('tidak menandai balasan yang justru menyangkal jaminan', () => {
  const result = verifyReply('Blue fire cannot be guaranteed — it depends on conditions.', { groundingLines: [], topic: 'blue_fire' })
  expect(result.guaranteeViolations).toEqual([])
})
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/reply-verifier.test.ts`
Expected: FAIL — `guaranteeViolations` belum ada.

- [ ] **Step 4: Implementasi**

```typescript
/**
 * Topik yang guardrail-nya melarang menjanjikan apa pun. Di luar ini, "guaranteed" adalah
 * kata yang sah -- "your booking is guaranteed once the deposit clears" tidak melanggar apa pun.
 */
const NO_GUARANTEE_TOPICS = new Set(['blue_fire', 'destination_readiness'])

/** "cannot be guaranteed" / "not guaranteed" adalah KEPATUHAN, bukan pelanggaran. */
const NEGATED = /\b(not|never|cannot|can't|no)\s+(?:be\s+)?guarante/i
```

Tambahkan ke `verifyReply`: kalau topiknya ada di `NO_GUARANTEE_TOPICS` dan sebuah kalimat balasan memuat frasa janji sisi-balasan (Ruling R49) **tanpa** cocok negasi di kalimat yang sama, catat pelanggarannya.

**Severity: dicatat, tidak memblokir.** Sama seperti `unverifiedPrices` — memblokir balasan yang sah lebih mahal daripada mencatat pelanggaran yang jarang. Frekuensinya dipantau lewat Task 15 sebelum diputuskan apakah perlu memblokir.

- [ ] **Step 5: Jalankan test**

Run: `npx vitest run src/lib/bot/reply-verifier.test.ts`
Expected: PASS.

- [ ] **Step 6: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/reply-verifier.ts src/lib/bot/reply-verifier.test.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "feat(bot): verifier menandai balasan yang menjanjikan hal yang guardrail larang"
```

---

## FASE 4 — Mata

### Task 15: Kolom `topic` / `job` di `BotDecisionRun`

> **Ruling R38 — tanpa kolom `stage`.** Plan ini sendiri mengecualikan `conversationStage`, jadi tidak ada yang pernah menulis kolom `stage`: kolom null permanen adalah skema mati, dan `.claude/rules/prisma-schema.md` melarang menambah field tanpa diskusi. Abaikan setiap `stage` di snippet task ini. Pola berkas `decision-recorder.ts`: setiap kolom diturunkan dari objek `decision` lewat helper `*ForDecision`. `topic` sudah tersedia di keputusan mode `faq` sebagai `sourceTopic` (`types.ts:93`). **`job` belum dibawa keputusan mana pun** — keputusan menambahkannya ke objek keputusan atau melepas kolomnya dicatat di ledger saat pra-dispatch task ini.

> **Ruling R51 — `job` dipertahankan, dan kedua nilai menempel di SETIAP keputusan sesudah klasifikasi (terverifikasi):**
> - **`job` dipertahankan.** `classifySalesNeed` menghitung `classification.job` (J1–J5) di setiap giliran Mode 1/2 (`orchestrator.ts:1213`) — itu sumbu funnel yang dibahas operator. Melepas kolomnya membuang nilai yang sudah dihitung.
> - **Topik hanya ada di keputusan `faq` hari ini** (`sourceTopic`, `types.ts:93`); `clarify` dan `handoff` tidak membawa topik sama sekali (`types.ts:91-95`). Padahal pertanyaan Task 16 — "cluster mana yang paling sering gagal" — justru tentang baris `clarify`/`handoff`. Kolom yang hanya terisi pada balasan sukses menjawab pertanyaan yang salah. Maka: tambahkan `topic?: string` dan `job?: string` opsional ke ketiga varian `BotDecision` (`types.ts`); di `decideAndRespond`, catat `job` saat klasifikasi penjualan dan `topic` saat klasifikasi topik ke satu konteks lokal, lalu tempelkan keduanya ke keputusan yang dikembalikan di SATU tempat (misalnya badan `try` dipindah ke fungsi dalam dan hasilnya dihias), bukan di tiap `return` — `decideAndRespond` punya lebih dari sepuluh titik `return`, dan satu yang terlewat berarti satu kelas kegagalan yang tak pernah terhitung. Keputusan sebelum klasifikasi (eskalasi kata kunci, Mode 3) jujur tanpa nilai.
> - **Recorder** mengikuti pola berkasnya: `topicForDecision` (jatuh ke `sourceTopic` bila `topic` kosong) dan `jobForDecision`, keduanya dari objek `decision` — `RecordDecisionRunParams` tidak berubah. Snippet test `{ ...baseRun, topic, job, stage }` skematik: test memberi `decision` yang membawa nilainya.
> - **Test tambahan di `orchestrator.test.ts`:** satu keputusan `clarify` sesudah klasifikasi membawa `topic` dan `job`; satu keputusan eskalasi kata kunci tidak membawa keduanya.
> - **Perintah migrasi Prisma 7:** `migrate diff --help` terpasang hanya mengenal `--from-schema`/`--to-schema` — `--from-schema-datamodel` di snippet tidak ada. Skema lama diambil dari BASE task ini ke workspace SDD, bukan `/tmp`. Jalankan `npx prisma generate` sesudah mengubah skema (lokal, tanpa DB) supaya `tsc` melihat kolom baru.
> - **Gerbang G4 terjadi saat deploy, bukan di tengah task.** Branch ini tidak menyentuh database produksi sampai di-deploy, jadi implementer meng-commit skema + SQL + kode lalu selesai; `migrate deploy` di VPS dijalankan operator SEBELUM kode ini di-deploy (kode yang menulis kolom yang belum ada akan membuat `recordBotDecisionRun` gagal — ditelan, tapi setiap run hilang). Dicatat di daftar gerbang laporan akhir.
> - Biaya kalau salah: satu fungsi dalam tambahan di `decideAndRespond`.

Nilai-nilai ini sudah dihitung tiap giliran, hari ini hanya terkubur di `trace` Json sehingga tidak bisa di-`groupBy`.

**Files:**
- Modify: `prisma/schema.prisma` (model `BotDecisionRun`, sekitar baris 288)
- Modify: `src/lib/bot-control/decision-recorder.ts`
- Modify: `src/lib/bot/types.ts` — `topic?`/`job?` di ketiga varian `BotDecision` (Ruling R51)
- Modify: `src/lib/bot/orchestrator.ts` — tempel `topic`/`job` di satu tempat (Ruling R51)
- Create: `prisma/migrations/<timestamp>_bot_decision_run_cluster_columns/migration.sql`
- Test: `src/lib/bot-control/decision-recorder.test.ts`
- Test: `src/lib/bot/orchestrator.test.ts` (Ruling R51)

**Interfaces:**
- Produces: dua kolom `String?` — `topic` dan `job` — dibaca Task 16 (Ruling R38/R51)

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('menulis topic, job, dan stage sebagai kolom', async () => {
  await recordBotDecisionRun({ ...baseRun, topic: 'payment', job: 'J2', stage: 'discovery' })
  expect(prisma.botDecisionRun.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ topic: 'payment', job: 'J2', stage: 'discovery' }) })
  )
})

it('menerima run tanpa ketiganya — baris lama tetap sah', async () => {
  await expect(recordBotDecisionRun(baseRun)).resolves.not.toThrow()
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot-control/decision-recorder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Tambahkan kolom ke skema**

Di `prisma/schema.prisma`, model `BotDecisionRun`, setelah `flowVersion`:

```prisma
  /// Tiga sumbu klasifikasi giliran ini, sebagai KOLOM bukan isi `trace`.
  ///
  /// Nilainya sudah dihitung tiap giliran sebelum kolom ini ada -- yang berubah hanya
  /// bahwa ia sekarang bisa di-groupBy tanpa mem-parse Json. Tanpa itu pertanyaan
  /// "cluster mana yang paling sering gagal" tidak bisa dijawab.
  ///
  /// Nullable: baris yang ditulis sebelum migrasi ini tidak punya nilainya, dan
  /// `recordBotDecisionRun` tidak boleh melempar hanya karena kolomnya kosong.
  topic          String?
  job            String?
  stage          String?
```

Dan di blok index:

```prisma
  @@index([topic])
```

- [ ] **Step 4: Buat migrasi offline**

`migrate diff` butuh skema **sebelum** perubahan sebagai pembanding, dan berkas itu tidak ada di repo. Ambil dari git, jangan buat manual:

```bash
git show HEAD:prisma/schema.prisma > .superpowers/sdd/2026-09-10-alur-grounding/schema-sebelum.prisma
DIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_bot_decision_run_cluster_columns"
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-schema .superpowers/sdd/2026-09-10-alur-grounding/schema-sebelum.prisma \
  --to-schema prisma/schema.prisma \
  --script > "$DIR/migration.sql"
cat "$DIR/migration.sql"
```

**Tinjau SQL-nya sebelum menerapkan.** Harus hanya `ALTER TABLE ... ADD COLUMN` dan `CREATE INDEX` — tidak boleh ada `DROP`, `TRUNCATE`, atau `ALTER` non-aditif. Kalau ada, hentikan dan bahas dengan operator (CLAUDE.md §7).

> **Jangan** `npx prisma migrate dev`. `DATABASE_URL` di repo ini menunjuk VPS produksi, dan perintah itu bisa me-reset database saat mendeteksi drift (CLAUDE.md §5).

- [ ] **Step 5: Tulis nilainya di recorder**

Tambahkan `topic`, `job`, `stage` ke tipe input `recordBotDecisionRun` (semuanya opsional) dan teruskan ke `prisma.botDecisionRun.create`.

- [ ] **Step 6: Jalankan test**

Run: `npx vitest run src/lib/bot-control/decision-recorder.test.ts`
Expected: PASS.

- [ ] **Step 7 — 🛑 GERBANG G4: operator menerapkan migrasi ke produksi**

**Berhenti di sini.** SQL dari Step 4 ditinjau manusia, lalu operator menjalankannya.

```bash
# di VPS, dengan PATH nvm Node 22 ter-export
npx prisma migrate deploy
```

Urutan aman (terbukti pada right-sizing, commit `90676c2`): cadangkan → SELECT verifikasi → **migrasi aditif** → deploy kode → verifikasi sehat.

**Kenapa ini gerbang:** menyentuh database produksi yang sedang melayani pelanggan. CLAUDE.md §7 mewajibkan SQL-nya dibaca manusia sebelum diterapkan, dan §5 melarang `migrate dev` di sini karena bisa me-reset database saat mendeteksi drift. Migrasi ini aditif dan rollback-nya murah (kolom nullable boleh ditinggal), tapi keputusan menjalankannya tetap milik operator.

- [ ] **Step 8: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add prisma/schema.prisma "$DIR/migration.sql" src/lib/bot/types.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts src/lib/bot-control/decision-recorder.ts src/lib/bot-control/decision-recorder.test.ts
git commit -m "feat(decision-log): kolom topic/job supaya laporan per cluster bisa di-query"
```

---

### Task 16: Laporan per cluster

**Files:**
- Modify: `src/app/api/dashboard/activity/route.ts`
- Create: `src/app/api/dashboard/activity/route.test.ts` — **berkas ini belum ada**; route-nya saat ini tidak punya test sama sekali. Ikuti pola mock Prisma yang dipakai `src/app/api/bot-control/decisions/route.test.ts`.

**Interfaces:**
- Consumes: kolom dari Task 15
- Produces: `{ byTopic: Array<{ topic: string; total: number; clarified: number; handoff: number }> }`

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('mengelompokkan keputusan per topik', async () => {
  vi.mocked(prisma.botDecisionRun.groupBy).mockResolvedValue([
    { topic: 'route_endpoint', status: 'CLARIFIED', _count: { _all: 12 } },
    { topic: 'payment', status: 'REPLIED', _count: { _all: 40 } },
  ] as never)
  const response = await GET(request)
  const body = await response.json()
  expect(body.byTopic).toContainEqual(expect.objectContaining({ topic: 'route_endpoint', clarified: 12 }))
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/app/api/dashboard/activity/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi**

Tambahkan satu `groupBy` — pola yang sama persis dengan yang sudah dipakai berkas ini untuk `KnowledgeGapLog`:

```typescript
    const byTopic = await prisma.botDecisionRun.groupBy({
      by: ['topic', 'status'],
      where: { startedAt: { gte: since }, topic: { not: null } },
      _count: { _all: true },
    })
```

Lalu bentuk jadi satu baris per topik dengan hitungan `REPLIED` / `CLARIFIED` / `HANDOFF`.

- [ ] **Step 4: Jalankan test**

Run: `npx vitest run src/app/api/dashboard/activity/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Ukur ulang dan bandingkan**

Run: `npm run measure:followup` dan bandingkan dengan hasil Task 3.
Expected: `mengulang` + `mengoreksi` **turun**. Kalau naik, perubahan ini merugikan — hentikan dan tinjau.

- [ ] **Step 6: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/app/api/dashboard/activity/
git commit -m "feat(dashboard): laporan keputusan bot per cluster topik"
```

---

## FASE 5 — Bisa diperiksa

Dua task ini tidak mengubah satu pun perilaku bot. Keduanya membuat hasil Fase 1–4 **bisa dilihat dan diuji**, dan keduanya berdiri di atas potongan yang sudah terverifikasi ada — jadi tidak ada alasan menundanya ke plan lain.

### Task 17: Simpan dan tampilkan baris grounding yang benar-benar dikirim

Terverifikasi hari ini: `KnowledgeRef` hanya menyimpan `{ sourceType, sourceKey, title, version }` — **sumbernya, bukan teksnya**. Dan `trace` hanya mencatat jumlah ("4 fakta"). Jadi tidak ada satu pun tempat yang bisa menjawab *"kalimat apa yang sebenarnya sampai ke model?"*

Begitu gerbang topik aktif, pertanyaan yang paling sering muncul justru **"kenapa fakta ini tidak ikut?"** — dan hari ini tidak ada yang bisa menjawabnya.

**Files:**
- Modify: `src/lib/bot/runtime-integration.ts` — kembalikan juga entri yang DITOLAK beserta alasannya
- Modify: `src/lib/bot-control/decision-recorder.ts` — simpan ke `BotDecisionRun.knowledgeRefs`
- Modify: `src/components/inbox/BotTracePopover.tsx`
- Test: `src/components/inbox/BotTracePopover.test.tsx`

**Interfaces:**
- Consumes: `ManagedFacts.gateBypassed` (Task 6), kolom `topic` (Task 15)
- Produces: `ManagedFacts.rejected: Array<{ sourceKey: string; itemQuestion: string; reason: string }>`

- [ ] **Step 1: Tulis test yang gagal**

```typescript
it('mencatat entri yang ditolak gerbang beserta alasannya', async () => {
  mockEntries([
    { question: 'Berapa deposit?', answer: '20%.', topics: ['payment'] },
  ])
  const facts = await managedFactsFor('bisa selesai di malang?', 'route_endpoint')
  expect(facts.rejected).toEqual([
    expect.objectContaining({ itemQuestion: 'Berapa deposit?', reason: 'topik [payment] tidak memuat route_endpoint' }),
  ])
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts`
Expected: FAIL — `rejected` belum ada.

- [ ] **Step 3: Implementasi di runtime-integration**

Tambahkan ke `ManagedFacts`:

```typescript
  /**
   * Entri yang DITOLAK gerbang topik pada giliran ini, beserta alasannya.
   *
   * Gerbang yang tidak bisa diperiksa adalah gerbang yang harus dipercaya. Ini yang membuat
   * "kenapa fakta ini tidak ikut?" bisa dijawab tanpa menjalankan ulang giliran itu -- dan
   * langsung menyerang risiko terbesar perubahan ini: klasifikasi meleset membuang fakta benar.
   */
  rejected: Array<{ sourceKey: string; itemQuestion: string; reason: string }>
```

Isi saat gerbang menolak, dengan alasan yang menyebut topik entri dan topik giliran. Perbarui juga konstanta `EMPTY` dengan `rejected: []`.

- [ ] **Step 4: Simpan ke decision run**

Di `decision-recorder.ts`, sertakan `rejected` ke dalam Json `knowledgeRefs` — kolomnya sudah ada dan sudah `Json?`, jadi **tidak butuh migrasi**. Lewatkan `sanitizeTrace` seperti trace lain.

- [ ] **Step 5: Tampilkan di popover inbox**

Di `BotTracePopover.tsx`, tambahkan dua daftar di bawah trace yang sudah ada:

```
Fakta yang dipakai     tiap baris + sumbernya
Fakta yang ditolak     "Berapa deposit?" — topik [payment], giliran ini route_endpoint
```

Agen yang melihat balasan aneh langsung tahu apakah faktanya tidak ada, atau ada tapi terbuang.

- [ ] **Step 6: Jalankan test**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts src/components/inbox/BotTracePopover.test.tsx`
Expected: PASS.

- [ ] **Step 7: Gerbang mutu + commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add src/lib/bot/runtime-integration.ts src/lib/bot-control/decision-recorder.ts src/components/inbox/BotTracePopover.tsx src/components/inbox/BotTracePopover.test.tsx src/lib/bot/runtime-integration.test.ts
git commit -m "feat(trace): tampilkan fakta yang dipakai dan yang ditolak gerbang, per balasan"
```

---

### Task 18: Golden case tumbuh dari jawaban yang ditandai

13 kasus, tetap, tidak pernah melebar — sementara bot terus menghadapi pertanyaan baru. Potongannya sudah ada semua: `BotDecisionRun.flaggedAt`/`flagNote` (terverifikasi di `schema.prisma:326`), dan bentuk fixture di `src/lib/bot/eval/fixtures.ts`.

**Files:**
- Create: `scripts/fixture-from-flagged.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BotDecisionRun` yang `flaggedAt != null`
- Produces: potongan TypeScript siap tempel ke `fixtures.ts`

- [ ] **Step 1: Tulis skrip**

```typescript
/**
 * Ubah jawaban buruk yang ditandai agen jadi kandidat golden case.
 *
 * READ-ONLY. Keluarannya potongan TypeScript ke stdout -- sengaja TIDAK menulis ke
 * fixtures.ts sendiri: ekspektasi sebuah kasus uji adalah penilaian manusia tentang
 * jawaban yang BENAR, dan skrip tidak tahu itu. Yang diotomatiskan hanya bagian
 * mekanisnya -- mengambil pesan aslinya tanpa salah ketik.
 */
import { config } from 'dotenv'

config()

async function main() {
  const { prisma } = await import('@/lib/db')

  const flagged = await prisma.botDecisionRun.findMany({
    where: { flaggedAt: { not: null } },
    select: { id: true, inboundText: true, replyText: true, flagNote: true, topic: true },
    orderBy: { flaggedAt: 'desc' },
    take: 20,
  })

  if (flagged.length === 0) {
    console.error('Tidak ada keputusan yang ditandai. Tandai jawaban buruk dari inbox dulu.')
    return
  }

  for (const run of flagged) {
    console.log(`  // Ditandai agen. Alasan: ${run.flagNote ?? '(tanpa alasan)'}`)
    console.log(`  // Balasan yang salah: ${(run.replyText ?? '').replace(/\s+/g, ' ').slice(0, 120)}`)
    console.log(`  {`)
    console.log(`    id: 'flagged-${run.id.slice(0, 8)}',`)
    console.log(`    message: ${JSON.stringify(run.inboundText)},`)
    console.log(`    topic: ${JSON.stringify(run.topic ?? 'general')},`)
    console.log(`    // ISI SENDIRI: frasa yang WAJIB ada di balasan yang benar`)
    console.log(`    mustInclude: [],`)
    console.log(`    // ISI SENDIRI: frasa yang TIDAK BOLEH ada`)
    console.log(`    mustNotInclude: [],`)
    console.log(`  },`)
  }

  console.error(`\n${flagged.length} kandidat. Isi mustInclude/mustNotInclude, tempel ke fixtures.ts, jalankan npm run eval.`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Gagal:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
```

- [ ] **Step 2: Daftarkan script**

```json
"fixture:from-flagged": "tsx scripts/fixture-from-flagged.ts"
```

- [ ] **Step 3: Jalankan**

Run: `npm run fixture:from-flagged`
Expected: potongan tercetak, atau pesan bahwa belum ada yang ditandai.

- [ ] **Step 4: Commit**

```bash
git add scripts/fixture-from-flagged.ts package.json
git commit -m "feat(eval): ubah keputusan yang ditandai jadi kandidat golden case"
```

---

## FASE 6 — Isi (butuh fakta dari JVTO)

### Task 19 — 🛑 GERBANG G3: isi `luggage_rule`

**Files:**
- Modify: `catalog/vehicle-and-luggage-rules.json`

Terverifikasi: `luggage_rule` `null` pada **16 dari 16** paket. Join-nya ada, komposisi ke prompt ada (`orchestrator.ts:1747`), penanganan kosongnya sudah benar — barisnya dihilangkan, bukan diisi tebakan. Yang kurang hanya datanya.

**Kenapa ini gerbang:** kebijakan koper JVTO tidak ada di repo, database, atau katalog. Mengarangnya adalah persis pelanggaran yang seluruh guardrail bot ini dibangun untuk cegah.

- [ ] **Step 1: Operator menyebutkan kebijakannya** — mis. *"1 koper besar + 1 tas kabin per orang; MPV maksimal 3 koper besar, Hiace 6"*
- [ ] **Step 2: Isi `luggage_rule` di 16 baris `catalog/vehicle-and-luggage-rules.json`**
- [ ] **Step 3: Verifikasi masuk prompt** — jalankan skenario koper di `/bot-control/test-lab`, pastikan baris `Luggage allowance:` muncul
- [ ] **Step 4: Commit**

```bash
git add catalog/vehicle-and-luggage-rules.json
git commit -m "feat(catalog): isi kebijakan koper untuk 16 paket"
```

---

### Task 20: Tulis knowledge yang memang belum ada

Fase 1–4 memindahkan dan menyaring fakta yang **sudah** ada. Tidak satu pun menambah yang belum ada. Menurut riset percakapan, itu justru penyebab kegagalan yang dominan.

- [ ] **Step 1: Baca laporan per cluster (Task 16), ambil tiga cluster teratas yang paling sering `CLARIFIED`/`HANDOFF`**
- [ ] **Step 2: Untuk tiap cluster, baca `KnowledgeGapLog.messageText` — apa yang sebenarnya ditanyakan pelanggan**
- [ ] **Step 3: Tulis entri knowledge untuk itu, terbitkan**
- [ ] **Step 4: Ulangi mingguan.** Ini bukan proyek dengan akhir — ini lingkaran yang Fase 1–4 baru saja tutup.

Pola yang belum tercakup dan sudah teridentifikasi dari riset: guide fotografi, kelayakan medis, sambungan penerbangan/kereta, kegagalan checkout, kebijakan koper.

---

## Self-Review

**1 · Cakupan.** Tujuh cacat, tujuh penyelesaian — **nol yang ditinggalkan sebagai temuan**:

| Cacat | Task |
| --- | --- |
| 01 · fakta selalu-ikut 887 token | Task 11 |
| 02 · managed knowledge tanpa sumbu topik | Task 5 |
| 03 · operator tak bisa mengisi topik | Task 7 + 9 |
| 04 · fakta masuk dari banyak pintu | Task 13 |
| 05 · tidak ada instrumen | Task 15 + 16 |
| 06 · `hotel` = `rooming` | **bukan cacat** — blok 6 sudah mengirim keduanya tanpa syarat topik (terverifikasi). Dikoreksi di Task 0. |
| 07 · `luggage_rule` kosong | Task 19 (Gerbang G3) |

**2 · Placeholder.** Tidak ada "TBD"/"implement later". Setiap step kode punya blok kode nyata. Task 9 dan 16 merujuk "ikuti pola yang sudah ada di berkas" — itu penunjuk konkret ke pola yang benar-benar ada, bukan penghindaran.

**3 · Konsistensi tipe.** `classifyFactTopics(question, answer, model?)` (Task 7) dipakai persis begitu di Task 8. `ManagedFacts` bertambah `gateBypassed` (Task 6), `degraded` (Task 12), lalu `rejected` (Task 17) — ketiganya ditambahkan, tidak saling menimpa. `RESOLVER_TOPICS` didefinisikan Task 4, dipakai Task 7 dan 9.

**4 · Verifikasi yang tidak diulang.** Hal-hal ini **sudah dibuktikan** dan diperlakukan sebagai fakta, bukan ditanya ulang: gerbang eval tertutup (dijalankan) · `approve:deployment` ada (`package.json`) · commit `90676c2` ada (`git log`) · `luggage_rule` null 16/16 (dihitung) · `KnowledgeRef` hanya menyimpan sumber (dibaca) · `hotel`/`rooming` tidak kehilangan fakta (dibaca dari `orchestrator.ts:1741-1752`) · 14 file katalog dibaca kode (di-grep). **Tidak ada step yang mengulang salah satunya.**

**5 · Yang sengaja TIDAK ada di plan ini.** `conversationStage` — PRD menandainya risiko tertinggi, dan ia merapikan tanpa membuat jawaban lebih benar. Ini keputusan desain dengan alasan tertulis, bukan pekerjaan yang ditunda.
