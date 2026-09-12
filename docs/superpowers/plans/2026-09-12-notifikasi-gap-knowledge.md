# Notifikasi Gap Knowledge, Lompat ke Jawaban, dan Uji Ulang — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jawaban bot yang tidak bersandar pada fakta mana pun tercatat sebagai gap, muncul sebagai angka di lonceng navigasi, bisa diklik untuk melompat tepat ke gelembung jawabannya dengan panel perbaikan terbuka, dan setelah diperbaiki diuji ulang sampai operator menyatakan sudah sesuai.

**Architecture:** Statusnya dihitung dari `attributions` yang sudah ada di setiap keputusan (`isUnsourcedFaqReply`, fungsi murni). Baris `KnowledgeGapLog` ditulis di `inbound.ts` setelah balasan terkirim — satu-satunya titik yang memegang id percakapan, id pesan, dan id run sekaligus — lalu satu event SSE menaikkan lencana. Perbaikan memakai panel yang sudah ada; uji ulangnya memanggil `runSimulation` (kering, dilarang mengirim) lewat route baru yang terbuka untuk semua yang login. Gap ditutup oleh konfirmasi operator, bukan oleh penyimpanan revisi.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Prisma 7 (PostgreSQL), Zod 4, Vitest 4 + Testing Library + vitest-mock-extended, lucide-react, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-12-notifikasi-gap-knowledge-design.md` (disetujui operator). Baca bersama `CLAUDE.md` dan `.claude/rules/*.md`.

**Direktori kerja:** semua perintah dijalankan dari root worktree `/Users/macbook/Code/wa-inbox/.claude/worktrees/alur-grounding`.

## Global Constraints

- Tanpa `any` — pakai `unknown` + penyempitan tipe.
- Setiap mutasi: `getSession` → validasi Zod → `try-catch` per handler; galat selalu `{ error: string }` dengan status HTTP yang sesuai.
- Tanpa secret/token di UI, respons API, audit log, atau log.
- Tanpa dependensi npm baru.
- DILARANG `npx prisma migrate dev` (`DATABASE_URL` = produksi). Migrasi dibuat offline dengan `prisma migrate diff`, dan hanya aditif (CLAUDE.md §7).
- **JANGAN ubah dua titik gap lama** di `orchestrator.ts` (`no_facts_resolved` di `:1291` dan `:2058`, `verification_failed` di `:811`) maupun `recordKnowledgeGap` itu sendiri.
- **JANGAN ubah** otorisasi `POST /api/bot-control/simulate` (tetap khusus admin), komponen `TestLab`, prompt bot, `topic-classifier.ts`, `multi-topic-classifier.ts`. Satu-satunya perubahan di `simulator.ts` adalah menambah field `knowledge` ke `SimulationResult` (Task 7), dan satu-satunya perubahan di `/api/bot/knowledge-gaps` adalah menambah field `resolvedAt` ke responsnya (Task 9) — pola auth-nya (mengandalkan `src/middleware.ts`) tidak diubah.
- Test yang membuktikan simulator tidak memanggil `sendMessage` dan tidak membuat `OutboundJob` HARUS tetap hijau.
- Test tidak memakai nomor pelanggan sungguhan.
- Gerbang per task: `npx vitest run <berkas test task itu>`. Gerbang akhir (Task 10): `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error).
- Commit dengan path eksplisit (tanpa `git add -A`/`.`), pesan diakhiri trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Teks UI dalam Bahasa Indonesia; kode & identifier Inggris.

## Keputusan atas ambiguitas spec (mengikat untuk semua task)

1. **Hanya satu kasus yang ditulis sinyal baru**: FAQ yang punya fakta tetapi `attributions`-nya kosong (`reason: 'reply_unsourced'`). Kasus "tidak ada fakta sama sekali" sudah dicatat `no_facts_resolved` oleh jalur lama; menulisnya lagi akan menghasilkan dua baris untuk satu giliran.
2. **`attributions === undefined` tidak pernah dianggap gap.** Itu berarti pemetaan tidak dihitung (balasan lama), bukan berarti tidak bersumber.
3. **Penulisan gap tidak ditunggu** dan galatnya hanya dicatat — sama seperti `recordKnowledgeGap` yang sudah ada. Kegagalan mencatat gap tidak boleh menggagalkan giliran bot yang sudah berhasil.
4. **Event SSE `knowledge.gap` tidak membawa isi apa pun** selain `conversationId`. Penerimanya memuat ulang daftarnya sendiri dari `/api/inbox/gaps`; membawa teks pelanggan ke setiap tab terbuka tidak diperlukan untuk menaikkan angka.
5. **Lencana menghitung semua gap yang belum selesai**, apa pun alasannya — termasuk tiga baris `no_facts_resolved` lama yang tidak punya `messageId`. Item seperti itu hanya membuka percakapannya.
6. **Route gap baru memakai `getSession` eksplisit** (pola `/api/inbox/*` yang sudah ada), bukan mengandalkan middleware seperti `/api/bot/knowledge-gaps` yang lama. Route lama tidak disentuh.
7. **`POST /api/inbox/decisions/[id]/fix` tidak menutup gap.** Penutupnya adalah konfirmasi "sudah sesuai" atau tombol "Tandai selesai" (revisi keputusan di spec §2).
8. **Nama migrasi tetap:** `20260912080000_knowledge_gap_notification`.

## Peta Berkas

**Dibuat**

| Berkas | Tanggung jawab | Task |
|---|---|---|
| `prisma/migrations/20260912080000_knowledge_gap_notification/migration.sql` | tiga kolom nullable + index `resolvedAt` | 1 |
| `src/lib/inbox/gap-signal.ts` (+ `gap-signal.test.ts`) | `isUnsourcedFaqReply`, murni | 2 |
| `src/lib/inbox/gap-log.ts` (+ `gap-log.test.ts`) | `recordUnsourcedReplyGap`, penulis + pemancar event | 3 |
| `src/app/api/inbox/gaps/route.ts` (+ `route.test.ts`) | hitungan + daftar gap yang belum selesai | 4 |
| `src/app/api/inbox/gaps/[id]/resolve/route.ts` (+ `route.test.ts`) | tandai selesai | 4 |
| `src/components/GapBell.tsx` (+ `GapBell.test.tsx`) | lonceng, lencana, dropdown | 5 |
| `src/app/api/inbox/retest/route.ts` (+ `route.test.ts`) | uji ulang untuk semua yang login | 7 |
| `src/app/(authenticated)/settings/knowledge-gaps/page.test.tsx` | test halaman gap | 9 |

**Diubah**

| Berkas | Perubahan | Task |
|---|---|---|
| `prisma/schema.prisma` | `KnowledgeGapLog`: `messageId`, `runId`, `resolvedAt`, `@@index([resolvedAt])` | 1 |
| `src/lib/realtime.ts` (+ `realtime.test.ts`) | varian event `knowledge.gap` | 3 |
| `src/lib/inbound.ts` (+ `inbound.test.ts`) | panggil penulis gap setelah balasan terkirim | 3 |
| `src/components/AppRail.tsx` (+ `AppRail.test.tsx`) | pasang `GapBell` | 5 |
| `src/app/(authenticated)/inbox/page.tsx` (+ `page.test.tsx`) | baca `?message=`, teruskan ke `ThreadView` | 6 |
| `src/components/inbox/ThreadView.tsx` (+ `ThreadView.test.tsx`) | `focusMessageId`: gulung ke pesan itu, buka panelnya | 6 |
| `src/components/inbox/MessageBubble.tsx` (+ `MessageBubble.test.tsx`) | prop `autoOpenFix` | 6 |
| `src/lib/bot-control/simulator.ts` (+ `simulator.test.ts`) | `SimulationResult.knowledge` | 7 |
| `src/components/inbox/FixAnswerPanel.tsx` (+ `FixAnswerPanel.test.tsx`) | putaran uji ulang | 8 |
| `src/app/api/bot/knowledge-gaps/route.ts` (+ `route.test.ts` baru) | respons bertambah `resolvedAt` (aditif; auth tidak berubah) | 9 |
| `src/app/(authenticated)/settings/knowledge-gaps/page.tsx` | kolom status + tombol Tandai selesai | 9 |

**Tidak disentuh:** `orchestrator.ts`, `reply-attribution.ts`, `decision-recorder.ts`, `send.ts`, `knowledge-workflow.ts`, `TestLab.tsx`, `/api/bot-control/simulate`, `NotificationListener.tsx`.

---
### Task 1: Kolom `messageId`, `runId`, `resolvedAt` di `KnowledgeGapLog`

**Files:**
- Modify: `prisma/schema.prisma` (model `KnowledgeGapLog`)
- Create: `prisma/migrations/20260912080000_knowledge_gap_notification/migration.sql`

**Interfaces:**
- Consumes: model `KnowledgeGapLog` yang sudah ada (`id`, `conversationId`, `conversation`, `topic`, `reason`, `messageText`, `createdAt`, `@@index([createdAt])`).
- Produces: tiga kolom nullable (`messageId String?`, `runId String?`, `resolvedAt DateTime?`) dan `@@index([resolvedAt])`. Semua baris lama tetap sah dengan ketiganya `NULL`.

Sengaja BUKAN relasi ke `Message`/`BotDecisionRun`: `BotDecisionRun.messageId` yang sudah ada pun kolom biasa tanpa foreign key, dan menambah FK berarti baris gap ikut terhapus saat pesannya dihapus — justru jejak yang ingin disimpan.

- [x] **Step 1: Simpan salinan skema lama (sebelum mengedit apa pun)**

```bash
git show HEAD:prisma/schema.prisma > "${TMPDIR:-/tmp}/schema-before-gap-notif.prisma"
git diff --quiet HEAD -- prisma/schema.prisma && echo "skema bersih, salinan = HEAD"
```

Expected: `skema bersih, salinan = HEAD`. Kalau tidak tercetak, ada perubahan lokal di skema — berhenti dan tanyakan.

- [x] **Step 2: Tambah kolom di `prisma/schema.prisma`**

Di model `KnowledgeGapLog`, ganti:

```prisma
  messageText    String
  createdAt      DateTime     @default(now())

  @@index([createdAt])
}
```

menjadi:

```prisma
  messageText    String
  // Notifikasi gap (2026-09-12): ketiganya hanya diisi oleh jalur `reply_unsourced`
  // (src/lib/inbox/gap-log.ts), satu-satunya titik yang memegang id pesan dan id run
  // sekaligus. Baris gap lama punya ketiganya kosong, dan notifikasi menanganinya dengan
  // hanya membuka percakapannya. Bukan relasi: menghapus pesannya tidak boleh ikut
  // menghapus catatan bahwa bot pernah menjawab tanpa sumber.
  messageId      String?
  runId          String?
  // Kosong = masih terbuka. Diisi saat operator menyatakan jawaban barunya sudah sesuai,
  // atau saat ia menekan "Tandai selesai".
  resolvedAt     DateTime?
  createdAt      DateTime     @default(now())

  @@index([createdAt])
  @@index([resolvedAt])
}
```

- [x] **Step 3: Buat migrasi offline dan periksa SQL-nya**

`prisma migrate diff` menulis spanduk dotenvx (`◇ injected env …`) ke STDOUT, bukan stderr, jadi pengalihan polos akan menaruhnya sebagai baris pertama berkas SQL — migrasi yang rusak dan baru ketahuan saat `migrate deploy` di produksi. Saringan dan pemeriksaan baris pertama di bawah ini yang mencegahnya.

```bash
mkdir -p prisma/migrations/20260912080000_knowledge_gap_notification
f=prisma/migrations/20260912080000_knowledge_gap_notification/migration.sql
npx prisma migrate diff \
  --from-schema "${TMPDIR:-/tmp}/schema-before-gap-notif.prisma" \
  --to-schema prisma/schema.prisma \
  --script 2>/dev/null | grep -v 'injected env' > "$f"
cat "$f"
head -1 "$f" | grep -q '^-- AlterTable$' \
  && ! grep -q 'injected env' "$f" \
  && ! grep -Eiq 'drop|truncate|alter column|rename' "$f" \
  && grep -Eq 'ADD COLUMN +"messageId" TEXT' "$f" \
  && grep -Eq 'ADD COLUMN +"resolvedAt" TIMESTAMP' "$f" \
  && grep -Eq 'ADD COLUMN +"runId" TEXT' "$f" \
  && grep -q 'CREATE INDEX "KnowledgeGapLog_resolvedAt_idx"' "$f" \
  && echo "MIGRASI ADITIF OK"
```

Expected isi berkas:

```sql
-- AlterTable
ALTER TABLE "KnowledgeGapLog" ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "runId" TEXT;

-- CreateIndex
CREATE INDEX "KnowledgeGapLog_resolvedAt_idx" ON "KnowledgeGapLog"("resolvedAt");
```

dan baris terakhir `MIGRASI ADITIF OK`. Kalau ada pernyataan lain, berhenti — skema berubah lebih dari yang direncanakan. **JANGAN** menjalankan `migrate dev` atau `migrate deploy` di task ini.

- [x] **Step 4: Regenerasi Prisma Client dan validasi skema**

```bash
npx prisma generate && npx prisma validate
```

Expected: `Generated Prisma Client` dan `The schema at prisma/schema.prisma is valid`.

- [x] **Step 5: Buktikan kolomnya terbaca tipe (test cepat lewat suite yang sudah ada)**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: PASS. Ini bukan test kolomnya — ia hanya membuktikan Prisma Client hasil regenerasi tidak merusak suite mana pun sebelum task berikutnya bersandar padanya. Kolomnya sendiri diuji di Task 3, tempat ia pertama kali ditulis.

- [x] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260912080000_knowledge_gap_notification/migration.sql
git commit -m "$(cat <<'EOF'
feat(db): KnowledgeGapLog menyimpan id pesan, id run, dan penanda selesai

Migrasi aditif: tiga kolom nullable plus index resolvedAt untuk hitungan lencana.
Bukan relasi ke Message/BotDecisionRun supaya catatan gap tidak ikut terhapus.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `isUnsourcedFaqReply` — sinyal murni

**Files:**
- Create: `src/lib/inbox/gap-signal.ts`
- Test: `src/lib/inbox/gap-signal.test.ts`

**Interfaces:**
- Consumes: `BotDecision` dan `DecisionKnowledge` (`src/lib/bot/types.ts`). `DecisionKnowledge` membawa `catalogLines: string[]`, `managedLines: Array<{ line, source, sourceId?, sourceKey?, version? }>`, dan `attributions?: ReplyAttribution[]`.
- Produces: `export function isUnsourcedFaqReply(decision: BotDecision): boolean` — murni, tanpa I/O, aman diimpor dari mana pun.

Aturannya, urut: bukan mode `faq` → `false`; tanpa `knowledge` → `false`; nol fakta (katalog + terkelola) → `false` (itu wilayah `no_facts_resolved` yang sudah ada); `attributions` absen → `false` (pemetaan tidak dihitung, bukan berarti tidak bersumber); `attributions` kosong → `true`.

- [x] **Step 1: Tulis test yang gagal — `src/lib/inbox/gap-signal.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isUnsourcedFaqReply } from './gap-signal'
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'

function knowledge(overrides: Partial<DecisionKnowledge> = {}): DecisionKnowledge {
  return {
    catalogLines: [],
    managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
    rejected: [],
    gateBypassed: false,
    attributions: [],
    ...overrides,
  }
}

function faq(overrides: Partial<Extract<BotDecision, { mode: 'faq' }>> = {}): BotDecision {
  return { mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', knowledge: knowledge(), ...overrides }
}

describe('isUnsourcedFaqReply', () => {
  it('menandai balasan FAQ yang punya fakta tetapi tidak satu paragraf pun cocok', () => {
    expect(isUnsourcedFaqReply(faq())).toBe(true)
  })

  it('tidak menandai balasan yang paragrafnya cocok dengan fakta', () => {
    const attributions = [{ paragraph: 0, lines: [{ kind: 'managed' as const, line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] }]
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ attributions }) }))).toBe(false)
  })

  it('tidak menandai giliran tanpa fakta sama sekali -- itu wilayah no_facts_resolved', () => {
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ catalogLines: [], managedLines: [] }) }))).toBe(false)
  })

  it('tidak menandai balasan lama yang pemetaannya tidak pernah dihitung', () => {
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ attributions: undefined }) }))).toBe(false)
  })

  it('tidak menandai keputusan tanpa knowledge sama sekali', () => {
    expect(isUnsourcedFaqReply({ mode: 'faq', draft: 'x', sourceTopic: 'price' })).toBe(false)
  })

  it('tidak pernah menandai clarify, handoff, atau booking_context', () => {
    expect(isUnsourcedFaqReply({ mode: 'clarify', reply: 'Ke mana?', knowledge: knowledge() })).toBe(false)
    expect(isUnsourcedFaqReply({ mode: 'handoff', reason: 'eskalasi', knowledge: knowledge() })).toBe(false)
    expect(isUnsourcedFaqReply({ mode: 'booking_context', reply: 'Berangkat 5 Agustus.', knowledge: knowledge() })).toBe(false)
  })

  it('menandai walau faktanya hanya dari katalog', () => {
    expect(isUnsourcedFaqReply(faq({ knowledge: knowledge({ catalogLines: ['Every package includes private transport.'], managedLines: [] }) }))).toBe(true)
  })
})
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/inbox/gap-signal.test.ts`
Expected: FAIL — `Failed to resolve import "./gap-signal"`.

- [x] **Step 3: Implementasi — `src/lib/inbox/gap-signal.ts`**

```ts
import type { BotDecision } from '@/lib/bot/types'

/**
 * Apakah balasan ini menjawab TANPA bersandar pada satu pun fakta yang dikirim ke model.
 *
 * Dihitung dari `attributions` (reply-attribution.ts), yang sudah ditempel di titik tempel
 * tunggal orchestrator. Murni dan tanpa I/O supaya bisa dipakai penulis gap maupun test tanpa
 * menyeret prisma.
 *
 * Empat hal yang sengaja BUKAN gap:
 *   - mode selain `faq` -- klarifikasi dan salam memang tidak butuh fakta, dan Mode 3 menjawab
 *     dari data booking pelanggan;
 *   - keputusan tanpa `knowledge` (tidak ada tahap perakitan fakta yang berjalan);
 *   - giliran dengan NOL fakta -- itu sudah dicatat `no_facts_resolved` oleh jalur lama, dan
 *     menulisnya lagi berarti dua baris untuk satu giliran;
 *   - `attributions` yang absen -- artinya pemetaan tidak pernah dihitung (balasan lama),
 *     bukan artinya tidak bersumber.
 */
