'use client'
import { cn } from '@/lib/utils'
import { FUNNEL_STAGES, FUNNEL_STAGE_LABELS, type FunnelStage } from '@/lib/pipeline/funnel'

/**
 * Sebaran percakapan per tahap funnel penjualan.
 *
 * Komponen ini TIDAK menentukan tahap apa pun. Tahap tiap percakapan dihitung
 * `resolveFunnelStage` di server (lihat api/bot-control/pipeline/funnel/route.ts) dan yang
 * sampai ke sini hanyalah angka per id tahap. Urutan tangga dan namanya diambil langsung dari
 * `FUNNEL_STAGES` / `FUNNEL_STAGE_LABELS`, bukan dari response, supaya tidak ada salinan kedua
 * daftar tahap yang bisa berbeda dari modulnya.
 *
 * Bilah digambar dengan lebar persen biasa, bukan chart library: enam angka pada satu sumbu
 * tidak membutuhkan apa pun selain pembagian.
 */

export type FunnelCounts = { id: FunnelStage; count: number }[]

export type PipelineFunnelBarProps = {
  stages: FunnelCounts
  total: number
  windowSize: number
}

export function PipelineFunnelBar({ stages, total, windowSize }: PipelineFunnelBarProps) {
  const countById = new Map(stages.map((stage) => [stage.id, stage.count]))
  const max = Math.max(1, ...stages.map((stage) => stage.count))

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-navy">Funnel penjualan</p>
        <p className="text-xs text-muted-foreground">
          {total} percakapan terakhir (jendela {windowSize}, tanpa percakapan sandbox). Tahap dihitung dari kelengkapan
          TripBrief; percakapan yang bot-nya mati dihitung sudah diteruskan ke tim.
        </p>
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada percakapan yang bisa dipetakan ke funnel.</p>
      ) : (
        <ul className="space-y-1.5">
          {FUNNEL_STAGES.map((stage) => {
            const count = countById.get(stage.id) ?? 0
            return (
              <li key={stage.id} className="space-y-0.5" title={stage.description}>
                <span className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{FUNNEL_STAGE_LABELS[stage.id]}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </span>
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn('block h-full rounded-full', count > 0 ? 'bg-brand' : 'bg-transparent')}
                    style={{ width: `${Math.round((count / max) * 100)}%` }}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
