'use client'
import { Badge } from '@/components/ui/badge'
import { RARE_SUB_STEPS, STEP_STATUS_LABEL } from '@/components/bot-control/PipelineCanvas'
import type { PipelineStep } from '@/lib/pipeline/steps'
import type { PipelineStepRecord } from '@/lib/pipeline/tracer'

/**
 * Panel detail satu step kasar.
 *
 * Step di kanvas sengaja kasar — sebelas kotak yang bisa dibaca sekali lihat. Kehalusannya
 * tidak dibuang, hanya dipindah ke sini: sub-langkah aslinya (28 node registry lama), letaknya
 * di kode, dan catatan yang benar-benar direkam tracer untuk run yang sedang dipilih.
 *
 * `sourceRef` ditampilkan sebagai teks biasa, bukan tautan: tidak ada penampil kode di aplikasi
 * ini, dan tautan yang tidak membuka apa-apa lebih buruk daripada jalur file yang bisa disalin
 * ke editor. Ikatan antara jalur itu dan kode nyata dijaga `steps.test.ts`, bukan oleh panel ini.
 */

export type PipelineStepDetailProps = {
  step: PipelineStep | null
  /** Catatan tracer untuk step ini, dari run yang sedang dipilih. */
  records: PipelineStepRecord[]
  /** Nama run yang sedang dipilih, atau null bila belum ada yang dipilih. */
  runLabel: string | null
  /** Run terpilih ADA, tapi jejaknya tidak pernah terekam (baris lama / jalur tanpa tracer). */
  runUnrecorded: boolean
}

export function PipelineStepDetail({ step, records, runLabel, runUnrecorded }: PipelineStepDetailProps) {
  if (!step) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-semibold text-navy">Detail step</p>
        <p className="text-sm text-muted-foreground">Klik salah satu kotak di kanvas untuk melihat isinya.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-navy">{step.label}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{step.summary}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {step.sourceRef.file} · {step.sourceRef.symbol}
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-navy">Sub-langkah</p>
        <ul className="space-y-1">
          {step.subSteps.map((subStep) => {
            const rare = RARE_SUB_STEPS[subStep.id]
            return (
              <li key={subStep.id} className="rounded border border-border bg-white p-1.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium">{subStep.label}</span>
                  {rare && <Badge variant="muted">jarang dipakai</Badge>}
                </span>
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {subStep.sourceRef.file} · {subStep.sourceRef.symbol}
                </span>
                {rare && <span className="block text-[10px] text-muted-foreground">{rare}</span>}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-navy">Yang terjadi pada run terpilih</p>
        {!runLabel && <p className="text-xs text-muted-foreground">Belum ada run yang dipilih.</p>}
        {runLabel && runUnrecorded && (
          // Bukan kegagalan. Run ini berjalan sebelum instrumentasi ada (atau lewat jalur tanpa
          // tracer), dan mengatakannya apa adanya lebih jujur daripada kanvas kosong yang
          // terbaca sebagai "bot tidak melakukan apa-apa".
          <p className="text-xs text-muted-foreground">
            Jejak run ini <span className="font-semibold">tidak terekam</span> — run berjalan sebelum instrumentasi ada,
            atau lewat jalur tanpa tracer. Bukan berarti run-nya gagal.
          </p>
        )}
        {runLabel && !runUnrecorded && records.length === 0 && (
          <p className="text-xs text-muted-foreground">Run {runLabel} tidak melewati step ini.</p>
        )}
        {records.map((record, index) => (
          <div key={`${record.stepId}-${index}`} className="rounded border border-border bg-white p-1.5">
            <span className="text-xs font-medium">{STEP_STATUS_LABEL[record.status]}</span>
            {record.at && <span className="ml-1.5 text-[10px] text-muted-foreground">{record.at}</span>}
            {record.detail !== undefined && (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-muted-foreground">
                {safeDetail(record.detail)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * `detail` sudah melewati sanitizer dan pembatas panjang di tracer, tapi bentuknya tetap
 * `unknown` — kolom Json bebas. Yang tidak bisa diserialisasi ditampilkan sebagai keterangan,
 * bukan dibiarkan melempar dan menjatuhkan seluruh panel.
 */
function safeDetail(detail: unknown): string {
  try {
    return JSON.stringify(detail, null, 2) ?? String(detail)
  } catch {
    return '(detail tidak bisa ditampilkan)'
  }
}