export function isUnsourcedFaqReply(decision: BotDecision): boolean {
  if (decision.mode !== 'faq') return false

  const knowledge = decision.knowledge
  if (!knowledge) return false
  if (knowledge.catalogLines.length + knowledge.managedLines.length === 0) return false

  const attributions = knowledge.attributions
  if (attributions === undefined) return false
  return attributions.length === 0
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `npx vitest run src/lib/inbox/gap-signal.test.ts`
Expected: PASS (7 test).

- [x] **Step 5: Commit**

```bash
git add src/lib/inbox/gap-signal.ts src/lib/inbox/gap-signal.test.ts
git commit -m "$(cat <<'EOF'
feat(inbox): sinyal murni untuk balasan FAQ yang tidak bersumber

Dihitung dari attributions yang sudah ada. Giliran tanpa fakta sama sekali sengaja tidak
ditandai di sini -- itu sudah dicatat no_facts_resolved oleh jalur lama.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 3: Penulis gap + event SSE + pemasangan di `inbound.ts`

**Files:**
- Create: `src/lib/inbox/gap-log.ts`
- Test: `src/lib/inbox/gap-log.test.ts`
- Modify: `src/lib/realtime.ts` (varian event), `src/lib/realtime.test.ts`
- Modify: `src/lib/inbound.ts` (impor + panggilan setelah `attachMessageToDecisionRun`), `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: `isUnsourcedFaqReply` (Task 2); `prisma.knowledgeGapLog.create`; `broadcast` (`src/lib/realtime.ts`); kolom Task 1.
- Produces:
  - `export const UNSOURCED_REPLY_REASON = 'reply_unsourced'`
  - `export async function recordUnsourcedReplyGap(params: { decision: BotDecision; conversationId: string; messageId?: string; runId: string | null; inboundText: string }): Promise<void>` — tidak pernah melempar; diam saja bila keputusannya bukan gap.
  - Varian event `{ type: 'knowledge.gap'; conversationId: string }` di `RealtimeEvent`.

Di `inbound.ts` panggilannya duduk tepat setelah `attachMessageToDecisionRun` pada cabang faq/booking_context/clarify — variabel `conversation.id`, `sent`, `decisionRunId`, `decision`, dan `inboundText` semuanya hidup di sana. Cabang handoff tidak disentuh (handoff bukan jawaban FAQ).

- [x] **Step 1: Tulis test yang gagal — `src/lib/inbox/gap-log.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { recordUnsourcedReplyGap, UNSOURCED_REPLY_REASON } from './gap-log'
import type { BotDecision, DecisionKnowledge } from '@/lib/bot/types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function knowledge(overrides: Partial<DecisionKnowledge> = {}): DecisionKnowledge {
  return {
    catalogLines: [],
    managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
    rejected: [],
    gateBypassed: false,
    attributions: [],
    ...overrides,
  }
}

const unsourced: BotDecision = { mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', topic: 'price', knowledge: knowledge() }

function params(overrides: Record<string, unknown> = {}) {
  return {
    decision: unsourced,
    conversationId: 'conv_1',
    messageId: 'msg_bot',
    runId: 'run_1',
    inboundText: 'berapa harga ATV sekarang?',
    ...overrides,
  } as Parameters<typeof recordUnsourcedReplyGap>[0]
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.knowledgeGapLog.create.mockResolvedValue({ id: 'gap_1' } as never)
})

describe('recordUnsourcedReplyGap', () => {
  it('menulis satu baris gap dengan ketiga id dan alasan reply_unsourced', async () => {
    await recordUnsourcedReplyGap(params())

    expect(mockPrisma.knowledgeGapLog.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conv_1',
        topic: 'price',
        reason: UNSOURCED_REPLY_REASON,
        messageText: 'berapa harga ATV sekarang?',
        messageId: 'msg_bot',
        runId: 'run_1',
      },
    })
  })

  it('memancarkan knowledge.gap setelah barisnya tersimpan', async () => {
    await recordUnsourcedReplyGap(params())
    expect(broadcast).toHaveBeenCalledWith({ type: 'knowledge.gap', conversationId: 'conv_1' })
  })

  it('memakai sourceTopic bila keputusan tidak membawa topic', async () => {
    await recordUnsourcedReplyGap(params({ decision: { mode: 'faq', draft: 'x', sourceTopic: 'payment', knowledge: knowledge() } }))
    expect(mockPrisma.knowledgeGapLog.create.mock.calls[0][0].data).toMatchObject({ topic: 'payment' })
  })

  it('menyimpan messageId null saat pengiriman tidak mengembalikan pesan', async () => {
    await recordUnsourcedReplyGap(params({ messageId: undefined }))
    expect(mockPrisma.knowledgeGapLog.create.mock.calls[0][0].data).toMatchObject({ messageId: null })
  })

  it('tidak menulis apa pun untuk balasan yang paragrafnya bersumber', async () => {
    const attributions = [{ paragraph: 0, lines: [{ kind: 'managed' as const, line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] }]
    await recordUnsourcedReplyGap(params({ decision: { ...unsourced, knowledge: knowledge({ attributions }) } }))

    expect(mockPrisma.knowledgeGapLog.create).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('tidak menulis apa pun untuk clarify, handoff, atau booking_context', async () => {
    await recordUnsourcedReplyGap(params({ decision: { mode: 'clarify', reply: 'Ke mana?', knowledge: knowledge() } }))
    await recordUnsourcedReplyGap(params({ decision: { mode: 'handoff', reason: 'eskalasi', knowledge: knowledge() } }))
    await recordUnsourcedReplyGap(params({ decision: { mode: 'booking_context', reply: 'Berangkat 5 Agustus.', knowledge: knowledge() } }))

    expect(mockPrisma.knowledgeGapLog.create).not.toHaveBeenCalled()
  })

  it('menelan galat basis data, mencatatnya, dan tidak memancarkan apa pun', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeGapLog.create.mockRejectedValue(new Error('db down'))

    await expect(recordUnsourcedReplyGap(params())).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('recordUnsourcedReplyGap gagal', expect.objectContaining({ conversationId: 'conv_1' }))
    expect(broadcast).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
```

- [x] **Step 2: Tulis test yang gagal — `src/lib/realtime.test.ts`**

Ganti:

```ts
  it('delivers a handoff.alert event distinctly from message.created', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    expect(listener).toHaveBeenCalledWith({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    unsubscribe()
  })
```

menjadi:

```ts
  it('delivers a handoff.alert event distinctly from message.created', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    expect(listener).toHaveBeenCalledWith({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    unsubscribe()
  })

  it('mengirim knowledge.gap tanpa isi pesan apa pun', () => {
    // Lencana lonceng hanya perlu tahu ADA gap baru; daftarnya diambil ulang dari
    // /api/inbox/gaps. Membawa kalimat pelanggan ke setiap tab terbuka tidak diperlukan.
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'knowledge.gap', conversationId: 'conv_1' })
    expect(listener).toHaveBeenCalledWith({ type: 'knowledge.gap', conversationId: 'conv_1' })
    unsubscribe()
  })
```

- [x] **Step 3: Tulis test yang gagal — `src/lib/inbound.test.ts`**

Tambahkan impor setelah baris `import { broadcast } from '@/lib/realtime'`:

```ts
import { recordUnsourcedReplyGap } from '@/lib/inbox/gap-log'
```

Tambahkan mock setelah baris `vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn() }))`:

```ts
vi.mock('@/lib/inbox/gap-log', () => ({ recordUnsourcedReplyGap: vi.fn() }))
```

Di `beforeEach` paling atas, setelah baris `vi.mocked(classifyAndStoreTopicLabels).mockReset().mockResolvedValue(null)`, tambahkan:

```ts
  vi.mocked(recordUnsourcedReplyGap).mockReset().mockResolvedValue(undefined)
```

Tambahkan di AKHIR berkas:

```ts
describe('runBotForConversation — catatan gap tidak bersumber', () => {
  const conversation = { id: 'conv_gap', contactName: 'Bruno' }
  const knowledge = {
    catalogLines: [],
    managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
    rejected: [],
    gateBypassed: false,
    attributions: [],
  }

  it('memanggil penulis gap setelah balasan terkirim, membawa id pesan dan id run', async () => {
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', knowledge })
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_bot' } as never)

    await runBotForConversation(conversation, 'berapa harga ATV sekarang?')

    expect(sendMessage).toHaveBeenCalled()
    expect(recordUnsourcedReplyGap).toHaveBeenCalledWith({
      decision: expect.objectContaining({ mode: 'faq' }),
      conversationId: 'conv_gap',
      messageId: 'msg_bot',
      runId: 'run_1',
      inboundText: 'berapa harga ATV sekarang?',
    })
  })

  it('tidak menunggu penulis gap: giliran selesai walau penulisannya menggantung', async () => {
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', knowledge })
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_bot' } as never)
    vi.mocked(recordUnsourcedReplyGap).mockReturnValue(new Promise(() => {}))

    await expect(runBotForConversation(conversation, 'berapa harga ATV sekarang?')).resolves.toBeUndefined()
  })

  it('kegagalan penulis gap hanya dicatat, giliran tetap berhasil', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Halo kak!', sourceTopic: 'price', knowledge })
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_bot' } as never)
    vi.mocked(recordUnsourcedReplyGap).mockRejectedValue(new Error('db down'))

    await runBotForConversation(conversation, 'berapa harga ATV sekarang?')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errorSpy).toHaveBeenCalledWith('recordUnsourcedReplyGap gagal dipanggil', expect.objectContaining({ conversationId: 'conv_gap' }))
    errorSpy.mockRestore()
  })

  it('cabang handoff tidak memanggil penulis gap sama sekali', async () => {
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'handoff', reason: 'kata kunci eskalasi' })
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg_handoff' } as never)

    await runBotForConversation(conversation, 'mau bicara dengan orang')

    expect(recordUnsourcedReplyGap).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 4: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/inbox/gap-log.test.ts src/lib/realtime.test.ts src/lib/inbound.test.ts`
Expected: FAIL — `Failed to resolve import "./gap-log"`; di `inbound.test.ts` gagal pada `Failed to resolve import "@/lib/inbox/gap-log"`.

- [x] **Step 5: Implementasi — `src/lib/inbox/gap-log.ts`**

```ts
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { isUnsourcedFaqReply } from './gap-signal'
import type { BotDecision } from '@/lib/bot/types'

/** Alasan gap untuk balasan FAQ yang tidak bersandar pada satu pun fakta yang dikirim ke model. */
export const UNSOURCED_REPLY_REASON = 'reply_unsourced'

/**
 * Mencatat satu balasan yang tidak bersumber, lalu memberi tahu lonceng.
 *
 * Dipanggil dari `inbound.ts` SETELAH balasannya terkirim, bukan dari orchestrator: hanya di
 * titik itu id percakapan, id pesan, dan id run ada bersamaan, dan notifikasi membutuhkan
 * ketiganya untuk bisa melompat tepat ke gelembungnya. Dua sinyal gap lama tetap ditulis di
 * tempatnya masing-masing (orchestrator.ts) dan tidak disentuh.
 *
 * Tidak pernah melempar: giliran bot yang sudah berhasil tidak boleh gagal gara-gara
 * pembukuan.
 */
export async function recordUnsourcedReplyGap(params: {
  decision: BotDecision
  conversationId: string
  messageId?: string
  runId: string | null
  inboundText: string
}): Promise<void> {
  const { decision } = params
  // Pemeriksaan mode kedua kalinya ada demi penyempitan tipe, bukan demi logika: `topic` dan
  // `sourceTopic` hanya ada di varian faq.
  if (!isUnsourcedFaqReply(decision) || decision.mode !== 'faq') return

  try {
    await prisma.knowledgeGapLog.create({
      data: {
        conversationId: params.conversationId,
        topic: decision.topic ?? decision.sourceTopic,
        reason: UNSOURCED_REPLY_REASON,
        messageText: params.inboundText,
        messageId: params.messageId ?? null,
        runId: params.runId,
      },
    })
    broadcast({ type: 'knowledge.gap', conversationId: params.conversationId })
  } catch (error) {
    console.error('recordUnsourcedReplyGap gagal', { conversationId: params.conversationId, error })
  }
}
```

- [x] **Step 6: Implementasi — `src/lib/realtime.ts`**

Ganti:

```ts
  | { type: 'handoff.alert'; conversationId: string; contactName: string | null }
```

menjadi:

```ts
  | { type: 'handoff.alert'; conversationId: string; contactName: string | null }
  // Satu balasan bot yang tidak bersandar pada fakta mana pun baru saja tercatat
  // (src/lib/inbox/gap-log.ts). Sengaja tidak membawa isi apa pun selain percakapannya:
  // lencana lonceng hanya perlu tahu ada yang baru, dan daftarnya diambil ulang dari
  // /api/inbox/gaps oleh penerima yang memang menampilkannya.
  | { type: 'knowledge.gap'; conversationId: string }
```

- [x] **Step 7: Implementasi — `src/lib/inbound.ts`**

Tambahkan impor setelah baris `import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'`:

```ts
import { recordUnsourcedReplyGap } from '@/lib/inbox/gap-log'
```

Ganti:

```ts
    await attachMessageToDecisionRun(decisionRunId, sent?.id, traceSnapshot(tracer))
  } else {
```

menjadi:

```ts
    await attachMessageToDecisionRun(decisionRunId, sent?.id, traceSnapshot(tracer))
    // Gap "tidak bersumber" dicatat DI SINI, bukan di orchestrator: ini satu-satunya titik
    // yang memegang id percakapan, id pesan, dan id run sekaligus -- dan notifikasinya butuh
    // ketiganya. Tidak ditunggu, sama seperti pembukuan lain di jalur ini.
    recordUnsourcedReplyGap({
      decision,
      conversationId: conversation.id,
      messageId: sent?.id,
      runId: decisionRunId,
      inboundText,
    }).catch((error: unknown) => {
      console.error('recordUnsourcedReplyGap gagal dipanggil', { conversationId: conversation.id, error })
    })
  } else {
```

- [x] **Step 8: Jalankan, pastikan LULUS**

Run: `npx vitest run src/lib/inbox/gap-log.test.ts src/lib/inbox/gap-signal.test.ts src/lib/realtime.test.ts src/lib/inbound.test.ts`
Expected: PASS, termasuk seluruh test lama di `inbound.test.ts` dan `realtime.test.ts`.

- [x] **Step 9: Commit**

```bash
git add src/lib/inbox/gap-log.ts src/lib/inbox/gap-log.test.ts \
  src/lib/realtime.ts src/lib/realtime.test.ts \
  src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "$(cat <<'EOF'
feat(inbox): catat balasan bot yang tidak bersumber sebagai gap

Ditulis setelah balasan terkirim, tempat id percakapan/pesan/run ada bersamaan, lalu satu
event SSE menaikkan lencana. Dua sinyal gap lama di orchestrator tidak disentuh.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 4: Route daftar gap dan penanda selesai

**Files:**
- Create: `src/app/api/inbox/gaps/route.ts` (+ `route.test.ts`)
- Create: `src/app/api/inbox/gaps/[id]/resolve/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: `getSession` (`src/lib/auth/get-session.ts:23`); kolom `resolvedAt`/`messageId` (Task 1); relasi `KnowledgeGapLog.conversation → Contact`.
- Produces:
  - `GET /api/inbox/gaps?limit=<1..20>&messageId=<id>` → 200 `{ count: number; items: Array<{ id, conversationId, messageId: string | null, contactName: string | null, topic, reason, messageText, createdAt }> }`. `count` = SEMUA gap yang belum selesai dengan saringan yang sama (tanpa `messageId`, itu berarti semuanya — angka untuk lencana). `messageId` opsional, dipakai panel perbaikan untuk menemukan gap milik satu jawaban. 401 tanpa sesi, 400 bila parameter tidak valid, 500 `{ error }`.
  - `POST /api/inbox/gaps/[id]/resolve` → 200 `{ id, resolvedAt }`, idempoten (gap yang sudah selesai dikembalikan apa adanya tanpa menulis ulang). 401, 404, 500 `{ error }`.

Otorisasi: `getSession` saja, tanpa `hasAdminPowers` — konsisten dengan route `/api/inbox/*` lain yang sudah ada dan dengan pengecualian CLAUDE.md §6. Route lama `/api/bot/knowledge-gaps` tidak disentuh.

- [x] **Step 1: Tulis test yang gagal — `src/app/api/inbox/gaps/route.test.ts`**

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

function req(query = '', withSession = true) {
  return new Request(`http://localhost/api/inbox/gaps${query}`, {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function gapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    messageId: 'msg_bot',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: new Date('2026-09-12T02:00:00.000Z'),
    conversation: { contact: { name: 'Bruno' } },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeGapLog.count.mockResolvedValue(7 as never)
  mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([gapRow()] as never)
})

describe('GET /api/inbox/gaps', () => {
  it('terbuka untuk AGENT: mengembalikan hitungan semua yang belum selesai dan daftar terbarunya', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      count: 7,
      items: [
        {
          id: 'gap_1',
          conversationId: 'conv_1',
          messageId: 'msg_bot',
          contactName: 'Bruno',
          topic: 'price',
          reason: 'reply_unsourced',
          messageText: 'berapa harga ATV sekarang?',
          createdAt: '2026-09-12T02:00:00.000Z',
        },
      ],
    })
  })

  it('hanya menghitung dan menampilkan gap yang belum selesai, terbaru dulu', async () => {
    await GET(req())

    expect(mockPrisma.knowledgeGapLog.count).toHaveBeenCalledWith({ where: { resolvedAt: null } })
    expect(mockPrisma.knowledgeGapLog.findMany).toHaveBeenCalledWith({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { conversation: { include: { contact: true } } },
    })
  })

  it('menghormati limit dan menolak yang di luar batas', async () => {
    await GET(req('?limit=3'))
    expect(mockPrisma.knowledgeGapLog.findMany.mock.calls[0][0]).toMatchObject({ take: 3 })

    const tooBig = await GET(req('?limit=99'))
    expect(tooBig.status).toBe(400)
    expect(await tooBig.json()).toEqual({ error: 'Parameter limit tidak valid' })
  })

  it('menyaring menurut messageId saat panel mencari gap milik satu jawaban', async () => {
    await GET(req('?messageId=msg_bot&limit=1'))

    expect(mockPrisma.knowledgeGapLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { resolvedAt: null, messageId: 'msg_bot' },
      take: 1,
    })
  })

  it('membawa messageId null untuk baris gap lama', async () => {
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([gapRow({ messageId: null, reason: 'no_facts_resolved' })] as never)
    const body = (await (await GET(req())).json()) as { items: Array<{ messageId: string | null }> }
    expect(body.items[0].messageId).toBeNull()
  })

  it('401 tanpa sesi, tanpa menyentuh database', async () => {
    const res = await GET(req('', false))
    expect(res.status).toBe(401)
    expect(mockPrisma.knowledgeGapLog.count).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila database gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeGapLog.count.mockRejectedValue(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal memuat gap knowledge' })
  })
})
```

- [x] **Step 2: Tulis test yang gagal — `src/app/api/inbox/gaps/[id]/resolve/route.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const params = { params: Promise.resolve({ id: 'gap_1' }) }

