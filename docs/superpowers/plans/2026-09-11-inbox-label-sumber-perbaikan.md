# Inbox: Label Topik, Sumber Jawaban, dan Perbaikan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap pesan masuk baru berlabel topik & intent di Inbox, setiap balasan bot mencatat paragraf mana cocok dengan baris knowledge/katalog mana, dan jawaban bot bisa diperbaiki langsung dari bubble-nya (edit entri yang dipakai atau tambah jawaban baru, langsung aktif).

**Architecture:** Kolom baru `Message.topicLabels` (Json?) diisi `classifyAndStoreTopicLabels` — dipanggil fire-and-forget dari dua pembuat pesan INBOUND (`ingestSingleMessage`, route test-message) dan ditunggu oleh route manual "Cek topik"; hasilnya dipancarkan lewat SSE `message.updated` yang sudah ada. Baris `managedLines` membawa `sourceId/sourceKey/version` lewat array paralel `ManagedFacts.lineMeta`, dan `attributeReply` (murni, deterministik) dijalankan di titik tempel tunggal `attachClassification` atas teks FINAL. Perbaikan memakai jalur tulis knowledge yang sudah ada (`saveKnowledgeDraft`/`createManagedKnowledge` → `publishKnowledgeRevision`) lewat route baru `POST /api/inbox/decisions/[id]/fix` yang terbuka untuk semua yang login.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Prisma 7 (PostgreSQL), Zod 4, Vitest 4 + Testing Library + vitest-mock-extended, lucide-react, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-11-inbox-label-sumber-perbaikan-design.md` (disetujui operator). Baca bersama `CLAUDE.md` dan `.claude/rules/*.md`.

**Direktori kerja:** semua perintah dijalankan dari root worktree `/Users/macbook/Code/wa-inbox/.claude/worktrees/alur-grounding`.

## Global Constraints

- Tanpa `any` — pakai `unknown` + penyempitan tipe.
- Setiap mutasi: `getSession` → validasi Zod → `try-catch` per handler; galat selalu `{ error: string }` dengan status HTTP yang sesuai; jangan bocorkan pesan galat mentah atau secret.
- Tanpa secret/token di UI, respons API, audit log, atau log.
- `reason` audit lewat `sanitizeTrace` — sudah dilakukan `writeBotAuditLog` (`src/lib/bot-control/audit.ts`), dipanggil oleh `publishKnowledgeRevision`. Jangan menulis audit sendiri.
- Penjaga `type === 'MANUAL'` di `src/lib/bot-control/knowledge-workflow.ts` tidak dilonggarkan dan tidak diubah.
- Tanpa dependensi npm baru.
- Test tidak memakai nomor pelanggan sungguhan; smoke test hanya lewat sandbox Test Lab / nomor whitelist `6282143403501`.
- DILARANG `npx prisma migrate dev` (`DATABASE_URL` = produksi). Migrasi dibuat offline dengan `prisma migrate diff` (CLAUDE.md §7).
- JANGAN ubah `src/lib/bot/topic-classifier.ts`, `src/lib/bot/multi-topic-classifier.ts`, prompt bot mana pun, dan `src/lib/bot-control/simulator.ts`.
- Teks UI dalam Bahasa Indonesia; kode & identifier Inggris.
- Gerbang per task: `npx vitest run <berkas test task itu>`. Gerbang akhir (Task 10): `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error).
- Commit dengan path eksplisit (tanpa `git add -A`/`.`), pesan diakhiri trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Keputusan atas ambiguitas spec (mengikat untuk semua task)

1. **"Berteks" = `Message.content` tidak kosong setelah `trim()`**, apa pun `type`-nya — foto dengan caption diklasifikasi, media tanpa caption tidak. Dipakai sama di jalur otomatis, route manual, dan UI "Cek topik".
2. **Tipe & parser `TopicLabels` tinggal di `src/lib/inbox/topic-labels-schema.ts` (murni)** dan di-re-export dari `src/lib/inbox/topic-labels.ts`. Alasan: `topic-labels.ts` mengimpor `withMediaUrl` dari `serialize-message.ts`, sementara `serializeMessage` butuh parser label — satu modul akan membuat impor melingkar, dan komponen klien tidak boleh menarik prisma.
3. **`MessageBubble` menerima prop baru `conversationId?: string`** (diteruskan `ThreadView`), karena route "Cek topik" butuh id percakapan dan `MessageView` tidak membawanya. Tanpa prop itu ikon "Cek topik" tidak tampil — pemakai lama tidak berubah.
4. **`managedLines` bertambah `sourceId`, `sourceKey`, `version` lewat array paralel `ManagedFacts.lineMeta`** (opsional, pola `lineSources`) dan satu helper `decisionManagedLines(managed)` yang menggantikan tiga map identik di `orchestrator.ts`.
5. **`attributions`**: selalu dilampirkan (boleh `[]`) bila keputusan punya `knowledge` DAN teks balasan; absen pada handoff dan pada balasan lama. UI membedakan `undefined` ("tidak tercatat") dari `[]` ("tidak ada paragraf yang cocok"). `paragraph` = indeks 0-based ke `splitParagraphs(teksBalasan)`; judul entri diturunkan dari `source` dengan membuang akhiran persis `" (v<version>)"` yang dibentuk `collect()`.
6. **Route fix menambah dua penjaga di luar spec** (keduanya melindungi tulisan operator, tidak melonggarkan apa pun): (a) `kind: 'edit'` hanya untuk `sourceId` yang benar-benar tercatat di `knowledgeRefs.knowledge.managedLines` run itu → 400 bila tidak; (b) bila revisi terakhir entri berstatus `DRAFT` → 409, karena `saveKnowledgeDraft` akan MENIMPA draft yang sedang dikerjakan operator lalu `publishKnowledgeRevision` mengaktifkannya.
7. **Panel perbaikan mendapat id run & `inboundText` dari route yang sudah ada dan hanya butuh sesi**: `GET /api/bot-control/decisions?messageId=…&limit=1` (dipakai `BotTracePopover`) lalu `GET /api/bot-control/decisions/[id]`. Tidak ada route baru untuk itu.
8. **"Versi di setiap baris Fakta yang dipakai" sudah terpenuhi hari ini** — `source` dibentuk `` `${entry.sourceTitle} (v${entry.version})` `` di `runtime-integration.ts` dan dirender apa adanya; dikunci oleh test yang sudah ada (`BotTracePopover.test.tsx`, "Kebijakan Pembayaran (v3)"). Tidak ada perubahan markup untuk itu.
9. **Bagian "Topik" di popover menampilkan nama Indonesia DAN id mentah** (`Pembayaran (payment)`), menghormati keputusan di `KnowledgeEditor.tsx` bahwa id mentah harus bisa dibandingkan dengan trace. Chip di bawah pesan masuk memakai nama saja (spec B1).
10. **Verifikasi** menampilkan status, `fabricatedPrices` ("Harga tidak bersumber"), `unverifiedPrices` ("Harga tidak cocok dengan fakta"), dan `unknownUrls` ("URL tidak dikenal"); `guaranteeViolations` tidak ditampilkan (di luar spec).
11. **Nama migrasi tetap:** `20260911090000_message_topic_labels` (lebih baru dari migrasi terakhir `20260910173649_bot_decision_run_cluster_columns`).

## Peta Berkas

**Dibuat**

| Berkas | Tanggung jawab | Task |
|---|---|---|
| `prisma/migrations/20260911090000_message_topic_labels/migration.sql` | `ALTER TABLE "Message" ADD COLUMN "topicLabels" JSONB` | 1 |
| `src/lib/inbox/topic-labels-schema.ts` | tipe `TopicLabels`/`TopicLabelSource`, `topicLabelsSchema`, `readTopicLabels` (murni, aman untuk klien) | 1 |
| `src/lib/inbox/topic-labels.ts` | `classifyAndStoreTopicLabels` (server), re-export tipe | 1 |
| `src/lib/inbox/topic-labels.test.ts` | test fungsi di atas + parser | 1 |
| `src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.ts` (+ `route.test.ts`) | "Cek topik" manual | 3 |
| `src/lib/inbox/label-names.ts` (+ `label-names.test.ts`) | nama tampilan 14 topik & J1–J5 | 4 |
| `src/lib/bot/reply-attribution.ts` (+ `reply-attribution.test.ts`) | `splitParagraphs`, `attributeReply`, konstanta ambang | 6 |
| `src/app/api/inbox/knowledge/[sourceId]/route.ts` (+ `route.test.ts`) | revisi PUBLISHED terkini untuk editor | 8 |
| `src/app/api/inbox/decisions/[id]/fix/route.ts` (+ `route.test.ts`) | simpan & aktifkan perbaikan, tandai run | 8 |
| `src/components/inbox/FixAnswerPanel.tsx` (+ `FixAnswerPanel.test.tsx`) | panel perbaikan | 9 |

**Diubah**

| Berkas | Perubahan | Task |
|---|---|---|
| `prisma/schema.prisma` | `Message.topicLabels Json?` setelah `botTrace` (baris 182) | 1 |
| `src/lib/inbound.ts` (+ `inbound.test.ts`) | panggil klasifikasi fire-and-forget setelah `message.created` (baris 544) | 2 |
| `src/app/api/conversations/[id]/test-message/route.ts` (+ `route.test.ts`) | idem, setelah `message.created` (baris 44) | 2 |
| `src/lib/serialize-message.ts` (+ `serialize-message.test.ts`) | `topicLabels` di `MessageView` | 4 |
| `src/components/inbox/MessageBubble.tsx` (+ `MessageBubble.test.tsx`) | chip, ikon "Cek topik" (Task 4), ikon "Perbaiki" (Task 9) | 4, 9 |
| `src/components/inbox/ThreadView.tsx` (+ `ThreadView.test.tsx`) | teruskan `conversationId` ke `MessageBubble` (baris 351); test label via SSE | 4 |
| `src/lib/bot/runtime-integration.ts` (+ `runtime-integration.test.ts`) | `lineMeta`, `ManagedLineMeta`, `decisionManagedLines` | 5 |
| `src/lib/bot/types.ts` | `managedLines` + id; `AttributedLine`, `ReplyAttribution`, `attributions?` | 5, 6 |
| `src/lib/bot/orchestrator.ts` (+ `orchestrator.test.ts`) | 3 map → `decisionManagedLines`; `attachClassification` menghitung atribusi | 5, 6 |
| `src/lib/bot-control/decision-recorder.test.ts` | kunci: `attributions` ikut ke `knowledgeRefs` tanpa perubahan kode | 6 |
| `src/components/inbox/BotTracePopover.tsx` (+ test) | bagian Topik, Sumber per paragraf, Verifikasi | 7 |
| `CLAUDE.md` | §6: satu kalimat pengecualian | 8 |
| `src/components/bot-control/KnowledgeEditor.tsx` (+ test) | prop `activateOnly?: boolean` | 9 |

**Tidak disentuh:** `topic-classifier.ts`, `multi-topic-classifier.ts`, `sales-classifier.ts`, `simulator.ts`, `decision-recorder.ts`, `send.ts`, `realtime.ts`, `knowledge-workflow.ts`, semua prompt.

---
### Task 1: Kolom `Message.topicLabels`, migrasi, tipe `TopicLabels`, dan `classifyAndStoreTopicLabels`

**Files:**
- Modify: `prisma/schema.prisma:182` (model `Message`, tepat setelah `botTrace        Json?`)
- Create: `prisma/migrations/20260911090000_message_topic_labels/migration.sql`
- Create: `src/lib/inbox/topic-labels-schema.ts`
- Create: `src/lib/inbox/topic-labels.ts`
- Test: `src/lib/inbox/topic-labels.test.ts`

**Interfaces:**
- Consumes (sudah ada, tidak diubah):
  - `classifyTopicViaLLM(job: string | null | undefined, message: string, model?: string): Promise<TopicClassification>` — `src/lib/bot/topic-classifier.ts:83`; `TopicClassification = { topic: ResolverTopic; source: 'llm' | 'regex_fallback' }`
  - `classifyAllTopics(message: string, model?: string): Promise<ResolverTopic[]>` — `src/lib/bot/multi-topic-classifier.ts:110` (gagal → `[]`)
  - `classifySalesNeed(input: { message: string; tripBrief: TripBrief }): SalesClassification` — `src/lib/bot/sales-classifier.ts:354` (sinkron; semua field `TripBrief` opsional, jadi `{}` sah)
  - `broadcast(event: RealtimeEvent): void` — `src/lib/realtime.ts`; varian `{ type: 'message.updated'; conversationId: string; message: unknown }`
  - `withMediaUrl<T extends { id: string; mediaId?: string | null; mediaUrl?: string | null }>(m: T): T & { mediaUrl: string | null }` — `src/lib/serialize-message.ts:62`
  - `RESOLVER_TOPICS`, `type ResolverTopic` — `src/lib/bot/module-resolver.ts:18-23` (modul tanpa impor, aman untuk klien)
  - Pola baca model: `prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })` (sama dengan `fillMissingTopics` di `knowledge-workflow.ts:181`)
- Produces:
  - `export type TopicLabelSource = 'auto' | 'manual'`
  - `export type TopicLabels = { topic: ResolverTopic; alsoTopics: ResolverTopic[]; job: SalesClassification['job']; topicSource: 'llm' | 'regex_fallback'; source: TopicLabelSource; at: string }`
  - `export const topicLabelsSchema` (Zod object untuk bentuk di atas)
  - `export function readTopicLabels(value: unknown): TopicLabels | null` — dari `src/lib/inbox/topic-labels-schema.ts`
  - `export async function classifyAndStoreTopicLabels(messageId: string, source: TopicLabelSource): Promise<TopicLabels | null>` — dari `src/lib/inbox/topic-labels.ts`; TIDAK PERNAH melempar; `null` = tidak diklasifikasi (bukan INBOUND, tanpa teks, tidak ada, atau galat baca/simpan)
  - `src/lib/inbox/topic-labels.ts` juga me-re-export `type TopicLabels` dan `type TopicLabelSource`

- [x] **Step 1: Simpan salinan skema lama (sebelum mengedit apa pun)**

```bash
git show HEAD:prisma/schema.prisma > "${TMPDIR:-/tmp}/schema-before-topic-labels.prisma"
git diff --quiet HEAD -- prisma/schema.prisma && echo "skema bersih, salinan = HEAD"
```

Expected: `skema bersih, salinan = HEAD`. Kalau tidak tercetak, ada perubahan lokal di skema — berhenti dan tanyakan.

- [x] **Step 2: Tambah kolom di `prisma/schema.prisma`**

Di model `Message` (baris 182), ganti:

```prisma
  botTrace        Json?
```

menjadi:

```prisma
  botTrace        Json?
  // TopicLabels (src/lib/inbox/topic-labels-schema.ts) untuk pesan INBOUND berteks. Null = belum
  // diklasifikasi (pesan sebelum rilis, media tanpa teks, atau klasifikasi gagal) -> "Cek topik".
  topicLabels     Json?
```

- [x] **Step 3: Buat migrasi offline dan periksa SQL-nya**

```bash
mkdir -p prisma/migrations/20260911090000_message_topic_labels
npx prisma migrate diff \
  --from-schema "${TMPDIR:-/tmp}/schema-before-topic-labels.prisma" \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/20260911090000_message_topic_labels/migration.sql
cat prisma/migrations/20260911090000_message_topic_labels/migration.sql
! grep -Eiq 'drop|truncate|alter column|rename' prisma/migrations/20260911090000_message_topic_labels/migration.sql \
  && grep -Eq 'ALTER TABLE "Message" ADD COLUMN +"topicLabels" JSONB;' prisma/migrations/20260911090000_message_topic_labels/migration.sql \
  && echo "MIGRASI ADITIF OK"
```

Expected isi berkas (spasi setelah `ADD COLUMN` adalah gaya Prisma):

```sql
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "topicLabels" JSONB;
```

dan baris terakhir `MIGRASI ADITIF OK`. Kalau ada pernyataan lain, berhenti — skema berubah lebih dari yang direncanakan. **JANGAN** menjalankan `npx prisma migrate dev` atau `migrate deploy` di task ini (deploy ada di Checklist Deploy).

- [x] **Step 4: Regenerasi Prisma Client (tanpa database)**

```bash
npx prisma generate && npx prisma validate
```

Expected: `Generated Prisma Client` dan `The schema at prisma/schema.prisma is valid`.

- [x] **Step 5: Tulis test yang gagal — `src/lib/inbox/topic-labels.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { classifyTopicViaLLM, type TopicClassification } from '@/lib/bot/topic-classifier'
import { classifyAllTopics } from '@/lib/bot/multi-topic-classifier'
import { classifySalesNeed } from '@/lib/bot/sales-classifier'
import { classifyAndStoreTopicLabels } from './topic-labels'
import { readTopicLabels } from './topic-labels-schema'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/bot/topic-classifier', () => ({ classifyTopicViaLLM: vi.fn() }))
vi.mock('@/lib/bot/multi-topic-classifier', () => ({ classifyAllTopics: vi.fn() }))
vi.mock('@/lib/bot/sales-classifier', () => ({ classifySalesNeed: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const TEXT = 'Berapa harga paket Ijen untuk 2 orang?'
const inbound = { id: 'msg_1', conversationId: 'conv_1', direction: 'INBOUND', content: TEXT }

function updateArg() {
  return mockPrisma.message.update.mock.calls[0][0]
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.message.findUnique.mockResolvedValue(inbound as never)
  mockPrisma.settings.findUnique.mockResolvedValue({ ollamaModel: 'gemma4:31b-cloud' } as never)
  mockPrisma.message.update.mockResolvedValue({
    ...inbound,
    mediaId: null,
    mediaUrl: null,
    replyTo: null,
  } as never)
  vi.mocked(classifyTopicViaLLM).mockResolvedValue({ topic: 'price', source: 'llm' })
  vi.mocked(classifyAllTopics).mockResolvedValue(['price', 'payment'])
  vi.mocked(classifySalesNeed).mockReturnValue({ job: 'J2', missingInfo: [], needsLiveData: false })
})

describe('classifyAndStoreTopicLabels', () => {
  it('menyimpan label dengan source yang diminta, dan membuang topik utama dari alsoTopics', async () => {
    const labels = await classifyAndStoreTopicLabels('msg_1', 'auto')

    expect(labels).toEqual({
      topic: 'price',
      alsoTopics: ['payment'],
      job: 'J2',
      topicSource: 'llm',
      source: 'auto',
      at: expect.any(String),
    })
    expect(updateArg()).toMatchObject({ where: { id: 'msg_1' }, data: { topicLabels: labels } })
    expect(classifySalesNeed).toHaveBeenCalledWith({ message: TEXT, tripBrief: {} })
  })

  it('mencatat source manual apa adanya', async () => {
    const labels = await classifyAndStoreTopicLabels('msg_1', 'manual')
    expect(labels?.source).toBe('manual')
  })

  it('memakai Settings.ollamaModel untuk kedua classifier model, dan menjalankannya paralel', async () => {
    let release: (value: TopicClassification) => void = () => {}
    vi.mocked(classifyTopicViaLLM).mockReturnValue(
      new Promise<TopicClassification>((resolve) => {
        release = resolve
      })
    )

    const pending = classifyAndStoreTopicLabels('msg_1', 'auto')
    // classifyAllTopics sudah dipanggil sementara classifyTopicViaLLM belum selesai.
    await vi.waitFor(() => expect(classifyAllTopics).toHaveBeenCalledWith(TEXT, 'gemma4:31b-cloud'))
    release({ topic: 'price', source: 'llm' })
    await pending

    expect(classifyTopicViaLLM).toHaveBeenCalledWith(null, TEXT, 'gemma4:31b-cloud')
  })

  it('mencatat topicSource regex_fallback', async () => {
    vi.mocked(classifyTopicViaLLM).mockResolvedValue({ topic: 'payment', source: 'regex_fallback' })

    const labels = await classifyAndStoreTopicLabels('msg_1', 'auto')

    expect(labels).toMatchObject({ topic: 'payment', alsoTopics: ['price'], topicSource: 'regex_fallback' })
  })

  it('memancarkan message.updated berisi baris tersimpan', async () => {
    await classifyAndStoreTopicLabels('msg_1', 'auto')

    expect(broadcast).toHaveBeenCalledWith({
      type: 'message.updated',
      conversationId: 'conv_1',
      message: expect.objectContaining({ id: 'msg_1', mediaUrl: null }),
    })
  })

  it('tidak mengklasifikasi pesan yang tidak ada, pesan keluar, atau pesan tanpa teks', async () => {
    for (const row of [null, { ...inbound, direction: 'OUTBOUND' }, { ...inbound, content: '   ' }, { ...inbound, content: null }]) {
      mockPrisma.message.findUnique.mockResolvedValueOnce(row as never)
      expect(await classifyAndStoreTopicLabels('msg_1', 'auto')).toBeNull()
    }
    expect(classifyTopicViaLLM).not.toHaveBeenCalled()
    expect(mockPrisma.message.update).not.toHaveBeenCalled()
  })

  it('galat baca dicatat tanpa teks pelanggan, tidak melempar, dan tidak memancarkan apa pun', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.findUnique.mockRejectedValue(new Error('db down'))

    await expect(classifyAndStoreTopicLabels('msg_1', 'auto')).resolves.toBeNull()

    expect(errorSpy).toHaveBeenCalledWith(
      'classifyAndStoreTopicLabels gagal',
      expect.objectContaining({ messageId: 'msg_1', source: 'auto' })
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('Berapa harga')
    expect(broadcast).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('galat simpan dicatat, tidak melempar, dan tidak memancarkan apa pun', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.update.mockRejectedValue(new Error('db down'))

    await expect(classifyAndStoreTopicLabels('msg_1', 'manual')).resolves.toBeNull()

    expect(errorSpy).toHaveBeenCalledWith('classifyAndStoreTopicLabels gagal', expect.objectContaining({ source: 'manual' }))
    expect(broadcast).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('readTopicLabels', () => {
  const valid = {
    topic: 'price',
    alsoTopics: ['payment'],
    job: 'J2',
    topicSource: 'llm',
    source: 'auto',
    at: '2026-09-11T08:00:00.000Z',
  }

  it('menerima bentuk yang valid', () => {
    expect(readTopicLabels(valid)).toEqual(valid)
  })

  it('menolak null dan bentuk yang tidak dikenal build ini', () => {
    expect(readTopicLabels(null)).toBeNull()
    expect(readTopicLabels({ ...valid, topic: 'bukan_topik' })).toBeNull()
    expect(readTopicLabels({ ...valid, job: 'J9' })).toBeNull()
    expect(readTopicLabels({ ...valid, source: 'robot' })).toBeNull()
  })
})
```

- [x] **Step 6: Jalankan test, pastikan GAGAL**

Run: `npx vitest run src/lib/inbox/topic-labels.test.ts`
Expected: FAIL — `Failed to resolve import "./topic-labels"` (modul belum ada).

- [x] **Step 7: Implementasi — `src/lib/inbox/topic-labels-schema.ts`**

```ts
import { z } from 'zod'
import { RESOLVER_TOPICS, type ResolverTopic } from '@/lib/bot/module-resolver'
import type { SalesClassification } from '@/lib/bot/types'

export type TopicLabelSource = 'auto' | 'manual'

export type TopicLabels = {
  topic: ResolverTopic
  alsoTopics: ResolverTopic[]
  job: SalesClassification['job']
  topicSource: 'llm' | 'regex_fallback'
  source: TopicLabelSource
  at: string
}

export const topicLabelsSchema = z.object({
  topic: z.enum(RESOLVER_TOPICS),
  alsoTopics: z.array(z.enum(RESOLVER_TOPICS)),
  job: z.enum(['J1', 'J2', 'J3', 'J4', 'J5']),
  topicSource: z.enum(['llm', 'regex_fallback']),
  source: z.enum(['auto', 'manual']),
  at: z.string(),
})

/** Kolom Json dibaca defensif: bentuk yang tidak dikenal build ini dianggap belum berlabel. */
export function readTopicLabels(value: unknown): TopicLabels | null {
  const parsed = topicLabelsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
```

- [x] **Step 8: Implementasi — `src/lib/inbox/topic-labels.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { classifyTopicViaLLM } from '@/lib/bot/topic-classifier'
import { classifyAllTopics } from '@/lib/bot/multi-topic-classifier'
import { classifySalesNeed } from '@/lib/bot/sales-classifier'
import type { TopicLabels, TopicLabelSource } from './topic-labels-schema'

export type { TopicLabels, TopicLabelSource } from './topic-labels-schema'

/**
 * Label topik & intent satu pesan INBOUND berteks: disimpan ke Message.topicLabels lalu
 * dipancarkan sebagai message.updated. Tidak pernah melempar -- jalur ingest memanggilnya tanpa
 * menunggu, dan kegagalannya hanya berarti pesan itu tanpa label ("Cek topik" tetap ada).
 * Teks pesan sengaja tidak masuk log.
 */
export async function classifyAndStoreTopicLabels(
  messageId: string,
  source: TopicLabelSource
): Promise<TopicLabels | null> {
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { direction: true, content: true },
    })
    const text = message?.content?.trim()
    if (!message || message.direction !== 'INBOUND' || !text) return null

    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
    const model = settings?.ollamaModel
    const [primary, all] = await Promise.all([classifyTopicViaLLM(null, text, model), classifyAllTopics(text, model)])

    const labels: TopicLabels = {
      topic: primary.topic,
      alsoTopics: all.filter((topic) => topic !== primary.topic),
      job: classifySalesNeed({ message: text, tripBrief: {} }).job,
      topicSource: primary.source,
      source,
      at: new Date().toISOString(),
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { topicLabels: labels as unknown as Prisma.InputJsonValue },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.updated', conversationId: updated.conversationId, message: withMediaUrl(updated) })
    return labels
  } catch (error) {
    console.error('classifyAndStoreTopicLabels gagal', { messageId, source, error })
    return null
  }
}
```

- [x] **Step 9: Jalankan test, pastikan LULUS**

Run: `npx vitest run src/lib/inbox/topic-labels.test.ts`
Expected: PASS (10 test).

- [x] **Step 10: Commit**

```bash
git add prisma/schema.prisma \
  prisma/migrations/20260911090000_message_topic_labels/migration.sql \
  src/lib/inbox/topic-labels-schema.ts \
  src/lib/inbox/topic-labels.ts \
  src/lib/inbox/topic-labels.test.ts
