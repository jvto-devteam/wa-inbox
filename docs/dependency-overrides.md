# `overrides` di package.json

`package.json` tidak bisa memuat komentar, jadi alasan setiap entri di blok `overrides`
dicatat di sini. **Jangan hapus sebuah override tanpa mengecek ulang `npm audit`** — kalau
upstream sudah naik sendiri, override-nya boleh dibuang, kalau belum, membuangnya
mengembalikan advisory-nya.

Terakhir diperiksa: 2026-09-07 (`npm audit --audit-level=moderate` → 0 vulnerabilities).

## `deepmerge-ts: ^8.0.2`

- Ditarik oleh `prisma` → `@prisma/config` → `deepmerge-ts@7.1.5`.
- Advisory: GHSA-ggr8-5vv4-36mx (stack exhaustion saat merge object graph rekursif), high.
- Prisma 7.10.0 (versi 7.x terbaru saat ini) masih memakai 7.x, dan `npm audit fix --force`
  menyelesaikannya dengan **menurunkan** ke `prisma@6.19.3` — downgrade major yang tidak boleh
  dilakukan, karena stack yang dipakai proyek ini adalah Prisma 7 (lihat `CLAUDE.md`).
- Dipakai oleh Prisma untuk memuat `prisma.config.ts`. Sudah diverifikasi dengan
  `npx prisma validate` dan `npx prisma generate` setelah override dipasang.
- **Buang override ini** begitu `@prisma/config` sendiri naik ke `deepmerge-ts@^8`.

## `mysql2: ^3.24.3`

- Ditarik oleh `prisma` (CLI) sebagai driver opsional.
- Advisory: GHSA-3f6p-5ww8-9rcr (auth plugin downgrade membocorkan kredensial plaintext) dan
  GHSA-rgwj-5xj2-c3m3 (decompression-bomb DoS), keduanya high.
- Proyek ini memakai PostgreSQL — `mysql2` tidak pernah dieksekusi. Override-nya dipasang
  supaya audit bersih dan tidak menutupi advisory lain yang benar-benar relevan, bukan karena
  ada jalur eksploitasi di sini.
- Sama seperti di atas: `npm audit fix --force` "memperbaikinya" dengan downgrade Prisma.