function req(withSession = true) {
  return new Request('http://localhost/api/inbox/gaps/gap_1/resolve', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  mockPrisma.knowledgeGapLog.findUnique.mockResolvedValue({ id: 'gap_1', resolvedAt: null } as never)
  mockPrisma.knowledgeGapLog.update.mockResolvedValue({ id: 'gap_1', resolvedAt: new Date('2026-09-12T03:00:00.000Z') } as never)
})

describe('POST /api/inbox/gaps/[id]/resolve', () => {
  it('terbuka untuk AGENT: mengisi resolvedAt', async () => {
    const res = await POST(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'gap_1', resolvedAt: '2026-09-12T03:00:00.000Z' })
    expect(mockPrisma.knowledgeGapLog.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date)
  })

  it('idempoten: gap yang sudah selesai dikembalikan tanpa ditulis ulang', async () => {
    mockPrisma.knowledgeGapLog.findUnique.mockResolvedValue({
      id: 'gap_1',
      resolvedAt: new Date('2026-09-10T01:00:00.000Z'),
    } as never)

    const res = await POST(req(), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'gap_1', resolvedAt: '2026-09-10T01:00:00.000Z' })
    expect(mockPrisma.knowledgeGapLog.update).not.toHaveBeenCalled()
  })

  it('404 untuk gap yang tidak ada, tanpa menulis apa pun', async () => {
    mockPrisma.knowledgeGapLog.findUnique.mockResolvedValue(null as never)
    const res = await POST(req(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Gap tidak ditemukan.' })
    expect(mockPrisma.knowledgeGapLog.update).not.toHaveBeenCalled()
  })

  it('401 tanpa sesi, tanpa menyentuh database', async () => {
    const res = await POST(req(false), params)
    expect(res.status).toBe(401)
    expect(mockPrisma.knowledgeGapLog.findUnique).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila penulisan gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.knowledgeGapLog.update.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menandai gap selesai' })
  })
})
```

- [x] **Step 3: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/app/api/inbox/gaps/route.test.ts "src/app/api/inbox/gaps/[id]/resolve/route.test.ts"`
Expected: FAIL — `Failed to resolve import "./route"` di kedua berkas.

- [x] **Step 4: Implementasi — `src/app/api/inbox/gaps/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
  // Dipakai panel perbaikan untuk menemukan gap milik SATU jawaban, supaya ia bisa menandainya
  // selesai setelah operator menyatakan jawaban barunya sudah sesuai.
  messageId: z.string().trim().min(1).optional(),
})

/**
 * Gap knowledge yang belum ditangani, untuk lonceng di navigasi.
 *
 * `count` sengaja dihitung terpisah dari `items`: lencana menyebut SEMUA yang belum selesai,
 * sementara dropdown hanya memuat beberapa terbaru. Terbuka untuk semua yang login, sama
 * seperti route perbaikan yang dilayaninya (CLAUDE.md §6).
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    messageId: url.searchParams.get('messageId') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Parameter limit tidak valid' }, { status: 400 })

  try {
    const where = { resolvedAt: null, ...(parsed.data.messageId ? { messageId: parsed.data.messageId } : {}) }
    const [count, rows] = await Promise.all([
      prisma.knowledgeGapLog.count({ where }),
      prisma.knowledgeGapLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parsed.data.limit,
        include: { conversation: { include: { contact: true } } },
      }),
    ])

    return NextResponse.json({
      count,
      items: rows.map((gap) => ({
        id: gap.id,
        conversationId: gap.conversationId,
        // Kosong pada baris gap lama (ditulis orchestrator sebelum kolom ini ada) -- lonceng
        // menanganinya dengan hanya membuka percakapannya.
        messageId: gap.messageId,
        contactName: gap.conversation.contact.name,
        topic: gap.topic,
        reason: gap.reason,
        messageText: gap.messageText,
        createdAt: gap.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('GET /api/inbox/gaps gagal', error)
    return NextResponse.json({ error: 'Gagal memuat gap knowledge' }, { status: 500 })
  }
}
```

- [x] **Step 5: Implementasi — `src/app/api/inbox/gaps/[id]/resolve/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'

/**
 * Menandai satu gap selesai. Dipakai tombol "Sudah sesuai" di panel perbaikan (setelah uji
 * ulang) dan tombol "Tandai selesai" di halaman gap.
 *
 * Idempoten: gap yang sudah selesai dikembalikan apa adanya, tanpa memindahkan stempel
 * waktunya -- kapan sesuatu dinyatakan beres adalah fakta yang tidak boleh ditulis ulang oleh
 * klik kedua.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const existing = await prisma.knowledgeGapLog.findUnique({ where: { id }, select: { id: true, resolvedAt: true } })
    if (!existing) return NextResponse.json({ error: 'Gap tidak ditemukan.' }, { status: 404 })
    if (existing.resolvedAt) {
      return NextResponse.json({ id: existing.id, resolvedAt: existing.resolvedAt.toISOString() })
    }

    const saved = await prisma.knowledgeGapLog.update({
      where: { id },
      data: { resolvedAt: new Date() },
      select: { id: true, resolvedAt: true },
    })
    return NextResponse.json({ id: saved.id, resolvedAt: saved.resolvedAt?.toISOString() ?? null })
  } catch (error) {
    console.error('POST /api/inbox/gaps/[id]/resolve gagal', error)
    return NextResponse.json({ error: 'Gagal menandai gap selesai' }, { status: 500 })
  }
}
```

- [x] **Step 6: Jalankan, pastikan LULUS**