git commit -m "$(cat <<'EOF'
feat(inbox): kolom Message.topicLabels dan classifyAndStoreTopicLabels

Migrasi aditif (ADD COLUMN JSONB) dibuat offline dengan migrate diff. Fungsi klasifikasi
tidak pernah melempar supaya aman dipanggil fire-and-forget dari jalur ingest.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 2: Jalur otomatis — `ingestSingleMessage` dan route test-message

**Files:**
- Modify: `src/lib/inbound.ts:7` (impor) dan `:544` (setelah `broadcast` `message.created`, di dalam blok `try`)
- Modify: `src/app/api/conversations/[id]/test-message/route.ts:6` (impor) dan `:44`
- Test: `src/lib/inbound.test.ts`, `src/app/api/conversations/[id]/test-message/route.test.ts`

**Interfaces:**
- Consumes: `classifyAndStoreTopicLabels(messageId: string, source: TopicLabelSource): Promise<TopicLabels | null>` (Task 1).
- Produces: tidak ada API baru. Invarian: setiap baris INBOUND yang dibuat kedua jalur ini dengan `content.trim() !== ''` memicu tepat satu `classifyAndStoreTopicLabels(created.id, 'auto')` yang tidak ditunggu; galatnya (termasuk promise yang ditolak) ditelan dengan `console.error('classifyAndStoreTopicLabels (auto) gagal', { messageId, error })`.

Catatan: `ingestSingleMessage` tidak diekspor (`src/lib/inbound.ts:493`); test-nya lewat `ingestMetaMessage` yang diekspor, sama seperti test lain di `inbound.test.ts`. Variabel `created` hanya hidup di dalam blok `try` (baris 525–545), jadi panggilan disisipkan di sana.

- [ ] **Step 1: Siapkan mock di `src/lib/inbound.test.ts`**

Tambahkan impor setelah baris `import { broadcast } from '@/lib/realtime'`:

```ts
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
```

Tambahkan mock setelah baris `vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))`:

```ts
vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn() }))
```

Di `beforeEach` paling atas, tepat setelah baris `vi.mocked(broadcast).mockReset()`, tambahkan:

```ts
  // Default: klasifikasi selesai tanpa label. Tanpa nilai ini `.catch` di jalur ingest akan
  // dipanggil pada `undefined` untuk setiap test lama yang membuat pesan berteks.
  vi.mocked(classifyAndStoreTopicLabels).mockReset().mockResolvedValue(null)
```

- [ ] **Step 2: Tulis test yang gagal — tambahkan di AKHIR `src/lib/inbound.test.ts`**

```ts
describe('ingestMetaMessage — label topik otomatis', () => {
  const base = samplePayload.entry[0].changes[0].value

  function payloadWithMessage(message: Record<string, unknown>): MetaWebhookPayload {
    return {
      entry: [{ changes: [{ value: { contacts: base.contacts, messages: [{ ...base.messages[0], ...message }] } }] }],
    } as MetaWebhookPayload
  }

  it('mengklasifikasi pesan teks masuk dengan source auto, termasuk di percakapan tanpa bot', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1', content: 'Halo, mau tanya paket Ijen' } as never)

    const result = await ingestMetaMessage(samplePayload)

    expect(result.processed).toBe(1)
    expect(classifyAndStoreTopicLabels).toHaveBeenCalledTimes(1)
    expect(classifyAndStoreTopicLabels).toHaveBeenCalledWith('msg_new', 'auto')
  })

  it('tidak menunggu klasifikasi: ingest selesai walau model tidak pernah menjawab', async () => {
    stubHappyPath()
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1', content: 'Halo, mau tanya paket Ijen' } as never)
    vi.mocked(classifyAndStoreTopicLabels).mockReturnValue(new Promise(() => {}))

    const result = await ingestMetaMessage(samplePayload)

    expect(result.processed).toBe(1)
  })

  it('kegagalan klasifikasi hanya dicatat; ingest tetap berhasil', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubHappyPath({ conversation: { botEnabled: false } })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_new', conversationId: 'conv_1', content: 'Halo' } as never)
    vi.mocked(classifyAndStoreTopicLabels).mockRejectedValue(new Error('ollama down'))

    const result = await ingestMetaMessage(samplePayload)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.processed).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'classifyAndStoreTopicLabels (auto) gagal',
      expect.objectContaining({ messageId: 'msg_new' })
    )
    errorSpy.mockRestore()
  })

  it('tidak mengklasifikasi pesan media tanpa teks', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_img', conversationId: 'conv_1', content: null } as never)

    await ingestMetaMessage(
      payloadWithMessage({ id: 'wamid.IMG1', type: 'image', text: undefined, image: { id: 'media_1', mime_type: 'image/jpeg' } })
    )

    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('mengklasifikasi foto yang punya caption', async () => {
    stubHappyPath({ conversation: { botEnabled: false } })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_cap', conversationId: 'conv_1', content: 'Ini hotelnya?' } as never)

    await ingestMetaMessage(
      payloadWithMessage({
        id: 'wamid.IMG2',
        type: 'image',
        text: undefined,
        image: { id: 'media_2', mime_type: 'image/jpeg', caption: 'Ini hotelnya?' },
      })
    )

    expect(classifyAndStoreTopicLabels).toHaveBeenCalledWith('msg_cap', 'auto')
  })
})
```

- [ ] **Step 3: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/inbound.test.ts -t "label topik otomatis"`
Expected: FAIL — `expected "vi.fn()" to be called 1 times, but got 0 times` (jalur ingest belum memanggilnya). Test "tidak menunggu" dan "tidak mengklasifikasi pesan media" boleh sudah lulus di tahap ini.

- [ ] **Step 4: Implementasi di `src/lib/inbound.ts`**

Tambahkan impor tepat setelah baris `import { withMediaUrl } from '@/lib/serialize-message'`:

```ts
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
```

Ganti blok ini (baris 544–545):

```ts
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })
  } catch (error) {
    // Race condition: a concurrent delivery of the same message (Meta's at-least-once
```

menjadi:

```ts
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })
    if (created.content?.trim()) {
      // Tidak ditunggu: webhook dan bot tidak menunggu model. Label menyusul lewat message.updated.
      classifyAndStoreTopicLabels(created.id, 'auto').catch((error: unknown) => {
        console.error('classifyAndStoreTopicLabels (auto) gagal', { messageId: created.id, error })
      })
    }
  } catch (error) {
    // Race condition: a concurrent delivery of the same message (Meta's at-least-once
```

- [ ] **Step 5: Jalankan, pastikan LULUS (seluruh berkas, supaya test lama ikut diperiksa)**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: PASS, termasuk 5 test baru.

- [ ] **Step 6: Siapkan mock dan tulis test yang gagal di `src/app/api/conversations/[id]/test-message/route.test.ts`**

Tambahkan impor setelah baris `import { scheduleBotRun } from '@/lib/inbound'`:

```ts
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
```

Tambahkan mock setelah baris `vi.mock('@/lib/inbound', () => ({ scheduleBotRun: vi.fn() }))`:

```ts
vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn() }))
```

Di `beforeEach`, setelah baris `vi.mocked(scheduleBotRun).mockReset()`, tambahkan:

```ts
  vi.mocked(classifyAndStoreTopicLabels).mockReset().mockResolvedValue(null)
```

Tambahkan dua test ini tepat setelah test `'rejects an empty body'` (masih di dalam `describe`):

```ts
  it('mengklasifikasi pesan sandbox tanpa menunggu, juga saat bot mati', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({
      id: 'msg_1', conversationId: 'conv_test', content: 'Berapa harga Ijen?', createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never)
    vi.mocked(classifyAndStoreTopicLabels).mockReturnValue(new Promise(() => {}))

    const res = await POST(req({ text: 'Berapa harga Ijen?' }), { params: Promise.resolve({ id: 'conv_test' }) })

    expect(res.status).toBe(200)
    expect(classifyAndStoreTopicLabels).toHaveBeenCalledWith('msg_1', 'auto')
  })

  it('kegagalan klasifikasi tidak menggagalkan route', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_test', isTest: true, botEnabled: false, contact: { name: null },
    } as never)
    mockPrisma.message.create.mockResolvedValue({
      id: 'msg_1', conversationId: 'conv_test', content: 'Berapa harga Ijen?', createdAt: new Date('2026-08-01T00:00:00Z'),
    } as never)
    vi.mocked(classifyAndStoreTopicLabels).mockRejectedValue(new Error('ollama down'))

    const res = await POST(req({ text: 'Berapa harga Ijen?' }), { params: Promise.resolve({ id: 'conv_test' }) })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalledWith(
      'classifyAndStoreTopicLabels (auto) gagal',
      expect.objectContaining({ messageId: 'msg_1' })
    )
    errorSpy.mockRestore()
  })
