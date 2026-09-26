# Omnichannel Fase Instagram DM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) atau superpowers:executing-plans untuk mengeksekusi rencana ini tugas demi tugas. Langkah memakai sintaks checkbox (`- [ ]`).

**Goal:** DM Instagram masuk ke Inbox wa-inbox, bisa dibalas dari Inbox, dengan tab Instagram sendiri dan sakelar bot sendiri.

**Architecture:** Jalur MASUK sudah selesai — fase Facebook membangun adapter `entry[].messaging[]` dengan `platform` sebagai parameter, dan `isMessengerPayload` sudah menerima `object === 'instagram'`. Yang tersisa adalah membuat dua modul Meta yang masih terpaku Facebook menjadi sadar-platform, menambahkan cabang kirim INSTAGRAM, lalu menyalakan tabnya. Endpoint kirim Instagram **identik** dengan Messenger (`POST /me/messages` dengan Page Access Token), jadi perbedaannya kecil dan terlokalisasi.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Vitest + vitest-mock-extended, Meta Graph API v21.0.

**Spec:** `docs/superpowers/specs/2026-09-23-omnichannel-inbox-design.md` (§6.2, §7, §8, §9 Fase 4)

> **STATUS: Tugas 1-5 SELESAI dan tayang di produksi (2026-09-26).** Tugas 6 (konfigurasi
> Meta) juga selesai: Page token dengan `instagram_basic` + `instagram_manage_messages` yang
> tidak kedaluwarsa, `@javavolcanotouroperator` tertaut ke Page `698402510359502`, dan objek
> webhook `instagram` terdaftar aktif. Yang belum: uji DM sungguhan, dan kepastian apakah
> `instagram_manage_messages` sudah Advanced Access atau masih Standard.
>
> **`check-instagram-plan.mjs` sudah DIHAPUS, bukan hilang.** Ia memverifikasi klaim rencana
> ini tentang keadaan repo SEBELUM eksekusi — termasuk setiap potongan "ganti X menjadi Y".
> Begitu rencananya dieksekusi, semua jangkar itu termakan dan 14 klaimnya menjadi merah
> permanen. Pemeriksa merah yang tidak bisa diperbaiki siapa pun lebih buruk daripada tidak
> ada pemeriksa: ia melatih orang mengabaikan pemeriksa. Assertion yang tahan lama sudah
> pindah ke `check-omnichannel-design.mjs`, yang kini menguji 61 klaim dan hijau.

**Pemeriksa spec:** `node docs/superpowers/specs/check-omnichannel-design.mjs` — harus exit 0 sebelum DAN sesudah rencana ini dijalankan. Tugas 5 mengubah klaimnya; tugas lain tidak boleh membuatnya merah.

---

## Global Constraints

Disalin verbatim dari `CLAUDE.md` dan spec. Setiap tugas terikat semuanya.

- **Dilarang `any`.** Pakai `unknown` atau tipe yang sesuai.
- **Jangan pernah menampilkan token/API key** di UI, API response, audit log, log server, atau dokumen ekspor apa pun. Meta memantulkan token ke dalam teks error OAuth-nya — teks itu tidak boleh diteruskan mentah.
- **Gerbang runtime bot tetap SATU:** `Conversation.botEnabled`. Sakelar per-platform hanya menulis massal saat di-toggle, lalu menyingkir.
- **Jangan uji ke akun/nomor pelanggan sungguhan.** Uji hanya ke akun milik sendiri atau whitelist `6282143403501`.
- **Dilarang menjalankan `npx prisma migrate dev`** terhadap database produksi. Rencana ini **tidak mengubah skema sama sekali** — `enum Platform` sudah memuat `INSTAGRAM` dan `Settings.botEnabledInstagram` sudah ada sejak fase fondasi.
- **Zona waktu `Asia/Jakarta`** untuk apa pun yang menyentuh jam kerja.
- **Sebelum commit:** `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error, warning boleh).
- **Deploy:** `npm run build` LOKAL dulu; restart VPS hanya kalau build exit 0; nvm Node 22 wajib diekspor **di perintah yang sama** dengan `pm2`.
- **Tab tidak boleh muncul sebelum jalurnya benar-benar bekerja.** Tab kosong lebih buruk daripada tidak ada tab — karena itu penyalaan tab adalah tugas TERAKHIR (Tugas 5), bukan pertama.

---

## Keadaan awal, terverifikasi 2026-09-25

Diperiksa langsung dari kode dan dari produksi, bukan dari dokumen:

| Bagian | Status | Bukti |
| --- | --- | --- |
| `enum Platform` memuat `INSTAGRAM` | **ada** | `prisma/schema.prisma` |
| `Settings.botEnabledInstagram` | **ada**, default `false` | `prisma/schema.prisma:786` |
| `POST /api/bot/channel-toggle` menerima `INSTAGRAM` | **ada** | `src/app/api/bot/channel-toggle/route.ts:34` |
| Sakelar Instagram di UI `/chatbot` | **ada** | `src/app/(authenticated)/chatbot/page.tsx:60` |
| `isMessengerPayload` menerima `'instagram'` | **ada** | `src/lib/meta/messenger-types.ts` |
| Dispatch `object==='instagram'` → `INSTAGRAM` | **ada** | `src/lib/inbound.ts:861` |
| Adapter `ingestMessengerPayload(payload, platform)` | **ada**, sudah bertipe `'FACEBOOK' \| 'INSTAGRAM'` | `src/lib/inbound-messenger.ts` |
| `defaultBotEnabled` sadar platform | **ada** | `src/lib/inbound.ts` |
| Route kirim UI memakai `conversationId` | **ada** (jalur `phone` hanya kompat lama) | `src/app/api/send/route.ts:32` |
| Pencarian nama sadar platform | **BELUM** | `messenger-profile.ts` hardcode Page ID + `FB_PAGE_ACCESS_TOKEN` |
| Kirim keluar Instagram | **BELUM** | `src/lib/send.ts:94` bertipe `'WHATSAPP' \| 'FACEBOOK'` |
| Tab Instagram | **BELUM** | `SHIPPED_PLATFORMS = ['WHATSAPP','FACEBOOK']` |
| Izin Meta Instagram | **BELUM** | token app `1487609042970236` tidak punya `instagram_basic` / `instagram_manage_messages` |
| Identitas INSTAGRAM di produksi | **0** (WHATSAPP 408, FACEBOOK 2) | kueri read-only produksi |

## Fakta Graph API yang mengikat rencana ini

Dari dokumentasi resmi Meta, jalur **Page-linked** (Instagram Professional tertaut ke Facebook Page — BUKAN "Instagram API with Instagram Login" di `graph.instagram.com`):

1. **Kirim: endpoint SAMA** — `POST https://graph.facebook.com/v21.0/me/messages?access_token={PAGE_TOKEN}`, body `{"recipient":{"id":"<IGSID>"},"message":{"text":"..."}}`.
   Sumber: `developers.facebook.com/docs/messenger-platform/instagram/features/send-message`
   **Catatan penting:** dokumentasi Instagram **tidak** menyertakan `messaging_type` di body, sementara kode Messenger kita mengirim `messaging_type:'RESPONSE'`. Rencana ini menghilangkan field itu untuk Instagram — lihat Tugas 2.