Run: `npx vitest run src/app/api/inbox/gaps/route.test.ts "src/app/api/inbox/gaps/[id]/resolve/route.test.ts"`
Expected: PASS (12 test).

- [x] **Step 7: Commit**

```bash
git add src/app/api/inbox/gaps/route.ts src/app/api/inbox/gaps/route.test.ts \
  "src/app/api/inbox/gaps/[id]/resolve/route.ts" "src/app/api/inbox/gaps/[id]/resolve/route.test.ts"
git commit -m "$(cat <<'EOF'
feat(inbox): route daftar gap yang belum selesai dan penanda selesai

Hitungan dipisah dari daftar supaya lencana menyebut semuanya sementara dropdown memuat
beberapa terbaru. Penandaan idempoten: klik kedua tidak memindahkan stempel waktunya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: Lonceng `GapBell` di navigasi

**Files:**
- Create: `src/components/GapBell.tsx` (+ `GapBell.test.tsx`)
- Modify: `src/components/AppRail.tsx` (+ `AppRail.test.tsx`)

**Interfaces:**
- Consumes: `GET /api/inbox/gaps?limit=5` (Task 4); event SSE `knowledge.gap` (Task 3); `fetchJson` (`src/lib/fetch-json.ts`); `cn` (`src/lib/utils.ts`).
- Produces:
  - `export type GapItem = { id: string; conversationId: string; messageId: string | null; contactName: string | null; topic: string; reason: string; messageText: string; createdAt: string }`
  - `export function gapHref(gap: GapItem): string` — `/inbox?conversation=…&message=…`, tanpa `message` bila baris gap lama.
  - `export function GapBell(): JSX.Element`

Lonceng duduk DI DALAM `<nav>` sebagai tujuan kedelapan, memakai kelas yang sama dengan tujuh tautan lain: di ponsel ia ikut baris yang memang sudah dirancang menggulung mendatar, di desktop ia ikut kolom. Dropdown-nya meniru menu akun yang sudah ada (tutup saat klik di luar dan saat Escape, buka ke atas di ponsel dan ke kanan di desktop).

- [x] **Step 1: Tulis test yang gagal — `src/components/GapBell.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { GapBell, gapHref } from './GapBell'

vi.mock('next/link', () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}))

// jsdom tidak punya EventSource; stub minimal yang bisa memancarkan event seperti ThreadView.test.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor() {
    FakeEventSource.instances.push(this)
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

function gap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    messageId: 'msg_bot',
    contactName: 'Bruno',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: '2026-09-12T02:00:00.000Z',
    ...overrides,
  }
}

function stubFeed(feed: { count: number; items: unknown[] }) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => feed }) as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('gapHref', () => {
  it('menyertakan id pesan bila ada', () => {
    expect(gapHref(gap() as never)).toBe('/inbox?conversation=conv_1&message=msg_bot')
  })

  it('hanya membuka percakapan untuk baris gap lama tanpa id pesan', () => {
    expect(gapHref(gap({ messageId: null }) as never)).toBe('/inbox?conversation=conv_1')
  })
})

describe('GapBell', () => {
  it('menampilkan angka gap yang belum ditangani', async () => {
    stubFeed({ count: 3, items: [gap()] })
    render(<GapBell />)
    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByLabelText('Gap knowledge (3 belum ditangani)')).toBeInTheDocument()
  })

  it('tanpa angka sama sekali saat tidak ada gap', async () => {
    stubFeed({ count: 0, items: [] })
    render(<GapBell />)
    await waitFor(() => expect(screen.getByLabelText('Gap knowledge')).toBeInTheDocument())
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('menulis 99+ di atas seratus', async () => {
    stubFeed({ count: 128, items: [] })
    render(<GapBell />)
    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('membuka daftar berisi kontak, topik, pertanyaan, dan tautan lihat semua', async () => {
    stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)

    fireEvent.click(await screen.findByLabelText('Gap knowledge (1 belum ditangani)'))

    expect(screen.getByText(/Bruno/)).toBeInTheDocument()
    expect(screen.getByText('berapa harga ATV sekarang?')).toBeInTheDocument()
    expect(screen.getByText('Jawaban tanpa sumber')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lihat semua' })).toHaveAttribute('href', '/settings/knowledge-gaps')
  })

  it('item menautkan ke percakapan dan pesannya', async () => {
    stubFeed({ count: 2, items: [gap(), gap({ id: 'gap_2', messageId: null, conversationId: 'conv_2', contactName: 'Ayu' })] })
    render(<GapBell />)
    fireEvent.click(await screen.findByLabelText('Gap knowledge (2 belum ditangani)'))

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/inbox?conversation=conv_1&message=msg_bot')
    expect(links[1]).toHaveAttribute('href', '/inbox?conversation=conv_2')
  })

  it('menaikkan angkanya saat event knowledge.gap tiba, tanpa muat ulang halaman', async () => {
    const fetchMock = stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)
    await screen.findByText('1')

    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ count: 2, items: [gap()] }) }) as Response)
    act(() => {
      FakeEventSource.instances[0].emit({ type: 'knowledge.gap', conversationId: 'conv_9' })
    })

    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('mengabaikan event lain', async () => {
    const fetchMock = stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)
    await screen.findByText('1')
    const callsBefore = fetchMock.mock.calls.length

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'message.created', conversationId: 'conv_9', message: { id: 'm1' } })
    })

    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('menutup daftar saat Escape ditekan', async () => {
    stubFeed({ count: 1, items: [gap()] })
    render(<GapBell />)
    fireEvent.click(await screen.findByLabelText('Gap knowledge (1 belum ditangani)'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/GapBell.test.tsx`
Expected: FAIL — `Failed to resolve import "./GapBell"`.

- [x] **Step 3: Implementasi — `src/components/GapBell.tsx`**

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/fetch-json'

export type GapItem = {
  id: string
  conversationId: string
  /** Kosong pada baris gap lama, yang ditulis sebelum kolomnya ada. */
  messageId: string | null
  contactName: string | null
  topic: string
  reason: string
  messageText: string
  createdAt: string
}

type GapFeed = { count: number; items: GapItem[] }

const REASON_LABEL: Record<string, string> = {
  reply_unsourced: 'Jawaban tanpa sumber',
  no_facts_resolved: 'Tidak ada fakta',
  verification_failed: 'Gagal verifikasi',
}

/**
 * Tanpa id pesan, notifikasi hanya bisa membuka percakapannya -- menebak gelembung mana yang
 * dimaksud (mis. "balasan bot terakhir") akan menyorot jawaban yang salah begitu ada balasan
 * lain sesudahnya.
 */
export function gapHref(gap: GapItem): string {
  const conversation = `/inbox?conversation=${encodeURIComponent(gap.conversationId)}`
  return gap.messageId ? `${conversation}&message=${encodeURIComponent(gap.messageId)}` : conversation
}

/**
 * Lonceng gap knowledge: berapa jawaban bot yang masih menunggu diajari, dan jalan tercepat ke
 * salah satunya. Angka naik seketika lewat event `knowledge.gap`; daftarnya diambil ulang dari
 * API supaya event-nya tidak perlu membawa isi percakapan ke setiap tab yang terbuka.
 */
export function GapBell() {
  const [feed, setFeed] = useState<GapFeed>({ count: 0, items: [] })
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetchJson<GapFeed>('/api/inbox/gaps?limit=5')
        .then((next) => {
          if (!cancelled) setFeed(next)
        })
        // Ditelan: lonceng adalah tambahan di atas navigasi, dan kegagalan memuatnya tidak
        // boleh mengubah apa pun di halaman yang sedang dibaca operator.
        .catch(() => {})
    }

    load()
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'knowledge.gap') load()
    }
    return () => {
      cancelled = true
      es.close()
    }
  }, [])

  // Pola yang sama dengan menu akun di AppRail: dropdown di rail yang ada di setiap halaman
  // harus bisa ditutup tanpa memilih apa pun.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={feed.count > 0 ? `Gap knowledge (${feed.count} belum ditangani)` : 'Gap knowledge'}
        className={cn(
          'focus-ring-inverse flex w-16 shrink-0 flex-col items-center justify-start gap-1 rounded-md px-0.5 py-2',
          'text-center text-[10px] leading-[1.15] font-medium tracking-tight transition-colors',
          'text-white/70 hover:bg-white/10 hover:text-white md:w-full'
        )}
      >
        <span className="relative">
          <Bell aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
          {feed.count > 0 && (
            <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-danger px-1 text-[9px] leading-4 font-semibold text-white tabular-nums">
              {feed.count > 99 ? '99+' : feed.count}
            </span>
          )}
        </span>
        <span className="w-full">Gap</span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute bottom-full left-0 z-30 mb-2 w-72 rounded-lg border border-line bg-surface p-1 shadow-popover',
            'md:bottom-0 md:left-full md:mb-0 md:ml-2'
          )}
        >
          <p className="px-2 py-1.5 text-xs font-medium text-ink">Jawaban yang perlu knowledge</p>
          {feed.items.length === 0 ? (
            <p className="px-2 pb-2 text-xs text-ink-muted">
              Tidak ada yang menunggu. Setiap jawaban bot terakhir bersandar pada fakta.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {feed.items.map((gap) => (
                <li key={gap.id}>
                  <Link
                    href={gapHref(gap)}
                    onClick={() => setOpen(false)}
                    className="focus-ring block rounded-md px-2 py-1.5 hover:bg-surface-sunken"
                  >
                    <span className="block text-xs font-medium text-ink">
                      {gap.contactName ?? gap.conversationId} · {gap.topic}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">{gap.messageText}</span>
                    <span className="block text-[11px] text-ink-subtle">{REASON_LABEL[gap.reason] ?? gap.reason}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/settings/knowledge-gaps"
            onClick={() => setOpen(false)}
            className="focus-ring mt-1 block border-t border-line px-2 pt-2 pb-1 text-xs font-medium text-accent hover:underline"
          >
            Lihat semua
          </Link>
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

Run: `npx vitest run src/components/GapBell.test.tsx`
Expected: PASS (10 test).

- [x] **Step 5: Tulis test yang gagal — `src/components/AppRail.test.tsx`**

`GapBell` di-mock di sini dengan sengaja: `stubApi` melempar untuk URL yang tidak dikenal, dan test rail tidak seharusnya ikut menyiapkan `EventSource` serta `/api/inbox/gaps` hanya untuk membuktikan loncengnya terpasang.

Tambahkan mock setelah baris `vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))`:

```tsx
vi.mock('./GapBell', () => ({ GapBell: () => <div data-testid="gap-bell" /> }))
```

Tambahkan test ini di akhir berkas:

```tsx
describe('AppRail — lonceng gap', () => {
  it('memasang lonceng tepat satu kali, di dalam menu utama', async () => {
    stubApi()
    render(<AppRail />)

    const bell = await screen.findByTestId('gap-bell')
    expect(bell).toBeInTheDocument()
    expect(screen.getAllByTestId('gap-bell')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Menu utama' })).toContainElement(bell)
  })
})
```

- [x] **Step 6: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/AppRail.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="gap-bell"]`.

- [x] **Step 7: Implementasi — `src/components/AppRail.tsx`**

Tambahkan impor setelah baris `import { Tooltip } from '@/components/ui/tooltip'`:

```ts
import { GapBell } from '@/components/GapBell'
```

Ganti:

```tsx
              <span className="w-full">{item.label}</span>
            </Link>
          )
        })}
      </nav>
```

menjadi:

```tsx
              <span className="w-full">{item.label}</span>
            </Link>
          )
        })}

        {/* Tujuan kedelapan, di dalam baris yang sama: di ponsel ia ikut menggulung mendatar
            bersama tujuh lainnya (lihat alasan di komentar <nav> di atas), di desktop ia ikut
            kolom. Bukan tautan, karena isinya daftar yang dibuka di tempat. */}
        <GapBell />
      </nav>
```

- [x] **Step 8: Jalankan, pastikan LULUS**

Run: `npx vitest run src/components/AppRail.test.tsx src/components/GapBell.test.tsx`
Expected: PASS, termasuk seluruh test lama `AppRail.test.tsx` (daftar tujuan, aturan aktif, menu akun).

- [x] **Step 9: Commit**

```bash
git add src/components/GapBell.tsx src/components/GapBell.test.tsx \
  src/components/AppRail.tsx src/components/AppRail.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): lonceng gap knowledge di navigasi

Angka naik seketika lewat event knowledge.gap; daftarnya diambil ulang dari API supaya
event-nya tidak membawa isi percakapan ke setiap tab. Baris gap lama tanpa id pesan hanya
membuka percakapannya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 6: Lompat ke pesan — `?message=`, sorotan, dan panel yang membuka sendiri

**Files:**
- Modify: `src/app/(authenticated)/inbox/page.tsx` (+ `page.test.tsx`)
- Modify: `src/components/inbox/ThreadView.tsx` (+ `ThreadView.test.tsx`)
- Modify: `src/components/inbox/MessageBubble.tsx` (+ `MessageBubble.test.tsx`)

**Interfaces:**
- Consumes: `gapHref` (Task 5) yang menghasilkan `/inbox?conversation=…&message=…`.
- Produces:
  - `ThreadView` props bertambah `focusMessageId?: string`
  - `MessageBubble` props bertambah `autoOpenFix?: boolean`
  - Halaman Inbox membaca `?message=` sekali saat mount, dan melepasnya begitu operator memilih percakapan lain.

Gulungan awal `ThreadView` sudah ada dan berjalan sekali per percakapan (`hasScrolledRef`); pesan yang diminta hanya menjadi sasaran baru dengan prioritas tertinggi, mendahului pembatas "belum dibaca".

- [x] **Step 1: Tulis test yang gagal — `src/app/(authenticated)/inbox/page.test.tsx`**

Ganti:

```tsx
vi.mock('@/components/inbox/ThreadView', () => ({
  ThreadView: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="thread-view">{conversationId}</div>
  ),
}))
```

menjadi:

```tsx
vi.mock('@/components/inbox/ThreadView', () => ({
  ThreadView: ({ conversationId, focusMessageId }: { conversationId: string; focusMessageId?: string }) => (
    <div data-testid="thread-view" data-focus-message-id={focusMessageId ?? ''}>
      {conversationId}
    </div>
  ),
}))
```

Tambahkan di akhir berkas:

```tsx
describe('InboxPage deep link via ?message=', () => {
  it('meneruskan pesan yang diminta ke ThreadView', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_bot')

    render(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', 'msg_bot')
  })

  it('tanpa ?message= tidak ada pesan yang disorot', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1')

    render(<InboxPage />)

    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', '')
  })

  it('melepas sorotan begitu operator berpindah percakapan', () => {
    mockSearchParams = new URLSearchParams('conversation=conv_1&message=msg_bot')

    render(<InboxPage />)
    fireEvent.click(screen.getByText('select conv_clicked'))

    expect(screen.getByTestId('thread-view')).toHaveTextContent('conv_clicked')
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-focus-message-id', '')
  })
})
```

- [x] **Step 2: Tulis test yang gagal — `src/components/inbox/MessageBubble.test.tsx`**

Tambahkan di akhir `describe('MessageBubble — Perbaiki', ...)`, setelah test terakhirnya:

```tsx
  it('membuka panel perbaikan sendiri saat diminta lewat autoOpenFix', () => {
    render(<MessageBubble message={botReply} autoOpenFix />)
    expect(screen.getByText('panel perbaikan msg_bot')).toBeInTheDocument()
  })

  it('autoOpenFix pada pesan bukan-bot tidak membuka apa pun', () => {
    render(<MessageBubble message={{ ...botReply, sentBy: 'AGENT', botTrace: null }} autoOpenFix />)
    expect(screen.queryByText('panel perbaikan msg_bot')).not.toBeInTheDocument()
  })
```

- [x] **Step 3: Tulis test yang gagal — `src/components/inbox/ThreadView.test.tsx`**

Tambahkan di akhir berkas:

```tsx
describe('ThreadView — lompat ke pesan tertentu', () => {
  const inbound = {
    id: 'm_in',
    direction: 'INBOUND',
    content: 'berapa harga ATV sekarang?',
    channel: 'OFFICIAL',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    createdAt: new Date().toISOString(),
    botTrace: null,
    topicLabels: null,
  }
  const botReply = {
    id: 'm_bot',
    direction: 'OUTBOUND',
    content: 'Harga ATV mulai Rp350.000.',
    channel: 'OFFICIAL',
    sentBy: 'BOT',
    deliveryStatus: 'SENT',
    createdAt: new Date().toISOString(),
    botTrace: { mode: 'faq', draft: 'Harga ATV mulai Rp350.000.', sourceTopic: 'price' },
    topicLabels: null,
  }

  function stubThread(messages: unknown[]) {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url)
      if (s.endsWith('/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response)
      if (s.endsWith('/api/accounts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ botEnabled: false, assignedAgentId: null }) } as Response)
    })
  }

  it('menggulung ke pesan yang diminta, bukan ke bawah', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    stubThread([inbound, botReply])

    render(<ThreadView conversationId="conv_1" focusMessageId="m_bot" />)

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' }))
    scrollSpy.mockRestore()
  })

  it('membuka panel perbaikan untuk pesan yang diminta', async () => {
    stubThread([inbound, botReply])

    render(<ThreadView conversationId="conv_1" focusMessageId="m_bot" />)

    expect(await screen.findByText('Perbaiki jawaban bot')).toBeInTheDocument()
  })

  it('tanpa focusMessageId, panel perbaikan tidak terbuka sendiri', async () => {
    stubThread([inbound, botReply])

    render(<ThreadView conversationId="conv_1" />)

    await waitFor(() => expect(screen.getByText('Harga ATV mulai Rp350.000.')).toBeInTheDocument())
    expect(screen.queryByText('Perbaiki jawaban bot')).not.toBeInTheDocument()
  })
})
```

- [x] **Step 4: Jalankan, pastikan GAGAL**

Run: `npx vitest run "src/app/(authenticated)/inbox/page.test.tsx" src/components/inbox/MessageBubble.test.tsx src/components/inbox/ThreadView.test.tsx`
Expected: FAIL — `data-focus-message-id` bernilai `''` padahal diharapkan `msg_bot`; panel tidak terbuka pada test `autoOpenFix`; `scrollIntoView` tidak pernah dipanggil dengan `{ block: 'center' }`.

- [x] **Step 5: Implementasi — `src/components/inbox/MessageBubble.tsx`**

Ganti:

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

menjadi:

```tsx
export function MessageBubble({
  message,
  onReply,
  conversationId,
  autoOpenFix,
}: {
  message: MessageView
  onReply?: (message: MessageView) => void
  /** Dibutuhkan route "Cek topik"; tanpa ini ikonnya tidak tampil. */
  conversationId?: string
  /** Dipakai saat operator tiba dari notifikasi gap: panel perbaikan terbuka tanpa satu klik lagi. */
  autoOpenFix?: boolean
}) {
```

Ganti:

```tsx
  const [showFix, setShowFix] = useState(false)
```

menjadi:

```tsx
  // Nilai awal, bukan efek: gelembung ini dirender ulang saat pesannya berubah, dan sebuah efek
  // akan membuka kembali panel yang baru saja ditutup operator.
  const [showFix, setShowFix] = useState(Boolean(autoOpenFix))
```

- [x] **Step 6: Implementasi — `src/components/inbox/ThreadView.tsx`**

6a. Ganti:

```tsx
export function ThreadView({
  conversationId,
  onBack,
  contactPanelOpen,
  onToggleContactPanel,
  className,
}: {
  conversationId: string
  /** Hanya dirender di bawah md, tempat tiga kolom menjadi satu kolom bertingkat. */
  onBack?: () => void
  contactPanelOpen?: boolean
  onToggleContactPanel?: () => void
  className?: string
}) {
```

menjadi:

```tsx
export function ThreadView({
  conversationId,
  onBack,
  contactPanelOpen,
  onToggleContactPanel,
  className,
  focusMessageId,
}: {
  conversationId: string
  /** Hanya dirender di bawah md, tempat tiga kolom menjadi satu kolom bertingkat. */
  onBack?: () => void
  contactPanelOpen?: boolean
  onToggleContactPanel?: () => void
  className?: string
  /**
   * Pesan yang harus dituju saat thread dibuka dari notifikasi gap (`/inbox?...&message=<id>`):
   * digulung ke tengah layar, disorot, dan panel perbaikannya dibuka.
   */
  focusMessageId?: string
}) {
```

6b. Ganti:

```tsx
  const unreadDividerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
```

menjadi:

```tsx
  const unreadDividerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
```

6c. Ganti:

```tsx
    const target = unreadDividerRef.current ?? bottomRef.current
    target?.scrollIntoView({ block: unreadDividerRef.current ? 'start' : 'end' })
```

menjadi:

```tsx
    // Pesan yang diminta notifikasi menang atas pembatas "belum dibaca": operator sampai di
    // sini justru untuk melihat jawaban itu, bukan untuk melanjutkan bacaan.
    if (focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'center' })
      return
    }
    const target = unreadDividerRef.current ?? bottomRef.current
    target?.scrollIntoView({ block: unreadDividerRef.current ? 'start' : 'end' })
```

6d. Ganti:

```tsx
        {messages.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || !isSameDay(new Date(m.createdAt), new Date(messages[i - 1].createdAt))) && (
              <ThreadDivider label={dayDividerLabel(m.createdAt)} />
            )}
            {i === firstUnreadIndex && (
              <ThreadDivider label="Pesan belum dibaca" tone="accent" innerRef={unreadDividerRef} />
            )}
            <MessageBubble message={m} onReply={setReplyingTo} conversationId={conversationId} />
          </div>
        ))}