```

- [ ] **Step 7: Jalankan, pastikan GAGAL**

Run: `npx vitest run "src/app/api/conversations/[id]/test-message/route.test.ts"`
Expected: FAIL pada `'mengklasifikasi pesan sandbox tanpa menunggu, juga saat bot mati'` — `expected "vi.fn()" to be called with arguments: [ 'msg_1', 'auto' ]`.

- [ ] **Step 8: Implementasi di `src/app/api/conversations/[id]/test-message/route.ts`**

Tambahkan impor setelah baris `import { scheduleBotRun } from '@/lib/inbound'`:

```ts
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
```

Ganti:

```ts
  broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })

  if (conversation.botEnabled) {
```

menjadi:

```ts
  broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })

  if (created.content?.trim()) {
    // Tidak ditunggu, sama seperti jalur webhook di src/lib/inbound.ts.
    classifyAndStoreTopicLabels(created.id, 'auto').catch((error: unknown) => {
      console.error('classifyAndStoreTopicLabels (auto) gagal', { messageId: created.id, error })
    })
  }

  if (conversation.botEnabled) {
```

- [ ] **Step 9: Jalankan, pastikan LULUS**

Run: `npx vitest run "src/app/api/conversations/[id]/test-message/route.test.ts" src/lib/inbound.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/inbound.ts src/lib/inbound.test.ts \
  "src/app/api/conversations/[id]/test-message/route.ts" \
  "src/app/api/conversations/[id]/test-message/route.test.ts"
git commit -m "$(cat <<'EOF'
feat(inbox): klasifikasi topik otomatis untuk setiap pesan masuk berteks

Dipanggil tanpa ditunggu dari webhook dan sandbox, untuk semua percakapan ber-bot atau
tidak; galatnya hanya dicatat sehingga ingest dan bot tidak pernah tertahan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: Route manual "Cek topik" — `POST /api/conversations/[id]/messages/[messageId]/topic-labels`

**Files:**
- Create: `src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.ts`
- Test: `src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.test.ts`

**Interfaces:**
- Consumes:
  - `getSession(req: Request): Promise<SessionPayload | null>` — `src/lib/auth/get-session.ts:23`; `SessionPayload = { accountId: string; role: AccountRoleName; tokenVersion: number }`
  - `classifyAndStoreTopicLabels(messageId, 'manual')` dan `readTopicLabels(value: unknown): TopicLabels | null` (Task 1)
- Produces: `POST(req: Request, ctx: { params: Promise<{ id: string; messageId: string }> })`
  - 200 `{ topicLabels: TopicLabels }` — label yang sudah ada (model tidak dipanggil) atau hasil klasifikasi baru
  - 400 `{ error }` — parameter kosong, pesan bukan INBOUND, atau tanpa teks
  - 401 `{ error: 'Tidak terautentikasi' }`
  - 404 `{ error }` — pesan tidak ada atau bukan milik percakapan `[id]`
  - 500 `{ error }` — klasifikasi mengembalikan `null` atau galat tak terduga

Otorisasi: hanya `getSession` (tanpa `hasAdminPowers`) — sama dengan route flag, karena label baca tidak mengubah apa yang bot lakukan. Tidak ada audit (CLAUDE.md §4: audit hanya untuk perubahan perilaku bot). Tidak ada body; parameter divalidasi Zod.

- [ ] **Step 1: Tulis test yang gagal — `route.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const LABELS = {
  topic: 'price',
  alsoTopics: [],
  job: 'J2',
  topicSource: 'llm',
  source: 'manual',
  at: '2026-09-11T08:00:00.000Z',
} as const

function ctx(id = 'conv_1', messageId = 'msg_1') {
  return { params: Promise.resolve({ id, messageId }) }
}

function req(withSession = true) {
  return new Request('http://localhost/api/conversations/conv_1/messages/msg_1/topic-labels', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

const inbound = { conversationId: 'conv_1', direction: 'INBOUND', content: 'Berapa harga Ijen?', topicLabels: null }

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.message.findUnique.mockResolvedValue(inbound as never)
  vi.mocked(classifyAndStoreTopicLabels).mockResolvedValue({ ...LABELS, alsoTopics: [] })
})

describe('POST /api/conversations/[id]/messages/[messageId]/topic-labels', () => {
  it('menolak tanpa sesi sebelum menyentuh database', async () => {
    const res = await POST(req(false), ctx())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalled()
  })

  it('terbuka untuk AGENT: mengklasifikasi pesan tanpa label dengan source manual', async () => {
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ topicLabels: LABELS })
    expect(classifyAndStoreTopicLabels).toHaveBeenCalledWith('msg_1', 'manual')
  })

  it('mengembalikan label yang sudah ada tanpa memanggil model', async () => {
    const stored = { ...LABELS, source: 'auto' }
    mockPrisma.message.findUnique.mockResolvedValue({ ...inbound, topicLabels: stored } as never)

    const res = await POST(req(), ctx())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ topicLabels: stored })
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('404 bila pesan tidak ada', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('404 bila pesan milik percakapan lain', async () => {
    const res = await POST(req(), ctx('conv_lain'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Pesan tidak ditemukan di percakapan ini' })
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('400 bila pesan bukan INBOUND', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...inbound, direction: 'OUTBOUND' } as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(400)
    expect(classifyAndStoreTopicLabels).not.toHaveBeenCalled()
  })

  it('400 bila pesan tanpa teks', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ ...inbound, content: '  ' } as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Hanya pesan masuk yang berteks yang bisa diperiksa topiknya' })
  })

  it('400 bila parameter kosong, tanpa menyentuh database', async () => {
    const res = await POST(req(), ctx('conv_1', ' '))
    expect(res.status).toBe(400)
    expect(mockPrisma.message.findUnique).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila klasifikasi tidak menghasilkan label', async () => {
    vi.mocked(classifyAndStoreTopicLabels).mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Topik gagal diperiksa. Coba lagi sebentar lagi.' })
  })

  it('500 dengan bentuk { error } bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.message.findUnique.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memeriksa topik' })
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run "src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Implementasi — `route.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
import { readTopicLabels } from '@/lib/inbox/topic-labels-schema'

const paramsSchema = z.object({ id: z.string().trim().min(1), messageId: z.string().trim().min(1) })

/**
 * "Cek topik" untuk satu pesan masuk. Terbuka untuk semua yang login, seperti route flag: label
 * baca tidak mengubah apa yang bot lakukan. Label yang sudah ada dikembalikan tanpa memanggil model.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) return NextResponse.json({ error: 'Alamat pesan tidak valid' }, { status: 400 })
  const { id, messageId } = parsed.data

  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true, direction: true, content: true, topicLabels: true },
    })
    if (!message || message.conversationId !== id) {
      return NextResponse.json({ error: 'Pesan tidak ditemukan di percakapan ini' }, { status: 404 })
    }
    if (message.direction !== 'INBOUND' || !message.content?.trim()) {
      return NextResponse.json({ error: 'Hanya pesan masuk yang berteks yang bisa diperiksa topiknya' }, { status: 400 })
    }

    const existing = readTopicLabels(message.topicLabels)
    if (existing) return NextResponse.json({ topicLabels: existing })

    const labels = await classifyAndStoreTopicLabels(messageId, 'manual')
    if (!labels) {
      return NextResponse.json({ error: 'Topik gagal diperiksa. Coba lagi sebentar lagi.' }, { status: 500 })
    }
    return NextResponse.json({ topicLabels: labels })
  } catch (error) {
    console.error('POST /api/conversations/[id]/messages/[messageId]/topic-labels gagal', error)
    return NextResponse.json({ error: 'Gagal memeriksa topik' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `npx vitest run "src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.test.ts"`
Expected: PASS (10 test).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.ts" \
  "src/app/api/conversations/[id]/messages/[messageId]/topic-labels/route.test.ts"
git commit -m "$(cat <<'EOF'
feat(inbox): route Cek topik untuk pesan masuk yang belum berlabel

Label yang sudah ada dikembalikan tanpa memanggil model; teks baru dikirim ke model
hanya saat operator meminta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: `serializeMessage`, nama tampilan label, chip, dan ikon "Cek topik" (termasuk label yang tiba lewat SSE)

**Files:**
- Modify: `src/lib/serialize-message.ts:1-47`
- Create: `src/lib/inbox/label-names.ts`
- Modify: `src/components/inbox/MessageBubble.tsx` (impor baris 3 & 12, `MessageView` baris 30, komponen baru sebelum baris 196, signature baris 258, state baris 265, footer baris 395)
- Modify: `src/components/inbox/ThreadView.tsx:351`
- Test: `src/lib/serialize-message.test.ts`, `src/lib/inbox/label-names.test.ts`, `src/components/inbox/MessageBubble.test.tsx`, `src/components/inbox/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `TopicLabels`, `readTopicLabels` (Task 1); route `POST /api/conversations/[id]/messages/[messageId]/topic-labels` → `{ topicLabels: TopicLabels }` (Task 3); `fetchJson<T>(input: string, init?: RequestInit): Promise<T>` (`src/lib/fetch-json.ts`, melempar `FetchJsonError` berisi `error` dari server).
- Produces:
  - `serializeMessage(...)` kini mengembalikan `topicLabels: TopicLabels | null` (tipe `MessageView` di `serialize-message.ts`)
  - `export const TOPIC_LABEL_NAMES: Record<ResolverTopic, string>`, `export const JOB_LABEL_NAMES: Record<SalesClassification['job'], string>`, `export function topicLabelName(topic: string): string`, `export function jobLabelName(job: string): string` — `src/lib/inbox/label-names.ts` (murni, aman untuk klien; id tak dikenal dikembalikan apa adanya)
  - `MessageView` (klien, `MessageBubble.tsx`) bertambah `topicLabels?: TopicLabels | null`
  - `MessageBubble` props: `{ message: MessageView; onReply?: (message: MessageView) => void; conversationId?: string }`

Catatan SSE: `ThreadView` mengganti bubble dengan `event.message` apa adanya (`ThreadView.tsx:228-230`), dan payload `message.updated` dari Task 1 adalah baris Prisma lengkap lewat `withMediaUrl` — kolom `topicLabels` ikut otomatis. Tidak ada perubahan pada handler SSE; cukup test yang membuktikannya.

- [ ] **Step 1: Tulis test yang gagal — `src/lib/inbox/label-names.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { RESOLVER_TOPICS } from '@/lib/bot/module-resolver'
import { JOB_LABEL_NAMES, TOPIC_LABEL_NAMES, jobLabelName, topicLabelName } from './label-names'

describe('label-names', () => {
  it('punya nama untuk setiap topik resolver, tanpa nama ganda', () => {
    expect(Object.keys(TOPIC_LABEL_NAMES).sort()).toEqual([...RESOLVER_TOPICS].sort())
    expect(new Set(Object.values(TOPIC_LABEL_NAMES)).size).toBe(RESOLVER_TOPICS.length)
  })

  it('punya nama untuk J1–J5, dan J2 bernama "Harga & nilai"', () => {
    expect(Object.keys(JOB_LABEL_NAMES)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5'])
    expect(jobLabelName('J2')).toBe('Harga & nilai')
    expect(topicLabelName('price')).toBe('Harga')
  })

  it('id yang tidak dikenal tampil apa adanya, termasuk nama properti bawaan objek', () => {
    expect(topicLabelName('bukan_topik')).toBe('bukan_topik')
    expect(topicLabelName('constructor')).toBe('constructor')
    expect(jobLabelName('J9')).toBe('J9')
  })
})
```

- [ ] **Step 2: Tulis test yang gagal — `src/lib/serialize-message.test.ts`**

Di helper `baseMessage`, tambahkan `topicLabels: null,` tepat setelah baris `    botTrace: null,`. Lalu tambahkan di akhir berkas:

```ts
describe('serializeMessage topicLabels', () => {
  const labels = {
    topic: 'price',
    alsoTopics: ['payment'],
    job: 'J2',
    topicSource: 'llm',
    source: 'auto',
    at: '2026-09-11T08:00:00.000Z',
  }

  it('meneruskan label yang valid', () => {
    expect(serializeMessage(baseMessage({ topicLabels: labels })).topicLabels).toEqual(labels)
  })

  it('null untuk kolom kosong atau bentuk yang tidak dikenal', () => {
    expect(serializeMessage(baseMessage()).topicLabels).toBeNull()
    expect(serializeMessage(baseMessage({ topicLabels: { topic: 'bukan_topik' } })).topicLabels).toBeNull()
  })
})
```

- [ ] **Step 3: Tulis test yang gagal — `src/components/inbox/MessageBubble.test.tsx`**

Tambahkan impor di bawah `import { MessageBubble } from './MessageBubble'`:

```ts
import type { TopicLabels } from '@/lib/inbox/topic-labels-schema'
```

Tambahkan di akhir berkas:

```tsx
describe('MessageBubble — label topik', () => {
  const inbound = {
    id: 'msg_in',
    direction: 'INBOUND' as const,
    content: 'Berapa harga paket Ijen?',
    channel: 'OFFICIAL',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    createdAt: new Date().toISOString(),
    botTrace: null,
  }
  const labels: TopicLabels = {
    topic: 'price',
    alsoTopics: ['payment'],
    job: 'J2',
    topicSource: 'llm',
    source: 'auto',
    at: '2026-09-11T08:00:00.000Z',
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('menampilkan chip topik utama, topik tambahan, dan intent', () => {
    render(<MessageBubble message={{ ...inbound, topicLabels: labels }} conversationId="conv_1" />)
    expect(screen.getByText('Harga')).toBeInTheDocument()
    expect(screen.getByText('Pembayaran')).toBeInTheDocument()
    expect(screen.getByText('Harga & nilai')).toBeInTheDocument()
    expect(screen.queryByText('perkiraan')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cek topik')).not.toBeInTheDocument()
  })

  it('menandai label hasil regex_fallback sebagai perkiraan', () => {
    render(<MessageBubble message={{ ...inbound, topicLabels: { ...labels, topicSource: 'regex_fallback' } }} conversationId="conv_1" />)
    expect(screen.getByText('perkiraan')).toBeInTheDocument()
  })

  it('tidak menampilkan chip di pesan keluar', () => {
    render(
      <MessageBubble
        message={{ ...inbound, direction: 'OUTBOUND', sentBy: 'AGENT', content: 'Halo', topicLabels: labels }}
        conversationId="conv_1"
      />
    )
    expect(screen.queryByText('Harga & nilai')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cek topik')).not.toBeInTheDocument()
  })

  it('menawarkan "Cek topik" untuk pesan masuk berteks tanpa label, lalu menampilkan chip hasilnya', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ topicLabels: labels }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    render(<MessageBubble message={inbound} conversationId="conv_1" />)
    fireEvent.click(screen.getByLabelText('Cek topik'))

    await waitFor(() => expect(screen.getByText('Harga & nilai')).toBeInTheDocument())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/conversations/conv_1/messages/msg_in/topic-labels')
    expect(init.method).toBe('POST')
    expect(screen.queryByLabelText('Cek topik')).not.toBeInTheDocument()
  })

  it('berganti ke status memuat selama pemeriksaan', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    render(<MessageBubble message={inbound} conversationId="conv_1" />)
    fireEvent.click(screen.getByLabelText('Cek topik'))

    expect(screen.getByLabelText('Memeriksa topik...')).toBeDisabled()
  })

  it('menampilkan galat di tempat bila pemeriksaan gagal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Topik gagal diperiksa. Coba lagi sebentar lagi.' }) }) as Response)
    )

    render(<MessageBubble message={inbound} conversationId="conv_1" />)
    fireEvent.click(screen.getByLabelText('Cek topik'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Topik gagal diperiksa. Coba lagi sebentar lagi.'))
    expect(screen.getByLabelText('Cek topik')).toBeInTheDocument()
  })

  it('tidak menawarkan "Cek topik" untuk pesan media tanpa teks, atau tanpa conversationId', () => {
    const { unmount } = render(
      <MessageBubble message={{ ...inbound, content: null, type: 'image', mediaUrl: '/api/media/msg_in' }} conversationId="conv_1" />
    )
    expect(screen.queryByLabelText('Cek topik')).not.toBeInTheDocument()
    unmount()

    render(<MessageBubble message={inbound} />)
    expect(screen.queryByLabelText('Cek topik')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Tulis test yang gagal — `src/components/inbox/ThreadView.test.tsx`**

Di dalam `describe('ThreadView live delivery-status updates', ...)`, tepat SEBELUM baris `  it('ignores a message.updated event for a different conversation', async () => {`, sisipkan:

```tsx
  it('menampilkan label topik yang tiba lewat message.updated tanpa muat ulang', async () => {
    const inboundMessage = {
      id: 'm_in',
      direction: 'INBOUND',
      content: 'Berapa harga paket Ijen?',
      channel: 'OFFICIAL',
      sentBy: 'CUSTOMER',
      deliveryStatus: 'DELIVERED',
      createdAt: new Date().toISOString(),
      botTrace: null,
      topicLabels: null,
    }
    mockBasicFetch([inboundMessage])

    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(screen.getByLabelText('Cek topik')).toBeInTheDocument())

    act(() => {
      FakeEventSource.instances[0].emit({
        type: 'message.updated',
        conversationId: 'conv_1',
        message: {
          ...inboundMessage,
          topicLabels: { topic: 'price', alsoTopics: [], job: 'J2', topicSource: 'llm', source: 'auto', at: '2026-09-11T08:00:00.000Z' },
        },
      })
    })

    await waitFor(() => expect(screen.getByText('Harga & nilai')).toBeInTheDocument())
    expect(screen.queryByLabelText('Cek topik')).not.toBeInTheDocument()
  })

```

- [ ] **Step 5: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/inbox/label-names.test.ts src/lib/serialize-message.test.ts src/components/inbox/MessageBubble.test.tsx src/components/inbox/ThreadView.test.tsx`
Expected: FAIL — `Failed to resolve import "./label-names"`; di `serialize-message.test.ts` `expected undefined to deeply equal {...}`; di MessageBubble/ThreadView `Unable to find a label with the text of: Cek topik`.

- [ ] **Step 6: Implementasi — `src/lib/inbox/label-names.ts`**

```ts
import type { ResolverTopic } from '@/lib/bot/module-resolver'
import type { SalesClassification } from '@/lib/bot/types'

export const TOPIC_LABEL_NAMES: Record<ResolverTopic, string> = {
  inclusions: 'Yang termasuk',
  price: 'Harga',
  private_tour: 'Tur privat',
  vehicle: 'Kendaraan',
  rooming: 'Kamar',
  hotel: 'Hotel',
  route_endpoint: 'Titik awal & akhir',
  destination_readiness: 'Kesiapan destinasi',
  booking: 'Pemesanan',
  payment: 'Pembayaran',
  cancellation: 'Pembatalan',
  blue_fire: 'Blue fire',
  greeting: 'Salam',
  general: 'Umum',
}

export const JOB_LABEL_NAMES: Record<SalesClassification['job'], string> = {
  J1: 'Cari paket',
  J2: 'Harga & nilai',
  J3: 'Rute & waktu',
  J4: 'Cek ketersediaan',
  J5: 'Keluhan & serah ke agen',
}

/** Id yang tidak dikenal (baris lama, nilai di luar enum) tampil apa adanya. */
export function topicLabelName(topic: string): string {
  return Object.prototype.hasOwnProperty.call(TOPIC_LABEL_NAMES, topic) ? TOPIC_LABEL_NAMES[topic as ResolverTopic] : topic
}

export function jobLabelName(job: string): string {
  return Object.prototype.hasOwnProperty.call(JOB_LABEL_NAMES, job) ? JOB_LABEL_NAMES[job as SalesClassification['job']] : job
}
```

- [ ] **Step 7: Implementasi — `src/lib/serialize-message.ts`**

Tambahkan impor setelah baris `import type { SentTemplatePayload } from '@/lib/meta/carousel-types'`:

```ts
import { readTopicLabels, type TopicLabels } from '@/lib/inbox/topic-labels-schema'
```

Di `MessageView` (berkas ini, bukan `MessageBubble.tsx` yang juga punya `botTrace: unknown`), ganti:

```ts
  createdAt: string
  botTrace: unknown
  replyTo: ReplyToView | null
```

menjadi:

```ts
  createdAt: string
  botTrace: unknown
  topicLabels: TopicLabels | null
  replyTo: ReplyToView | null
```

Di `serializeMessage`, ganti:

```ts
    createdAt: m.createdAt.toISOString(),
    botTrace: m.botTrace,
```

menjadi:

```ts
    createdAt: m.createdAt.toISOString(),
    botTrace: m.botTrace,
    topicLabels: readTopicLabels(m.topicLabels),
```

- [ ] **Step 8: Implementasi — `src/components/inbox/MessageBubble.tsx`**

8a. Ganti baris impor ikon (baris 3):

```ts
import { Bot, Brain, CornerUpLeft, Film, Image as ImageIcon, Paperclip } from 'lucide-react'
```

menjadi:

```ts
import { Bot, Brain, CornerUpLeft, Film, Image as ImageIcon, Paperclip, Tag } from 'lucide-react'
```

8b. Setelah baris `import type { BotDecision } from '@/lib/bot/types'` tambahkan:

```ts
import type { TopicLabels } from '@/lib/inbox/topic-labels-schema'
import { jobLabelName, topicLabelName } from '@/lib/inbox/label-names'
```

8c. Di `MessageView`, setelah baris `  replyTo?: { id: string; content: string | null; type: string; sentBy: string } | null` tambahkan:

```ts
  topicLabels?: TopicLabels | null
```

8d. Tepat sebelum baris `const CHANNEL_LABEL: Record<string, string> = { OFFICIAL: 'Official', UNOFFICIAL: 'Unofficial' }` sisipkan:

```tsx
/** Topik & intent satu pesan masuk. "perkiraan" = topik dari regex cadangan, bukan dari model. */
function TopicChips({ labels }: { labels: TopicLabels }) {
  return (
    <>
      <Badge variant="brand">{topicLabelName(labels.topic)}</Badge>
      {labels.alsoTopics.map((topic) => (
        <Badge key={topic} variant="muted">
          {topicLabelName(topic)}
        </Badge>
      ))}
      <Badge variant="default">{jobLabelName(labels.job)}</Badge>
      {labels.topicSource === 'regex_fallback' && <span className="italic">perkiraan</span>}
    </>
  )
}

```

8e. Ganti signature komponen (baris 258):

```tsx
export function MessageBubble({ message, onReply }: { message: MessageView; onReply?: (message: MessageView) => void }) {
```

menjadi:

```tsx
export function MessageBubble({
  message,
  onReply,
  conversationId,
}: {
  message: MessageView
  onReply?: (message: MessageView) => void
  /** Dibutuhkan route "Cek topik"; tanpa ini ikonnya tidak tampil. */
  conversationId?: string
}) {
```

8f. Tepat setelah baris `  const [retryError, setRetryError] = useState<string | null>(null)` tambahkan state (masih sebelum early return handoff, supaya urutan hook tetap):

```tsx
  const [checkedLabels, setCheckedLabels] = useState<TopicLabels | null>(null)
  const [checkingTopic, setCheckingTopic] = useState(false)
  const [topicError, setTopicError] = useState<string | null>(null)
```

8g. Tepat setelah fungsi `retrySend` berakhir (baris `  }` sebelum komentar `  // A handoff decision is logged (Task 34)`), tambahkan:

```tsx
  async function checkTopic() {
    if (checkingTopic || !conversationId) return
    setCheckingTopic(true)
    setTopicError(null)
    try {
      const data = await fetchJson<{ topicLabels: TopicLabels }>(
        `/api/conversations/${conversationId}/messages/${message.id}/topic-labels`,
        { method: 'POST' }
      )
      setCheckedLabels(data.topicLabels)
    } catch (error: unknown) {
      setTopicError(error instanceof Error ? error.message : 'Gagal memeriksa topik')
    } finally {
      setCheckingTopic(false)
    }
  }
```

8h. Tepat setelah baris `  const cards = message.templatePayload?.cards` tambahkan:

```tsx
  const topicLabels = message.topicLabels ?? checkedLabels
  const canCheckTopic = !isOutbound && !topicLabels && Boolean(conversationId && message.content?.trim())
```

8i. Ganti baris footer:

```tsx
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
```

menjadi:

```tsx
        {!isOutbound && topicLabels && <TopicChips labels={topicLabels} />}
        {canCheckTopic && (
          <IconButton
            size="sm"
            label={checkingTopic ? 'Memeriksa topik...' : 'Cek topik'}
            icon={<Tag strokeWidth={1.75} />}
            onClick={checkTopic}
            disabled={checkingTopic}
            className="-my-1"
          />
        )}
        {topicError && (
          <span role="alert" className="text-danger">
            {topicError}
          </span>
        )}
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
```

- [ ] **Step 9: Implementasi — `src/components/inbox/ThreadView.tsx:351`**

Ganti:

```tsx
            <MessageBubble message={m} onReply={setReplyingTo} />
```

menjadi:

```tsx
            <MessageBubble message={m} onReply={setReplyingTo} conversationId={conversationId} />
```

- [ ] **Step 10: Jalankan, pastikan LULUS**

Run: `npx vitest run src/lib/inbox/label-names.test.ts src/lib/serialize-message.test.ts src/components/inbox/MessageBubble.test.tsx src/components/inbox/ThreadView.test.tsx`
Expected: PASS, termasuk semua test lama di keempat berkas.

- [ ] **Step 11: Commit**

```bash
git add src/lib/inbox/label-names.ts src/lib/inbox/label-names.test.ts \
  src/lib/serialize-message.ts src/lib/serialize-message.test.ts \
  src/components/inbox/MessageBubble.tsx src/components/inbox/MessageBubble.test.tsx \
  src/components/inbox/ThreadView.tsx src/components/inbox/ThreadView.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): chip topik & intent di pesan masuk, dengan ikon Cek topik

Label yang tiba lewat message.updated langsung tampil; pesan tanpa label bisa diperiksa
dari bubble-nya. Nama tampilan Bahasa Indonesia untuk 14 topik dan J1–J5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: `managedLines` membawa `sourceId`, `sourceKey`, `version`

**Files:**
- Modify: `src/lib/bot/types.ts:118-119` (`DecisionKnowledge.managedLines`)
- Modify: `src/lib/bot/runtime-integration.ts` (impor baris 24, `ManagedFacts` baris 125–135, `collect` baris 362–468, `managedFactsFor` doc baris 470, `allManagedFacts` baris 609–635)
- Modify: `src/lib/bot/orchestrator.ts:185` (impor) dan tiga map identik di baris 960, 1182, 2039
- Test: `src/lib/bot/runtime-integration.test.ts`, `src/lib/bot/orchestrator.test.ts:621-627`

**Interfaces:**
- Consumes: `ManagedKnowledgeEntry = { sourceId; sourceKey; sourceTitle; revisionId; version; items }` (`src/lib/bot/managed-knowledge.ts:36-43`) — `sourceId`/`sourceKey`/`version` sudah ada di setiap entri tapi `sourceId` belum pernah dibaca `collect()`.
- Produces:
  - `export type ManagedLineMeta = { sourceId: string; sourceKey: string; version: number }` (runtime-integration.ts)
  - `ManagedFacts.lineMeta?: ManagedLineMeta[]` — sejajar 1:1 dengan `lines`; absen pada `EMPTY` (pola `lineSources`)
  - `export function decisionManagedLines(managed: ManagedFacts): DecisionKnowledge['managedLines']`
  - `DecisionKnowledge['managedLines']` = `Array<{ line: string; source: string; sourceId?: string; sourceKey?: string; version?: number }>` — `source` tetap ada ("Judul (vN)")

Catatan: `orchestrator.test.ts` me-mock `loadPublishedManagedKnowledge` tetapi memakai `runtime-integration.ts` asli, jadi test yang meng-`toEqual` `managedLines` (hanya baris 621) harus diperbarui; test lain memakai `toMatchObject` sehingga field tambahan tidak mematahkannya. `sanitizeTrace` tidak meredaksi `sourceId`/`sourceKey` — daftar `SECRET_KEY_HINTS` (`trace-sanitizer.ts:22-37`) hanya memuat `apikey`/`privatekey`, bukan `key`.

- [ ] **Step 1: Tulis test yang gagal — tambahkan `decisionManagedLines` ke impor `src/lib/bot/runtime-integration.test.ts`**

Di blok impor dari `'./runtime-integration'` (baris 10–19), tambahkan baris `  decisionManagedLines,` tepat setelah `  allManagedFacts,`. Lalu tambahkan di akhir berkas:

```ts
describe('lineMeta dan decisionManagedLines', () => {
  const priced = entry({
    items: [
      {
        question: 'Berapa harga ATV?',
        answer: 'Tergantung paket.',
        prices: [{ label: 'ATV 1 jam', amount: 350000, currency: 'IDR' }],
        links: [{ label: 'Detail', url: 'https://example.com/atv' }],
      },
    ],
  })
  const meta = { sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }

  it('managedFactsFor: lineMeta sejajar 1:1 dengan lines, termasuk baris harga dan tautan', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [priced], available: true, loadedAt: 0 })

    const facts = await managedFactsFor('berapa harga ATV?', null)

    expect(facts.lines).toHaveLength(3)
    expect(facts.lineMeta).toEqual([meta, meta, meta])
  })

  it('allManagedFacts: lineMeta sejajar 1:1 dengan lines', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [priced], available: true, loadedAt: 0 })

    const facts = await allManagedFacts()

    expect(facts.lineMeta).toEqual([meta, meta, meta])
  })

  it('decisionManagedLines memasangkan setiap baris dengan source dan identitas revisinya', async () => {
    vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({ entries: [priced], available: true, loadedAt: 0 })

    const facts = await managedFactsFor('berapa harga ATV?', null)

    expect(decisionManagedLines(facts)).toEqual([
      { line: 'Berapa harga ATV? — Tergantung paket.', source: 'FAQ Harga ATV (v2)', ...meta },
      { line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', ...meta },
      { line: 'Detail: https://example.com/atv', source: 'FAQ Harga ATV (v2)', ...meta },
    ])
  })

  it('decisionManagedLines tanpa lineMeta (bentuk lama) hanya membawa line dan source', () => {
    expect(
      decisionManagedLines({
        lines: ['A — a'],
        lineSources: ['FAQ (v1)'],
        refs: [],
        gateBypassed: false,
        truncated: 0,
        rejected: [],
        rejectedOmitted: 0,
        degraded: false,
      })
    ).toEqual([{ line: 'A — a', source: 'FAQ (v1)' }])
  })
})
```

- [ ] **Step 2: Perbarui ekspektasi di `src/lib/bot/orchestrator.test.ts` (baris 623)**

Ganti:

```ts
      managedLines: [{ line: 'How does the ferry work? — Ketapang-Gilimanuk ferry.', source: 'FERRY / TRANSPORT (v1)' }],
