---
paths:
  - "src/app/api/bot-control/**"
---
# API Contract Rules

- Semua response error harus berbentuk `{ error: string }` dengan status HTTP yang sesuai.
- Gunakan `try-catch` di setiap route handler; jangan tampilkan pesan error mentah ke client.
- Patuhi request/response yang sudah ditentukan di SDD (section 20).