```

menjadi:

```tsx
        {messages.map((m, i) => {
          const focused = m.id === focusMessageId
          return (
            <div
              key={m.id}
              ref={focused ? focusRef : undefined}
              className={cn(focused && 'rounded-lg ring-2 ring-accent/40')}
            >
              {(i === 0 || !isSameDay(new Date(m.createdAt), new Date(messages[i - 1].createdAt))) && (
                <ThreadDivider label={dayDividerLabel(m.createdAt)} />
              )}
              {i === firstUnreadIndex && (
                <ThreadDivider label="Pesan belum dibaca" tone="accent" innerRef={unreadDividerRef} />
              )}
              <MessageBubble
                message={m}
                onReply={setReplyingTo}
                conversationId={conversationId}
                autoOpenFix={focused}
              />
            </div>
          )
        })}
```

- [x] **Step 7: Implementasi — `src/app/(authenticated)/inbox/page.tsx`**

7a. Ganti:

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('conversation'))
```

menjadi:

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('conversation'))
  // Dibaca sekali, dengan alasan yang sama seperti `conversation` di atas. Dilepas begitu
  // operator berpindah percakapan: menyorot pesan milik percakapan lain tidak berarti apa-apa.
  const [focusMessageId, setFocusMessageId] = useState<string | null>(() => searchParams.get('message'))
```

7b. Ganti:

```tsx
      <ConversationList
        selectedId={selectedId}
        onSelect={setSelectedId}
        className={cn(selectedId && 'max-md:hidden')}
      />
```

menjadi:

```tsx
      <ConversationList
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id)
          setFocusMessageId(null)
        }}
        className={cn(selectedId && 'max-md:hidden')}
      />
```

7c. Ganti:

```tsx
          <ThreadView
            key={`thread-${selectedId}`}
            conversationId={selectedId}
```

menjadi:

```tsx
          <ThreadView
            key={`thread-${selectedId}`}
            conversationId={selectedId}
            focusMessageId={focusMessageId ?? undefined}
```

- [x] **Step 8: Jalankan, pastikan LULUS**

Run: `npx vitest run "src/app/(authenticated)/inbox/page.test.tsx" src/components/inbox/MessageBubble.test.tsx src/components/inbox/ThreadView.test.tsx`
Expected: PASS, termasuk test lama (gulungan ke pembatas "belum dibaca" tetap berjalan saat tidak ada pesan yang diminta).

- [x] **Step 9: Commit**

```bash
git add "src/app/(authenticated)/inbox/page.tsx" "src/app/(authenticated)/inbox/page.test.tsx" \
  src/components/inbox/ThreadView.tsx src/components/inbox/ThreadView.test.tsx \
  src/components/inbox/MessageBubble.tsx src/components/inbox/MessageBubble.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): notifikasi gap melompat ke gelembung jawabannya

?message= menggulung ke pesan itu, menyorotnya, dan membuka panel perbaikan. Tanpa
parameter itu perilaku thread tidak berubah sama sekali.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 7: Uji ulang — `SimulationResult.knowledge` dan route `/api/inbox/retest`

