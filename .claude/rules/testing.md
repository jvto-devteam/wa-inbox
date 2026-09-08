---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---
# Testing Rules

- Setiap fitur baru wajib disertai unit test dan/atau route test.
- Test harus lulus sebelum PR diajukan (`npm test`, `npx tsc --noEmit`, `npx eslint .`).
- Untuk simulator, **wajib** ada test yang memastikan tidak ada pemanggilan `sendMessage`
  dan tidak ada `OutboundJob` yang dibuat.
- Test bot/messaging tidak boleh menyentuh nomor pelanggan sungguhan.