```

menjadi:

```ts
      managedLines: [
        {
          line: 'How does the ferry work? — Ketapang-Gilimanuk ferry.',
          source: 'FERRY / TRANSPORT (v1)',
          sourceId: 'ks_1',
          sourceKey: 'managed/ferry',
          version: 1,
        },
      ],
```

- [ ] **Step 3: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts src/lib/bot/orchestrator.test.ts`
Expected: FAIL — `decisionManagedLines is not a function` di runtime-integration.test; di orchestrator.test test `'attaches \`knowledge\` (managed lines, no catalogLines) to a Mode 3 decision, but not topic/job'` gagal karena `sourceId` tidak ada.

- [ ] **Step 4: Implementasi — `src/lib/bot/types.ts`**

Ganti:

```ts
  /** Managed knowledge lines as sent, each paired with its source ("Title (vN)"). */
  managedLines: Array<{ line: string; source: string }>
```

menjadi:

```ts
  /**
   * Managed knowledge lines as sent, each paired with its source ("Title (vN)"). `sourceId`/
   * `sourceKey`/`version` name the published revision; absent on rows stored before they existed.
   */
  managedLines: Array<{ line: string; source: string; sourceId?: string; sourceKey?: string; version?: number }>
```

- [ ] **Step 5: Implementasi — `src/lib/bot/runtime-integration.ts`**

5a. Setelah baris `import type { ResolverTopic } from './module-resolver'` tambahkan:

```ts
import type { DecisionKnowledge } from './types'
```

5b. Tepat sebelum baris `export type ManagedFacts = {` sisipkan:

```ts
/** Which published revision one managed line came from. */
export type ManagedLineMeta = { sourceId: string; sourceKey: string; version: number }

```

5c. Di `ManagedFacts`, ganti:

```ts
  lineSources?: string[]
  /** Trace refs, labelled MANAGED so a reader can tell them from catalog facts. */
```

menjadi:

```ts
  lineSources?: string[]
  /** Parallel to `lines`, same convention as `lineSources`. Feeds `DecisionKnowledge.managedLines`' ids. */
  lineMeta?: ManagedLineMeta[]
  /** Trace refs, labelled MANAGED so a reader can tell them from catalog facts. */
```

5d. Di return type `collect`, ganti:

```ts
): {
  lines: string[]
  lineSources: string[]
  refs: KnowledgeRef[]
  truncated: number
```

menjadi:

```ts
): {
  lines: string[]
  lineSources: string[]
  lineMeta: ManagedLineMeta[]
  refs: KnowledgeRef[]
  truncated: number
```

5e. Di badan `collect`, ganti blok berikut (baris 425–449):

```ts
  const lineSources: string[] = []
  const refs: KnowledgeRef[] = []

  managed.entries.forEach((entry, entryIndex) => {
    const itemIndices = selectedItemsByEntry.get(entryIndex)
    if (!itemIndices || itemIndices.size === 0) return

    const source = `${entry.sourceTitle} (v${entry.version})`

    entry.items.forEach((item, itemIndex) => {
      if (!itemIndices.has(itemIndex)) return

      lines.push(`${item.question} — ${item.answer}`)
      lineSources.push(source)
      // Prices and links travel as their own lines so the reply verifier can source them: a
      // figure buried in prose is indistinguishable, to it, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
        lineSources.push(source)
      }
      for (const link of item.links ?? []) {
        lines.push(`${link.label}: ${link.url}`)
        lineSources.push(source)
      }
    })
```

menjadi:

```ts
  const lineSources: string[] = []
  const lineMeta: ManagedLineMeta[] = []
  const refs: KnowledgeRef[] = []

  managed.entries.forEach((entry, entryIndex) => {
    const itemIndices = selectedItemsByEntry.get(entryIndex)
    if (!itemIndices || itemIndices.size === 0) return

    const source = `${entry.sourceTitle} (v${entry.version})`
    const meta: ManagedLineMeta = { sourceId: entry.sourceId, sourceKey: entry.sourceKey, version: entry.version }

    entry.items.forEach((item, itemIndex) => {
      if (!itemIndices.has(itemIndex)) return

      lines.push(`${item.question} — ${item.answer}`)
      lineSources.push(source)
      lineMeta.push(meta)
      // Prices and links travel as their own lines so the reply verifier can source them: a
      // figure buried in prose is indistinguishable, to it, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
        lineSources.push(source)
        lineMeta.push(meta)
      }
      for (const link of item.links ?? []) {
        lines.push(`${link.label}: ${link.url}`)
        lineSources.push(source)
        lineMeta.push(meta)
      }
    })
```

5f. Ganti return `collect`:

```ts
  return { lines, lineSources, refs, truncated, rejected: rejectedRecorded, rejectedOmitted }
```

menjadi:

```ts
  return { lines, lineSources, lineMeta, refs, truncated, rejected: rejectedRecorded, rejectedOmitted }
```

5g. Tepat sebelum baris `/**` yang membuka doc `managedFactsFor` (baris yang diikuti ` * Managed knowledge relevant to one customer message.`), sisipkan:

```ts
/** `ManagedFacts` → `DecisionKnowledge.managedLines`: one entry per line, revision ids included when known. */
export function decisionManagedLines(managed: ManagedFacts): DecisionKnowledge['managedLines'] {
  return managed.lines.map((line, i) => ({
    line,
    source: managed.lineSources?.[i] ?? '',
    ...(managed.lineMeta?.[i] ?? {}),
  }))
}

```

5h. Di `allManagedFacts`, ganti blok (baris 609–635):

```ts
  const lines: string[] = []
  const lineSources: string[] = []
  const refs: KnowledgeRef[] = []

  for (const entry of managed.entries) {
    if (entry.items.length === 0) continue
    const source = `${entry.sourceTitle} (v${entry.version})`

    for (const item of entry.items) {
      lines.push(`${item.question} — ${item.answer}`)
      lineSources.push(source)
      // Same reasoning as `collect`: a price or link buried in prose is indistinguishable, to
      // the reply verifier, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
        lineSources.push(source)
      }
      for (const link of item.links ?? []) {
        lines.push(`${link.label}: ${link.url}`)
        lineSources.push(source)
      }
    }

    refs.push({ sourceType: 'MANAGED', sourceKey: entry.sourceKey, title: entry.sourceTitle, version: entry.version })
  }

  return { lines, lineSources, refs, gateBypassed: false, truncated: 0, rejected: [], rejectedOmitted: 0, degraded: false }
```

menjadi:

```ts
  const lines: string[] = []
  const lineSources: string[] = []
  const lineMeta: ManagedLineMeta[] = []
  const refs: KnowledgeRef[] = []

  for (const entry of managed.entries) {
    if (entry.items.length === 0) continue
    const source = `${entry.sourceTitle} (v${entry.version})`
    const meta: ManagedLineMeta = { sourceId: entry.sourceId, sourceKey: entry.sourceKey, version: entry.version }

    for (const item of entry.items) {
      lines.push(`${item.question} — ${item.answer}`)
      lineSources.push(source)
      lineMeta.push(meta)
      // Same reasoning as `collect`: a price or link buried in prose is indistinguishable, to
      // the reply verifier, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
        lineSources.push(source)
        lineMeta.push(meta)
      }
      for (const link of item.links ?? []) {
        lines.push(`${link.label}: ${link.url}`)
        lineSources.push(source)
        lineMeta.push(meta)
      }
    }

    refs.push({ sourceType: 'MANAGED', sourceKey: entry.sourceKey, title: entry.sourceTitle, version: entry.version })
  }

  return { lines, lineSources, lineMeta, refs, gateBypassed: false, truncated: 0, rejected: [], rejectedOmitted: 0, degraded: false }
```

- [ ] **Step 6: Implementasi — `src/lib/bot/orchestrator.ts`**

Ganti baris 185:

```ts
import { shouldRunEscalationClassifier, fallbackReplyText, managedFactsFor, allManagedFacts, MAX_MANAGED_ITEMS_PER_TURN } from './runtime-integration'
```

menjadi:

```ts
import { shouldRunEscalationClassifier, fallbackReplyText, managedFactsFor, allManagedFacts, decisionManagedLines, MAX_MANAGED_ITEMS_PER_TURN } from './runtime-integration'
```

Lalu ganti KETIGA kemunculan (Edit dengan `replace_all: true`) teks persis:

```ts
managedLines: managed.lines.map((line, i) => ({ line, source: managed.lineSources?.[i] ?? '' })),
```

menjadi:

```ts
managedLines: decisionManagedLines(managed),
```

Verifikasi mekanis:

```bash
test "$(grep -c 'managedLines: decisionManagedLines(managed),' src/lib/bot/orchestrator.ts)" = 3 \
  && ! grep -q 'managed.lineSources' src/lib/bot/orchestrator.ts && echo "3 TITIK DIGANTI"
```

Expected: `3 TITIK DIGANTI`.

- [ ] **Step 7: Jalankan, pastikan LULUS**

Run: `npx vitest run src/lib/bot/runtime-integration.test.ts src/lib/bot/orchestrator.test.ts src/components/inbox/BotTracePopover.test.tsx src/lib/bot-control/decision-recorder.test.ts src/lib/send.test.ts`
Expected: PASS (tiga berkas terakhir memakai fixture `managedLines` bentuk lama dan harus tetap hijau — bukti kompatibilitas).

- [ ] **Step 8: Commit**

```bash
git add src/lib/bot/types.ts src/lib/bot/runtime-integration.ts src/lib/bot/runtime-integration.test.ts \
  src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "$(cat <<'EOF'
feat(bot): managedLines membawa sourceId, sourceKey, dan version

Array paralel lineMeta di ManagedFacts dan satu helper decisionManagedLines menggantikan
tiga map identik di orchestrator. Field source lama tetap ada untuk trace yang sudah tersimpan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: `attributeReply` — pemetaan paragraf → baris, dipasang di `attachClassification`

**Files:**
- Modify: `src/lib/bot/types.ts:159-162` (akhir `DecisionKnowledge`, sebelum `export type BotDecision =`)
- Create: `src/lib/bot/reply-attribution.ts`
- Modify: `src/lib/bot/orchestrator.ts:199` (impor) dan `:2431-2440` (`attachClassification`)
- Test: `src/lib/bot/reply-attribution.test.ts`, `src/lib/bot/orchestrator.test.ts`, `src/lib/bot-control/decision-recorder.test.ts`

**Interfaces:**
- Consumes:
  - `extractRupiahAmounts(text: string): number[]` (`src/lib/bot/reply-verifier.ts:91`) dan `extractUrls(text: string): string[]` (`:212`). `reply-verifier.ts` tidak punya impor, jadi `reply-attribution.ts` tetap aman diimpor komponen klien.
  - `DecisionKnowledge['managedLines']` dengan `sourceId?`/`version?` (Task 5).
- Produces:
  - `export type AttributedLine = { kind: 'managed' | 'catalog'; line: string; sourceId?: string; title?: string; version?: number }` (types.ts)
  - `export type ReplyAttribution = { paragraph: number; lines: AttributedLine[] }` (types.ts)
  - `DecisionKnowledge.attributions?: ReplyAttribution[]`
  - `export const MIN_CONTENT_WORD_LENGTH = 4`, `export const MIN_SHARED_CONTENT_WORDS = 3`, `export const MIN_SHARED_RATIO = 0.3`
  - `export function splitParagraphs(text: string): string[]`
  - `export function attributeReply(replyText: string, knowledge: DecisionKnowledge): ReplyAttribution[]`

**Aturan cocok (ditetapkan di modul, persis):** balasan dipecah `splitParagraphs` — per baris kosong (`/\n\s*\n/`), lalu setiap baris yang diawali butir (`/^(?:[-*•]|\d+[.)])\s+/`) memulai paragraf baru; baris lanjutan ikut butir sebelumnya; baris di-`trim`, paragraf kosong dibuang. `paragraph` = indeks 0-based hasil itu. Satu baris knowledge/katalog cocok dengan satu paragraf bila SALAH SATU:
1. ada nominal Rupiah yang sama (hasil `extractRupiahAmounts`, selisih `< 0.5`);
2. ada URL yang sama (hasil `extractUrls`, huruf kecil, `/` di akhir dibuang);
3. jumlah kata isi yang sama `>= MIN_SHARED_CONTENT_WORDS` (3) DAN `jumlah itu / jumlah kata isi baris >= MIN_SHARED_RATIO` (0.3). Kata isi = huruf kecil, dipecah `/[^\p{L}\p{N}]+/u`, panjang `>= 4`, bukan stopword (salinan persis `STOPWORDS` di `runtime-integration.ts:211-222`, yang tidak bisa diimpor karena modul itu menarik prisma).

Urutan kandidat deterministik: semua `catalogLines` dulu, lalu `managedLines`, masing-masing dalam urutan aslinya. Paragraf tanpa kecocokan tidak masuk hasil. Baris katalog → `{ kind: 'catalog', line }`. Baris managed → `{ kind: 'managed', line, sourceId?, title, version? }` dengan `title` = `source` tanpa akhiran persis `" (v<version>)"` (akhiran yang dibentuk `collect()`/`allManagedFacts()`); tanpa `version`, `title` = `source` apa adanya.

**Titik hitung:** di dalam `attachClassification` — satu-satunya titik tempel, dipanggil untuk jalur normal dan jalur `catch` — atas teks keputusan yang dikembalikan `runDecision()` (sudah melewati `composeVerifiedReply`): `faq` → `draft`; `booking_context`/`clarify` → `reply`; `handoff` → tidak ada atribusi. `attributions` dilampirkan (boleh `[]`) hanya bila `knowledge` ada dan teks tidak kosong. `Message.botTrace` (via `sendMessage` → `sanitizeTrace`) dan `BotDecisionRun.knowledgeRefs` (via `knowledgeRefsForDecision`, yang menyalin `decision.knowledge` utuh) otomatis membawa data yang sama — `decision-recorder.ts` dan `send.ts` tidak diubah.

- [ ] **Step 1: Tulis test yang gagal — `src/lib/bot/reply-attribution.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { attributeReply, splitParagraphs, MIN_SHARED_CONTENT_WORDS, MIN_SHARED_RATIO } from './reply-attribution'
import type { DecisionKnowledge } from './types'

function knowledge(overrides: Partial<DecisionKnowledge> = {}): DecisionKnowledge {
  return { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, ...overrides }
}

const managedPrice = { line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }
const managedLink = { line: 'Detail: https://example.com/atv', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }

describe('splitParagraphs', () => {
  it('memecah per baris kosong', () => {
    expect(splitParagraphs('Satu.\n\nDua.\n\n\nTiga.')).toEqual(['Satu.', 'Dua.', 'Tiga.'])
  })

  it('setiap butir jadi paragraf sendiri, baris lanjutan ikut butirnya', () => {
    expect(splitParagraphs('Pilihan:\n- Paket A\n  termasuk hotel\n- Paket B\n1. Satu\n2) Dua')).toEqual([
      'Pilihan:',
      '- Paket A\ntermasuk hotel',
      '- Paket B',
      '1. Satu',
      '2) Dua',
    ])
  })

  it('teks kosong tidak menghasilkan paragraf', () => {
    expect(splitParagraphs('  \n\n ')).toEqual([])
  })
})