**Files:**
- Modify: `src/lib/bot-control/simulator.ts` (+ `simulator.test.ts`)
- Create: `src/app/api/inbox/retest/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: `runSimulation(request: SimulationRequest): Promise<SimulationResult>` (`src/lib/bot-control/simulator.ts:106`), dengan `SimulationRequest = { message: string; conversationId?: string; contactPhone?: string; contactName?: string; useExistingHistory?: boolean; dryRun?: boolean }`; `getSession`; `parseJsonBody`.
- Produces:
  - `SimulationResult` bertambah `knowledge: DecisionKnowledge | null` — fakta yang benar-benar dipakai giliran simulasi, termasuk `attributions`.
  - `POST /api/inbox/retest` dengan body `{ message: string; conversationId: string }` → 200 `SimulationResult`; 401; 400; 500 `{ error }`.

Ini satu-satunya perubahan pada `simulator.ts`: penambahan field, tanpa menyentuh jalur sandbox, pemulihan, maupun larangan mengirimnya. Otorisasi `/api/bot-control/simulate` yang lama tetap khusus admin; route baru inilah yang terbuka untuk semua yang login (spec §2).

- [x] **Step 1: Tulis test yang gagal — `src/lib/bot-control/simulator.test.ts`**

Tambahkan di akhir berkas:

```ts
describe('knowledge pada hasil simulasi', () => {
  it('membawa fakta dan pemetaan paragraf apa adanya dari keputusan', async () => {
    const knowledge = {
      catalogLines: [],
      managedLines: [{ line: 'ATV 1 jam: IDR 350000', source: 'FAQ Harga ATV (v2)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 2 }],
      rejected: [],
      gateBypassed: false,
      attributions: [
        { paragraph: 0, lines: [{ kind: 'managed' as const, line: 'ATV 1 jam: IDR 350000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 2 }] },
      ],
    }
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Harga ATV Rp350.000.', sourceTopic: 'price', knowledge })

    const result = await runSimulation({ message: 'berapa harga ATV?' })

    expect(result.knowledge).toEqual(knowledge)
  })

  it('null saat keputusan tidak membawa knowledge sama sekali', async () => {
    vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'clarify', reply: 'Ke mana?' })

    const result = await runSimulation({ message: 'halo' })

    expect(result.knowledge).toBeNull()
  })
})
```

- [x] **Step 2: Tulis test yang gagal — `src/app/api/inbox/retest/route.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { runSimulation } from '@/lib/bot-control/simulator'
import { sendMessage } from '@/lib/send'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/simulator', () => ({ runSimulation: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

const result = {
  mode: 'faq',
  reply: 'Harga ATV Rp400.000.',
  status: 'WOULD_REPLY',
  flowSteps: [],
  knowledgeRefs: { sourceTopic: 'price' },
  knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, attributions: [] },
  verification: null,
  warnings: ['Simulasi dijalankan pada percakapan sandbox, bukan percakapan aslinya.'],
  wouldSendViaChannel: 'UNOFFICIAL',
  decisionRunId: 'run_sim_1',
  latencyMs: 1200,
}

function req(body: unknown, withSession = true) {
  return new Request('http://localhost/api/inbox/retest', {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(runSimulation).mockResolvedValue(result as never)
})

describe('POST /api/inbox/retest', () => {
  it('terbuka untuk AGENT, dan menjalankan simulasi dengan konteks percakapan aslinya', async () => {
    const res = await POST(req({ message: 'berapa harga ATV sekarang?', conversationId: 'conv_1' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
    expect(runSimulation).toHaveBeenCalledWith({
      message: 'berapa harga ATV sekarang?',
      conversationId: 'conv_1',
      useExistingHistory: true,
    })
  })

  it('tidak pernah mengirim apa pun ke pelanggan', async () => {
    await POST(req({ message: 'berapa harga ATV sekarang?', conversationId: 'conv_1' }))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('401 tanpa sesi, tanpa menjalankan simulasi', async () => {
    const res = await POST(req({ message: 'x', conversationId: 'conv_1' }, false))
    expect(res.status).toBe(401)
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('400 lewat Zod: pesan kosong, percakapan kosong, atau field tambahan', async () => {
    for (const body of [
      { message: '', conversationId: 'conv_1' },
      { message: 'x', conversationId: '' },
      { message: 'x', conversationId: 'conv_1', dryRun: false },
    ]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Data uji ulang tidak valid' })
    }
    expect(runSimulation).not.toHaveBeenCalled()
  })

  it('500 dengan bentuk { error } bila simulasi gagal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(runSimulation).mockRejectedValue(new Error('ollama down'))
    const res = await POST(req({ message: 'x', conversationId: 'conv_1' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menjalankan uji ulang' })
  })
})
```

- [x] **Step 3: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/lib/bot-control/simulator.test.ts src/app/api/inbox/retest/route.test.ts`
Expected: FAIL — `result.knowledge` undefined di simulator.test; `Failed to resolve import "./route"` di route.test.

- [x] **Step 4: Implementasi — `src/lib/bot-control/simulator.ts`**

4a. Ganti:

```ts
import type { BotDecision, TraceStep } from '@/lib/bot/types'
```

menjadi:

```ts
import type { BotDecision, DecisionKnowledge, TraceStep } from '@/lib/bot/types'
```

4b. Ganti (blok ini hanya ada di `simulator.ts`; `TestLab.tsx` punya tipe lokalnya sendiri yang mirip):

```ts
export type SimulationResult = {
  mode: string
  reply: string | null
  status: SimulationStatus
  flowSteps: TraceStep[]
  knowledgeRefs: { sourceTopic?: string } | null
```

menjadi:

```ts
export type SimulationResult = {
  mode: string
  reply: string | null
  status: SimulationStatus
  flowSteps: TraceStep[]
  knowledgeRefs: { sourceTopic?: string } | null
  /**
   * Fakta yang benar-benar dipakai giliran ini, beserta pemetaan paragrafnya
   * (`attributions`). Dipakai panel perbaikan di Inbox untuk menjawab satu pertanyaan yang
   * tidak bisa dijawab teks balasannya sendiri: apakah jawaban barunya bersandar pada entri
   * yang baru saja disimpan, atau kebetulan terdengar benar.
   */
  knowledge: DecisionKnowledge | null
```

4c. Ganti:

```ts
    knowledgeRefs: decision?.mode === 'faq' ? { sourceTopic: decision.sourceTopic } : null,
```

menjadi:

```ts
    knowledgeRefs: decision?.mode === 'faq' ? { sourceTopic: decision.sourceTopic } : null,
    knowledge: decision?.knowledge ?? null,
```

- [x] **Step 5: Implementasi — `src/app/api/inbox/retest/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { runSimulation } from '@/lib/bot-control/simulator'

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(5000),
    conversationId: z.string().trim().min(1),
  })
  .strict()

/**
 * Uji ulang satu pertanyaan pelanggan setelah knowledge-nya diperbaiki.
 *
 * Terbuka untuk semua yang login, berbeda dari `/api/bot-control/simulate` yang khusus admin:
 * siapa pun yang boleh MENGUBAH jawaban bot (CLAUDE.md §6, pengecualian perbaikan dari Inbox)
 * harus boleh MENGUJINYA, dan menguji adalah tindakan yang lebih aman dari keduanya.
 * `runSimulation` kering — ia berjalan di percakapan sandbox, mengembalikannya seperti semula,
 * dan dilarang memanggil `sendMessage` atau membuat `OutboundJob` (dijaga test simulator).
 *
 * `useExistingHistory: true`: yang diuji adalah pertanyaan itu DENGAN konteks percakapan
 * aslinya, karena jawaban yang benar untuk pelanggan ini yang sedang diperiksa.
 */
export async function POST(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const parsed = await parseJsonBody(req, bodySchema, 'Data uji ulang tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const result = await runSimulation({
      message: parsed.data.message,
      conversationId: parsed.data.conversationId,
      useExistingHistory: true,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/inbox/retest gagal', error)
    return NextResponse.json({ error: 'Gagal menjalankan uji ulang' }, { status: 500 })
  }
}
```

- [x] **Step 6: Jalankan, pastikan LULUS (termasuk penjaga "simulator tidak mengirim")**

Run: `npx vitest run src/lib/bot-control/simulator.test.ts src/app/api/inbox/retest/route.test.ts src/app/api/bot-control/simulate/route.test.ts src/components/bot-control/TestLab.test.tsx`
Expected: PASS — Test Lab dan route simulate lama tidak berubah perilakunya.

- [x] **Step 7: Commit**

```bash
git add src/lib/bot-control/simulator.ts src/lib/bot-control/simulator.test.ts \
  src/app/api/inbox/retest/route.ts src/app/api/inbox/retest/route.test.ts
git commit -m "$(cat <<'EOF'
feat(inbox): route uji ulang untuk semua yang login, hasilnya membawa knowledge

Memakai runSimulation yang sama (kering, dilarang mengirim) dengan konteks percakapan asli.
SimulationResult kini membawa knowledge supaya panel bisa menyatakan jawaban barunya
bersumber dari entri yang baru disimpan atau tidak.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 8: Putaran uji ulang di `FixAnswerPanel`

**Files:**
- Modify: `src/components/bot-control/KnowledgeEditor.tsx` (+ `KnowledgeEditor.test.tsx`)
- Modify: `src/components/inbox/FixAnswerPanel.tsx` (+ `FixAnswerPanel.test.tsx`)

**Interfaces:**
- Consumes: `POST /api/inbox/retest` (Task 7), `GET /api/inbox/gaps?messageId=` dan `POST /api/inbox/gaps/[id]/resolve` (Task 4), `POST /api/inbox/decisions/[id]/fix` (sudah ada, mengembalikan `{ sourceId, revisionId, version, status, title, flagged }`), `GET /api/bot-control/decisions/[id]` (sudah ada, mengembalikan `conversationId`).
- Produces:
  - `KnowledgeEditor` props bertambah `initialReason?: string` (tanpa prop, perilakunya tidak berubah).
  - `FixAnswerPanel` menjalankan uji ulang sendiri setelah revisi aktif, menanyakan kesesuaian, dan menutup gap saat dijawab "sudah sesuai".

Putarannya: simpan → uji ulang otomatis → "sudah sesuai?" → **Sudah** menutup gap dan selesai; **Belum** meminta catatan (minimal 10 karakter) lalu membuka editor lagi untuk entri yang sama dengan catatan itu sebagai alasan revisi berikutnya.

- [x] **Step 1: Tulis test yang gagal — `src/components/bot-control/KnowledgeEditor.test.tsx`**

Tambahkan di dalam `describe('KnowledgeEditor', ...)`, setelah test terakhirnya:

```tsx
  it('mengisi alasan dari initialReason, supaya putaran perbaikan tidak menyuruh mengetik ulang', () => {
    renderEditor({ activateOnly: true, initialReason: 'Harganya masih yang lama, seharusnya Rp400.000' })
    expect(screen.getByLabelText('Alasan perubahan')).toHaveValue('Harganya masih yang lama, seharusnya Rp400.000')
  })

  it('tanpa initialReason alasannya tetap kosong seperti sebelumnya', () => {
    renderEditor()
    expect(screen.getByLabelText('Alasan perubahan')).toHaveValue('')
  })
```

- [x] **Step 2: Implementasi — `src/components/bot-control/KnowledgeEditor.tsx`**

2a. Ganti:

```tsx
  onSave,
  activateOnly = false,
}: {
```

menjadi:

```tsx
  onSave,
  activateOnly = false,
  initialReason,
}: {
```

2b. Ganti:

```tsx
  /** Hanya "Simpan & aktifkan" (panel perbaikan di Inbox). Tanpa prop ini perilaku tidak berubah. */
  activateOnly?: boolean
}) {
```

menjadi:

```tsx
  /** Hanya "Simpan & aktifkan" (panel perbaikan di Inbox). Tanpa prop ini perilaku tidak berubah. */
  activateOnly?: boolean
  /**
   * Alasan yang sudah terisi saat editor dibuka. Dipakai putaran uji ulang: kalimat operator
   * tentang apa yang masih salah ADALAH alasan revisi berikutnya, jadi ia tidak perlu
   * menuliskannya dua kali.
   */
  initialReason?: string
}) {
```

2c. Ganti:

```tsx
  const [reason, setReason] = useState('')
```

menjadi:

```tsx
  const [reason, setReason] = useState(initialReason ?? '')
```

- [x] **Step 3: Jalankan, pastikan LULUS**

Run: `npx vitest run src/components/bot-control/KnowledgeEditor.test.tsx`
Expected: PASS, termasuk seluruh test lama.

- [x] **Step 4: Tulis test yang gagal — `src/components/inbox/FixAnswerPanel.test.tsx`**

4a. Panel sekarang mencari gap milik pesan ini saat dibuka, jadi rute itu harus ada di setiap skenario. Ganti:

```tsx
const RUN_ROUTES: Record<string, Route> = {
  'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { body: { items: [{ id: 'run_1' }] } },
  'GET /api/bot-control/decisions/run_1': { body: { id: 'run_1', inboundText: QUESTION, replyText: 'Harga ATV Rp350.000.' } },
}
```

menjadi:

```tsx
const RUN_ROUTES: Record<string, Route> = {
  'GET /api/bot-control/decisions?messageId=msg_bot&limit=1': { body: { items: [{ id: 'run_1' }] } },
  'GET /api/bot-control/decisions/run_1': {
    body: { id: 'run_1', conversationId: 'conv_1', inboundText: QUESTION, replyText: 'Harga ATV Rp350.000.' },
  },
  'GET /api/inbox/gaps?messageId=msg_bot&limit=1': { body: { count: 1, items: [{ id: 'gap_1' }] } },
}

const SAVED = { sourceId: 'ks_1', revisionId: 'krev_4', version: 4, status: 'PUBLISHED', title: 'FAQ Harga ATV', flagged: true }

const KNOWLEDGE_ROUTE: Record<string, Route> = {
  'GET /api/inbox/knowledge/ks_1': {
    body: { title: 'FAQ Harga ATV', summary: null, items: [{ question: 'Berapa harga ATV?', answer: 'Mulai Rp350.000.' }], version: 3 },
  },
}

/** Hasil uji ulang: jawaban baru yang paragrafnya cocok dengan entri `ks_1`. */
function retestBody(overrides: Record<string, unknown> = {}) {
  return {
    reply: 'Harga ATV mulai Rp400.000 per orang.',
    knowledge: {
      catalogLines: [],
      managedLines: [{ line: 'ATV 1 jam: IDR 400000', source: 'FAQ Harga ATV (v4)', sourceId: 'ks_1', sourceKey: 'managed/atv', version: 4 }],
      rejected: [],
      gateBypassed: false,
      attributions: [{ paragraph: 0, lines: [{ kind: 'managed', line: 'ATV 1 jam: IDR 400000', sourceId: 'ks_1', title: 'FAQ Harga ATV', version: 4 }] }],
    },
    ...overrides,
  }
}

/** Menyimpan dari editor yang sudah terbuka, sampai revisi aktif. */
async function saveFromEditor(answer = 'Mulai Rp400.000.') {
  fireEvent.change(screen.getByLabelText('Jawaban item 1'), { target: { value: answer } })
  fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
  fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))
}
```

4b. Tambahkan di akhir `describe('FixAnswerPanel', ...)`:

```tsx
  it('menguji ulang sendiri setelah revisi aktif, dan menyatakan jawabannya bersumber dari entri baru', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    await saveFromEditor()

    expect(await screen.findByText('Harga ATV mulai Rp400.000 per orang.')).toBeInTheDocument()
    expect(screen.getByText('Bersumber dari entri yang baru disimpan.')).toBeInTheDocument()
    expect(screen.getByText('Jawaban ini sudah sesuai?')).toBeInTheDocument()

    const retestCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/inbox/retest')
    expect(JSON.parse(String(retestCall?.[1]?.body))).toEqual({ message: QUESTION, conversationId: 'conv_1' })
  })

  it('"Sudah sesuai" menutup gap dan mengakhiri putaran', async () => {
    const fetchMock = stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
      'POST /api/inbox/gaps/gap_1/resolve': { body: { id: 'gap_1', resolvedAt: '2026-09-12T03:00:00.000Z' } },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    await saveFromEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Sudah sesuai' }))

    expect(await screen.findByText('Gap ditandai selesai.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/inbox/gaps/gap_1/resolve')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Belum sesuai' })).not.toBeInTheDocument()
  })

  it('"Belum sesuai" membuka editor lagi dengan catatan operator sebagai alasan revisi berikutnya', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    await saveFromEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Belum sesuai' }))

    const note = 'Harga ATV per orang belum disebut, hanya per jam'
    fireEvent.change(screen.getByLabelText('Apa yang masih belum benar?'), { target: { value: note } })
    fireEvent.click(screen.getByRole('button', { name: 'Perbaiki lagi' }))

    expect(await screen.findByDisplayValue('Mulai Rp350.000.')).toBeInTheDocument()
    expect(screen.getByLabelText('Alasan perubahan')).toHaveValue(note)
  })

  it('menolak "Perbaiki lagi" sebelum catatannya cukup panjang', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody() },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    await saveFromEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Belum sesuai' }))

    fireEvent.change(screen.getByLabelText('Apa yang masih belum benar?'), { target: { value: 'salah' } })
    expect(screen.getByRole('button', { name: 'Perbaiki lagi' })).toBeDisabled()
  })

  it('mengatakan apa adanya saat jawaban barunya tetap tidak bersumber', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { body: retestBody({ knowledge: { catalogLines: [], managedLines: [], rejected: [], gateBypassed: false, attributions: [] } }) },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    await saveFromEditor()

    expect(await screen.findByText('Belum bersumber: tidak ada paragraf yang cocok dengan fakta mana pun.')).toBeInTheDocument()
  })

  it('kegagalan uji ulang tidak menghapus hasil simpan, dan bisa diulang', async () => {
    stubFetch({
      ...RUN_ROUTES,
      ...KNOWLEDGE_ROUTE,
      'POST /api/inbox/decisions/run_1/fix': { body: SAVED },
      'POST /api/inbox/retest': { status: 500, body: { error: 'Gagal menjalankan uji ulang' } },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByDisplayValue('Mulai Rp350.000.')
    await saveFromEditor()

    expect(await screen.findByText('Aktif: FAQ Harga ATV v4')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal menjalankan uji ulang')
    expect(screen.getByRole('button', { name: 'Coba uji ulang lagi' })).toBeInTheDocument()
  })
```

- [x] **Step 5: Jalankan, pastikan GAGAL**

Run: `npx vitest run src/components/inbox/FixAnswerPanel.test.tsx`
Expected: FAIL — `fetch tak terduga: GET /api/inbox/gaps?messageId=msg_bot&limit=1` pada test lama (panel belum mencarinya) dan `Unable to find an element with the text: Jawaban ini sudah sesuai?` pada test baru.

- [x] **Step 6: Implementasi — `src/components/inbox/FixAnswerPanel.tsx`**

6a. Ganti (tiga baris sekaligus — baris `IconButton` sendirian ada di banyak berkas):

```tsx
import { IconButton } from '@/components/ui/icon-button'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { fetchJson } from '@/lib/fetch-json'
```

menjadi:

```tsx
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { KnowledgeEditor, type KnowledgeDraft } from '@/components/bot-control/KnowledgeEditor'
import { fetchJson } from '@/lib/fetch-json'
```

6b. Ganti:

```tsx
type RunView = { id: string; inboundText: string; replyText: string | null }
```

menjadi:

```tsx
type RunView = { id: string; conversationId: string; inboundText: string; replyText: string | null }
```

6c. Ganti:

```tsx
type Editing =
  | { kind: 'edit'; sourceId: string; title: string; initial: KnowledgeDraft }
  | { kind: 'new'; title: string; initial: KnowledgeDraft }
type FixResult = { title: string; version: number; flagged: boolean }
```

menjadi:

```tsx
type Editing =
  | { kind: 'edit'; sourceId: string; title: string; initial: KnowledgeDraft; reason?: string }
  | { kind: 'new'; title: string; initial: KnowledgeDraft; reason?: string }
type FixResult = { sourceId: string; title: string; version: number; flagged: boolean }
/**
 * Uji ulang sesudah revisi aktif. `sourcedByNewEntry` sengaja dibedakan dari `sourcedAtAll`:
 * jawaban yang terdengar benar tetapi bersandar pada entri LAIN berarti entri yang baru
 * disimpan tidak terpakai -- biasanya karena gerbang topik menolaknya -- dan operator harus
 * tahu itu alih-alih menutup gap dengan tenang.
 */
type Retest =
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'done'; reply: string | null; sourcedByNewEntry: boolean; sourcedAtAll: boolean }

const MIN_NOTE_LENGTH = 10
```

6d. Ganti:

```tsx
  const [result, setResult] = useState<FixResult | null>(null)
```

menjadi:

```tsx
  const [result, setResult] = useState<FixResult | null>(null)
  const [gapId, setGapId] = useState<string | null>(null)
  const [retest, setRetest] = useState<Retest | null>(null)
  const [notSuitable, setNotSuitable] = useState(false)
  const [note, setNote] = useState('')
  const [resolved, setResolved] = useState(false)
```

6e. Ganti:

```tsx
        setLoad(run ? { status: 'ready', run: { id: run.id, inboundText: run.inboundText, replyText: run.replyText } } : { status: 'no-run' })
```

menjadi:

```tsx
        setLoad(
          run
            ? {
                status: 'ready',
                run: { id: run.id, conversationId: run.conversationId, inboundText: run.inboundText, replyText: run.replyText },
              }
            : { status: 'no-run' }
        )
```

6f. Ganti:

```tsx
    return () => {
      cancelled = true
    }
  }, [messageId])

  async function openEdit(sourceId: string) {
```

menjadi:

```tsx
    return () => {
      cancelled = true
    }
  }, [messageId])

  // Gap milik jawaban INI, supaya "sudah sesuai" bisa menutupnya. Tidak ada gap (panel dibuka
  // dari ikon di gelembung, bukan dari notifikasi) bukan kesalahan: perbaikannya tetap jalan,
  // hanya tidak ada yang perlu ditutup.
  useEffect(() => {
    let cancelled = false
    fetchJson<{ items: Array<{ id: string }> }>(`/api/inbox/gaps?messageId=${encodeURIComponent(messageId)}&limit=1`)
      .then((feed) => {
        if (!cancelled) setGapId(feed.items[0]?.id ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [messageId])

  async function runRetest(sourceId: string, run: RunView) {
    setRetest({ status: 'running' })
    try {
      const simulated = await fetchJson<{ reply: string | null; knowledge: { attributions?: Array<{ lines: Array<{ sourceId?: string }> }> } | null }>(
        '/api/inbox/retest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: run.inboundText, conversationId: run.conversationId }),
        }
      )
      const attributions = simulated.knowledge?.attributions ?? []
      setRetest({
        status: 'done',
        reply: simulated.reply,
        sourcedByNewEntry: attributions.some((attribution) => attribution.lines.some((line) => line.sourceId === sourceId)),
        sourcedAtAll: attributions.length > 0,
      })
    } catch (error: unknown) {
      setRetest({ status: 'error', message: error instanceof Error ? error.message : 'Gagal menjalankan uji ulang' })
    }
  }

  async function confirmSuitable() {
    if (gapId) {
      try {
        await fetchJson(`/api/inbox/gaps/${encodeURIComponent(gapId)}/resolve`, { method: 'POST' })
      } catch {
        // Ditelan: revisinya sudah aktif, dan gagal menandai gap hanya berarti ia masih
        // muncul di lonceng -- bukan alasan menampilkan kegagalan atas pekerjaan yang berhasil.
      }
    }
    setResolved(true)
    setNotSuitable(false)
  }

  async function openEdit(sourceId: string, initialReason?: string) {
```

6g. Ganti:

```tsx
      setEditing({
        kind: 'edit',
        sourceId,
        title: `Perbaiki: ${data.title} (v${data.version} aktif)`,
        initial: { title: data.title, summary: data.summary ?? '', items: data.items },
      })
```

menjadi:

```tsx
      setEditing({
        kind: 'edit',
        sourceId,
        title: `Perbaiki: ${data.title} (v${data.version} aktif)`,
        initial: { title: data.title, summary: data.summary ?? '', items: data.items },
        reason: initialReason,
      })
```

6h. Ganti:

```tsx
      const saved = await fetchJson<{ title: string; version: number; flagged: boolean }>(`/api/inbox/decisions/${load.run.id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setResult({ title: saved.title, version: saved.version, flagged: saved.flagged })
      setEditing(null)
```

menjadi:

```tsx
      const saved = await fetchJson<{ sourceId: string; title: string; version: number; flagged: boolean }>(
        `/api/inbox/decisions/${load.run.id}/fix`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      setResult({ sourceId: saved.sourceId, title: saved.title, version: saved.version, flagged: saved.flagged })
      setEditing(null)
      setNotSuitable(false)
      setNote('')
      // Uji ulang berjalan sendiri: menyimpan revisi bukan bukti jawabannya jadi benar, dan
      // satu klik lagi di sini hanya menunda pemeriksaan yang memang harus terjadi.
      void runRetest(saved.sourceId, load.run)
```

6i. Ganti:

```tsx
        saving={saving}
        error={saveError}
        activateOnly
```

menjadi:

```tsx
        saving={saving}
        error={saveError}
        activateOnly
        initialReason={editing.reason}
```

6j. Ganti:

```tsx
      {result && (
        <div role="status" className="space-y-0.5 border-t border-line pt-2">
          <p className="font-medium text-ink">{`Aktif: ${result.title} v${result.version}`}</p>
          <p className="text-ink-muted">
            {result.flagged ? 'Jawaban bot ini ditandai perlu diperbaiki.' : 'Revisi sudah aktif, tetapi jawaban ini gagal ditandai.'}
          </p>
        </div>
      )}
```

menjadi:

```tsx
      {result && (
        <div className="space-y-2 border-t border-line pt-2">
          <div role="status" className="space-y-0.5">
            <p className="font-medium text-ink">{`Aktif: ${result.title} v${result.version}`}</p>
            <p className="text-ink-muted">
              {result.flagged ? 'Jawaban bot ini ditandai perlu diperbaiki.' : 'Revisi sudah aktif, tetapi jawaban ini gagal ditandai.'}
            </p>
          </div>

          {retest?.status === 'running' && <p className="text-ink-muted">Menguji ulang jawaban bot...</p>}

          {retest?.status === 'error' && (
            <>
              <p role="alert" className="text-danger">
                {retest.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (load.status === 'ready') void runRetest(result.sourceId, load.run)
                }}
              >
                Coba uji ulang lagi
              </Button>
            </>
          )}

          {retest?.status === 'done' && (
            <>
              <div className="space-y-1">
                <p className="font-medium text-ink">Jawaban baru</p>
                <p className="whitespace-pre-wrap text-ink-muted">{retest.reply ?? '—'}</p>
                <p className="text-ink-muted">
                  {retest.sourcedByNewEntry
                    ? 'Bersumber dari entri yang baru disimpan.'
                    : retest.sourcedAtAll
                      ? 'Bersumber, tetapi dari entri lain — bukan yang baru disimpan.'
                      : 'Belum bersumber: tidak ada paragraf yang cocok dengan fakta mana pun.'}
                </p>
                {/* Dua batas yang harus diketahui sebelum hasilnya dipercaya. */}
                <p className="text-xs text-ink-subtle">
                  Uji ulang berjalan di percakapan sandbox tanpa data booking, dan meninggalkan satu baris keputusan
                  berstatus SIMULATED.
                </p>
              </div>

              {resolved ? (
                <p role="status" className="font-medium text-ink">
                  Gap ditandai selesai.
                </p>
              ) : notSuitable ? (
                <div className="space-y-1.5">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label="Apa yang masih belum benar?"
                    placeholder="Apa yang masih belum benar? Kalimat ini menjadi alasan revisi berikutnya."
                    rows={2}
                  />
                  <Button
                    type="button"
                    disabled={note.trim().length < MIN_NOTE_LENGTH}
                    onClick={() => {
                      void openEdit(result.sourceId, note.trim())
                    }}
                  >
                    Perbaiki lagi
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="font-medium text-ink">Jawaban ini sudah sesuai?</p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        void confirmSuitable()
                      }}
                    >
                      Sudah sesuai
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setNotSuitable(true)}>
                      Belum sesuai
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
```

- [x] **Step 7: Jalankan, pastikan LULUS**

Run: `npx vitest run src/components/inbox/FixAnswerPanel.test.tsx src/components/bot-control/KnowledgeEditor.test.tsx`
Expected: PASS, termasuk seluruh test lama panel (kedua jalur simpan, galat, tanpa run).

- [x] **Step 8: Commit**

```bash
git add src/components/bot-control/KnowledgeEditor.tsx src/components/bot-control/KnowledgeEditor.test.tsx \
  src/components/inbox/FixAnswerPanel.tsx src/components/inbox/FixAnswerPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(inbox): uji ulang otomatis setelah knowledge diperbaiki

Panel menjalankan simulasi dengan konteks percakapan asli, menyatakan apakah jawaban
barunya bersumber dari entri yang baru disimpan, lalu menanyakan kesesuaian. "Belum sesuai"
membuka editor lagi dengan catatan operator sebagai alasan revisi berikutnya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---
### Task 9: Halaman gap menampilkan status dan bisa menandai selesai

**Files:**
- Modify: `src/app/api/bot/knowledge-gaps/route.ts` (+ `route.test.ts` baru)
- Modify: `src/app/(authenticated)/settings/knowledge-gaps/page.tsx` (+ `page.test.tsx` baru)

**Interfaces:**
- Consumes: `POST /api/inbox/gaps/[id]/resolve` (Task 4); kolom `resolvedAt` (Task 1).
- Produces: respons `/api/bot/knowledge-gaps` bertambah satu field `resolvedAt: string | null` (aditif; auth dan pola route tidak berubah — ia tetap mengandalkan `src/middleware.ts` seperti seluruh `/api/bot/*`). Halaman menampilkan lencana "Selesai" atau tombol "Tandai selesai" per baris, dan mengenal alasan `reply_unsourced`.

Halaman ini tetap memakai route lamanya (200 baris terakhir, dengan saringan alasan) alih-alih `/api/inbox/gaps` yang hanya melayani lonceng (paling banyak 20, hanya yang belum selesai): daftar lengkap termasuk yang sudah ditangani adalah gunanya halaman ini.

- [ ] **Step 1: Tulis test yang gagal — `src/app/api/bot/knowledge-gaps/route.test.ts`**

```ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: new Date('2026-09-12T02:00:00.000Z'),
    resolvedAt: null,
    conversation: { contact: { name: 'Bruno' } },
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([row()] as never)
})

describe('GET /api/bot/knowledge-gaps', () => {
  it('membawa resolvedAt supaya halaman bisa membedakan yang sudah ditangani', async () => {
    const body = (await (await GET(new Request('http://localhost/api/bot/knowledge-gaps'))).json()) as Array<Record<string, unknown>>

    expect(body[0]).toMatchObject({ id: 'gap_1', reason: 'reply_unsourced', resolvedAt: null })
  })

  it('meneruskan stempel selesai apa adanya', async () => {
    mockPrisma.knowledgeGapLog.findMany.mockResolvedValue([row({ resolvedAt: new Date('2026-09-12T03:00:00.000Z') })] as never)

    const body = (await (await GET(new Request('http://localhost/api/bot/knowledge-gaps'))).json()) as Array<{ resolvedAt: string | null }>

    expect(body[0].resolvedAt).toBe('2026-09-12T03:00:00.000Z')
  })

  it('saringan alasan yang sudah ada tidak berubah', async () => {
    await GET(new Request('http://localhost/api/bot/knowledge-gaps?reason=reply_unsourced'))

    expect(mockPrisma.knowledgeGapLog.findMany.mock.calls[0][0]).toMatchObject({ where: { reason: 'reply_unsourced' }, take: 200 })
  })
})
```

- [ ] **Step 2: Implementasi — `src/app/api/bot/knowledge-gaps/route.ts`**

Ganti:

```ts
      messageText: g.messageText,
      createdAt: g.createdAt,
```

menjadi:

```ts
      messageText: g.messageText,
      createdAt: g.createdAt,
      // Halaman ini menampilkan SEMUA gap, termasuk yang sudah ditangani -- lonceng yang hanya
      // mengurus yang belum (lihat /api/inbox/gaps).
      resolvedAt: g.resolvedAt,
```

- [ ] **Step 3: Jalankan, pastikan LULUS**

Run: `npx vitest run src/app/api/bot/knowledge-gaps/route.test.ts`
Expected: PASS (3 test).

- [ ] **Step 4: Tulis test yang gagal — `src/app/(authenticated)/settings/knowledge-gaps/page.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import KnowledgeGapsPage from './page'

function gap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap_1',
    conversationId: 'conv_1',
    contactName: 'Bruno',
    topic: 'price',
    reason: 'reply_unsourced',
    messageText: 'berapa harga ATV sekarang?',
    createdAt: '2026-09-12T02:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  }
}

function stubFetch(gaps: unknown[], resolveBody: unknown = { id: 'gap_1', resolvedAt: '2026-09-12T03:00:00.000Z' }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    if (key.startsWith('GET /api/bot/knowledge-gaps')) {
      return { ok: true, status: 200, json: async () => gaps } as Response
    }
    if (key === 'POST /api/inbox/gaps/gap_1/resolve') {
      return { ok: true, status: 200, json: async () => resolveBody } as Response
    }
    throw new Error(`fetch tak terduga: ${key}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('KnowledgeGapsPage — status dan penandaan', () => {
  it('memberi nama alasan baru dan menawarkan tombol tandai selesai', async () => {
    stubFetch([gap()])

    render(<KnowledgeGapsPage />)

    expect(await screen.findByText('Jawaban tanpa sumber')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tandai selesai' })).toBeInTheDocument()
  })

  it('menandai selesai dan menggantinya dengan lencana, tanpa memuat ulang daftar', async () => {
    const fetchMock = stubFetch([gap()])

    render(<KnowledgeGapsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tandai selesai' }))

    expect(await screen.findByText('Selesai')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tandai selesai' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/inbox/gaps/gap_1/resolve')).toBe(true)
  })

  it('baris yang sudah selesai langsung tampil dengan lencana', async () => {
    stubFetch([gap({ resolvedAt: '2026-09-11T01:00:00.000Z' })])

    render(<KnowledgeGapsPage />)

    expect(await screen.findByText('Selesai')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tandai selesai' })).not.toBeInTheDocument()
  })

  it('kegagalan penandaan membiarkan tombolnya bisa ditekan lagi', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(url)}`
      if (key.startsWith('GET /api/bot/knowledge-gaps')) {
        return { ok: true, status: 200, json: async () => [gap()] } as Response
      }
      return { ok: false, status: 500, json: async () => ({ error: 'Gagal menandai gap selesai' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<KnowledgeGapsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Tandai selesai' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Tandai selesai' })).not.toBeDisabled())
    expect(screen.queryByText('Selesai')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Jalankan, pastikan GAGAL**

Run: `npx vitest run "src/app/(authenticated)/settings/knowledge-gaps/page.test.tsx"`
Expected: FAIL — `Unable to find an element with the text: Jawaban tanpa sumber` (nama alasan dan tombolnya belum ada).

- [ ] **Step 6: Implementasi — `src/app/(authenticated)/settings/knowledge-gaps/page.tsx`**

6a. Ganti (empat baris sekaligus — tiga baris pertama juga ada di `ContactTable.tsx`, baris `Skeleton` yang membedakannya):

```tsx
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
```

menjadi:

```tsx
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
```

6b. Ganti:

```tsx
  messageText: string
  createdAt: string
}

const REASON_LABEL: Record<string, string> = {
  no_facts_resolved: 'Tidak ada fakta',
  verification_failed: 'Gagal verifikasi',
}
```

menjadi:

```tsx
  messageText: string
  createdAt: string
  resolvedAt: string | null
}

const REASON_LABEL: Record<string, string> = {
  no_facts_resolved: 'Tidak ada fakta',
  verification_failed: 'Gagal verifikasi',
  reply_unsourced: 'Jawaban tanpa sumber',
}
```

6c. Ganti:

```tsx
  const [loadedFilter, setLoadedFilter] = useState<string | null>(null)
  const loading = loadedFilter !== filter
```

menjadi:

```tsx
  const [loadedFilter, setLoadedFilter] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const loading = loadedFilter !== filter

  async function resolveGap(id: string) {
    setResolving(id)
    try {
      const saved = await fetchJson<{ id: string; resolvedAt: string | null }>(
        `/api/inbox/gaps/${encodeURIComponent(id)}/resolve`,
        { method: 'POST' }
      )
      // Baris itu saja yang diperbarui, bukan seluruh daftar: memuat ulang akan memindahkan
      // posisi baris lain di bawah kursor operator yang sedang menyisir daftar.
      setGaps((prev) => prev.map((gap) => (gap.id === saved.id ? { ...gap, resolvedAt: saved.resolvedAt } : gap)))
    } catch {
      // Ditelan: tombolnya kembali bisa ditekan, dan tidak ada yang hilang kalau gagal.
    } finally {
      setResolving(null)
    }
  }
```

6d. Ganti:

```tsx
                  <time dateTime={g.createdAt} className="ml-auto font-mono text-xs text-ink-subtle">
                    {new Date(g.createdAt).toLocaleString('id-ID')}
                  </time>
```

menjadi:

```tsx
                  <time dateTime={g.createdAt} className="ml-auto font-mono text-xs text-ink-subtle">
                    {new Date(g.createdAt).toLocaleString('id-ID')}
                  </time>
                  {g.resolvedAt ? (
                    <Badge variant="success">Selesai</Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={resolving === g.id}
                      onClick={() => {
                        void resolveGap(g.id)
                      }}
                    >
                      {resolving === g.id ? 'Menandai...' : 'Tandai selesai'}
                    </Button>
                  )}
```

- [ ] **Step 7: Jalankan, pastikan LULUS**

Run: `npx vitest run "src/app/(authenticated)/settings/knowledge-gaps/page.test.tsx" src/app/api/bot/knowledge-gaps/route.test.ts`
Expected: PASS (7 test).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/bot/knowledge-gaps/route.ts src/app/api/bot/knowledge-gaps/route.test.ts \
  "src/app/(authenticated)/settings/knowledge-gaps/page.tsx" \
  "src/app/(authenticated)/settings/knowledge-gaps/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat(inbox): halaman gap menampilkan status dan bisa menandai selesai

Respons route lama bertambah resolvedAt (aditif, auth tidak berubah). Penandaan memakai
route yang sama dengan panel perbaikan, dan hanya baris itu yang diperbarui.

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
Expected: semua PASS. Bila merah, perbaiki penyebabnya di task yang bersangkutan — jangan melonggarkan asersi.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keluar 0, tanpa keluaran.

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: 0 error (warning boleh).

- [ ] **Step 4: Pemeriksa larangan mekanis (harus mencetak `LARANGAN BERSIH`)**

```bash
BASE=$(git merge-base HEAD origin/main)
! git diff --name-only "$BASE"..HEAD | grep -Eq '^src/lib/bot/orchestrator\.ts$|^src/lib/bot/reply-attribution\.ts$|^src/components/bot-control/TestLab\.tsx$|^src/app/api/bot-control/simulate/route\.ts$' \
  && ! git diff "$BASE"..HEAD -- src | grep -E '^\+' | grep -Eq ':\s*any\b|as any\b|<any>' \
  && ! git diff "$BASE"..HEAD -- package.json package-lock.json | grep -q '^+' \
  && ! grep -Eiq 'drop|truncate|alter column|rename' prisma/migrations/20260912080000_knowledge_gap_notification/migration.sql \
  && test "$(git diff "$BASE"..HEAD -- src/lib/bot-control/simulator.ts | grep -cE '^\+.*(sendMessage|OutboundJob)')" = 0 \
  && echo "LARANGAN BERSIH"
```

Expected: `LARANGAN BERSIH` — orchestrator, atribusi, Test Lab, dan route simulate lama tidak tersentuh; tidak ada `any` baru; tidak ada dependensi baru; migrasi murni aditif; dan simulator tidak mendapat satu pun baris baru yang menyentuh pengiriman.

- [ ] **Step 5: Commit hanya bila Step 1–4 memerlukan perbaikan** (path eksplisit, trailer yang sama seperti task lain).

---

## Cakupan spec → task

| Spec | Task |
|---|---|
| §4A sinyal "tidak bersumber" dari `attributions`, hanya mode `faq` | 2 |
| §4B tiga kolom baru + index `resolvedAt` | 1 |
| §4C titik tulis setelah balasan terkirim + event `knowledge.gap` | 3 |
| §4D lonceng, lencana, dropdown lima, "Lihat semua", baris lama tanpa `messageId` | 5 |
| §4D lompat ke pesan: `?message=`, sorotan, panel terbuka sendiri | 6 |
| §4E `SimulationResult.knowledge` + route uji ulang terbuka untuk yang login | 7 |
| §4E putaran uji ulang: jawaban baru, status sumber, "sudah sesuai?", catatan → revisi berikutnya | 8 |
| §4F `GET /api/inbox/gaps`, `POST .../resolve`, fix route TIDAK menutup gap | 4 (dan 8 yang memanggilnya) |
| §4F halaman gap: status + "Tandai selesai" | 9 |
| §5 pengujian per bagian | menyatu di setiap task |
| §6 risiko (dipantau setelah rilis, bukan kode) | Checklist Deploy langkah 6 |

---

## Checklist Deploy

Urutan wajib: **cadangkan → `prisma migrate deploy` SEBELUM kode → build → restart → smoke test di VPS.** Kode baru menulis `KnowledgeGapLog.messageId/runId` sejak balasan pertama; menjalankannya sebelum kolomnya ada membuat setiap penulisan gap gagal (tertelan `console.error`) dan `GET /api/inbox/gaps` mengembalikan 500.

Prasyarat: Task 10 hijau dan branch sudah digabung ke `origin/main`.

- [ ] **1. Cadangkan** (dijalankan di VPS, supaya kredensial tidak perlu keluar dari sana)

```bash
ssh root@31.97.223.43 'set -uo pipefail
TS=$(date +%Y%m%d-%H%M)
git -C /var/www/wa-inbox rev-parse HEAD
cd /var/www/wa-inbox && tar czf "/root/wa-inbox-predeploy-$TS.tar.gz" --exclude=node_modules --exclude=.next --exclude=.git . 2>/dev/null || true
ls -lh "/root/wa-inbox-predeploy-$TS.tar.gz"
sudo -u postgres pg_dump -d wa_inbox -t "\"KnowledgeGapLog\"" -F c -f "/tmp/backup-gaps-$TS.dump"
mv "/tmp/backup-gaps-$TS.dump" "/root/backup-gaps-$TS.dump"
pg_restore --list "/root/backup-gaps-$TS.dump" | grep -c "TABLE DATA public KnowledgeGapLog"
sudo -u postgres psql -d wa_inbox -tAc "SELECT count(*) FROM \"KnowledgeGapLog\";"'
```

Catat SHA yang tercetak pertama — itu sasaran rollback.

- [ ] **2. Terapkan migrasi (SEBELUM kode aktif), lalu verifikasi**

```bash
ssh root@31.97.223.43 'set -uo pipefail
export PATH=/root/.nvm/versions/node/v22.19.0/bin:$PATH
cd /var/www/wa-inbox
DEPLOYED=$(git rev-parse HEAD); git fetch origin main -q
git diff --diff-filter=DR --name-status "$DEPLOYED" origin/main   # harus kosong
git checkout origin/main -- . && git reset --soft origin/main
git diff --name-only "$DEPLOYED" origin/main -- package.json package-lock.json   # kosong = tanpa npm ci
npx prisma generate 2>&1 | tail -2
npx prisma migrate status 2>&1 | tail -4
npx prisma migrate deploy 2>&1 | tail -5
sudo -u postgres psql -d wa_inbox -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'KnowledgeGapLog'"'"' AND column_name IN ('"'"'messageId'"'"','"'"'runId'"'"','"'"'resolvedAt'"'"');"'
```

Expected: satu migrasi tertunda lalu terpasang, dan hitungan kolom `3`.

- [ ] **3. Build dan restart**

```bash
ssh root@31.97.223.43 'export PATH=/root/.nvm/versions/node/v22.19.0/bin:$PATH
cd /var/www/wa-inbox && npm run build 2>&1 | tail -6 && pm2 restart wa-inbox && sleep 6
pm2 status wa-inbox | tail -4
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3015/login'
```

Expected: build selesai, proses `online`, HTTP `200`.

- [ ] **4. Verifikasi route baru terpasang dan bergerbang sesi**

```bash
ssh root@31.97.223.43 'for u in "/api/inbox/gaps:GET" "/api/inbox/gaps/gap_x/resolve:POST" "/api/inbox/retest:POST"; do
  p="${u%%:*}"; m="${u##*:}"
  echo "$m $p -> $(curl -s -o /dev/null -w "%{http_code}" -X "$m" -H "Content-Type: application/json" -d "{}" "http://localhost:3015$p")"
done'
```

Expected: ketiganya `401`.

- [ ] **5. Smoke test di VPS — sandbox atau nomor whitelist `6282143403501` saja**

1. Buka Inbox. Lonceng di rail terlihat; tanpa gap, ia tanpa angka.
2. Di percakapan sandbox, kirim pertanyaan yang jawabannya tidak ada di knowledge (mis. "ada diskon rombongan 20 orang?"). Setelah bot menjawab, lencana lonceng naik tanpa memuat ulang halaman.
3. Klik lonceng → item teratas adalah pertanyaan itu → klik → Inbox membuka percakapannya, menggulung ke jawaban bot, menyorotnya, dan panel perbaikan terbuka sendiri.
4. "Tambah jawaban yang benar" → isi jawaban + alasan → "Simpan & aktifkan". Panel menjalankan uji ulang sendiri dan menampilkan jawaban baru beserta status sumbernya.
5. Jawab "Sudah sesuai" → lencana turun. Buka `/settings/knowledge-gaps` → baris itu berlencana "Selesai".
6. Arsipkan entri uji itu dari halaman Knowledge bila isinya memang hanya untuk percobaan.

- [ ] **6. Ukur sepekan kemudian (risiko §6 spec)**

```bash
ssh root@31.97.223.43 'sudo -u postgres psql -d wa_inbox -c "SELECT reason, count(*) FILTER (WHERE \"resolvedAt\" IS NULL) AS terbuka, count(*) AS total FROM \"KnowledgeGapLog\" WHERE \"createdAt\" > now() - interval '"'"'7 days'"'"' GROUP BY reason;"'
```

Kalau `reply_unsourced` menyala di hampir setiap jawaban, yang ditinjau adalah ambang pencocokan di `reply-attribution.ts` — bukan loncengnya.

- [ ] **7. Rollback (bila perlu)**

Di VPS: `git checkout <SHA langkah 1> -- . && git reset --soft <SHA langkah 1> && npx prisma generate && npm run build && pm2 restart wa-inbox`. Ketiga kolom boleh dibiarkan — nullable dan aditif, kode lama tidak membacanya.
