/**
 * What "stuck" means for an outbound job — in one place, because two places is a bug.
 *
 * A stuck job is not a stored status: it is a row still sitting in SENDING long after the
 * worker that claimed it should have finished. Two things read that definition — the recovery
 * pass in `worker.ts` that drags such rows back onto the retry ladder, and the "hanya yang
 * menggantung" filter on the Outbound Queue page that shows an operator what recovery WOULD
 * touch before they press the button. If those two ever describe different rows, the page lies
 * about the button next to it: the list shows nothing and recovery moves forty jobs, or the
 * list shows forty and recovery moves none. The filter exists precisely so nobody has to press
 * that button blind, so it has to be the same query, not a copy of it.
 */
import type { Prisma } from '@prisma/client'

/**
 * How long a job may sit in SENDING before the worker holding it is presumed dead.
 *
 * The atomic claim in `worker.ts` is what makes concurrent workers safe, but it is also a
 * one-way door: a process killed between the claim and the outcome write (a deploy, an OOM, a
 * function timeout, a crashed dispatch) leaves the row in SENDING forever, and the due-jobs
 * query only ever looks at QUEUED/RETRYING. Nothing would come back for it — the customer
 * never gets the message, the bubble stays PENDING, and no error is recorded anywhere.
 *
 * Five minutes, per SDD Manage Second §8.7. The number trades two failures against each
 * other: too short re-dispatches an attempt that was merely slow, sending the customer the
 * message twice (the exact failure the atomic claim exists to prevent); too long just makes
 * them wait for a message the system already knows nothing is coming for. A wa-coexist or
 * Graph call plus a media upload is seconds, so five minutes is far outside normal and still
 * inside a single scheduler tick's patience.
 */
export const STUCK_SENDING_MS = 5 * 60_000

/**
 * The one where-clause that says "abandoned mid-flight".
 *
 * `updatedAt` is the claim's own timestamp: flipping the row to SENDING is the last write it
 * received, so "not touched since the cutoff" is exactly "claimed that long ago and never
 * finished".
 */
export function stuckOutboundJobWhere(now: Date = new Date()): Prisma.OutboundJobWhereInput {
  return { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - STUCK_SENDING_MS) } }
}