2. **Izin:** `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`. Membalas orang yang tidak punya peran di app/Page butuh **Advanced Access** lewat App Review.
3. **Webhook:** objek **`instagram`** (bukan `page`), field `messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions`, `messaging_referral`, `standby`. Dua langkah: subscribe objek di level app, lalu install per-Page lewat `POST /{page-id}/subscribed_apps`.
4. **Nama pengirim:** `GET https://graph.facebook.com/v21.0/{IGSID}?fields=name,username&access_token={PAGE_TOKEN}`. Ini **berbeda** dari Facebook, di mana `GET /{psid}?fields=name` DITOLAK (code 100) dan kita terpaksa lewat `/{page_id}/conversations`. Perbedaan inilah yang membuat pencarian nama harus sadar-platform.
5. **Jendela 24 jam berlaku sama**, dengan **error code 10** yang sama seperti Messenger.

**Yang TIDAK terverifikasi dan tidak boleh diklaim:** subcode spesifik varian Instagram untuk error jendela 24 jam. Halaman referensi error-code Meta mengembalikan 404; hanya sumber pihak ketiga yang menyebutkannya. Rencana ini karena itu **hanya** bercabang pada `code === 10`, tidak pernah pada subcode.

---

## File Structure

| File | Tanggung jawab | Tugas |
| --- | --- | --- |
| `src/lib/meta/messenger-profile.ts` | cari nama tampilan, satu cabang per platform | 1 |
| `src/lib/meta/messenger-profile.test.ts` | tes cabang IG + regresi cabang FB | 1 |
| `src/lib/inbound-messenger.ts` | teruskan `platform` ke pencarian nama | 1 |
| `src/lib/meta/messenger-send.ts` | kirim teks, body per platform, pesan error per platform | 2 |
| `src/lib/meta/messenger-send.test.ts` | tes body IG tanpa `messaging_type`, regresi FB | 2 |
| `src/lib/send.ts` | rute platform → jalur Messenger/Instagram | 3 |
| `src/lib/send.test.ts` | tes rute IG, gerbang lampiran IG | 3 |
| `src/lib/test-conversation.ts` | perbaiki pemakaian `contact.contactId` | 4 |
| `src/lib/channel/platform.ts` | nyalakan tab Instagram | 5 |
| `src/lib/channel/platform.test.ts` | harapan `SHIPPED_PLATFORMS` | 5 |
| `docs/superpowers/specs/check-omnichannel-design.mjs` | balik klaim "fase IG belum" | 5 |

Tidak ada file baru. Tidak ada perubahan skema Prisma.

---

## Task 1: Pencarian nama sadar-platform

**Kenapa ini tugas pertama:** `ingestOne` memanggil `fetchMessengerProfileName(event.sender.id)` untuk **kedua** platform tanpa argumen platform. Setiap DM Instagram hari ini akan menanyakan IGSID ke endpoint percakapan Page Facebook — yang akan mengembalikan kosong, diam-diam, dan setiap kontak Instagram lahir tanpa nama. Ini gagal senyap, bukan error.

**Files:**
- Modify: `src/lib/meta/messenger-profile.ts`
- Modify: `src/lib/inbound-messenger.ts` (satu pemanggilan, ~baris 96)
- Test: `src/lib/meta/messenger-profile.test.ts`

**Interfaces:**
- Produces: `fetchMessengerProfileName(externalId: string, platform: 'FACEBOOK' | 'INSTAGRAM'): Promise<string | null>` — parameter `platform` **WAJIB, tanpa default**.

> **Kenapa wajib dan tanpa default:** repo ini sudah pernah membayar harga parameter platform opsional dengan default WhatsApp (`src/lib/send.ts`, Review round 1 Temuan 1) — default yang salah gagal ke arah paling membingungkan dan setiap pemanggil harus mengingatnya. Parameter wajib membuat `tsc` yang mengingatkan, bukan manusia.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `src/lib/meta/messenger-profile.test.ts`:

```ts
describe('cabang Instagram', () => {
  it('memakai endpoint profil IGSID langsung, bukan percakapan Page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ name: 'Sinta', username: 'sinta.jvto' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const nama = await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')

    expect(nama).toBe('Sinta')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/igsid_777')
    expect(url).toContain('fields=name%2Cusername')
    // Endpoint percakapan Page adalah jalur FACEBOOK. Kalau Instagram ikut lewat sana,
    // IGSID ditanyakan ke Page dan balasannya selalu kosong -- gagal senyap.
    expect(url).not.toContain('/conversations')
  })

  it('jatuh ke username kalau name tidak ada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ username: 'sinta.jvto' }),
    }))

    expect(await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')).toBe('sinta.jvto')
  })

  it('mengembalikan null, tidak melempar, saat Graph menolak', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }))

    expect(await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')).toBeNull()
  })

  it('tidak membocorkan token ke nilai balik', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ name: 'token-uji' }),
    }))
    const nama = await fetchMessengerProfileName('igsid_777', 'INSTAGRAM')
    // Nama memang bisa berisi apa saja; yang dijaga di sini adalah URL tidak bocor ke hasil.
    expect(nama).toBe('token-uji')
  })
})

// Regresi: cabang Facebook tidak boleh berubah perilakunya.
it('Facebook tetap lewat percakapan Page', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ participants: { data: [
      { id: '698402510359502', name: 'Java Volcano' },
      { id: 'psid_abc', name: 'David' },
    ] } }] }),
  })
  vi.stubGlobal('fetch', fetchMock)

  expect(await fetchMessengerProfileName('psid_abc', 'FACEBOOK')).toBe('David')
  expect(String(fetchMock.mock.calls[0][0])).toContain('/conversations')
})
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

Run: `npx vitest run src/lib/meta/messenger-profile.test.ts`
Expected: FAIL — `fetchMessengerProfileName` baru menerima 1 argumen, dan tidak ada cabang Instagram.

- [ ] **Step 3: Implementasi**

Ganti isi `src/lib/meta/messenger-profile.ts` mulai dari `interface ConversationsResponse` ke bawah dengan:

```ts
interface ConversationsResponse {
  data?: Array<{
    participants?: {
      data?: Array<{ id?: string; name?: string }>
    }
  }>
}