describe('attributeReply', () => {
  it('mencocokkan lewat nominal Rupiah walau formatnya berbeda', () => {
    expect(attributeReply('Halo kak!\n\nHarga ATV Rp350.000 per jam.', knowledge({ managedLines: [managedPrice] }))).toEqual([
      { paragraph: 1, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
    ])
  })

  it('mencocokkan lewat URL yang sama', () => {
    expect(attributeReply('Info lengkap: https://example.com/atv.', knowledge({ managedLines: [managedLink] }))).toEqual([
      { paragraph: 0, lines: [{ kind: 'managed', line: managedLink.line, sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
    ])
  })

  it('mencocokkan lewat kata isi di atas ambang, termasuk baris katalog', () => {
    const catalogLine = 'Every package includes private transport and a driver/guide.'
    expect(
      attributeReply('All our packages include private transport with your own driver and guide.', knowledge({ catalogLines: [catalogLine] }))
    ).toEqual([{ paragraph: 0, lines: [{ kind: 'catalog', line: catalogLine }] }])
  })

  it(`ambang kata isi: minimal ${MIN_SHARED_CONTENT_WORDS} kata DAN ${MIN_SHARED_RATIO} dari kata isi baris`, () => {
    const ten = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
    // 3 dari 10 kata = 0.3 -> cocok (batas inklusif).
    expect(attributeReply('alpha bravo charlie', knowledge({ catalogLines: [ten] }))).toEqual([
      { paragraph: 0, lines: [{ kind: 'catalog', line: ten }] },
    ])
    // 2 kata -> di bawah jumlah minimum.
    expect(attributeReply('alpha bravo', knowledge({ catalogLines: [ten] }))).toEqual([])
    // 3 dari 11 kata = 0.27 -> di bawah rasio minimum.
    expect(attributeReply('alpha bravo charlie', knowledge({ catalogLines: [`${ten} kilo`] }))).toEqual([])
  })

  it('tidak mencocokkan baris yang hanya berbagi sedikit kata, dan tidak menganggap persen sebagai Rupiah', () => {
    const line = 'Berapa deposit? — 20% dari total, dibayar di Surabaya.'
    expect(
      attributeReply(
        'Deposit bisa ditransfer kapan saja, 20% saja.',
        knowledge({ managedLines: [{ line, source: 'Kebijakan Pembayaran (v3)', sourceId: 'ks_2', sourceKey: 'managed/pay', version: 3 }] })
      )
    ).toEqual([])
  })

  it('satu paragraf bisa cocok dengan beberapa baris: katalog dulu, lalu managed, urut aslinya', () => {
    const unrelated = 'Semua paket termasuk transport privat.'
    expect(
      attributeReply('Harga ATV Rp350.000, detail di https://example.com/atv', knowledge({ catalogLines: [unrelated], managedLines: [managedPrice, managedLink] }))
    ).toEqual([
      {
        paragraph: 0,
        lines: [
          { kind: 'managed', line: managedPrice.line, sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 },
          { kind: 'managed', line: managedLink.line, sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 },
        ],
      },
    ])
  })

  it('baris lama tanpa sourceId/version tetap tercatat, judulnya source apa adanya', () => {
    expect(
      attributeReply('Harga ATV Rp350.000.', knowledge({ managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)' }] }))
    ).toEqual([{ paragraph: 0, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 350000', title: 'FAQ Harga ATV (v2)' }] }])
  })
})
```

- [ ] **Step 2: Tulis test yang gagal — `src/lib/bot/orchestrator.test.ts`**

2a. Di test `'attaches \`knowledge\` (managed lines, no catalogLines) to a Mode 3 decision, but not topic/job'` (sudah diubah di Task 5), ganti:

```ts
          sourceKey: 'managed/ferry',
          version: 1,
        },
      ],
      rejected: [],
      rejectedOmitted: 0,
      gateBypassed: false,
    })
```

menjadi:

```ts
          sourceKey: 'managed/ferry',
          version: 1,
        },
      ],
      rejected: [],
      rejectedOmitted: 0,
      gateBypassed: false,
      // 'Sure!' tidak berbagi nominal, URL, atau kata isi dengan baris mana pun.
      attributions: [],
    })
```

2b. Tepat SEBELUM baris komentar `  // Confirmed with the operator 2026-08-06: Ijen's health screening is included for every` (test berikutnya di `describe` yang sama), sisipkan:

```ts
  it('mencatat paragraf balasan FINAL yang cocok dengan baris knowledge (attributions)', async () => {
    ;vi.mocked(ensureFreshBookingData).mockResolvedValue({ bookingId: 'B1' })
    ;vi.mocked(loadPublishedManagedKnowledge).mockResolvedValue({
      entries: [
        {
          sourceId: 'ks_1',
          sourceKey: 'managed/ferry',
          sourceTitle: 'FERRY / TRANSPORT',
          revisionId: 'krev_1',
          version: 1,
          items: [{ question: 'How does the ferry work?', answer: 'Ketapang-Gilimanuk ferry.' }],
        },
      ],
      available: true,
      loadedAt: 0,
    })
    // Berbagi {ferry, ketapang, gilimanuk} = 3 dari 4 kata isi baris -> cocok lewat aturan kata.
    ;vi.mocked(callLLM).mockResolvedValue('The Ketapang-Gilimanuk ferry crossing to Bali runs every hour.')

    const result = await decideAndRespond('conv_1', 'How do we get to Bali?')

    expect(result.knowledge?.attributions).toEqual([
      {
        paragraph: 0,
        lines: [
          {
            kind: 'managed',
            line: 'How does the ferry work? — Ketapang-Gilimanuk ferry.',
            sourceId: 'ks_1',
            title: 'FERRY / TRANSPORT',
            version: 1,
          },
        ],
      },
    ])
  })

```

- [ ] **Step 3: Tulis test pengunci — `src/lib/bot-control/decision-recorder.test.ts`**

Tambahkan impor setelah baris `import { prisma } from '@/lib/db'`:

```ts
import { sanitizeTrace } from './trace-sanitizer'
```

Tepat setelah test `'includes decision.knowledge alone when the decision has no sourceTopic'` (masih di dalam `describe` yang sama), tambahkan:

```ts
  // Inbox (2026-09-11): attributions dan id revisi ikut ke knowledgeRefs dan Message.botTrace tanpa
  // perubahan di berkas ini maupun di send.ts -- dua test ini yang membuktikannya.
  const attributedKnowledge = {
    catalogLines: [],
    managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
    rejected: [],
    gateBypassed: false,
    attributions: [
      { paragraph: 0, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
    ],
  }

  it('membawa knowledge.attributions ke knowledgeRefs apa adanya', () => {
    expect(knowledgeRefsForDecision({ mode: 'faq', sourceTopic: 'price', knowledge: attributedKnowledge })).toEqual({
      sourceTopic: 'price',
      knowledge: attributedKnowledge,
    })
  })

  it('sanitizeTrace tidak meredaksi sourceId, sourceKey, maupun attributions', () => {
    expect(sanitizeTrace({ knowledge: attributedKnowledge })).toEqual({ knowledge: attributedKnowledge })
  })
```

- [ ] **Step 4: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/bot/reply-attribution.test.ts src/lib/bot/orchestrator.test.ts src/lib/bot-control/decision-recorder.test.ts`
Expected: FAIL — `Failed to resolve import "./reply-attribution"`; di orchestrator.test dua test Mode 3 gagal (`attributions` tidak ada). Dua test decision-recorder baru LULUS sejak awal — itu disengaja: keduanya mengunci bahwa jalur rekam tidak perlu diubah.

- [ ] **Step 5: Implementasi — `src/lib/bot/types.ts`**

Ganti:

```ts
  alsoTopics?: string[]
}

export type BotDecision =
```

menjadi:

```ts
  alsoTopics?: string[]
  /**
   * Which knowledge lines each paragraph of the FINAL reply matches (reply-attribution.ts). A
   * system match on shared figures, URLs or words -- not the model's own citation. Absent on
   * replies stored before it existed; `[]` when nothing matched.
   */
  attributions?: ReplyAttribution[]
}

/** One knowledge/catalog line paired with a reply paragraph by `attributeReply`. */
export type AttributedLine = {
  kind: 'managed' | 'catalog'
  line: string
  sourceId?: string
  title?: string
  version?: number
}

export type ReplyAttribution = { paragraph: number; lines: AttributedLine[] }

export type BotDecision =
```

- [ ] **Step 6: Implementasi — `src/lib/bot/reply-attribution.ts`**

```ts
import { extractRupiahAmounts, extractUrls } from './reply-verifier'
import type { AttributedLine, DecisionKnowledge, ReplyAttribution } from './types'

/**
 * Paragraf balasan FINAL -> baris knowledge/katalog yang cocok. Murni dan deterministik, tanpa
 * model; hasilnya pencocokan sistem, bukan kutipan model, jadi UI menulisnya "cocok dengan".
 * BotTracePopover (klien) mengimpor `splitParagraphs` dari sini, jadi berkas ini hanya boleh
 * mengimpor modul murni -- reply-verifier.ts tidak punya impor sama sekali.
 *
 * Cocok bila SALAH SATU: nominal Rupiah sama; URL sama; atau kata isi yang sama
 * >= MIN_SHARED_CONTENT_WORDS dan >= MIN_SHARED_RATIO dari kata isi baris.
 */
export const MIN_CONTENT_WORD_LENGTH = 4
export const MIN_SHARED_CONTENT_WORDS = 3
export const MIN_SHARED_RATIO = 0.3

const AMOUNT_EPSILON = 0.5
const BULLET = /^(?:[-*•]|\d+[.)])\s+/

/** Salinan persis STOPWORDS di runtime-integration.ts, yang tidak bisa diimpor ke sini (menarik prisma). */
const STOPWORDS = new Set([
  'yang', 'untuk', 'dari', 'dengan', 'atau', 'dan', 'ada', 'apa', 'apakah', 'adakah', 'bisa',
  'bisakah', 'boleh', 'saya', 'kami', 'kita', 'anda', 'ini', 'itu', 'berapa', 'kapan', 'dimana',
  'mana', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'mohon', 'tolong', 'terima',
  'kasih', 'selamat', 'halo', 'hallo', 'sudah', 'belum', 'akan', 'juga', 'saja', 'kalau', 'jika',
  'tapi', 'tetapi', 'karena', 'tersebut', 'tentang', 'seperti', 'punya', 'ingin', 'pengen',
  'the', 'and', 'for', 'with', 'you', 'are', 'what', 'can', 'how', 'where', 'when', 'does',
  'have', 'this', 'that', 'there', 'would', 'could', 'should', 'please', 'thanks', 'hello',
  'about', 'from', 'your', 'much', 'many',
])

export function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  for (const block of text.split(/\n\s*\n/)) {
    let current: string[] = []
    for (const raw of block.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      if (BULLET.test(line) && current.length > 0) {
        paragraphs.push(current.join('\n'))
        current = []
      }
      current.push(line)
    }
    if (current.length > 0) paragraphs.push(current.join('\n'))
  }
  return paragraphs
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= MIN_CONTENT_WORD_LENGTH && !STOPWORDS.has(word))
  )
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '')
}

/** "Judul (vN)" -> "Judul". Akhiran itu dibentuk collect()/allManagedFacts() di runtime-integration.ts. */
function titleFromSource(source: string, version: number | undefined): string {
  if (version === undefined) return source
  const suffix = ` (v${version})`
  return source.endsWith(suffix) ? source.slice(0, -suffix.length) : source
}

type Candidate = { attributed: AttributedLine; words: Set<string>; amounts: number[]; urls: Set<string> }

function candidate(attributed: AttributedLine): Candidate {
  return {
    attributed,
    words: contentWords(attributed.line),
    amounts: extractRupiahAmounts(attributed.line),
    urls: new Set(extractUrls(attributed.line).map(normalizeUrl)),
  }
}

function matches(c: Candidate, words: Set<string>, amounts: number[], urls: Set<string>): boolean {
  if (amounts.some((a) => c.amounts.some((b) => Math.abs(a - b) < AMOUNT_EPSILON))) return true
  for (const url of urls) if (c.urls.has(url)) return true
  if (c.words.size === 0) return false
  let shared = 0
  for (const word of c.words) if (words.has(word)) shared += 1
  return shared >= MIN_SHARED_CONTENT_WORDS && shared / c.words.size >= MIN_SHARED_RATIO
}

