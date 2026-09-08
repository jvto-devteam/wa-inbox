/**
 * The emergency stop for one provider.
 *
 * --- Why this lives in the database and not in a module variable ---
 *
 * A process-local flag would pause the process that received the request and nothing else. This
 * app runs behind `next start` on a VPS and its queue is driven by a scheduler hitting
 * `/api/outbound-jobs/process`; there is no guarantee the request that set the flag and the
 * request that drains the queue land in the same process, and a redeploy clears the flag
 * outright. An operator would press Pause during an incident, watch the button turn green, and
 * messages would keep going out.
 *
 * That is the "inert switch that appears to work" failure this whole system is built to avoid,
 * and it is worst here — the one control whose entire purpose is to be trusted in an emergency.
 * So it is a row, shared by every process and surviving restarts.
 *
 * --- Why it is its own column, and not part of anything that gets saved wholesale ---
 *
 * A pause is an operational action, not configuration. It used to live on a policy row that had
 * a draft → review → approve → publish lifecycle, and the dangerous part was that a publish of
 * some unrelated knowledge change rewrote that row's config from the draft — so a pause set
 * during an incident could be lifted silently by somebody publishing something else. Its own
 * column kept it out of that lifecycle then, and keeps it out of the Settings form now:
 * `pausedProviders` is deliberately NOT in the PATCH /api/settings schema, so saving the safety
 * numbers, the default channel, or a bot sentence cannot touch a pause. The two pause routes
 * are the only writers, and they write straight through — there is nothing to publish.
 *
 * --- Why a paused job is delayed, never failed ---
 *
 * A pause exists to protect messages from a provider that is misbehaving. Failing them would
 * destroy exactly what the operator was trying to save, and a customer would never get their
 * reply. Paused jobs simply stay in the queue and go out when the provider is resumed.
 */
import { prisma } from '@/lib/db'

/** Providers that can be paused. Mirrors OutboundJob.provider. */
export const PAUSABLE_PROVIDERS = ['COEXIST', 'META'] as const
export type PausableProvider = (typeof PAUSABLE_PROVIDERS)[number]

function asProviders(value: unknown): PausableProvider[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PausableProvider =>
    typeof item === 'string' && (PAUSABLE_PROVIDERS as readonly string[]).includes(item)
  )
}

/**
 * Which providers are currently paused.
 *
 * Deliberately NOT cached. Every other loader in this system caches for thirty seconds because
 * it is read on every turn and its values change rarely. This one is the opposite: it is read
 * once per queue drain, and the entire point of it is to take effect the moment somebody presses
 * the button. A thirty-second delay on an emergency stop is not a performance win.
 *
 * Fails OPEN — an unreadable row means "nothing paused", so a database blip cannot silently
 * halt every outbound message in the account.
 */
export async function getPausedProviders(): Promise<PausableProvider[]> {
  try {
    const row = await prisma.settings.findUnique({ where: { id: 1 }, select: { pausedProviders: true } })
    return asProviders(row?.pausedProviders)
  } catch (error) {
    console.error('getPausedProviders: gagal membaca jeda provider, dianggap tidak ada', { error })
    return []
  }
}

export async function isProviderPaused(provider: string): Promise<boolean> {
  return (await getPausedProviders()).includes(provider as PausableProvider)
}

/** Adds a provider to the paused set. Returns the new set. Idempotent. */
export async function pauseProvider(provider: PausableProvider): Promise<PausableProvider[]> {
  const current = await getPausedProviders()
  if (current.includes(provider)) return current

  const next = [...current, provider]
  await prisma.settings.update({ where: { id: 1 }, data: { pausedProviders: next } })
  return next
}

/** Removes a provider from the paused set. Returns the new set. Idempotent. */
export async function resumeProvider(provider: PausableProvider): Promise<PausableProvider[]> {
  const current = await getPausedProviders()
  if (!current.includes(provider)) return current

  const next = current.filter((item) => item !== provider)
  await prisma.settings.update({ where: { id: 1 }, data: { pausedProviders: next } })
  return next
}
