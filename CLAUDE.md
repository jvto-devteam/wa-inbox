# wa-inbox — Project Rules (WAJIB)

Dokumen ini adalah **konstitusi pengembangan**. Semua instruksi di bawah ini bersifat **mengikat** dan tidak boleh dilanggar.
Jika ada ambiguitas, lihat referensi lengkap di `.claude/docs/bot-control-spec.md` (SDD Bot Control Center).

---

## Stack Teknologi (Tetap)
- Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Tailwind v4, Vitest, Ollama lokal.

## Rekomendasi Model per Fase (Untuk Efisiensi Biaya)
- **Fase 1, 2, 5** (read‑only, indexing, dokumentasi): gunakan `claude --model haiku`
- **Fase 3, 4** (logic bot, simulator): gunakan `claude --model sonnet` (default)
- **Fase 6** (outbound queue, safety): gunakan `claude --model opus` untuk reasoning mendalam
- **Subagent audit/ekspor** sudah dikonfigurasi otomatis di `.claude/agents/`

## Prinsip Eksekusi (Urutan Fase TIDAK BOLEH DILOMPATI)
1. **Expose first → Manage second → Extend third.**
2. Kerjakan sesuai urutan **Phase 1–6** yang terdefinisi di SDD.
   - Phase 1: Read‑only visibility (Flow & Rules)
   - Phase 2: Knowledge visibility (Indexing & Explorer)
   - Phase 3: Decision trace & logs
   - Phase 4: Test Lab (Simulator)
   - Phase 5: Documentation export
   - Phase 6: Channel policy & outbound queue
3. **Jangan mulai Phase N+1** sebelum *Definition of Done* Phase N tercapai.

## Kebijakan Channel (KRITIS, Tidak Bisa Diubah Sembarangan)
- **WhatsApp Official** = webhook inbound utama; **bukan jalur outbound default**.
- **WhatsApp Unofficial (co-exist)** = **jalur outbound default** untuk semua balasan bot dan agen.
- **Official** hanya digunakan untuk: template, campaign legal, utility/auth, dan fallback tertentu.

## Struktur File untuk Bot Control (WAJIB)
Semua file baru untuk fitur ini harus berada di lokasi berikut:
- Library / utilitas: `src/lib/bot-control/*`
- API routes: `src/app/api/bot-control/*`
- Halaman UI: `src/app/(authenticated)/bot-control/*`
- Komponen UI: `src/components/bot-control/*`

**Larangan:** Membuat file di luar struktur ini tanpa alasan tertulis di deskripsi PR.

## Checklist Sebelum Menyatakan Suatu Task SELESAI
Jalankan perintah berikut secara berurutan, **semua harus lulus**:
1. `npm test`
2. `npx tsc --noEmit`
3. `npx eslint`
4. Jika ada perubahan skema Prisma, **wajib** membuat migrasi (`npx prisma migrate dev`).

## Larangan Mutlak (Zero Tolerance)
- **Simulator** (`src/lib/bot-control/simulator.ts`) **DILARANG** memanggil `sendMessage` atau membuat `OutboundJob` — hanya dry‑run.
- **Jangan pernah menampilkan token/API key** di UI, API response, atau dokumentasi export.
- **Jangan overwrite** `KnowledgeSource` yang `type=MANUAL`.
- **Dilarang** menggunakan `any`; gunakan `unknown` atau buat tipe yang sesuai.

## Aturan Spesifik per Area
Aturan yang lebih detail untuk modul tertentu (channel, bot safety, testing, dll.) ada di `.claude/rules/` dan akan dimuat otomatis saat Claude membuka file yang cocok.

---

**Referensi final:** Seluruh spesifikasi teknis (model data, API contract, UI detail) berada di `.claude/docs/bot-control-spec.md`.
Jika instruksi di file ini bertentangan dengan ucapan lisan, maka **yang berlaku adalah yang tertulis di SDD**.
