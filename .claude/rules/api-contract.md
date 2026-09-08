---
paths:
  - "src/app/api/bot-control/**"
---
# API Contract Rules

- Semua response error harus berbentuk `{ error: string }` dengan status HTTP yang sesuai.
- Gunakan `try-catch` di setiap route handler; jangan tampilkan pesan error mentah ke client.
- Urutan wajib untuk setiap mutation ada di `CLAUDE.md` section 6 (auth → `hasAdminPowers`
  → Zod → audit log bila perlu → transaksi bila perlu).
- Tidak ada matriks izin per-peran. Otorisasi = `hasAdminPowers()`.