interface InstagramProfileResponse {
  name?: string
  username?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Cari nama tampilan pengirim Messenger atau Instagram DM.
 *
 * Dua cabang, karena Graph API memperlakukan keduanya BERBEDA -- bukan karena kerapian:
 *
 * - FACEBOOK: `GET /{psid}?fields=name` DITOLAK (code 100, terverifikasi di produksi
 *   2026-09-23). Satu-satunya jalan adalah `GET /{page_id}/conversations?user_id={psid}
 *   &fields=participants`, lalu ambil participant yang id-nya BUKAN page id.
 * - INSTAGRAM: endpoint profil langsung JUSTRU bekerja --
 *   `GET /{igsid}?fields=name,username`. Akun Instagram boleh tidak punya `name`
 *   (hanya username), jadi `username` dipakai sebagai cadangan.
 *
 * `platform` WAJIB dan tanpa default. Default apa pun di sini akan salah untuk separuh
 * pemanggil dan gagal secara senyap: kontak lahir tanpa nama, tidak ada error, tidak ada
 * yang melapor. Bandingkan dengan `platform` opsional di src/lib/send.ts yang sudah
 * dibatalkan pada Review round 1 Temuan 1 karena persis alasan ini.
 *
 * SELALU mengembalikan `null`, tidak pernah melempar -- error jaringan, error Graph, token
 * hilang, atau bentuk respons tak terduga semuanya ditelan di sini. Pesan pelanggan wajib
 * tetap masuk ke Inbox walau pencarian nama gagal total.
 *
 * Token TIDAK PERNAH ikut ke log maupun ke nilai balik, lewat jalur sukses maupun gagal.
 */
export async function fetchMessengerProfileName(
  externalId: string,
  platform: 'FACEBOOK' | 'INSTAGRAM',
): Promise<string | null> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) return null

  const url =
    platform === 'INSTAGRAM'
      ? `https://graph.facebook.com/${GRAPH_VERSION}/${externalId}?fields=${encodeURIComponent('name,username')}&access_token=${token}`
      : `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.FB_PAGE_ID || DEFAULT_PAGE_ID}/conversations?user_id=${externalId}&fields=participants&access_token=${token}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
    if (!res.ok) return null

    const data: unknown = await res.json()
    if (!isObject(data)) return null

    if (platform === 'INSTAGRAM') {
      const profile = data as InstagramProfileResponse
      return profile.name ?? profile.username ?? null
    }

    const pageId = process.env.FB_PAGE_ID || DEFAULT_PAGE_ID
    const participants = (data as ConversationsResponse).data?.[0]?.participants?.data
    if (!participants) return null

    const sender = participants.find((participant) => participant.id && participant.id !== pageId)
    return sender?.name ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Teruskan `platform` dari pemanggil**

Di `src/lib/inbound-messenger.ts`, di dalam `ingestOne`, ubah:

```ts
      displayName = await fetchMessengerProfileName(event.sender.id)
```

menjadi:

```ts
      displayName = await fetchMessengerProfileName(event.sender.id, platform)
```

- [ ] **Step 5: Jalankan tes, pastikan LULUS**

Run: `npx vitest run src/lib/meta/messenger-profile.test.ts src/lib/inbound-messenger.test.ts`
Expected: PASS semua.

- [ ] **Step 6: Gerbang penuh**

Run: `npm test && npx tsc --noEmit && npx eslint .`
Expected: 0 test gagal, 0 error tsc, 0 error eslint.

- [ ] **Step 7: Commit**

```bash
git add src/lib/meta/messenger-profile.ts src/lib/meta/messenger-profile.test.ts src/lib/inbound-messenger.ts
git commit -m "feat(instagram): pencarian nama sadar-platform

Graph API memperlakukan keduanya berbeda: PSID Facebook hanya bisa lewat
/{page_id}/conversations, sementara IGSID justru bisa lewat endpoint profil
langsung /{igsid}?fields=name,username. Tanpa cabang ini setiap kontak
Instagram lahir tanpa nama, diam-diam, tanpa error.

platform wajib dan tanpa default -- default apa pun salah untuk separuh
pemanggil dan gagal secara senyap."
```

---

## Task 2: Kirim teks sadar-platform

**Files:**
- Modify: `src/lib/meta/messenger-send.ts`
- Test: `src/lib/meta/messenger-send.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `sendMessengerText(recipientId: string, text: string, platform: 'FACEBOOK' | 'INSTAGRAM'): Promise<{ externalId: string }>` — `platform` **WAJIB, tanpa default**.

**Dua perbedaan nyata antara IG dan FB di endpoint yang sama:**
1. Dokumentasi Instagram tidak menyertakan `messaging_type` di body. Mengirim field yang tidak dikenal ke Graph API berisiko ditolak, dan tidak ada alasan mengirimnya.
2. Pesan error yang dibaca agen harus menyebut platform yang benar. "Facebook menolak" pada percakapan Instagram membuat agen mencari masalah di tempat yang salah.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `src/lib/meta/messenger-send.test.ts`:

