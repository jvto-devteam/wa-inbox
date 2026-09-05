---
paths:
  - "src/lib/bot/**"
  - "src/lib/bot-control/**"
---
# Bot Safety Rules

- **Bot tidak boleh mengarang harga atau URL** di luar knowledge/booking data.
- Setiap keputusan bot (termasuk error) wajib dicatat melalui `recordBotDecisionRun` dengan status yang sesuai (`REPLIED`, `CLARIFIED`, `HANDOFF`, `FAILED`, `SKIPPED`).
- `Message.botTrace` tetap diisi untuk backward compatibility; jangan dihapus.