export function attributeReply(replyText: string, knowledge: DecisionKnowledge): ReplyAttribution[] {
  const candidates = [
    ...knowledge.catalogLines.map((line) => candidate({ kind: 'catalog', line })),
    ...knowledge.managedLines.map((m) =>
      candidate({
        kind: 'managed',
        line: m.line,
        ...(m.sourceId !== undefined ? { sourceId: m.sourceId } : {}),
        title: titleFromSource(m.source, m.version),
        ...(m.version !== undefined ? { version: m.version } : {}),
      })
    ),
  ]

  const attributions: ReplyAttribution[] = []
  splitParagraphs(replyText).forEach((paragraph, index) => {
    const words = contentWords(paragraph)
    const amounts = extractRupiahAmounts(paragraph)
    const urls = new Set(extractUrls(paragraph).map(normalizeUrl))
    const lines = candidates.filter((c) => matches(c, words, amounts, urls)).map((c) => c.attributed)
    if (lines.length > 0) attributions.push({ paragraph: index, lines })
  })
  return attributions
}
```

Pastikan salinan stopword identik (pemeriksa mekanis, harus mencetak `STOPWORDS IDENTIK`):

```bash
node -e '
const fs=require("fs");
const grab=(f)=>{const s=fs.readFileSync(f,"utf8");const m=s.match(/const STOPWORDS = new Set\(\[([\s\S]*?)\]\)/);return [...m[1].matchAll(/'"'"'([^'"'"']+)'"'"'/g)].map(x=>x[1]).sort().join(",")};
const a=grab("src/lib/bot/runtime-integration.ts"), b=grab("src/lib/bot/reply-attribution.ts");
if(a!==b){console.error("STOPWORDS BERBEDA");process.exit(1)} console.log("STOPWORDS IDENTIK")'
```

- [ ] **Step 7: Implementasi — `src/lib/bot/orchestrator.ts`**

7a. Tepat sebelum baris `import type { BotDecision, Catalog, DecisionKnowledge, TraceStep, TripBrief } from './types'` tambahkan:

```ts
import { attributeReply } from './reply-attribution'
```

7b. Ganti seluruh fungsi:

```ts
function attachClassification(
  decision: BotDecision,
  ctx: { topic?: string; job?: string; knowledge?: DecisionKnowledge }
): BotDecision {
  return {
    ...decision,
    ...(ctx.topic !== undefined ? { topic: ctx.topic } : {}),
    ...(ctx.job !== undefined ? { job: ctx.job } : {}),
    ...(ctx.knowledge !== undefined ? { knowledge: ctx.knowledge } : {}),
  }
}
```

menjadi:

```ts
function attachClassification(
  decision: BotDecision,
  ctx: { topic?: string; job?: string; knowledge?: DecisionKnowledge }
): BotDecision {
  const knowledge = ctx.knowledge === undefined ? undefined : withAttributions(decision, ctx.knowledge)
  return {
    ...decision,
    ...(ctx.topic !== undefined ? { topic: ctx.topic } : {}),
    ...(ctx.job !== undefined ? { job: ctx.job } : {}),
    ...(knowledge !== undefined ? { knowledge } : {}),
  }
}

/**
 * Pairs the FINAL reply (whatever runDecision() returned, i.e. after composeVerifiedReply's
 * verifier) paragraph by paragraph with the knowledge it matches, here at the single attachment
 * point so Message.botTrace and BotDecisionRun.knowledgeRefs carry the same mapping. A handoff
 * has no reply to attribute.
 */
function withAttributions(decision: BotDecision, knowledge: DecisionKnowledge): DecisionKnowledge {
  const reply = decision.mode === 'faq' ? decision.draft : decision.mode === 'handoff' ? null : decision.reply
  return reply ? { ...knowledge, attributions: attributeReply(reply, knowledge) } : knowledge
}
```

- [ ] **Step 8: Jalankan, pastikan LULUS (termasuk simulator, yang tidak diubah)**

Run: `npx vitest run src/lib/bot/reply-attribution.test.ts src/lib/bot/orchestrator.test.ts src/lib/bot-control/decision-recorder.test.ts src/lib/bot-control/simulator.test.ts src/lib/send.test.ts`
Expected: PASS — termasuk test simulator yang membuktikan tidak ada `sendMessage` dan tidak ada `OutboundJob`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/bot/types.ts src/lib/bot/reply-attribution.ts src/lib/bot/reply-attribution.test.ts \
  src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts \
  src/lib/bot-control/decision-recorder.test.ts
git commit -m "$(cat <<'EOF'
feat(bot): catat paragraf balasan yang cocok dengan baris knowledge

attributeReply murni dan deterministik (nominal, URL, atau kata isi di atas ambang),
dihitung sekali di attachClassification atas teks final sesudah verifier.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 7: `BotTracePopover` — bagian Topik, Sumber per paragraf, Verifikasi

**Files:**
- Modify: `src/components/inbox/BotTracePopover.tsx` (impor baris 8, helper setelah `knowledgeOf` baris 39, nilai turunan setelah `usedFacts` baris 61, JSX setelah baris 92 dan sebelum baris 144)
- Test: `src/components/inbox/BotTracePopover.test.tsx`

**Interfaces:**
- Consumes: `splitParagraphs` (Task 6), `AttributedLine`/`DecisionKnowledge.attributions` (Task 6), `topicLabelName`/`jobLabelName` (Task 4), `type ReplyVerification` (`src/lib/bot/reply-verifier.ts:243` — `{ status: 'PASSED' | 'PASSED_AFTER_RETRY' | 'BLOCKED'; attempts; fabricatedPrices: number[]; unverifiedPrices: number[]; unknownUrls: string[]; guaranteeViolations: string[] }`).
- Produces: tidak ada API baru; props `BotTracePopover` tidak berubah (`{ trace: BotDecision | null; messageId?: string; onClose: () => void }`).

Tampilan baru (semua teks dirakit dengan template literal supaya satu node teks):
- **Topik** (setelah baris mode; hanya bila ada `topic`, `job`, atau `knowledge.alsoTopics`): `Utama: <nama> (<id>)`, `Tambahan: <nama> (<id>), …`, `Intent: <nama> (<id>)`. `booking_context` tidak punya `topic`/`job` di tipenya.
- **Sumber per paragraf** (bila keputusan punya teks balasan, yaitu bukan handoff): `attributions` absen → `Tidak tercatat untuk balasan ini.`; `[]` → `Tidak ada paragraf yang cocok dengan fakta mana pun.`; selain itu per atribusi `“<potongan paragraf ≤80>”` + `cocok dengan <sumber>; <sumber>` (managed → `Judul vN`, katalog → `Katalog`). Kata "dikutip" tidak dipakai.
- **Verifikasi** (bila `trace.verification` ada): `Status: Lolos | Lolos setelah diulang | Diblokir`, `Harga tidak bersumber: Rp…`, `Harga tidak cocok dengan fakta: Rp…`, `URL tidak dikenal: …`.
- "Fakta yang dipakai" TIDAK diubah: `source` sudah "Judul (vN)" (Keputusan 8).

- [ ] **Step 1: Tulis test yang gagal — tambahkan di akhir `src/components/inbox/BotTracePopover.test.tsx`**

```tsx
describe('BotTracePopover — Topik, Sumber per paragraf, Verifikasi', () => {
  it('menampilkan topik utama, topik tambahan, dan intent dengan nama dan id mentahnya', () => {
    render(
      <BotTracePopover
        trace={{
          mode: 'faq',
          draft: 'x',
          sourceTopic: 'payment',
          topic: 'payment',
          job: 'J2',
          knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, alsoTopics: ['blue_fire'] },
        }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Topik')).toBeInTheDocument()
    expect(screen.getByText('Utama: Pembayaran (payment)')).toBeInTheDocument()
    expect(screen.getByText('Tambahan: Blue fire (blue_fire)')).toBeInTheDocument()
    expect(screen.getByText('Intent: Harga & nilai (J2)')).toBeInTheDocument()
  })

  it('tanpa bagian Topik bila keputusan tidak membawa klasifikasi', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} onClose={() => {}} />)
    expect(screen.queryByText('Topik')).not.toBeInTheDocument()
  })

  it('menampilkan potongan setiap paragraf dengan sumber yang cocok, tanpa kata "dikutip"', () => {
    render(
      <BotTracePopover
        trace={{
          mode: 'faq',
          draft: 'Halo kak!\n\nHarga ATV Rp350.000 per jam.\n\n- Semua paket termasuk transport privat.',
          sourceTopic: 'price',
          knowledge: {
            catalogLines: ['Every package includes private transport.'],
            managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
            rejected: [],
            gateBypassed: false,
            attributions: [
              { paragraph: 1, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
              { paragraph: 2, lines: [{ kind: 'catalog', line: 'Every package includes private transport.' }] },
            ],
          },
        }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Sumber per paragraf')).toBeInTheDocument()
    expect(screen.getByText('“Harga ATV Rp350.000 per jam.”')).toBeInTheDocument()
    expect(screen.getByText('cocok dengan FAQ Harga ATV v2')).toBeInTheDocument()
    expect(screen.getByText('“- Semua paket termasuk transport privat.”')).toBeInTheDocument()
    expect(screen.getByText('cocok dengan Katalog')).toBeInTheDocument()
    expect(screen.queryByText(/dikutip/i)).not.toBeInTheDocument()
  })

  it('balasan lama tanpa attributions: "tidak tercatat"', () => {
    render(
      <BotTracePopover
        trace={{
          mode: 'clarify',
          reply: 'Anda tertarik ke mana?',
          knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false },
        }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Tidak tercatat untuk balasan ini.')).toBeInTheDocument()
  })

  it('attributions kosong: tidak ada paragraf yang cocok', () => {
    render(
      <BotTracePopover
        trace={{
          mode: 'booking_context',
          reply: 'Booking Anda berangkat 5 Agustus.',
          knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, attributions: [] },
        }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Tidak ada paragraf yang cocok dengan fakta mana pun.')).toBeInTheDocument()
  })

  it('handoff tidak punya bagian Sumber per paragraf', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} onClose={() => {}} />)
    expect(screen.queryByText('Sumber per paragraf')).not.toBeInTheDocument()
  })

  it('menampilkan hasil verifikasi: status, harga tak bersumber, harga tak cocok, URL tak dikenal', () => {
    render(
      <BotTracePopover
        trace={{
          mode: 'faq',
          draft: 'x',
          sourceTopic: 'price',
          verification: {
            status: 'BLOCKED',
            attempts: 2,
            fabricatedPrices: [350000],
            unverifiedPrices: [1250000],
            unknownUrls: ['https://contoh.invalid/x'],
            guaranteeViolations: [],
          },
        }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Verifikasi')).toBeInTheDocument()
    expect(screen.getByText('Status: Diblokir')).toBeInTheDocument()
    expect(screen.getByText('Harga tidak bersumber: Rp350.000')).toBeInTheDocument()
    expect(screen.getByText('Harga tidak cocok dengan fakta: Rp1.250.000')).toBeInTheDocument()
    expect(screen.getByText('URL tidak dikenal: https://contoh.invalid/x')).toBeInTheDocument()
  })

  it('tanpa bagian Verifikasi bila giliran itu tidak diverifikasi', () => {
    render(<BotTracePopover trace={{ mode: 'clarify', reply: 'x' }} onClose={() => {}} />)
    expect(screen.queryByText('Verifikasi')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/inbox/BotTracePopover.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Topik` (dan teks baru lainnya); test lama tetap lulus.

- [ ] **Step 3: Implementasi — impor dan helper di `BotTracePopover.tsx`**

Ganti baris:

```ts
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'
```

menjadi:

```ts
import type { AttributedLine, BotDecision, DecisionKnowledge } from '@/lib/bot/types'
import type { ReplyVerification } from '@/lib/bot/reply-verifier'
import { splitParagraphs } from '@/lib/bot/reply-attribution'
import { jobLabelName, topicLabelName } from '@/lib/inbox/label-names'
```

Tepat setelah fungsi `knowledgeOf` (setelah `}` penutupnya, sebelum `export function BotTracePopover({`), sisipkan:

```ts
function replyTextOf(trace: BotDecision | null): string | null {
  if (!trace || trace.mode === 'handoff') return null
  return trace.mode === 'faq' ? trace.draft : trace.reply
}

/** `booking_context` never carries topic/job (see BotDecision in types.ts). */
function classificationOf(trace: BotDecision | null): { topic?: string; job?: string } {
  if (!trace || trace.mode === 'booking_context') return {}
  return { topic: trace.topic, job: trace.job }
}

const VERIFICATION_STATUS_LABEL: Record<ReplyVerification['status'], string> = {
  PASSED: 'Lolos',
  PASSED_AFTER_RETRY: 'Lolos setelah diulang',
  BLOCKED: 'Diblokir',
}

function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`
}

function excerpt(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function attributedSourceLabel(line: AttributedLine): string {
  if (line.kind === 'catalog') return 'Katalog'
  if (line.title && line.version !== undefined) return `${line.title} v${line.version}`
  return line.title ?? 'Knowledge'
}

```

- [ ] **Step 4: Implementasi — nilai turunan di dalam komponen**

Tepat setelah blok `const usedFacts = knowledge ? [...] : []` (berakhir di baris `    : []`), tambahkan:

```ts
  const replyText = replyTextOf(trace)
  const paragraphs = replyText ? splitParagraphs(replyText) : []
  const { topic, job } = classificationOf(trace)
  const alsoTopics = knowledge?.alsoTopics ?? []
  const attributions = knowledge?.attributions
  const verification = trace?.verification
```

- [ ] **Step 5: Implementasi — JSX bagian Topik**

Ganti baris:

```tsx
      {trace?.mode === 'clarify' && <p>Destinasi belum diketahui -- bot menanyakan ke pelanggan.</p>}
```

menjadi:

```tsx
      {trace?.mode === 'clarify' && <p>Destinasi belum diketahui -- bot menanyakan ke pelanggan.</p>}

      {(topic || job || alsoTopics.length > 0) && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="font-medium text-ink">Topik</p>
          {topic && <p className="text-ink-muted">{`Utama: ${topicLabelName(topic)} (${topic})`}</p>}
          {alsoTopics.length > 0 && (
            <p className="text-ink-muted">{`Tambahan: ${alsoTopics.map((t) => `${topicLabelName(t)} (${t})`).join(', ')}`}</p>
          )}
          {job && <p className="text-ink-muted">{`Intent: ${jobLabelName(job)} (${job})`}</p>}
        </div>
      )}
```

- [ ] **Step 6: Implementasi — JSX Sumber per paragraf dan Verifikasi**

Ganti:

```tsx
      {runId && (
        <Link
```

menjadi:

```tsx
      {/* Pencocokan sistem (reply-attribution.ts), bukan kutipan model -- karena itu "cocok dengan". */}
      {replyText !== null && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <p className="font-medium text-ink">Sumber per paragraf</p>
          {attributions === undefined ? (
            <p className="text-ink-muted">Tidak tercatat untuk balasan ini.</p>
          ) : attributions.length === 0 ? (
            <p className="text-ink-muted">Tidak ada paragraf yang cocok dengan fakta mana pun.</p>
          ) : (
            <ul className="space-y-1">
              {attributions.map((attribution) => (
                <li key={attribution.paragraph} className="space-x-1">
                  <span className="text-ink">{`“${excerpt(paragraphs[attribution.paragraph] ?? '')}”`}</span>
                  <span className="text-ink-subtle">{`cocok dengan ${attribution.lines.map(attributedSourceLabel).join('; ')}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verification && (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="font-medium text-ink">Verifikasi</p>
          <p className="text-ink-muted">{`Status: ${VERIFICATION_STATUS_LABEL[verification.status] ?? verification.status}`}</p>
          {verification.fabricatedPrices.length > 0 && (
            <p className="text-ink-muted">{`Harga tidak bersumber: ${verification.fabricatedPrices.map(formatRupiah).join(', ')}`}</p>
          )}
          {verification.unverifiedPrices.length > 0 && (
            <p className="text-ink-muted">{`Harga tidak cocok dengan fakta: ${verification.unverifiedPrices.map(formatRupiah).join(', ')}`}</p>
          )}
          {verification.unknownUrls.length > 0 && (
            <p className="break-all text-ink-muted">{`URL tidak dikenal: ${verification.unknownUrls.join(', ')}`}</p>
          )}
        </div>
      )}

      {runId && (
        <Link
```

- [ ] **Step 7: Jalankan, pastikan LULUS**

Run: `npx vitest run src/components/inbox/BotTracePopover.test.tsx src/components/inbox/MessageBubble.test.tsx`
Expected: PASS — termasuk seluruh test lama (mis. "Kebijakan Pembayaran (v3)" masih tampil, dan `queryByRole('list')` pada handoff tetap kosong).

- [ ] **Step 8: Commit**

```bash
git add src/components/inbox/BotTracePopover.tsx src/components/inbox/BotTracePopover.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): popover alasan bot menampilkan topik, sumber per paragraf, dan verifikasi

Sumber per paragraf ditulis "cocok dengan" karena itu pencocokan sistem, bukan kutipan
model; balasan lama tanpa pemetaan menampilkan "tidak tercatat".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 8: `GET /api/inbox/knowledge/[sourceId]`, `POST /api/inbox/decisions/[id]/fix`, dan amandemen CLAUDE.md §6

**Files:**
- Create: `src/app/api/inbox/knowledge/[sourceId]/route.ts` (+ `route.test.ts`)
- Create: `src/app/api/inbox/decisions/[id]/fix/route.ts` (+ `route.test.ts`)
- Modify: `CLAUDE.md` §6 (setelah butir 5)

**Interfaces:**
- Consumes (semua sudah ada, tidak diubah):
  - `getSession` (`src/lib/auth/get-session.ts:23`); `parseJsonBody<T>(req: Request, schema: ZodType<T>, invalidBodyMessage?: string): Promise<{ success: true; data: T } | { success: false; error: string }>` (`src/lib/parse-json.ts:20`)
  - `knowledgeItemSchema`, `readKnowledgeBody(value: unknown): ManagedKnowledgeBody | null` (`src/lib/bot-control/knowledge-body.ts:42,96`)
  - dari `src/lib/bot-control/knowledge-workflow.ts`: `type Actor = { id: string; name: string | null }`; `createManagedKnowledge(params: CreateSourceParams, actor: Actor): Promise<RevisionResult>`; `saveKnowledgeDraft(sourceId: string, params: SaveDraftParams, actor: Actor): Promise<RevisionResult>`; `publishKnowledgeRevision(sourceId: string, actor: Actor, reason: string | null): Promise<RevisionResult>`; `RevisionResult = { sourceId; revisionId; version; status; title }`; `MANAGED_SOURCE_TYPE`; `KnowledgeNotFoundError`, `KnowledgeNotEditableError`, `KnowledgeTransitionError`
  - `publishKnowledgeRevision` sudah menulis audit `PUBLISH` di dalam transaksinya lewat `writeBotAuditLog` (yang menjalankan `sanitizeTrace` atas `reason`) dan membuang cache knowledge.
- Produces:
  - `GET(req, { params: Promise<{ sourceId: string }> })` → 200 `{ title: string; summary: string | null; items: KnowledgeItem[]; version: number }` dari revisi `PUBLISHED` terkini sumber `MANUAL` yang tidak diarsipkan; 401 / 404 / 422 (isi tak terbaca) / 500, semua `{ error }`.
  - `POST(req, { params: Promise<{ id: string }> })` dengan body union:
    - `{ kind: 'edit'; sourceId: string; title: string; summary?: string; items: KnowledgeItem[] (1–200); reason: string (10–2000) }`
    - `{ kind: 'new'; title: string; summary?: string; items: KnowledgeItem[]; reason: string }`
    - → 200 `RevisionResult & { flagged: boolean }`; 400 (Zod, sumber non-MANUAL, `sourceId` tidak dipakai run itu); 401; 404 (run atau sumber tidak ada); 409 (entri punya draft yang belum diaktifkan, atau transisi ditolak); 500.

Otorisasi: hanya `getSession` — pengecualian §6 yang dicatat di langkah terakhir task ini. Aktor = akun sesi (`name` diambil dari `prisma.account`, pola `create-knowledge-draft/route.ts:62`). Penandaan run (`flaggedAt = now`, `flagNote = reason`) dilakukan SETELAH revisi aktif dan kegagalannya hanya menghasilkan `flagged: false`.

- [ ] **Step 1: Tulis test yang gagal — `src/app/api/inbox/knowledge/[sourceId]/route.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = { params: Promise.resolve({ sourceId: 'ks_1' }) }
const ITEMS = [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000 per orang.' }]

function req(withSession = true) {
  return new Request('http://localhost/api/inbox/knowledge/ks_1', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeRevision.findFirst.mockResolvedValue({ title: 'FAQ Harga ATV', summary: null, body: { items: ITEMS }, version: 3 } as never)
})

describe('GET /api/inbox/knowledge/[sourceId]', () => {
  it('mengembalikan revisi PUBLISHED terkini untuk semua yang login, termasuk AGENT', async () => {
    const res = await GET(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: 'FAQ Harga ATV', summary: null, items: ITEMS, version: 3 })
    expect(mockPrisma.knowledgeRevision.findFirst).toHaveBeenCalledWith({
      where: {
        knowledgeSourceId: 'ks_1',
        status: 'PUBLISHED',
        knowledgeSource: { type: 'MANUAL', status: { not: 'ARCHIVED' } },
      },
      orderBy: { version: 'desc' },
      select: { title: true, summary: true, body: true, version: true },
    })
  })

  it('401 tanpa sesi, tanpa menyentuh database', async () => {
    const res = await GET(req(false), params)
    expect(res.status).toBe(401)
    expect(mockPrisma.knowledgeRevision.findFirst).not.toHaveBeenCalled()
  })

  it('404 bila tidak ada revisi aktif', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(null as never)
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Entri knowledge aktif tidak ditemukan' })
  })

  it('422 bila isi revisi tidak terbaca build ini', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue({ title: 'X', summary: null, body: { foo: 1 }, version: 1 } as never)
    const res = await GET(req(), params)
    expect(res.status).toBe(422)
  })

  it('500 dengan bentuk { error } bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeRevision.findFirst.mockRejectedValue(new Error('db down'))
    const res = await GET(req(), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat entri knowledge' })
  })
})
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run "src/app/api/inbox/knowledge/[sourceId]/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Implementasi — `src/app/api/inbox/knowledge/[sourceId]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readKnowledgeBody } from '@/lib/bot-control/knowledge-body'
import { MANAGED_SOURCE_TYPE } from '@/lib/bot-control/knowledge-workflow'

/**
 * Isi revisi PUBLISHED terkini satu entri, untuk panel perbaikan di Inbox. Terbuka untuk semua
 * yang login: yang dibaca adalah apa yang bot sudah katakan ke pelanggan, bukan draft.
 */
export async function GET(req: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { sourceId } = await params

  try {
    const revision = await prisma.knowledgeRevision.findFirst({
      where: {
        knowledgeSourceId: sourceId,
        status: 'PUBLISHED',
        knowledgeSource: { type: MANAGED_SOURCE_TYPE, status: { not: 'ARCHIVED' } },
      },
      orderBy: { version: 'desc' },
      select: { title: true, summary: true, body: true, version: true },
    })
    if (!revision) return NextResponse.json({ error: 'Entri knowledge aktif tidak ditemukan' }, { status: 404 })

    const body = readKnowledgeBody(revision.body)
    if (!body) {
      return NextResponse.json({ error: 'Isi entri ini tidak terbaca oleh versi aplikasi ini' }, { status: 422 })
    }

    return NextResponse.json({ title: revision.title, summary: revision.summary, items: body.items, version: revision.version })
  } catch (error) {
    console.error('GET /api/inbox/knowledge/[sourceId] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat entri knowledge' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `npx vitest run "src/app/api/inbox/knowledge/[sourceId]/route.test.ts"`
Expected: PASS (5 test).

- [ ] **Step 5: Tulis test yang gagal — `src/app/api/inbox/decisions/[id]/fix/route.test.ts`**

Test ini memakai `knowledge-workflow.ts` ASLI di atas prisma tiruan (pola `knowledge-workflow.test.ts`), supaya penjaga MANUAL dan tulisan audit yang diuji adalah yang sungguhan.

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { classifyFactTopics } from '@/lib/bot/fact-topic-classifier'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))
vi.mock('@/lib/bot/fact-topic-classifier', () => ({ classifyFactTopics: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const mockTx = mockDeep<Prisma.TransactionClient>()
const params = { params: Promise.resolve({ id: 'run_1' }) }
const REASON = 'Harga ATV sudah naik sejak Agustus'
const ITEMS = [{ question: 'Berapa harga ATV?', answer: 'ATV 1 jam Rp400.000 per orang.', topics: ['price'] }]
const INVALID = 'Data perbaikan tidak valid; isi minimal satu item dan alasan minimal 10 karakter'

const EDIT = { kind: 'edit', sourceId: 'ks_1', title: 'FAQ Harga ATV', summary: '', items: ITEMS, reason: REASON }
const NEW = { kind: 'new', title: 'Harga ATV terbaru', items: ITEMS, reason: REASON }

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/inbox/decisions/run_1/fix', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

function source(overrides: Record<string, unknown> = {}) {
  return { id: 'ks_1', key: 'managed/atv', title: 'FAQ Harga ATV', type: 'MANUAL', status: 'PUBLISHED', summary: null, ...overrides } as never
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'krev_3',
    knowledgeSourceId: 'ks_1',
    version: 3,
    title: 'FAQ Harga ATV',
    summary: null,
    body: { items: ITEMS },
    status: 'PUBLISHED',
    changeReason: null,
    ...overrides,
  } as never
}

const runWithSource = {
  id: 'run_1',
  knowledgeRefs: {
    knowledge: {
      managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v3)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 3 }],
    },
  },
}

beforeEach(() => {
  mockReset(mockPrisma)
  mockReset(mockTx)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  vi.mocked(classifyFactTopics).mockResolvedValue([])
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    (arg as (tx: Prisma.TransactionClient) => Promise<unknown>)(mockTx)
  )
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Budi' } as never)
  mockPrisma.botDecisionRun.findUnique.mockResolvedValue(runWithSource as never)
  mockPrisma.botDecisionRun.update.mockResolvedValue({ id: 'run_1' } as never)
  mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source())
  mockPrisma.knowledgeRevision.create.mockResolvedValue(revision({ id: 'krev_4', version: 4, status: 'DRAFT' }))
  mockTx.knowledgeRevision.updateMany.mockResolvedValue({ count: 1 } as never)
  mockTx.knowledgeSource.update.mockResolvedValue(source())
})

describe('POST /api/inbox/decisions/[id]/fix — umum', () => {
  it('401 tanpa sesi, tanpa membaca apa pun', async () => {
    const res = await POST(req(EDIT, false), params)
    expect(res.status).toBe(401)
    expect(mockPrisma.botDecisionRun.findUnique).not.toHaveBeenCalled()
  })

  it('400 lewat Zod: alasan pendek, item kosong, kind asing, atau field tambahan', async () => {
    for (const body of [
      { ...EDIT, reason: 'pendek' },
      { ...NEW, items: [] },
      { ...NEW, kind: 'hapus' },
      { ...NEW, status: 'PUBLISHED' },
    ]) {
      const res = await POST(req(body), params)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: INVALID })
    }
    expect(mockPrisma.botDecisionRun.findUnique).not.toHaveBeenCalled()
  })

  it('404 bila keputusan tidak ada', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Keputusan tidak ditemukan.' })
  })
})

describe("POST /api/inbox/decisions/[id]/fix — kind: 'edit'", () => {
  beforeEach(() => {
    // 1) penjaga draft di route, 2) saveKnowledgeDraft, 3) publishKnowledgeRevision.
    mockPrisma.knowledgeRevision.findFirst
      .mockResolvedValueOnce(revision())
      .mockResolvedValueOnce(revision())
      .mockResolvedValueOnce(revision({ id: 'krev_4', version: 4, status: 'DRAFT' }))
    mockTx.knowledgeRevision.update.mockResolvedValue(revision({ id: 'krev_4', version: 4, status: 'PUBLISHED' }))
  })

  it('terbuka untuk AGENT: menyimpan revisi baru lalu mengaktifkannya, dengan audit PUBLISH', async () => {
    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sourceId: 'ks_1',
      revisionId: 'krev_4',
      version: 4,
      status: 'PUBLISHED',
      title: 'FAQ Harga ATV',
      flagged: true,
    })
    expect(mockPrisma.knowledgeRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ knowledgeSourceId: 'ks_1', version: 4, status: 'DRAFT', changeReason: REASON, createdBy: 'acc_agent' }),
      })
    )
    expect(mockTx.knowledgeRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'krev_4' }, data: expect.objectContaining({ status: 'PUBLISHED', publishedBy: 'acc_agent' }) })
    )
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityType: 'KNOWLEDGE', entityId: 'ks_1', actorId: 'acc_agent', actorName: 'Budi', reason: REASON }),
      mockTx
    )
  })

  it('menandai run: flaggedAt sekarang, flagNote = alasan', async () => {
    await POST(req(EDIT), params)

    const arg = mockPrisma.botDecisionRun.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'run_1' })
    expect(arg.data).toMatchObject({ flagNote: REASON })
    expect(arg.data.flaggedAt).toBeInstanceOf(Date)
  })

  it('penandaan gagal: respons flagged false, revisi tetap aktif', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.botDecisionRun.update.mockRejectedValue(new Error('db down'))

    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ version: 4, status: 'PUBLISHED', flagged: false })
    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'PUBLISH' }), mockTx)
  })

  it('penjaga MANUAL tetap utuh: sumber non-MANUAL ditolak tanpa revisi, aktivasi, audit, atau tanda', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ type: 'CATALOG' }))

    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/bertipe CATALOG/)
    expect(mockPrisma.knowledgeRevision.create).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockTx.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(writeBotAuditLog).not.toHaveBeenCalled()
    expect(mockPrisma.botDecisionRun.update).not.toHaveBeenCalled()
  })

  it('menolak sourceId yang tidak dipakai jawaban itu', async () => {
    const res = await POST(req({ ...EDIT, sourceId: 'ks_lain' }), params)
    expect(res.status).toBe(400)
    expect(mockPrisma.knowledgeSource.findUnique).not.toHaveBeenCalled()
  })

  it('menolak edit untuk run lama yang managedLines-nya belum membawa sourceId', async () => {
    mockPrisma.botDecisionRun.findUnique.mockResolvedValue({
      id: 'run_1',
      knowledgeRefs: { knowledge: { managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v3)' }] } },
    } as never)
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(400)
  })

  it('409 bila entri punya draft yang belum diaktifkan, supaya draft itu tidak tertimpa', async () => {
    mockPrisma.knowledgeRevision.findFirst.mockReset()
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValueOnce(revision({ id: 'krev_4', version: 4, status: 'DRAFT' }))

    const res = await POST(req(EDIT), params)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/draft v4/)
    expect(mockPrisma.knowledgeRevision.update).not.toHaveBeenCalled()
    expect(mockPrisma.knowledgeRevision.create).not.toHaveBeenCalled()
    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })

  it('404 bila sumber tidak ada', async () => {
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Knowledge tidak ditemukan.' })
  })

  it('500 dengan bentuk { error } bila aktivasi gagal di tengah jalan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTx.knowledgeRevision.updateMany.mockRejectedValue(new Error('db down'))
    const res = await POST(req(EDIT), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menyimpan perbaikan' })
  })
})

