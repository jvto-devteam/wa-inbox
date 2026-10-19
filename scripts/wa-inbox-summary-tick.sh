#!/usr/bin/env bash
# Tick antrean live Summary Harian: POST /api/summary-items/tick (reconcile + item REPLY live,
# tanpa LLM). Dipasang di VPS sebagai /usr/local/bin/wa-inbox-summary-tick.sh, sebentuk dengan
# /usr/local/bin/wa-inbox-daily-summary.sh (job 00:00):
#
#   */5 * * * * /usr/local/bin/wa-inbox-summary-tick.sh
#
# Log: /var/log/wa-inbox-summary-tick.log (satu baris per tick). Secret dibaca dari .env aplikasi
# (OUTBOUND_CRON_SECRET) dan TIDAK PERNAH dicetak -- tidak ke log, tidak ke argumen proses (curl
# membaca header dari stdin, jadi secret tidak terlihat di `ps`).
#
# Jangan ganti endpoint ini dengan /api/outbound-jobs/process: endpoint itu juga menjalankan
# retry ladder outbound, yang sengaja belum dijadwalkan.
set -u

ENV_FILE="${WA_INBOX_ENV_FILE:-/var/www/wa-inbox/.env}"
BASE_URL="${WA_INBOX_BASE_URL:-http://127.0.0.1:3015}"
LOG_FILE="${WA_INBOX_TICK_LOG:-/var/log/wa-inbox-summary-tick.log}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"; }

# Nilai terakhir OUTBOUND_CRON_SECRET=..., tanpa tanda kutip pembungkus.
SECRET="$(grep -E '^OUTBOUND_CRON_SECRET=' "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
if [ -z "$SECRET" ]; then
  log "GAGAL: OUTBOUND_CRON_SECRET tidak ditemukan di $ENV_FILE"
  exit 1
fi

BODY="$(printf 'x-cron-secret: %s\n' "$SECRET" | curl -sS --max-time 60 -X POST -H @- -w '\nHTTP %{http_code}' "$BASE_URL/api/summary-items/tick" 2>&1)"
CODE=$?
unset SECRET

# Jawaban endpoint hanya angka ({ reconciled, live } atau { error }); dipadatkan jadi satu baris.
log "curl=$CODE $(printf '%s' "$BODY" | tr '\n' ' ')"
[ "$CODE" -eq 0 ] && printf '%s' "$BODY" | grep -q 'HTTP 200$'
