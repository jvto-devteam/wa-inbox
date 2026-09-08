---
paths:
  - "src/lib/send.ts"
  - "src/lib/channel-router.ts"
  - "src/lib/outbound/**"
---
# Channel Policy (Wajib)

- **Default outbound** = `UNOFFICIAL` (co-exist).
- Hanya gunakan `OFFICIAL` jika:
  - Mengirim template tersertifikasi.
  - Campaign legal / utility / auth.
  - Fallback ketika unofficial gagal dan official diizinkan.
- Setiap pengiriman via unofficial WAJIB melalui `OutboundJob` dengan retry ladder yang sudah
  diterapkan di `retry-policy.ts`: attempt 1 → immediate, attempt 2 → 30s, attempt 3 → 2m,
  attempt 4 → 10m, then FAILED.

## Outbound Job (dipindahkan dari `manage-second.md` yang sudah dihapus)

- **Stuck recovery:** job yang tertahan di `SENDING` lebih dari 5 menit dikembalikan ke
  `RETRYING` atau `FAILED`. Definisinya ada di **satu tempat**,
  `src/lib/outbound/stuck.ts`, dan dipakai bersama oleh recovery di worker dan filter
  "hanya yang menggantung" di halaman Outbound Queue. Jangan menyalinnya — dua definisi
  yang berbeda membuat halaman berbohong tentang tombol di sebelahnya.
- **Duplicate check** harus meng-exclude `messageId` miliknya sendiri.
- **Campaign job** wajib memeriksa `ContactConsent.optOut`.
- Ambang pengaman (`campaignRatePerMinute`, `duplicateWindowMs`,
  `providerFailureThreshold`, `providerFailureWindowMs`) dibaca dari `Settings` dan
  dibatasi oleh `SAFETY_BOUNDS` di `src/lib/outbound/safety-bounds.ts`. Batas bawahnya
  bukan hiasan: nol mematikan gerbangnya, bukan melonggarkannya.
- `pausedProviders` hanya ditulis oleh `/api/outbound-jobs/pause-provider` dan
  `resume-provider`, tidak pernah lewat `PATCH /api/settings`.