describe("POST /api/inbox/decisions/[id]/fix — kind: 'new'", () => {
  beforeEach(() => {
    mockTx.knowledgeSource.create.mockResolvedValue(source({ id: 'ks_new', key: 'managed/new', status: 'DRAFT', title: 'Harga ATV terbaru' }))
    mockTx.knowledgeRevision.create.mockResolvedValue(
      revision({ id: 'krev_new', knowledgeSourceId: 'ks_new', version: 1, status: 'DRAFT', title: 'Harga ATV terbaru' })
    )
    mockPrisma.knowledgeSource.findUnique.mockResolvedValue(source({ id: 'ks_new', key: 'managed/new', status: 'DRAFT' }))
    mockPrisma.knowledgeRevision.findFirst.mockResolvedValue(
      revision({ id: 'krev_new', knowledgeSourceId: 'ks_new', version: 1, status: 'DRAFT', title: 'Harga ATV terbaru' })
    )
    mockTx.knowledgeRevision.update.mockResolvedValue(
      revision({ id: 'krev_new', knowledgeSourceId: 'ks_new', version: 1, status: 'PUBLISHED', title: 'Harga ATV terbaru' })
    )
  })

  it('membuat entri MANUAL baru lalu mengaktifkannya, dengan audit PUBLISH dan tanda', async () => {
    const res = await POST(req(NEW), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sourceId: 'ks_new',
      revisionId: 'krev_new',
      version: 1,
      status: 'PUBLISHED',
      title: 'Harga ATV terbaru',
      flagged: true,
    })
    expect(mockTx.knowledgeSource.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'MANUAL', title: 'Harga ATV terbaru', createdBy: 'acc_agent' }) })
    )
    expect(writeBotAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH', entityId: 'ks_new', reason: REASON }),
      mockTx
    )
    expect(mockPrisma.botDecisionRun.update).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Jalankan, pastikan GAGAL**

Run: `npx vitest run "src/app/api/inbox/decisions/[id]/fix/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 7: Implementasi — `src/app/api/inbox/decisions/[id]/fix/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { knowledgeItemSchema } from '@/lib/bot-control/knowledge-body'
import {
  createManagedKnowledge,
  publishKnowledgeRevision,
  saveKnowledgeDraft,
  KnowledgeNotEditableError,
  KnowledgeNotFoundError,
  KnowledgeTransitionError,
  type Actor,
} from '@/lib/bot-control/knowledge-workflow'

const content = {
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000).optional(),
  items: z.array(knowledgeItemSchema).min(1).max(200),
  reason: z.string().trim().min(10).max(2000),
}

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('edit'), sourceId: z.string().trim().min(1), ...content }).strict(),
  z.object({ kind: z.literal('new'), ...content }).strict(),
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** sourceId setiap baris knowledge terkelola yang dipakai run ini (knowledgeRefs.knowledge.managedLines). */
function usedSourceIds(knowledgeRefs: unknown): Set<string> {
  const ids = new Set<string>()
  if (!isRecord(knowledgeRefs) || !isRecord(knowledgeRefs.knowledge)) return ids
  const lines = knowledgeRefs.knowledge.managedLines
  if (!Array.isArray(lines)) return ids
  for (const line of lines) {
    if (isRecord(line) && typeof line.sourceId === 'string') ids.add(line.sourceId)
  }
  return ids
}

/**
 * Perbaikan jawaban bot dari Inbox: simpan lalu aktifkan, dalam satu permintaan. Terbuka untuk
 * semua yang login (CLAUDE.md §6, pengecualian tunggal) karena setiap simpan berversi, dapat
 * dikembalikan, dan tercatat di audit log oleh publishKnowledgeRevision.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  const parsed = await parseJsonBody(
    req,
    bodySchema,
    'Data perbaikan tidak valid; isi minimal satu item dan alasan minimal 10 karakter'
  )
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const input = parsed.data

  try {
    const run = await prisma.botDecisionRun.findUnique({ where: { id }, select: { id: true, knowledgeRefs: true } })
    if (!run) return NextResponse.json({ error: 'Keputusan tidak ditemukan.' }, { status: 404 })

    const account = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const actor: Actor = { id: session.accountId, name: account?.name ?? null }
    const fields = {
      title: input.title,
      summary: input.summary ? input.summary : null,
      body: { items: input.items },
      reason: input.reason,
    }

    let sourceId: string
    if (input.kind === 'edit') {
      if (!usedSourceIds(run.knowledgeRefs).has(input.sourceId)) {
        return NextResponse.json(
          { error: 'Entri ini tidak dipakai pada jawaban tersebut, jadi tidak diperbaiki dari sini.' },
          { status: 400 }
        )
      }
      // saveKnowledgeDraft MENIMPA draft yang ada, dan publish lalu mengaktifkannya -- tulisan
      // operator yang belum selesai tidak boleh hilang lewat jalan pintas ini.
      const latest = await prisma.knowledgeRevision.findFirst({
        where: { knowledgeSourceId: input.sourceId },
        orderBy: { version: 'desc' },
        select: { version: true, status: true },
      })
      if (latest?.status === 'DRAFT') {
        return NextResponse.json(
          {
            error: `Entri ini punya draft v${latest.version} yang belum diaktifkan. Selesaikan draft itu di halaman Knowledge dulu supaya tidak tertimpa.`,
          },
          { status: 409 }
        )
      }
      sourceId = (await saveKnowledgeDraft(input.sourceId, fields, actor)).sourceId
    } else {
      sourceId = (await createManagedKnowledge(fields, actor)).sourceId
    }

    const published = await publishKnowledgeRevision(sourceId, actor, input.reason)

    // Metadata triase saja: revisi di atas sudah aktif apa pun hasil penandaan ini.
    let flagged = true
    try {
      await prisma.botDecisionRun.update({ where: { id: run.id }, data: { flaggedAt: new Date(), flagNote: input.reason } })
    } catch (error) {
      console.error('POST /api/inbox/decisions/[id]/fix: penandaan run gagal', { runId: run.id, error })
      flagged = false
    }

    return NextResponse.json({ ...published, flagged })
  } catch (error) {
    if (error instanceof KnowledgeNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    if (error instanceof KnowledgeNotEditableError) return NextResponse.json({ error: error.message }, { status: 400 })
    if (error instanceof KnowledgeTransitionError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('POST /api/inbox/decisions/[id]/fix gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan perbaikan' }, { status: 500 })
  }
}
```

- [ ] **Step 8: Jalankan, pastikan LULUS (termasuk test workflow yang tidak diubah)**

Run: `npx vitest run "src/app/api/inbox/decisions/[id]/fix/route.test.ts" "src/app/api/inbox/knowledge/[sourceId]/route.test.ts" src/lib/bot-control/knowledge-workflow.test.ts`
Expected: PASS.

- [ ] **Step 9: Amandemen `CLAUDE.md` §6**

Ganti:

```markdown
5. Transaksi Prisma kalau ada lebih dari satu tulisan yang harus konsisten. Saat dipanggil
   dengan client transaksi, tulisan audit **melempar**; saat standalone, ia ditelan.
```

menjadi:

```markdown
5. Transaksi Prisma kalau ada lebih dari satu tulisan yang harus konsisten. Saat dipanggil
   dengan client transaksi, tulisan audit **melempar**; saat standalone, ia ditelan.

Pengecualian tunggal untuk langkah 2: perbaikan knowledge dari Inbox
(`POST /api/inbox/decisions/[id]/fix`) terbuka untuk semua yang login karena setiap simpan
berversi, dapat dikembalikan, dan tercatat di audit log — route knowledge lainnya tetap lewat
`hasAdminPowers()`.
```

Verifikasi mekanis:

```bash
test "$(grep -c 'POST /api/inbox/decisions/\[id\]/fix' CLAUDE.md)" = 1 && echo "AMANDEMEN OK"
```

Expected: `AMANDEMEN OK`.

- [ ] **Step 10: Commit**

```bash
git add "src/app/api/inbox/knowledge/[sourceId]/route.ts" "src/app/api/inbox/knowledge/[sourceId]/route.test.ts" \
  "src/app/api/inbox/decisions/[id]/fix/route.ts" "src/app/api/inbox/decisions/[id]/fix/route.test.ts" \
  CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(inbox): route perbaikan jawaban bot dan pembaca revisi aktif

Simpan lalu aktifkan lewat jalur knowledge-workflow yang sudah ada (audit PUBLISH, penjaga
MANUAL utuh), lalu tandai run. Edit dibatasi ke entri yang dipakai jawaban itu dan ditolak
bila ada draft yang belum diaktifkan. CLAUDE.md §6 mencatat pengecualian aksesnya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 9: `FixAnswerPanel`, prop `activateOnly` di `KnowledgeEditor`, dan ikon "Perbaiki" di `MessageBubble`

**Files:**
- Modify: `src/components/bot-control/KnowledgeEditor.tsx:39-54` (props), `:87-90` (kalimat pembuka), `:198-205` (tombol draft)
- Create: `src/components/inbox/FixAnswerPanel.tsx`
- Modify: `src/components/inbox/MessageBubble.tsx` (impor ikon & panel, state, render panel, ikon di footer)
- Test: `src/components/bot-control/KnowledgeEditor.test.tsx`, `src/components/inbox/FixAnswerPanel.test.tsx`, `src/components/inbox/MessageBubble.test.tsx`

**Interfaces:**
- Consumes:
  - `KnowledgeEditor` props lama: `{ initial: KnowledgeDraft; title: string; saving: boolean; error: string | null; onCancel: () => void; onSave: (draft: KnowledgeDraft, reason: string, activate: boolean) => void }`; `type KnowledgeDraft = { title: string; summary: string; items: KnowledgeItem[] }`
  - `Modal({ onClose, className, children })` (`src/components/ui/modal.tsx` — tanpa `isOpen`/`title`; pemanggil yang merender kondisional)
  - `GET /api/bot-control/decisions?messageId=…&limit=1` → `{ items: Array<{ id: string }> }` dan `GET /api/bot-control/decisions/[id]` → `{ id; inboundText: string; replyText: string | null; … }` (keduanya hanya butuh sesi)
  - `GET /api/inbox/knowledge/[sourceId]` dan `POST /api/inbox/decisions/[id]/fix` (Task 8)
  - `DecisionKnowledge.managedLines[].sourceId?` (Task 5)
- Produces:
  - `KnowledgeEditor` prop baru `activateOnly?: boolean` (default `false`): menyembunyikan "Simpan draft" dan mengganti kalimat pembuka. Tanpa prop, perilaku identik — dibuktikan oleh seluruh test lama `KnowledgeEditor.test.tsx` yang tidak diubah.
  - `export function FixAnswerPanel(props: { messageId: string; trace: BotDecision | null; replyText: string | null; onClose: () => void }): JSX.Element`

Alur panel: muat run (list → detail) → tampilkan pertanyaan pelanggan, jawaban bot, "Knowledge yang dipakai" (unik per `sourceId`; baris lama tanpa `sourceId` tampil tanpa tombol Edit) → **Edit** memuat revisi PUBLISHED terkini lalu merender `KnowledgeEditor` (menggantikan modal panel, tidak bertumpuk) → **Tambah jawaban yang benar** membuka editor berisi satu item `{ question: inboundText, answer: '' }` → simpan = `POST …/fix` → panel kembali dengan `Aktif: <judul> v<N>` dan status penandaan.

- [ ] **Step 1: Tulis test yang gagal — `src/components/bot-control/KnowledgeEditor.test.tsx`**

Tambahkan di dalam `describe('KnowledgeEditor', ...)`, setelah test terakhirnya:

```tsx
  it('activateOnly: hanya "Simpan & aktifkan", dan tidak menjanjikan draft', () => {
    renderEditor({ activateOnly: true })
    expect(screen.getByRole('button', { name: 'Simpan & aktifkan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simpan draft' })).not.toBeInTheDocument()
    expect(screen.queryByText(/bot belum membacanya/i)).not.toBeInTheDocument()
    expect(screen.getByText('Tersimpan langsung aktif: bot memakainya mulai pesan berikutnya.')).toBeInTheDocument()
  })

  it('activateOnly: menyimpan selalu dengan activate = true', () => {
    const { onSave } = renderEditor({ activateOnly: true })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))
    expect(onSave).toHaveBeenCalledWith(draft(), REASON, true)
  })
```

- [ ] **Step 2: Tulis test yang gagal — `src/components/inbox/FixAnswerPanel.test.tsx`**

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { FixAnswerPanel } from './FixAnswerPanel'
import type { BotDecision } from '@/lib/bot/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const REASON = 'Harga ATV sudah naik sejak Agustus'
const QUESTION = 'Berapa harga ATV sekarang?'

const trace: BotDecision = {
  mode: 'faq',
  draft: 'Harga ATV Rp350.000.',
  sourceTopic: 'price',
  knowledge: {
    catalogLines: [],
    managedLines: [
      { line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v3)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 3 },
      { line: 'Berapa harga ATV? — Mulai Rp350.000.', source: 'FAQ Harga ATV (v3)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 3 },
      { line: 'Cuaca dingin -- bawa jaket.', source: 'Info Umum (v1)' },
    ],
    rejected: [],
    gateBypassed: false,
  },
}

type Route = { status?: number; body: unknown }

/** Kunci = "<METHOD> <url>"; permintaan yang tidak terdaftar membuat test gagal keras. */
function stubFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    const route = routes[key]
    if (!route) throw new Error(`fetch tak terduga: ${key}`)
    const status = route.status ?? 200
    return { ok: status < 400, status, json: async () => route.body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const RUN_ROUTES: Record<string, Route> = {
  'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { body: { items: [{ id: 'run_1' }] } },
  'GET /api/bot-control/decisions/run_1': { body: { id: 'run_1', inboundText: QUESTION, replyText: 'Harga ATV Rp350.000.' } },
}

function renderPanel() {
  render(<FixAnswerPanel messageId="msg_bot" trace={trace} replyText="Harga ATV Rp350.000." onClose={() => {}} />)
}

function fixBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/inbox/decisions/run_1/fix')
  return JSON.parse(String(call?.[1]?.body))
}