```ts
describe('cabang Instagram', () => {
  it('mengirim ke IGSID tanpa messaging_type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ message_id: 'm_ig_1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendMessengerText('igsid_777', 'Halo!', 'INSTAGRAM')

    expect(res).toEqual({ externalId: 'm_ig_1' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.recipient).toEqual({ id: 'igsid_777' })
    expect(body.message).toEqual({ text: 'Halo!' })
    // Dokumentasi Instagram tidak menyertakan messaging_type. Mengirim field yang tidak
    // dikenal ke Graph API berisiko ditolak, dan tidak ada alasan mengirimnya.
    expect(body).not.toHaveProperty('messaging_type')
  })

  it('menyebut Instagram, bukan Facebook, saat jendela 24 jam lewat', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { code: 10 } }),
    }))

    await expect(sendMessengerText('igsid_777', 'Halo!', 'INSTAGRAM'))
      .rejects.toThrow(/Instagram menolak.*24 jam/)
  })

  it('tidak membocorkan token di pesan error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: 'Invalid OAuth token token-uji', code: 190 } }),
    }))

    await expect(sendMessengerText('igsid_777', 'Halo!', 'INSTAGRAM')).rejects.not.toThrow(/token-uji/)
  })
})

// Regresi: Facebook tetap mengirim messaging_type RESPONSE dan tetap menyebut Facebook.
it('Facebook tetap mengirim messaging_type RESPONSE', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm_fb_1' }) })
  vi.stubGlobal('fetch', fetchMock)

  await sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK')

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
  expect(body.messaging_type).toBe('RESPONSE')
})

it('Facebook tetap menyebut Facebook saat jendela lewat', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 400, json: async () => ({ error: { code: 10 } }),
  }))

  await expect(sendMessengerText('psid_abc', 'Halo!', 'FACEBOOK'))
    .rejects.toThrow(/Facebook menolak.*24 jam/)
})
```

Perbarui juga tes lama di file ini yang memanggil `sendMessengerText` dengan dua argumen — tambahkan `'FACEBOOK'` sebagai argumen ketiga pada setiap pemanggilan.

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

Run: `npx vitest run src/lib/meta/messenger-send.test.ts`
Expected: FAIL — fungsi baru menerima 2 argumen dan selalu mengirim `messaging_type`.

- [ ] **Step 3: Implementasi**

Ganti seluruh isi `src/lib/meta/messenger-send.ts` dengan:

```ts
const GRAPH_VERSION = 'v21.0'

const PLATFORM_NAMA: Record<'FACEBOOK' | 'INSTAGRAM', string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
}

/**
 * Kirim pesan teks ke satu PSID (Facebook) atau IGSID (Instagram) lewat Graph API Page.
 *
 * Endpoint dan token-nya SAMA untuk kedua platform -- `POST /me/messages` dengan Page
 * Access Token -- karena akun Instagram Professional-nya tertaut ke Page yang sama. Ini
 * jalur "Page-linked", bukan "Instagram API with Instagram Login" (graph.instagram.com),
 * yang punya endpoint sendiri dan TIDAK dipakai di sini.
 *
 * Dua hal yang tetap berbeda:
 * 1. `messaging_type` hanya dikirim untuk Facebook. Dokumentasi kirim Instagram tidak
 *    menyertakannya, dan mengirim field yang tidak dikenal ke Graph API berisiko ditolak.
 * 2. Nama platform di pesan error. "Facebook menolak" pada percakapan Instagram membuat
 *    agen mencari masalah di tempat yang salah.
 *
 * Pesan error dari Meta TIDAK pernah diteruskan mentah-mentah: Meta memantulkan token yang
 * dipakai ke dalam teks error OAuth-nya, dan teks itu bisa mendarat di UI atau audit log.
 * CLAUDE.md §5 melarang token muncul di mana pun.
 */
export async function sendMessengerText(
  recipientId: string,
  text: string,
  platform: 'FACEBOOK' | 'INSTAGRAM',
): Promise<{ externalId: string }> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) throw new Error('FB_PAGE_ACCESS_TOKEN belum diatur')

  const nama = PLATFORM_NAMA[platform]

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      ...(platform === 'FACEBOOK' ? { messaging_type: 'RESPONSE' } : {}),
    }),
  })

  const data: unknown = await res.json()

  if (!res.ok) {
    const code = (data as { error?: { code?: number } }).error?.code
    // Code 10 = di luar jendela 24 jam, berlaku sama untuk Messenger dan Instagram DM.
    // Mencoba lagi tidak akan pernah berhasil, jadi agen harus tahu alasannya alih-alih
    // menekan tombol kirim berulang kali. Sengaja TIDAK bercabang pada subcode: subcode
    // varian Instagram tidak bisa dikonfirmasi dari dokumentasi resmi yang bisa diakses.
    if (code === 10) {
      throw new Error(`${nama} menolak: sudah lewat 24 jam sejak pesan terakhir pelanggan`)
    }
    throw new Error(`Gagal mengirim ke ${nama} (code ${code ?? res.status})`)
  }

  const messageId = (data as { message_id?: string }).message_id
  if (!messageId) throw new Error(`${nama} tidak mengembalikan message_id`)

  return { externalId: messageId }
}
```

- [ ] **Step 4: Jalankan tes, pastikan LULUS**

Run: `npx vitest run src/lib/meta/messenger-send.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta/messenger-send.ts src/lib/meta/messenger-send.test.ts
git commit -m "feat(instagram): kirim teks sadar-platform

Endpoint dan token sama (POST /me/messages dengan Page token) karena akun
Instagram tertaut ke Page yang sama. Dua yang berbeda: messaging_type hanya
untuk Facebook (dokumentasi kirim Instagram tidak menyertakannya), dan nama
platform di pesan error supaya agen tidak mencari masalah di tempat salah.

Sengaja tidak bercabang pada subcode -- subcode varian Instagram tidak bisa
dikonfirmasi dari dokumentasi resmi yang bisa diakses."
```

---

## Task 3: Cabang kirim INSTAGRAM di `send.ts`

**Files:**
- Modify: `src/lib/send.ts` (tipe `platform` ~baris 94, cabang ~baris 121, `sendMessengerMessage`)
- Test: `src/lib/send.test.ts`

**Interfaces:**
- Consumes: `sendMessengerText(recipientId, text, platform)` dari Tugas 2.
- Produces: `sendMessage` menerima percakapan berplatform `INSTAGRAM` dan merutekannya ke jalur Messenger.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `src/lib/send.test.ts` (ikuti gaya mock Prisma yang sudah dipakai file itu):

