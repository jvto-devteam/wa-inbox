-- Penanda email otomatis (newsletter/notifikasi/balasan mesin) untuk menyaring daily summary.
-- Aditif murni: kolom baru dengan default false, tidak mengubah baris lama.
ALTER TABLE "Conversation" ADD COLUMN     "mailAutomated" BOOLEAN NOT NULL DEFAULT false;
