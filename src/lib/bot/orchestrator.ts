// Bot orchestrator -- the central integration point tying together every
// bot-brain building block from Tasks 20-28 into the 3-mode decision flow
// documented in docs/design/wa-inbox-concept.html's "Kapan bot balas
// sendiri, kapan handoff" table:
//
//   -1. Kill switch (Task 33): an operator emergency-stop flag
//      (`Settings.botKillSwitch`) checked first, before even the escalation
//      keywords below -- an unconditional override that bypasses every mode,
//      including Mode 3 (booking_context), unlike the deployment gate at
//      step 2, which deliberately leaves Mode 3 untouched.
//   0. Escalation check (keyword-based) short-circuits everything else,
//      including the booking lookup -- a complaint/refund message must
//      never wait on a network call before handing off to a human.
//   1. Booking lookup (Mode 3, "booking_context"): if the customer has an
//      existing booking, the reply is grounded ONLY in that booking's data
//      via a local-only LLM call (`forceLocal: true` -- booking data is
//      sensitive, so it stays off any hosted API) and the funnel/route-gate
//      machinery is bypassed entirely, since a returning customer with a
//      real booking is not in acquisition-funnel territory.
//   2. No booking -> deployment gate (Task 25): Mode 1/2 answers are built
//      from agent-runtime's catalog/release, so they stay off unless that
//      release has been approved for customer traffic. This does NOT gate
//      Mode 3 (booking_context) above, which is grounded in the independent,
//      already-live, already-trusted Booking API -- gating it on catalog
//      readiness would be a category error.
//   3. Route-integrity gate (Task 22) next, since a handoff there means no
//      verified package to even hold a funnel conversation about.
//   4. Sales-need classification (Task 23): a message needing live data
//      (availability, guarantees) can't be safely answered by the funnel or
//      a cached catalog, so it hands off too -- and so does `job === 'J5'`,
//      the classifier's own dedicated "route to a human" signal (covers
//      cancellations, reschedules, payment/booking-status queries, and
//      complaints via a materially larger keyword surface than this file's
//      own small pre-DB `ESCALATION_KEYWORDS`).
//   5. Funnel (Task 27), resumed from the conversation's persisted
//      `tripBrief.funnelState` (defaulting to 'GREETING' only for brand-new
//      conversations) and persisted back after every step -- NOT hardcoded
//      to 'GREETING' on every call, which would reset returning customers
//      back to the first funnel question on every single message.
//   6. Funnel reaching HUMAN_HANDOFF falls through to a catalog-driven FAQ
//      draft (Task 24) as the last automated attempt before a human takes
//      over.
//
// Every step that can throw (a down booking API, a malformed catalog file,
// an LLM timeout) is wrapped in a single outer try/catch that defaults to
// handoff -- the fail-safe of last resort for this, the highest-stakes
// integration point in the whole bot brain.
import { prisma } from '@/lib/db'
import { lookupBooking } from '@/lib/booking/client'
import { checkRouteGate } from './route-gate'
import { classifySalesNeed } from './sales-classifier'
import { processFunnelState } from './funnel'
import { composeResponse } from './response-composer'
import { callLLM } from './llm'
import { loadCatalog } from './catalog'
import { checkDeploymentGate } from './deployment-gate'
import type { BotDecision, TripBrief } from './types'

const ESCALATION_KEYWORDS = ['komplain', 'refund', 'bicara dengan manusia', 'agen manusia', 'cs manusia']

function isEscalation(message: string): boolean {
  const lower = message.toLowerCase()
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw))
}

const BOOKING_CACHE_MS = 24 * 60 * 60 * 1000

export async function decideAndRespond(conversationId: string, inboundText: string): Promise<BotDecision> {
  try {
    // Kill switch (Task 33): an unconditional operator emergency stop, checked
    // before even the escalation-keyword check. Unlike the deployment gate
    // below, this bypasses EVERY mode -- including Mode 3 (booking_context) --
    // since it's meant as a strictly stronger override for "something is
    // wrong, halt all automated replies right now."
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    if (settings.botKillSwitch) {
      return { mode: 'handoff', reason: 'Bot dimatikan sementara (kill switch aktif)', cause: 'kill_switch' }
    }

    if (isEscalation(inboundText)) {
      return { mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }
    }

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { contact: true },
    })

    let bookingData = conversation.bookingData as unknown
    const stale =
      !conversation.bookingCheckedAt || Date.now() - conversation.bookingCheckedAt.getTime() > BOOKING_CACHE_MS
    if (stale) {
      bookingData = await lookupBooking(conversation.contact.phone)
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { bookingData: bookingData as never, bookingCheckedAt: new Date() },
      })
    }

    // Mode 3 -- booking context: bypasses funnel and route gate entirely.
    if (bookingData) {
      const prompt = `Data booking pelanggan (JSON): ${JSON.stringify(bookingData)}\n\nPertanyaan: "${inboundText}"\n\nJawab HANYA berdasarkan data booking di atas. Jangan menebak apa pun yang tidak ada di data.`
      const reply = await callLLM(prompt, { forceLocal: true })
      return { mode: 'booking_context', reply }
    }

    // Mode 1/2 -- funnel + FAQ, gated by deployment approval + route integrity.
    // Deployment gate governs agent-runtime's catalog/release (what Mode 1/2 is
    // built from) -- it deliberately does NOT run before the Mode 3 branch
    // above, since Mode 3 is grounded in the independent, already-trusted
    // Booking API, not the catalog release this gate approves.
    const deploymentGate = checkDeploymentGate()
    if (!deploymentGate.readyForApproval) {
      return {
        mode: 'handoff',
        reason: `Gerbang persetujuan belum terbuka: ${deploymentGate.blocking.join(', ')}`,
      }
    }

    const tripBrief = (conversation.tripBrief as TripBrief | null) ?? {}
    const catalog = loadCatalog()
    const routeResult = checkRouteGate({ destination: tripBrief.destination, catalog })
    if (routeResult.status === 'handoff') {
      return { mode: 'handoff', reason: routeResult.reason }
    }

    const classification = classifySalesNeed({ message: inboundText, tripBrief })
    if (classification.needsLiveData) {
      return { mode: 'handoff', reason: 'Butuh data harga/ketersediaan real-time — belum tersambung' }
    }
    if (classification.job === 'J5') {
      return { mode: 'handoff', reason: 'Permintaan memerlukan penanganan manusia (pembatalan/status/komplain)' }
    }

    const funnelResult = processFunnelState({
      currentState: tripBrief.funnelState ?? 'GREETING',
      message: inboundText,
      catalog,
    })
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { tripBrief: { ...tripBrief, funnelState: funnelResult.nextState } as never },
    })
    if (funnelResult.nextState !== 'HUMAN_HANDOFF') {
      return { mode: 'funnel', reply: funnelResult.reply, nextState: funnelResult.nextState }
    }

    const draft = composeResponse({
      topic: 'inclusions',
      packageKey: catalog.packages[0]?.packageKey ?? '',
      catalog,
      isHandoff: false,
    })
    return { mode: 'faq', draft, sourceTopic: 'inclusions' }
  } catch {
    return { mode: 'handoff', reason: 'Terjadi kegagalan saat memproses — default gagal-aman' }
  }
}
