# .claude/rules

Aturan yang **path-scoped** — hanya berlaku untuk sebagian file, dan terlalu detail untuk
konstitusi utama. Setiap file punya frontmatter `paths:` yang menentukan kapan ia berlaku.

Isi saat ini:

- `api-contract.md` — route handler di `src/app/api/bot-control/**`.
- `bot-safety.md` — `src/lib/bot/**` dan `src/lib/bot-control/**`.
- `channel-policy.md` — pengiriman dan outbound queue.
- `prisma-schema.md` — `prisma/schema.prisma`.
- `testing.md` — file test.

Aturan yang mengikat seluruh repo tetap di [`CLAUDE.md`](../../CLAUDE.md). Jangan pecah
aturan inti ke sini — satu sumber kebenaran lebih baik daripada dua yang bisa saling
bertentangan. Kalau sebuah file di sini bertentangan dengan `CLAUDE.md`, `CLAUDE.md` yang
berlaku dan file di sini yang harus diperbaiki.

`manage-second.md` dihapus pada 2026-09-08: seluruh isinya menjelaskan lapisan
draft → review → approve → publish → rollback yang sudah tidak ada lagi di kode.