```ts
describe('percakapan Instagram', () => {
  it('merutekan ke jalur Messenger dengan platform INSTAGRAM', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_ig', contact: { phone: null },
      channelIdentity: { platform: 'INSTAGRAM', externalId: 'igsid_777' },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1' } as never)
    vi.mocked(sendMessengerText).mockResolvedValue({ externalId: 'm_ig_1' })

    await sendMessage({ conversationId: 'conv_ig', text: 'Halo!', sentBy: 'AGENT' })

    expect(sendMessengerText).toHaveBeenCalledWith('igsid_777', 'Halo!', 'INSTAGRAM')
  })

  // Kontak Instagram tidak pernah punya nomor telepon. Kalau cabang platform tidak ada,
  // pengiriman jatuh ke gerbang `!contact.phone` jalur WhatsApp dan SELALU gagal -- dengan
  // pesan yang menyesatkan pula.
  it('tidak pernah jatuh ke gerbang nomor telepon WhatsApp', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_ig', contact: { phone: null },
      channelIdentity: { platform: 'INSTAGRAM', externalId: 'igsid_777' },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1' } as never)
    vi.mocked(sendMessengerText).mockResolvedValue({ externalId: 'm_ig_1' })

    const hasil = await sendMessage({ conversationId: 'conv_ig', text: 'Halo!', sentBy: 'AGENT' })

    expect(hasil).toBeTruthy()
    expect(sendMessengerText).toHaveBeenCalled()
  })

  // Kelas bug yang sama yang attachmentPlaceholder tutup di sisi masuk: gagal TERLIHAT,
  // bukan diam-diam mengirim teksnya saja dan kehilangan lampirannya tanpa jejak.
  it('menolak lampiran secara terlihat, tanpa memanggil provider sama sekali', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
      id: 'conv_ig', contact: { phone: null },
      channelIdentity: { platform: 'INSTAGRAM', externalId: 'igsid_777' },
    } as never)
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_gagal', deliveryStatus: 'FAILED' } as never)

    await sendMessage({
      conversationId: 'conv_ig', text: '', sentBy: 'AGENT',
      media: { type: 'image', url: 'https://x/y.jpg', mimeType: 'image/jpeg' },
    })

    expect(sendMessengerText).not.toHaveBeenCalled()
    const data = mockPrisma.message.create.mock.calls[0][0].data as { deliveryStatus?: string; content?: string }
    expect(data.deliveryStatus).toBe('FAILED')
    expect(data.content).toMatch(/Instagram/)
  })
})
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

Run: `npx vitest run src/lib/send.test.ts`
Expected: FAIL — `platform` INSTAGRAM tidak dikenali, pengiriman jatuh ke jalur WhatsApp.

- [ ] **Step 3: Lebarkan tipe `platform`**

Di `src/lib/send.ts`, ganti baris 94:

```ts
  platform?: 'WHATSAPP' | 'FACEBOOK'
```

menjadi:

```ts
  platform?: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM'
```

- [ ] **Step 4: Rutekan kedua platform Messenger**

Ganti cabang di ~baris 121:

```ts
  if (platform === 'FACEBOOK') {
    return sendMessengerMessage(params, botTrace, conversation)
  }
```

menjadi:

```ts
  // Instagram DM memakai adapter, endpoint, dan token yang SAMA dengan Messenger (akun
  // Instagram Professional tertaut ke Page yang sama), jadi satu cabang untuk keduanya --
  // bukan dua cabang yang cepat atau lambat berselisih. `platform` diteruskan ke bawah
  // supaya body kirim dan pesan error tetap benar per platform.
  if (platform === 'FACEBOOK' || platform === 'INSTAGRAM') {
    return sendMessengerMessage(params, botTrace, conversation, platform)
  }
