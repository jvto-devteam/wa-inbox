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