describe('FixAnswerPanel', () => {
  it('menampilkan pertanyaan pelanggan, jawaban bot, dan knowledge unik per sumber', async () => {
    stubFetch(RUN_ROUTES)
    renderPanel()

    expect(await screen.findByText(QUESTION)).toBeInTheDocument()
    expect(screen.getByText('Harga ATV Rp350.000.')).toBeInTheDocument()
    expect(screen.getAllByText('FAQ Harga ATV (v3)')).toHaveLength(1)
    // Baris lama tanpa sourceId tetap tampil, tetapi tanpa tombol Edit.
    expect(screen.getByText('Info Umum (v1)')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it('Edit: membuka editor dari revisi PUBLISHED terkini, lalu menyimpan & mengaktifkan', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      'GET /api/inbox/knowledge/ks_1': {
        body: { title: 'FAQ Harga ATV', summary: null, items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000.' }], version: 3 },
      },
      'POST /api/inbox/decisions/run_1/fix': {
        body: { sourceId: 'ks_1', revisionId: 'krev_4', version: 4, status: 'PUBLISHED', title: 'FAQ Harga ATV', flagged: true },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByDisplayValue('Mulai Rp350.000.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simpan draft' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: 'Mulai Rp400.000.' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText('Aktif: FAQ Harga ATV v4')).toBeInTheDocument()
    expect(screen.getByText('Jawaban bot ini ditandai perlu diperbaiki.')).toBeInTheDocument()
    expect(fixBody(fetchMock)).toEqual({
      kind: 'edit',
      sourceId: 'ks_1',
      title: 'FAQ Harga ATV',
      items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp400.000.' }],
      reason: REASON,
    })
  })

  it('Tambah jawaban yang benar: editor berisi satu item dengan pertanyaan pelanggan', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      'POST /api/inbox/decisions/run_1/fix': {
        body: { sourceId: 'ks_new', revisionId: 'krev_new', version: 1, status: 'PUBLISHED', title: QUESTION, flagged: true },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Tambah jawaban yang benar' }))
    expect(screen.getByLabelText('Pertanyaan item 1')).toHaveValue(QUESTION)
    expect(screen.getByLabelText('Jawaban item 1')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: 'ATV 1 jam Rp400.000 per orang.' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText(`Aktif: ${QUESTION} v1`)).toBeInTheDocument()
    expect(fixBody(fetchMock)).toEqual({
      kind: 'new',
      title: QUESTION,
      items: [{ question: QUESTION, answer: 'ATV 1 jam Rp400.000 per orang.' }],
      reason: REASON,
    })
  })

  it('melaporkan jujur bila revisi aktif tetapi penandaan gagal', async () => {
    stubFetch({
      ...RUN_ROUTES,
      'POST /api/inbox/decisions/run_1/fix': {
        body: { sourceId: 'ks_new', revisionId: 'krev_new', version: 1, status: 'PUBLISHED', title: QUESTION, flagged: false },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Tambah jawaban yang benar' }))
    fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: 'ATV 1 jam Rp400.000 per orang.' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText('Revisi sudah aktif, tetapi jawaban ini gagal ditandai.')).toBeInTheDocument()
  })

  it('galat simpan tampil di editor, dan editor tetap terbuka', async () => {
    stubFetch({
      ...RUN_ROUTES,
      'GET /api/inbox/knowledge/ks_1': {
        body: { title: 'FAQ Harga ATV', summary: null, items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000.' }], version: 3 },
      },
      'POST /api/inbox/decisions/run_1/fix': {
        status: 409,
        body: { error: 'Entri ini punya draft v4 yang belum diaktifkan. Selesaikan draft itu di halaman Knowledge dulu supaya tidak tertimpa.' },
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))

    expect(await screen.findByText(/punya draft v4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simpan & aktifkan' })).toBeInTheDocument()
  })

  it('galat membuka entri tampil tanpa menutup panel', async () => {
    stubFetch({
      ...RUN_ROUTES,
      'GET /api/inbox/knowledge/ks_1': { status: 404, body: { error: 'Entri knowledge aktif tidak ditemukan' } },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Entri knowledge aktif tidak ditemukan')
    expect(screen.getByText(QUESTION)).toBeInTheDocument()
  })

  it('galat memuat keputusan tampil sebagai alert', async () => {
    stubFetch({
      'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { status: 500, body: { error: 'Gagal memuat daftar keputusan' } },
    })
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat daftar keputusan')
    expect(screen.queryByRole('button', { name: 'Tambah jawaban yang benar' })).not.toBeInTheDocument()
  })

  it('tanpa run tercatat: menjelaskan, tanpa tombol perbaikan', async () => {
    stubFetch({ 'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { body: { items: [] } } })
    renderPanel()

    expect(await screen.findByText('Keputusan bot untuk pesan ini tidak tercatat, jadi tidak bisa diperbaiki dari sini.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tambah jawaban yang benar' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Tulis test yang gagal — `src/components/inbox/MessageBubble.test.tsx`**

Tambahkan tepat setelah baris-baris impor di atas berkas:

```tsx
vi.mock('./FixAnswerPanel', () => ({
  FixAnswerPanel: ({ messageId, onClose }: { messageId: string; onClose: () => void }) => (
    <div>
      {`panel perbaikan ${messageId}`}
      <button type="button" onClick={onClose}>
        tutup panel
      </button>
    </div>
  ),
}))
```

Tambahkan di akhir berkas:

```tsx
describe('MessageBubble — Perbaiki', () => {
  const botReply = {
    id: 'msg_bot',
    direction: 'OUTBOUND' as const,
    content: 'Harga ATV Rp350.000.',
    channel: 'OFFICIAL',
    sentBy: 'BOT',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
    botTrace: { mode: 'faq', draft: 'Harga ATV Rp350.000.', sourceTopic: 'price' },
  }

  it('ikon Perbaiki di balasan bot membuka dan menutup panel perbaikan', () => {
    render(<MessageBubble message={botReply} />)
    expect(screen.queryByText('panel perbaikan msg_bot')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Perbaiki jawaban bot'))
    expect(screen.getByText('panel perbaikan msg_bot')).toBeInTheDocument()

    fireEvent.click(screen.getByText('tutup panel'))
    expect(screen.queryByText('panel perbaikan msg_bot')).not.toBeInTheDocument()
  })

  it('tidak ada ikon Perbaiki di pesan agen maupun pelanggan', () => {
    const { unmount } = render(<MessageBubble message={{ ...botReply, sentBy: 'AGENT', botTrace: null }} />)
    expect(screen.queryByLabelText('Perbaiki jawaban bot')).not.toBeInTheDocument()
    unmount()

    render(<MessageBubble message={{ ...botReply, direction: 'INBOUND', sentBy: 'CUSTOMER', botTrace: null }} />)
    expect(screen.queryByLabelText('Perbaiki jawaban bot')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/bot-control/KnowledgeEditor.test.tsx src/components/inbox/FixAnswerPanel.test.tsx src/components/inbox/MessageBubble.test.tsx`
Expected: FAIL — di KnowledgeEditor "Simpan draft" masih ada; `Failed to resolve import "./FixAnswerPanel"` untuk dua berkas lainnya.

- [ ] **Step 5: Implementasi — `src/components/bot-control/KnowledgeEditor.tsx`**

5a. Ganti:

```tsx
  onCancel,
  onSave,
}: {
```

menjadi:

```tsx
  onCancel,
  onSave,
  activateOnly = false,
}: {
```

5b. Ganti:

```tsx
  onSave: (draft: KnowledgeDraft, reason: string, activate: boolean) => void
}) {
```

menjadi:

```tsx
  onSave: (draft: KnowledgeDraft, reason: string, activate: boolean) => void
  /** Hanya "Simpan & aktifkan" (panel perbaikan di Inbox). Tanpa prop ini perilaku tidak berubah. */
  activateOnly?: boolean
}) {
```

5c. Ganti:

```tsx
        <p className="text-sm text-ink-muted">
          Disimpan sebagai draft, bot belum membacanya. Tekan &ldquo;Simpan &amp; aktifkan&rdquo; kalau isinya sudah
          boleh dipakai menjawab customer.
        </p>
```

menjadi:

```tsx
        {activateOnly ? (
          <p className="text-sm text-ink-muted">Tersimpan langsung aktif: bot memakainya mulai pesan berikutnya.</p>
        ) : (
          <p className="text-sm text-ink-muted">
            Disimpan sebagai draft, bot belum membacanya. Tekan &ldquo;Simpan &amp; aktifkan&rdquo; kalau isinya sudah
            boleh dipakai menjawab customer.
          </p>
        )}
```

5d. Ganti:

```tsx
        <Button
          type="button"
          variant="outline"
          onClick={() => onSave(draft, reason.trim(), false)}
          disabled={saving || !complete || reason.trim().length < MIN_REASON_LENGTH}
        >
          {saving ? 'Menyimpan...' : 'Simpan draft'}
        </Button>
```

menjadi:

```tsx
        {!activateOnly && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onSave(draft, reason.trim(), false)}
            disabled={saving || !complete || reason.trim().length < MIN_REASON_LENGTH}
          >
            {saving ? 'Menyimpan...' : 'Simpan draft'}
          </Button>
        )}
```

- [ ] **Step 6: Implementasi — `src/components/inbox/FixAnswerPanel.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { fetchJson } from '@/lib/fetch-json'
import type { BotDecision } from '@/lib/bot/types'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'

type RunView = { id: string; inboundText: string; replyText: string | null }
type LoadState =
  | { status: 'loading' }
  | { status: 'no-run' }
  | { status: 'error'; message: string }
  | { status: 'ready'; run: RunView }
type Editing =
  | { kind: 'edit'; sourceId: string; title: string; initial: KnowledgeDraft }
  | { kind: 'new'; title: string; initial: KnowledgeDraft }
type FixResult = { title: string; version: number; flagged: boolean }
type UsedSource = { key: string; label: string; sourceId?: string }

/** Batas knowledgeItemSchema (question) dan judul yang wajar untuk entri baru. */
const QUESTION_MAX = 1000
const TITLE_MAX = 80

/** Satu entri per sumber; baris lama tanpa sourceId tetap tampil, tanpa tombol Edit. */
function usedSources(trace: BotDecision | null): UsedSource[] {
  const seen = new Map<string, UsedSource>()
  for (const line of trace?.knowledge?.managedLines ?? []) {
    const key = line.sourceId ?? line.source
    if (!seen.has(key)) seen.set(key, { key, label: line.source, ...(line.sourceId ? { sourceId: line.sourceId } : {}) })
  }
  return [...seen.values()]
}

/**
 * Perbaiki jawaban bot dari bubble-nya: edit entri knowledge yang dipakai, atau tambah jawaban
 * yang benar. Menyimpan = langsung aktif (POST /api/inbox/decisions/[id]/fix), tanpa AI.
 */
export function FixAnswerPanel({
  messageId,
  trace,
  replyText,
  onClose,
}: {
  messageId: string
  trace: BotDecision | null
  replyText: string | null
  onClose: () => void
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [result, setResult] = useState<FixResult | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchJson<{ items: Array<{ id: string }> }>(`/api/bot-control/decisions?messageId=${encodeURIComponent(messageId)}&limit=1`)
      .then((list) => {
        const runId = list.items[0]?.id
        return runId ? fetchJson<RunView>(`/api/bot-control/decisions/${runId}`) : null
      })
      .then((run) => {
        if (cancelled) return
        setLoad(run ? { status: 'ready', run: { id: run.id, inboundText: run.inboundText, replyText: run.replyText } } : { status: 'no-run' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Gagal memuat keputusan bot' })
      })
    return () => {
      cancelled = true
    }
  }, [messageId])

  async function openEdit(sourceId: string) {
    setOpening(sourceId)
    setOpenError(null)
    try {
      const data = await fetchJson<{ title: string; summary: string | null; items: KnowledgeItem[]; version: number }>(
        `/api/inbox/knowledge/${encodeURIComponent(sourceId)}`
      )
      setSaveError(null)
      setEditing({
        kind: 'edit',
        sourceId,
        title: `Perbaiki: ${data.title} (v${data.version} aktif)`,
        initial: { title: data.title, summary: data.summary ?? '', items: data.items },
      })
    } catch (error: unknown) {
      setOpenError(error instanceof Error ? error.message : 'Gagal membuka entri knowledge')
    } finally {
      setOpening(null)
    }
  }

  function openNew(inboundText: string) {
    setSaveError(null)
    setEditing({
      kind: 'new',
      title: 'Tambah jawaban yang benar',
      initial: { title: inboundText.slice(0, TITLE_MAX), summary: '', items: [{ question: inboundText.slice(0, QUESTION_MAX), answer: '' }] },
    })
  }

  async function save(draft: KnowledgeDraft, reason: string) {
    if (!editing || load.status !== 'ready') return
    setSaving(true)
    setSaveError(null)
    const content = { title: draft.title.trim(), summary: draft.summary.trim() || undefined, items: draft.items, reason }
    const body = editing.kind === 'edit' ? { kind: 'edit', sourceId: editing.sourceId, ...content } : { kind: 'new', ...content }
    try {
      const saved = await fetchJson<{ title: string; version: number; flagged: boolean }>(`/api/inbox/decisions/${load.run.id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setResult({ title: saved.title, version: saved.version, flagged: saved.flagged })
      setEditing(null)
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : 'Gagal menyimpan perbaikan')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <KnowledgeEditor
        initial={editing.initial}
        title={editing.title}
        saving={saving}
        error={saveError}
        activateOnly
        onCancel={() => {
          setEditing(null)
          setSaveError(null)
        }}
        onSave={(draft, reason) => {
          void save(draft, reason)
        }}
      />
    )
  }

  const sources = usedSources(trace)

  return (
    <Modal onClose={onClose} className="max-w-md space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">Perbaiki jawaban bot</h2>
        <IconButton size="sm" label="Tutup" icon={<X strokeWidth={2} />} onClick={onClose} className="-mt-1 -mr-1" />
      </div>

      {load.status === 'loading' && <p className="text-ink-muted">Memuat keputusan bot...</p>}
      {load.status === 'no-run' && (
        <p className="text-ink-muted">Keputusan bot untuk pesan ini tidak tercatat, jadi tidak bisa diperbaiki dari sini.</p>
      )}
      {load.status === 'error' && (
        <p role="alert" className="text-danger">
          {load.message}
        </p>
      )}

      {load.status === 'ready' && (
        <>
          <div className="space-y-1">
            <p className="font-medium text-ink">Pertanyaan pelanggan</p>
            <p className="whitespace-pre-wrap text-ink-muted">{load.run.inboundText}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-ink">Jawaban bot</p>
            <p className="whitespace-pre-wrap text-ink-muted">{load.run.replyText ?? replyText ?? '—'}</p>
          </div>
          <div className="space-y-1.5 border-t border-line pt-2">
            <p className="font-medium text-ink">Knowledge yang dipakai</p>
            {sources.length === 0 ? (
              <p className="text-ink-muted">Jawaban ini tidak memakai knowledge terkelola.</p>
            ) : (
              <ul className="space-y-1">
                {sources.map(({ key, label, sourceId }) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">{label}</span>
                    {sourceId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={opening !== null}
                        onClick={() => {
                          void openEdit(sourceId)
                        }}
                      >
                        {opening === sourceId ? 'Membuka...' : 'Edit'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {openError && (
              <p role="alert" className="text-danger">
                {openError}
              </p>
            )}
          </div>
          <Button type="button" onClick={() => openNew(load.run.inboundText)}>
            Tambah jawaban yang benar
          </Button>
        </>
      )}

      {result && (
        <div role="status" className="space-y-0.5 border-t border-line pt-2">
          <p className="font-medium text-ink">{`Aktif: ${result.title} v${result.version}`}</p>
          <p className="text-ink-muted">
            {result.flagged ? 'Jawaban bot ini ditandai perlu diperbaiki.' : 'Revisi sudah aktif, tetapi jawaban ini gagal ditandai.'}
          </p>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 7: Implementasi — `src/components/inbox/MessageBubble.tsx`**

7a. Ganti baris impor ikon (hasil Task 4):

```ts
import { Bot, Brain, CornerUpLeft, Film, Image as ImageIcon, Paperclip, Tag } from 'lucide-react'
```

menjadi:

```ts
import { Bot, Brain, CornerUpLeft, Film, Image as ImageIcon, Paperclip, Tag, Wrench } from 'lucide-react'
```

7b. Setelah baris `import { BotTracePopover } from './BotTracePopover'` tambahkan:

```ts
import { FixAnswerPanel } from './FixAnswerPanel'
```

7c. Setelah baris `  const [showTrace, setShowTrace] = useState(false)` tambahkan:

```ts
  const [showFix, setShowFix] = useState(false)
```

7d. Ganti:

```tsx
      {isBotMessage && showTrace && (
        <BotTracePopover
          trace={(message.botTrace as BotDecision | null) ?? null}
          messageId={message.id}
          onClose={() => setShowTrace(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
```

menjadi:

```tsx
      {isBotMessage && showTrace && (
        <BotTracePopover
          trace={(message.botTrace as BotDecision | null) ?? null}
          messageId={message.id}
          onClose={() => setShowTrace(false)}
        />
      )}
      {isBotMessage && showFix && (
        <FixAnswerPanel
          messageId={message.id}
          trace={(message.botTrace as BotDecision | null) ?? null}
          replyText={message.content}
          onClose={() => setShowFix(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
```

7e. Ganti:

```tsx
            onClick={() => setShowTrace((prev) => !prev)}
            className="-my-1"
          />
        )}
        {message.sentBy === 'AGENT' && <span>Agen</span>}
```

menjadi:

```tsx
            onClick={() => setShowTrace((prev) => !prev)}
            className="-my-1"
          />
        )}
        {isBotMessage && (
          <IconButton
            size="sm"
            label="Perbaiki jawaban bot"
            icon={<Wrench strokeWidth={1.75} />}
            onClick={() => setShowFix(true)}
            className="-my-1"
          />
        )}
        {message.sentBy === 'AGENT' && <span>Agen</span>}
```

- [ ] **Step 8: Jalankan, pastikan LULUS**

Run: `npx vitest run src/components/bot-control/KnowledgeEditor.test.tsx src/components/inbox/FixAnswerPanel.test.tsx src/components/inbox/MessageBubble.test.tsx src/components/inbox/ThreadView.test.tsx`
Expected: PASS — termasuk seluruh test lama `KnowledgeEditor.test.tsx` (perilaku tanpa prop identik).

- [ ] **Step 9: Commit**

```bash
git add src/components/bot-control/KnowledgeEditor.tsx src/components/bot-control/KnowledgeEditor.test.tsx \
  src/components/inbox/FixAnswerPanel.tsx src/components/inbox/FixAnswerPanel.test.tsx \
  src/components/inbox/MessageBubble.tsx src/components/inbox/MessageBubble.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): panel perbaikan jawaban bot dari bubble balasan

Edit entri knowledge yang dipakai atau tambah jawaban yang benar; simpan langsung aktif.
KnowledgeEditor mendapat prop activateOnly tanpa mengubah perilaku di halaman Knowledge.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 10: Gerbang akhir

**Files:** tidak ada perubahan kode (hanya perbaikan bila gerbang merah, di-commit terpisah dengan path eksplisit).

**Interfaces:** Consumes semua task 1–9. Produces: branch hijau dan siap ditinjau.

- [ ] **Step 1: Seluruh test**

Run: `npm test`
Expected: semua PASS. Bila ada yang merah, perbaiki penyebabnya di task yang bersangkutan — jangan melonggarkan asersi.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keluar 0, tanpa keluaran.

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: 0 error (warning boleh).

- [ ] **Step 4: Pemeriksa larangan mekanis (harus mencetak `LARANGAN BERSIH`)**

```bash
BASE=$(git merge-base HEAD origin/main)
! git diff --name-only "$BASE"..HEAD | grep -Eq '^src/lib/bot/(topic-classifier|multi-topic-classifier)\.ts$|^src/lib/bot-control/simulator\.ts$' \
  && ! git diff "$BASE"..HEAD -- src | grep -E '^\+' | grep -Eq ':\s*any\b|as any\b|<any>' \
  && ! git diff "$BASE"..HEAD -- package.json package-lock.json | grep -q '^+' \
  && ! grep -Eiq 'drop|truncate|alter column|rename' prisma/migrations/20260911090000_message_topic_labels/migration.sql \
  && echo "LARANGAN BERSIH"
```

Expected: `LARANGAN BERSIH` — tidak ada perubahan pada classifier/simulator, tidak ada `any` baru, tidak ada dependensi baru, migrasi murni aditif.

- [ ] **Step 5: Commit hanya bila Step 1–4 memerlukan perbaikan** (path eksplisit, trailer yang sama seperti task lain).

---

## Cakupan spec → task

| Spec | Task |
|---|---|
| A1 kolom `Message.topicLabels`, tipe `TopicLabels`, `classifyAndStoreTopicLabels`, model `Settings.ollamaModel`, `alsoTopics` tanpa topik utama, pancar `message.updated` | 1 |
| A1 jalur otomatis (fire-and-forget, semua percakapan, sandbox, tanpa media tanpa teks, galat dicatat) | 2 |
| A1 jalur manual (login saja, INBOUND berteks milik percakapan, label lama dikembalikan tanpa model) | 3 |
| A2 `sourceId`/`sourceKey`/`version` per `managedLines`, `source` tetap | 5 |
| A2 `attributions`, `attributeReply` murni, dihitung di `attachClassification` atas teks final, ikut `botTrace` & `knowledgeRefs` lewat `sanitizeTrace` | 6 |
| B1 `serializeMessage`, chip, nama 14 topik & J1–J5, "perkiraan", label via SSE, ikon "Cek topik" dengan status memuat/galat | 4 |
| B2 popover: Topik, Sumber per paragraf ("cocok dengan", "tidak tercatat"), versi per baris, Verifikasi | 7 (versi: Keputusan 8) |
| B2 ikon Perbaiki, `FixAnswerPanel`, editor hanya "Simpan & aktifkan", hasil "Aktif: <judul> v<N>", tanda perlu diperbaiki | 9 |
| C1 route fix (sesi saja, Zod union, edit/new → publish, audit PUBLISH, tanda run, `flagged: false`, penjaga MANUAL, `{ error }`) | 8 |
| C2 `GET /api/inbox/knowledge/[sourceId]` | 8 |
| C3 amandemen CLAUDE.md §6 | 8 |
| C4 migrasi offline aditif; migrasi SEBELUM kode | 1 + Checklist Deploy |
| §5 simulator tidak berubah, gerbang umum | 6 (simulator.test), 10 |

---

## Checklist Deploy

Urutan wajib: **cadangkan → `prisma migrate deploy` SEBELUM kode → build → restart → smoke test di VPS.** Kode baru menulis `Message.topicLabels` sejak pesan pertama; menjalankannya sebelum kolom ada membuat setiap klasifikasi otomatis gagal (tertelan `console.error`) dan route "Cek topik" mengembalikan 500.

Prasyarat: Task 10 hijau, branch sudah digabung ke `main` dan di-push ke `origin/main` (keputusan operator). Langkah 1–2 dijalankan dari checkout utama `/Users/macbook/Code/wa-inbox` (yang punya `.env`; `DATABASE_URL` menunjuk Postgres produksi di VPS — lihat CLAUDE.md §5).

- [ ] **1. Cadangkan**

Database (tabel yang disentuh migrasi):

```bash
cd /Users/macbook/Code/wa-inbox
git checkout main && git pull --ff-only origin main
set -a; . ./.env; set +a
pg_dump "${DATABASE_URL%%\?*}" --table='"Message"' --format=custom --file="backup-message-$(date +%Y%m%d-%H%M).dump"
pg_restore --list backup-message-*.dump | grep -q 'TABLE DATA public Message' && echo "CADANGAN DB OK"
```

(`${DATABASE_URL%%\?*}` membuang query string gaya Prisma seperti `?schema=public` yang ditolak `pg_dump`.) Berkas cadangan jangan di-commit.

Pohon kode di VPS (membawa suntingan lokal yang tidak ada di commit mana pun):

```bash
ssh root@31.97.223.43 'cd /var/www/wa-inbox && tar czf /root/wa-inbox-predeploy-$(date +%Y%m%d-%H%M).tar.gz --exclude=node_modules --exclude=.next --exclude=.git . && ls -lh /root/wa-inbox-predeploy-*.tar.gz | tail -1'
```

- [ ] **2. Terapkan migrasi (SEBELUM kode) dan verifikasi**

```bash
cd /Users/macbook/Code/wa-inbox
cat prisma/migrations/20260911090000_message_topic_labels/migration.sql   # harus satu ALTER TABLE ... ADD COLUMN
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status   # "Database schema is up to date!"
echo 'SELECT "topicLabels" FROM "Message" LIMIT 1;' | npx prisma db execute --stdin && echo "KOLOM ADA"
```

DILARANG `npx prisma migrate dev`. Kolom aditif nullable tidak mengubah perilaku kode lama yang masih berjalan di VPS.

- [ ] **3. Deploy kode dan build di VPS (Node 22)**

```bash
ssh root@31.97.223.43
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
cd /var/www/wa-inbox
DEPLOYED=$(git rev-parse HEAD)
git fetch origin main
git diff --diff-filter=DR --name-status "$DEPLOYED" origin/main   # harus kosong; kalau tidak, hapus berkas lama itu manual
git checkout origin/main -- .
git reset --soft origin/main
npx prisma generate && npm run build
```

`package.json` tidak berubah di plan ini, jadi `npm ci` tidak diperlukan. Jangan `git reset --hard`/`git clean` (gitignored `catalog/deployment-approval.json`, `.env`, `public/uploads/` harus tetap ada).

- [ ] **4. Restart dan cek sehat**

```bash
pm2 restart wa-inbox
pm2 status wa-inbox                                                    # online
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3015/login   # 200
pm2 logs wa-inbox --lines 200 --nostream | grep -E 'classifyAndStoreTopicLabels|topic-labels' || echo "BELUM ADA GALAT LABEL"
```

- [ ] **5. Smoke test di VPS — hanya sandbox Test Lab atau nomor whitelist `6282143403501`**

1. Buka Inbox → percakapan sandbox (Test Lab, `isTest`). Kirim: `Berapa harga paket Ijen untuk 2 orang?`. Dalam beberapa detik, di bawah pesan masuk muncul chip (topik, intent) tanpa muat ulang. Pesan sandbox lama (sebelum rilis) menampilkan ikon "Cek topik"; klik satu → memuat → chip muncul.
2. Pada balasan bot untuk pesan itu, klik ikon alasan (🧠): bagian **Topik**, **Sumber per paragraf** ("cocok dengan …" atau "Tidak ada paragraf yang cocok…"), dan **Verifikasi** tampil; balasan lama menampilkan "Tidak tercatat untuk balasan ini."
3. Klik ikon **Perbaiki**: panel menampilkan pertanyaan, jawaban, dan knowledge yang dipakai; tombol **Edit** membuka editor terisi revisi aktif dan hanya ada "Simpan & aktifkan". **Jangan menyimpan** di smoke test kecuali operator memutuskan — simpan langsung mengubah jawaban bot untuk semua pelanggan. Bila operator ingin menguji simpan, pakai "Tambah jawaban yang benar" dengan pertanyaan khusus sandbox, lalu arsipkan entri itu segera dari `/bot-control/knowledge`.
4. Opsional: kirim satu pesan WhatsApp dari nomor whitelist `6282143403501` ke nomor bisnis; chip muncul di percakapan itu. Jangan menguji ke nomor pelanggan mana pun.
5. Ulangi `pm2 logs wa-inbox --lines 200 --nostream | grep -E 'classifyAndStoreTopicLabels|topic-labels'` — tidak boleh ada galat baru.

- [ ] **6. Rollback (bila perlu)**

Kode: di VPS `git checkout "$DEPLOYED" -- . && git reset --soft "$DEPLOYED" && npx prisma generate && npm run build && pm2 restart wa-inbox`. Kolom `topicLabels` boleh dibiarkan — aditif dan nullable, kode lama tidak membacanya. Cadangan langkah 1 hanya dipakai bila data `Message` rusak.
