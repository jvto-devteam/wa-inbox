import { describe, it, expect } from 'vitest'
import { classifySalesNeed } from './sales-classifier'

describe('classifySalesNeed', () => {
  // --- J1_package_discovery (real profile: package_recommendation) ---
  // Real required fields: destinations, pickup.location, dropoff.location.
  // travel_dates.start / pax.confirmed are OPTIONAL for this profile (routing-and-
  // clarification.yaml lines 79-83) -- so an empty TripBrief on a generic package
  // question should only flag `destination`, NOT dateRange/pax. This corrects the
  // task brief's placeholder, which assumed all three are always required.
  it('defaults to J1 (package discovery) and flags only destination when TripBrief is empty', () => {
    const result = classifySalesNeed({ message: 'Halo, mau tanya paket wisata', tripBrief: {} })
    expect(result.job).toBe('J1')
    expect(result.missingInfo).toEqual(['destination'])
    expect(result.needsLiveData).toBe(false)
  })

  it('does not flag destination once present for J1', () => {
    const result = classifySalesNeed({
      message: 'Ada paket ke Ijen?',
      tripBrief: { destination: 'Ijen' },
    })
    expect(result.job).toBe('J1')
    expect(result.missingInfo).toEqual([])
  })

  // --- J2_price_and_value (real profile: standard_price) ---
  // Real required fields: selected_package_key (mapped -> destination, judgment call),
  // pax.confirmed. travel_dates.start is OPTIONAL (yaml lines 84-88).
  it('classifies price questions as J2 and flags destination + pax but not dateRange', () => {
    const result = classifySalesNeed({ message: 'Berapa harganya untuk paket ini?', tripBrief: {} })
    expect(result.job).toBe('J2')
    expect(result.missingInfo).toEqual(expect.arrayContaining(['destination', 'pax']))
    expect(result.missingInfo).not.toContain('dateRange')
  })

  it('does not flag J2 fields once destination and pax are both present', () => {
    const result = classifySalesNeed({
      message: 'Berapa harganya?',
      tripBrief: { destination: 'Ijen', pax: 2 },
    })
    expect(result.missingInfo).toEqual([])
  })

  // --- J3_route_and_timing (real profile: route_validation) ---
  // Real required fields: travel_dates.start, pax.confirmed, pickup.location,
  // dropoff.location, destinations -- all three wa-inbox fields are required here.
  it('classifies connection/pickup questions as J3 and flags all three fields when empty', () => {
    const result = classifySalesNeed({
      message: 'Saya naik pesawat, bisa dijemput di airport?',
      tripBrief: {},
    })
    expect(result.job).toBe('J3')
    expect(result.missingInfo).toEqual(expect.arrayContaining(['destination', 'dateRange', 'pax']))
  })

  // --- J4_live_confirmation (real profile: availability_check) ---
  // Real required fields: selected_package_key (-> destination), travel_dates.start,
  // pax.confirmed.
  //
  // needsLiveData no longer follows from job===J4 alone (see sales-classifier.ts's own
  // comment on that line): confirmed 2026-08-05, "Tour selalu available" -- JVTO's tours are
  // private/bespoke with no shared slot inventory, so a bare availability question is
  // directly answerable, not something needing "let me check with our team".
  it('classifies as J4 for availability questions but no longer flags needsLiveData (tours are always available)', () => {
    const result = classifySalesNeed({ message: 'Ada slot kosong tanggal 1 Agustus?', tripBrief: { destination: 'Ijen' } })
    expect(result.job).toBe('J4')
    expect(result.needsLiveData).toBe(false)
    expect(result.missingInfo).toEqual(expect.arrayContaining(['dateRange', 'pax']))
  })

  it('clears J4 missingInfo once destination, dateRange, and pax are all present', () => {
    const result = classifySalesNeed({
      message: 'Apakah masih tersedia?',
      tripBrief: { destination: 'Ijen', dateRange: '2026-08-01', pax: 2 },
    })
    expect(result.job).toBe('J4')
    expect(result.missingInfo).toEqual([])
  })

  // --- J5_exception_and_handoff (real profile: general_information -> required: []) ---
  // J5 is complaint/refund/booking-status/human-handoff territory, not a data-gathering
  // job, so the real requirement_profiles config requires nothing for it -- missingInfo
  // must stay empty even with a completely empty TripBrief.
  it('classifies complaints/refund requests as J5 with no missingInfo regardless of TripBrief', () => {
    const result = classifySalesNeed({ message: 'Saya mau komplain, minta refund dong', tripBrief: {} })
    expect(result.job).toBe('J5')
    expect(result.missingInfo).toEqual([])
  })

  it('classifies an explicit human-handoff request as J5', () => {
    const result = classifySalesNeed({ message: 'Bisa saya bicara dengan orang?', tripBrief: {} })
    expect(result.job).toBe('J5')
  })

  it('prioritizes J5 handoff signals over price keywords in the same message', () => {
    const result = classifySalesNeed({
      message: 'Saya komplain soal harganya, ini terlalu mahal',
      tripBrief: {},
    })
    expect(result.job).toBe('J5')
  })

  // Narrowed 2026-08-05 to match chatbot-web's own escalation scope: "refund"/"cancel"/
  // "sudah bayar" alone no longer force job=J5 -- they're ordinary, answerable FAQ topics
  // (policy_cancellation_package_credit's real cancellation/refund policy, or -- for a
  // customer who actually has a booking -- Mode 3's own real payment-status answer).
  it('does NOT force J5 for a bare refund/cancellation/payment-status question (now answerable FAQ, not automatic escalation)', () => {
    expect(classifySalesNeed({ message: 'What is your refund policy?', tripBrief: {} }).job).not.toBe('J5')
    expect(classifySalesNeed({ message: 'Bisa saya cancel booking saya?', tripBrief: {} }).job).not.toBe('J5')
    expect(classifySalesNeed({ message: 'Sudah bayar tapi belum ada konfirmasi', tripBrief: {} }).job).not.toBe('J5')
  })

  // --- needsLiveData decoupled from job (attraction hard-dependency / guarantee phrases) ---
  // guardrails-and-state.yaml's attraction_hard_dependency trigger_phrases (e.g. "main
  // reason", "must see") force a live_check action regardless of the resolved job -- they
  // do NOT by themselves flip the job to J4 the way a direct availability question does.
  it('flags needsLiveData for hard-dependency phrasing even when job stays J1', () => {
    const result = classifySalesNeed({
      message: 'Blue Fire is why we are coming, it is a must see for us',
      tripBrief: {},
    })
    expect(result.job).toBe('J1')
    expect(result.needsLiveData).toBe(true)
  })

  // guardrails-and-state.yaml's guarantee_phrases (lines 16-20) force mode="handoff" in the
  // real system -- deliberately DIVERGED from as of 2026-08-05 (see this file's
  // GUARANTEE_KEYWORDS comment and orchestrator.ts's header): a guarantee demand still flags
  // needsLiveData (so the LLM defers that specific detail), but no longer forces job=J5. The
  // LLM's own GUARDRAIL_INSTRUCTION is what keeps the reply honest now, without escalating.
  it('flags needsLiveData (but does NOT force J5) when a guarantee is demanded', () => {
    const result = classifySalesNeed({
      message: 'Can you guarantee we will see Blue Fire?',
      tripBrief: { destination: 'Ijen' },
    })
    expect(result.job).not.toBe('J5')
    expect(result.needsLiveData).toBe(true)
  })

  // --- fail-safe _EMPTY semantics (sales_intelligence.py line 27: None/""/[]/{}} ---
  it('treats an empty-string dateRange as missing, matching the real _EMPTY sentinel', () => {
    const result = classifySalesNeed({
      message: 'Saya naik kereta, bisa dijemput?',
      tripBrief: { destination: 'Ijen', dateRange: '', pax: 2 },
    })
    expect(result.missingInfo).toContain('dateRange')
  })

  it('does not treat pax=0 as missing, matching the real _EMPTY sentinel (0 is not in _EMPTY)', () => {
    const result = classifySalesNeed({
      message: 'Berapa harganya?',
      tripBrief: { destination: 'Ijen', pax: 0 },
    })
    expect(result.missingInfo).not.toContain('pax')
  })

  it('is case-insensitive when matching keywords', () => {
    const result = classifySalesNeed({ message: 'BERAPA HARGA paketnya?', tripBrief: {} })
    expect(result.job).toBe('J2')
  })

  // Reported live 2026-08-06: real B2B/reseller-partnership questions (a Ctrip agent, PT
  // Darmawisata staff, an influencer-collaboration offer) were answered as if they were
  // ordinary retail customers -- no module carries commercial partnership terms, and an LLM
  // must never invent one. This is a genuine "only a human can answer" case.
  it('classifies B2B/partnership inquiries as J5 (human handoff), not an ordinary FAQ', () => {
    expect(classifySalesNeed({ message: 'Kerja sama kemitraan yang mana dari produk kami', tripBrief: {} }).job).toBe('J5')
    expect(classifySalesNeed({ message: 'Do you offer wholesale or reseller rates?', tripBrief: {} }).job).toBe('J5')
    expect(classifySalesNeed({ message: 'We would love to explore collaborating with you for a reel', tripBrief: {} }).job).toBe(
      'J5'
    )
  })

  // Deliberately does NOT flag a bare "partner"/"group rate" mention -- both are ambiguous
  // with an ordinary retail customer (a travel companion/spouse, or a real large family
  // booking asking about group pricing), unlike the more specific B2B terms above.
  it('does not misclassify an ordinary retail mention of "partner" or "group rate" as B2B handoff', () => {
    expect(classifySalesNeed({ message: 'It will just be my partner and I for this trip', tripBrief: {} }).job).not.toBe('J5')
    expect(classifySalesNeed({ message: 'Do you have a group rate for 15 people?', tripBrief: {} }).job).not.toBe('J5')
  })

  // Reported live 2026-08-06: a real service-failure complaint ("I am a bit disappointed
  // because I buy an extra service...") used phrasing this list didn't cover.
  it('classifies "disappointed"/"dissatisfied" as J5, alongside the existing "kecewa"', () => {
    expect(classifySalesNeed({ message: 'I am a bit disappointed because of this', tripBrief: {} }).job).toBe('J5')
    expect(classifySalesNeed({ message: 'We are not satisfied with the service', tripBrief: {} }).job).toBe('J5')
  })
})
