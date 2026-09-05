---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---
# Testing Rules

- Setiap fitur baru wajib disertai unit test dan/atau route test sesuai section 21 SDD.
- Test harus lulus sebelum PR diajukan.
- Untuk simulator, wajib ada test yang memastikan tidak ada pemanggilan `sendMessage`.