```

- [ ] **Step 5: Terima dan pakai `platform` di `sendMessengerMessage`**

Tambahkan parameter keempat pada `sendMessengerMessage`:

```ts
  conversation: { channelIdentity: { externalId: string } | null },
  platform: 'FACEBOOK' | 'INSTAGRAM',
) {
  const nama = platform === 'INSTAGRAM' ? 'Instagram' : 'Facebook'
```

Ganti pesan gerbang lampiran:

```ts
  if (params.media) {
    console.error('sendMessage: lampiran belum didukung', {
      conversationId: params.conversationId, platform,
    })
    return recordFailed(`Kirim lampiran ke ${nama} belum didukung -- kirim teks, atau balas lewat aplikasi ${nama}`)
  }
```

Ganti gerbang identitas hilang:

```ts
  const recipientId = conversation.channelIdentity?.externalId
  if (!recipientId) {
    console.error('sendMessage: percakapan tanpa ChannelIdentity', {
      conversationId: params.conversationId, platform,
    })
    return recordFailed(params.text || null)
  }
```

Dan teruskan platform ke pengiriman:

```ts
    const result = await sendMessengerText(recipientId, params.text, platform)
```

- [ ] **Step 6: Jalankan tes, pastikan LULUS**

Run: `npx vitest run src/lib/send.test.ts`
Expected: PASS semua, termasuk tes Facebook yang sudah ada sebelumnya.

- [ ] **Step 7: Gerbang penuh**

Run: `npm test && npx tsc --noEmit && npx eslint .`
Expected: 0 test gagal, 0 error tsc, 0 error eslint.

- [ ] **Step 8: Commit**

```bash
git add src/lib/send.ts src/lib/send.test.ts
git commit -m "feat(instagram): cabang kirim INSTAGRAM di send.ts

Satu cabang untuk FACEBOOK dan INSTAGRAM karena adapter, endpoint, dan
tokennya sama -- bukan dua cabang yang cepat atau lambat berselisih.

Tanpa cabang ini pengiriman Instagram jatuh ke gerbang !contact.phone jalur
WhatsApp dan selalu gagal, dengan pesan yang menyesatkan: kontak Instagram
memang tidak pernah punya nomor telepon."
```

---

## Task 4: Perbaiki `test-conversation.ts` memakai `identity.contactId`

**Kenapa ada di rencana ini:** ini satu-satunya pemanggil `upsertChannelIdentity` yang masih memakai `contact.contactId` sebagai `Conversation.contactId`, padahal kontrak fungsi itu menyatakan nilai baliknya yang wajib dipakai. Kontrak yang sama adalah yang diandalkan seluruh jalur Instagram. Membiarkan satu pelanggar tersisa membuat kontraknya tampak opsional.

**Files:**
- Modify: `src/lib/test-conversation.ts`
- Test: `src/lib/test-conversation.test.ts`

**Interfaces:**
- Consumes: `upsertChannelIdentity(...): Promise<{ id: string; contactId: string }>`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// upsertChannelIdentity mengembalikan pemilik yang BENAR-BENAR terikat, yang belum tentu
// sama dengan Contact yang baru saja dibuat pemanggil. Memakai contact.id sendiri membuat
// Conversation.contactId dan ChannelIdentity.contactId menunjuk Contact berbeda selamanya.
it('memakai contactId dari identitas, bukan Contact yang dibuat sendiri', async () => {
  mockPrisma.contact.findFirst.mockResolvedValue(null as never)
  mockPrisma.contact.create.mockResolvedValue({ id: 'contact_kalah' } as never)
  vi.mocked(upsertChannelIdentity).mockResolvedValue({ id: 'ci_1', contactId: 'contact_menang' })
  mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1' } as never)

  await ensureTestConversation()

  const arg = mockPrisma.conversation.upsert.mock.calls[0][0] as unknown as {
    create: { contactId: string }
  }
  expect(arg.create.contactId).toBe('contact_menang')
})
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

Run: `npx vitest run src/lib/test-conversation.test.ts`
Expected: FAIL — `contactId` yang tertulis adalah `contact_kalah`.

- [ ] **Step 3: Implementasi**

Di `src/lib/test-conversation.ts`, di dalam `prisma.conversation.upsert`, ganti:

```ts
      contactId: contact.contactId,
```

menjadi:

```ts
      // WAJIB nilai balik upsertChannelIdentity, bukan contact.contactId milik pemanggil --
      // lihat kontraknya di src/lib/channel/identity.ts. Kalau identitasnya sudah ada,
      // cabang update tidak menyentuh contactId, jadi pemiliknya bisa Contact yang lain.
      contactId: identity.contactId,
```

- [ ] **Step 4: Jalankan tes, pastikan LULUS**

Run: `npx vitest run src/lib/test-conversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/test-conversation.ts src/lib/test-conversation.test.ts
git commit -m "fix(test-conversation): pakai identity.contactId sesuai kontrak

Satu-satunya pemanggil upsertChannelIdentity yang masih memakai contactId
miliknya sendiri. Kontrak yang sama diandalkan seluruh jalur Instagram;
satu pelanggar tersisa membuat kontraknya tampak opsional."
```

---

## Task 5: Nyalakan tab Instagram

**Tugas TERAKHIR, dengan sengaja.** Tab adalah janji ke operator bahwa channelnya hidup. Menyalakannya sebelum Tugas 1–3 selesai berarti menjanjikan sesuatu yang belum bisa diberikan, dan tab kosong tidak bisa dibedakan dari channel yang rusak.

**Files:**
- Modify: `src/lib/channel/platform.ts`
- Modify: `src/lib/channel/platform.test.ts`
- Modify: `docs/superpowers/specs/check-omnichannel-design.mjs`
- Modify: `src/components/inbox/ConversationList.test.tsx` (komentar yang menyebut daftar platform)

**Interfaces:**
- Consumes: `SHIPPED_PLATFORMS` dibaca `ConversationList.tsx` untuk merender pil tab — sudah generik, tidak perlu diubah.

- [ ] **Step 1: Perbarui tes yang mengunci daftar**

Di `src/lib/channel/platform.test.ts`, ganti:

```ts
    expect(SHIPPED_PLATFORMS).toEqual(['WHATSAPP', 'FACEBOOK'])
    expect(SHIPPED_PLATFORMS).not.toContain('INSTAGRAM')
    expect(SHIPPED_PLATFORMS).not.toContain('EMAIL')
```

menjadi:

```ts
    expect(SHIPPED_PLATFORMS).toEqual(['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'])
    // Email belum punya fase yang selesai -- tab kosong lebih buruk daripada tidak ada tab.
    expect(SHIPPED_PLATFORMS).not.toContain('EMAIL')
```

- [ ] **Step 2: Jalankan tes, pastikan GAGAL**

Run: `npx vitest run src/lib/channel/platform.test.ts`
Expected: FAIL — daftar masih dua entri.

- [ ] **Step 3: Implementasi**

Di `src/lib/channel/platform.ts`, ganti:

```ts
export const SHIPPED_PLATFORMS = ['WHATSAPP', 'FACEBOOK'] as const satisfies readonly Platform[]
```

menjadi:

```ts
export const SHIPPED_PLATFORMS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'] as const satisfies readonly Platform[]
```

Perbarui juga kalimat terakhir komentar di atasnya:

```ts
 * Tab kosong lebih buruk daripada tidak ada tab: ia menjanjikan sesuatu yang tidak bisa
 * diberikan, dan tidak bisa dibedakan dari channel yang rusak. Karena itu Email TIDAK ada
 * di sini sampai fasenya benar-benar selesai.
```

- [ ] **Step 4: Balik klaim di pemeriksa spec**

Di `docs/superpowers/specs/check-omnichannel-design.mjs`, ganti blok tiga `mustNotContain` "fase Instagram, belum" dengan:

```js
// Fase Instagram SELESAI (2026-09-25): assertion-nya berbalik arah, seperti §4 dan §6 sebelumnya.
mustContain('src/lib/send.ts', /platform === 'FACEBOOK' \|\| platform === 'INSTAGRAM'/, 'cabang kirim FACEBOOK dan INSTAGRAM')
mustContain('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'\]/, 'INSTAGRAM di SHIPPED_PLATFORMS')
mustContain('src/lib/meta/messenger-profile.ts', /platform: 'FACEBOOK' \| 'INSTAGRAM'/, 'messenger-profile sadar platform')
mustContain('src/lib/meta/messenger-send.ts', /platform: 'FACEBOOK' \| 'INSTAGRAM'/, 'messenger-send sadar platform')
// Email BELUM -- klaim "belum ada" berikutnya yang harus basi saat fase email jalan.
mustNotContain('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \[[^\]]*EMAIL/, 'EMAIL di SHIPPED_PLATFORMS (fase email, belum)')
```

- [ ] **Step 5: Jalankan pemeriksa spec**

Run: `node docs/superpowers/specs/check-omnichannel-design.mjs`
Expected: exit 0, "✓ semua klaim … masih cocok dengan repo".

- [ ] **Step 6: Gerbang penuh + build**

Run: `npm test && npx tsc --noEmit && npx eslint . && npm run build`
Expected: semua hijau, build exit 0. **Build wajib** — tes dan tsc tidak menangkap kerusakan bundel klien, dan Tugas 5 menyentuh komponen yang dirender.

- [ ] **Step 7: Commit**

```bash
git add src/lib/channel/platform.ts src/lib/channel/platform.test.ts \
        src/components/inbox/ConversationList.test.tsx \
        docs/superpowers/specs/check-omnichannel-design.mjs
git commit -m "feat(instagram): nyalakan tab Instagram di Inbox

Tugas terakhir dengan sengaja: tab adalah janji ke operator bahwa channelnya
hidup. Menyalakannya lebih dulu berarti menjanjikan sesuatu yang belum bisa
diberikan, dan tab kosong tidak bisa dibedakan dari channel yang rusak.

Pemeriksa spec dibalik arahnya: klaim fase Instagram 'belum' menjadi 'sudah',
dan EMAIL menggantikannya sebagai klaim 'belum' berikutnya."
```

---

## Task 6: Konfigurasi Meta dan verifikasi produksi

**Bukan tugas kode.** Tidak ada file yang diubah. Ini gerbang yang menentukan apakah Tugas 1–5 benar-benar berfungsi, dan sebagian langkahnya **butuh tindakan pemilik akun** — bukan sesuatu yang bisa diselesaikan agen sendirian.

**Prasyarat yang harus dipastikan dulu (di luar kode):**

1. Akun Instagram JVTO adalah **Professional account** (Business atau Creator).
2. Akun itu **tertaut ke Facebook Page `698402510359502`** lewat Meta Business Suite.
3. App **Wa Dashboard JVTO** (`1487609042970236`) punya use case Instagram dengan izin `instagram_basic`, `instagram_manage_messages`, dan `pages_manage_metadata`.
4. **Advanced Access** untuk `instagram_manage_messages` — tanpa ini hanya orang yang punya peran di app/Page yang bisa dibalas. Ini lewat App Review, prosesnya di luar kendali kode dan biasanya paling lama.

- [ ] **Step 1: Verifikasi tautan Instagram ↔ Page**

```bash
ssh root@31.97.223.43 'cd /var/www/wa-inbox; set -a; . ./.env; set +a
curl -s "https://graph.facebook.com/v21.0/698402510359502?fields=name,instagram_business_account&access_token=$FB_PAGE_ACCESS_TOKEN" \
  | python3 -m json.tool'
```

Expected: `instagram_business_account` berisi `{id: ...}`.
Kalau `error` code 100 muncul: izin `instagram_basic` belum ada — **berhenti**, selesaikan prasyarat 3 dulu.

- [ ] **Step 2: Verifikasi scope token benar-benar bertambah**

```bash
ssh root@31.97.223.43 'cd /var/www/wa-inbox; set -a; . ./.env; set +a
curl -s "https://graph.facebook.com/v21.0/debug_token?input_token=$FB_PAGE_ACCESS_TOKEN&access_token=$FB_PAGE_ACCESS_TOKEN" \
  | python3 -c "import sys,json; print(sorted(json.load(sys.stdin)[\"data\"][\"scopes\"]))"'
```

Expected: daftar memuat `instagram_basic` dan `instagram_manage_messages`.
**Jangan pernah mencetak nilai tokennya**, hanya scope-nya.

> Kalau scope belum bertambah setelah izin ditambahkan di App Dashboard, Page Access Token-nya harus **diterbitkan ulang** — token membawa scope yang berlaku saat ia dibuat, bukan yang berlaku sekarang.

- [ ] **Step 3: Langganan webhook objek `instagram`**

Di App Dashboard → Webhooks, pilih objek **`instagram`** (bukan `page`), callback `https://wa-inbox.javavolcano-touroperator.com/api/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN` yang ada di `.env` produksi. Subscribe field `messages` dan `messaging_postbacks`.

Lalu install app ke Page-nya:

```bash
ssh root@31.97.223.43 'cd /var/www/wa-inbox; set -a; . ./.env; set +a
curl -s -X POST "https://graph.facebook.com/v21.0/698402510359502/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=$FB_PAGE_ACCESS_TOKEN"'
```

Expected: `{"success":true}`.

- [ ] **Step 4: Deploy**

```bash
# LOKAL dulu -- tes/tsc/eslint tidak menangkap kerusakan bundel klien
npm run build && echo "BUILD_EXIT=$?"

git push origin main

ssh root@31.97.223.43 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
  cd /var/www/wa-inbox && git fetch origin && git reset --hard origin/main
  npx prisma generate && npm run build'
```

Restart HANYA kalau build exit 0, dengan nvm di perintah yang sama:

```bash
ssh root@31.97.223.43 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
  pm2 restart wa-inbox --update-env && sleep 8 && pm2 list | grep wa-inbox'
```

Expected: status `online`.

> **Jebakan yang sudah dua kali mematikan produksi:** `pm2 restart --update-env` mengganti env proses dengan env shell pemanggil. Tanpa nvm Node 22 **di perintah yang sama**, app dapat Node 18, Next.js menolak (butuh ≥20.9.0), dan app `errored` → Cloudflare 502.

- [ ] **Step 5: Smoke test**

```bash
curl -sI https://wa-inbox.javavolcano-touroperator.com/login | head -1
```

Expected: `HTTP/2 200`.

- [ ] **Step 6: Uji DM sungguhan**

Kirim DM ke akun Instagram JVTO **dari akun milik sendiri**, bukan dari akun pelanggan.

Verifikasi berurutan:

```bash
# a. webhook dibalas 200, bukan 401/500
ssh root@31.97.223.43 'grep "api/webhooks/meta" /var/log/nginx/access.log | tail -5'

# b. identitas Instagram lahir dengan nama
ssh root@31.97.223.43 'cd /var/www/wa-inbox; set -a; . ./.env; set +a
psql "$DATABASE_URL" -c "SELECT platform, \"externalId\", \"displayName\" FROM \"ChannelIdentity\" WHERE platform='"'"'INSTAGRAM'"'"';"'
```

Expected: satu baris `INSTAGRAM` dengan `displayName` terisi (bukan `NULL` — kalau `NULL`, Tugas 1 tidak bekerja di produksi).

- [ ] **Step 7: Uji balasan dari Inbox**

Buka tab **Instagram** di Inbox, balas percakapan itu dengan teks.

Expected: balasan sampai di Instagram, dan bubble-nya `SENT` (bukan `FAILED`).

- [ ] **Step 8: Verifikasi tidak ada 500 dan tidak ada kontak ganda**

```bash
ssh root@31.97.223.43 'grep "api/webhooks/meta" /var/log/nginx/access.log | awk "{print \$9}" | sort | uniq -c
cd /var/www/wa-inbox; set -a; . ./.env; set +a
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM \"Contact\" c LEFT JOIN \"Conversation\" v ON v.\"contactId\"=c.id WHERE v.id IS NULL AND c.phone IS NULL;"'
```

Expected: 0 × 500, dan jumlah kontak yatim **tidak bertambah** dari nilai sebelum uji.

---

## Self-Review

**1. Cakupan spec.**

| Bagian spec | Tugas |
| --- | --- |
| §6.2 percabangan `object === 'instagram'` | sudah ada sebelum rencana ini (fase Facebook) — dikunci pemeriksa spec |
| §6.2 satu adapter dengan `platform` parameter | sudah ada — dipakai ulang Tugas 1 |
| §7 cabang `INSTAGRAM → Graph API send (IG)` | Tugas 2 + 3 |
| §8 tab tumbuh per fase | Tugas 5 |
| §5 gerbang runtime tunggal | tidak disentuh — tidak ada tugas yang mengubah `Conversation.botEnabled` |
| §9 Fase 4 bergantung App Review | Tugas 6 prasyarat 4 |
| Sakelar bot per-channel | sudah ada sejak fondasi — dicatat di tabel keadaan awal |

Tidak ada celah.

**2. Pemindaian placeholder.** Tidak ada "TBD", "implement later", atau "similar to Task N". Setiap langkah kode memuat kode sungguhan. Tugas 6 tidak memuat kode karena memang bukan tugas kode — perintahnya konkret dan bisa dijalankan.

**3. Konsistensi tipe.**
- `fetchMessengerProfileName(externalId: string, platform: 'FACEBOOK' | 'INSTAGRAM')` — dideklarasikan Tugas 1, dipakai Tugas 1 Step 4. Konsisten.
- `sendMessengerText(recipientId: string, text: string, platform: 'FACEBOOK' | 'INSTAGRAM')` — dideklarasikan Tugas 2, dipakai Tugas 3 Step 5. Konsisten.
- `sendMessengerMessage(params, botTrace, conversation, platform)` — parameter keempat ditambahkan Tugas 3 Step 5, dipanggil Tugas 3 Step 4. Konsisten.
- `SHIPPED_PLATFORMS` — tipe `readonly Platform[]` tidak berubah, hanya isinya. Konsisten.

**4. Ketergantungan antar tugas.**

| | butuh | alasan |
| --- | --- | --- |
| Tugas 1 | — | berdiri sendiri |
| Tugas 2 | — | berdiri sendiri |
| Tugas 3 | **Tugas 2** | memanggil `sendMessengerText` dengan 3 argumen |
| Tugas 4 | — | berdiri sendiri, tidak menyentuh Instagram |
| Tugas 5 | **1, 2, 3** | tab tidak boleh menyala sebelum jalurnya bekerja |
| Tugas 6 | **1–5** | memverifikasi semuanya di produksi |

Urutan 1 → 2 → 3 → 4 → 5 → 6 memenuhi semuanya. Tugas 4 boleh digeser ke mana saja.

**5. Risiko yang diketahui dan tidak disembunyikan.**

- **`messaging_type` di Instagram** — dokumentasi tidak menyertakannya, tapi tidak secara eksplisit melarangnya. Rencana ini menghilangkannya untuk IG. Kalau Tugas 6 Step 7 gagal dengan error parameter, kembalikan field itu dan perbarui komentar di `messenger-send.ts`. Terdeteksi di Step 7, bukan senyap.
- **Subcode error jendela 24 jam varian Instagram** — tidak terverifikasi dari sumber resmi. Rencana ini karena itu hanya bercabang pada `code === 10`.
- **Advanced Access** bisa memakan waktu berhari-hari dan di luar kendali kode. Tugas 1–5 tetap bisa diselesaikan dan di-deploy sebelum izinnya turun; hanya Tugas 6 Step 6–8 yang tertahan. Tab Instagram sebaiknya **tidak** dinyalakan (Tugas 5) sampai Step 6 terbukti — kalau App Review belum turun, tahan Tugas 5 dan deploy Tugas 1–4 lebih dulu.

---

## Yang TIDAK dilakukan

- **Tidak mengubah skema Prisma.** `enum Platform`, `Settings.botEnabledInstagram`, dan `ChannelIdentity` semuanya sudah ada.
- **Tidak menyentuh jalur WhatsApp.** Tidak ada tugas yang mengubah `MessageChannel`, `resolveChannelForCapability`, atau gerbang `contact.phone`.
- **Tidak membangun kirim lampiran ke Instagram.** Ia gagal terlihat (Tugas 3), tidak diam-diam. Pekerjaan tersendiri.
- **Tidak mengunduh media masuk dari Instagram.** `attachmentPlaceholder` yang sudah ada sudah menanganinya sebagai `[Lampiran: image]`.
- **Tidak memakai jalur "Instagram API with Instagram Login"** (`graph.instagram.com`). Setup ini Page-linked; mencampur keduanya berarti dua sistem izin sekaligus.
- **Tidak melepas langganan `page` app lama** — itu pekerjaan bersih-bersih fase Facebook yang masih terbuka, bukan bagian dari fase ini.
