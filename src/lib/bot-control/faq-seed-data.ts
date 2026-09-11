/**
 * Seed data for the 11 general-JVTO-fact blocks formerly hardcoded as `GENERAL_FAQ_FALLBACK`
 * (src/lib/bot/knowledge.ts, removed in Task 11).
 *
 * --- Where this content came from ---
 *
 * Each entry's `answer` is that block's bullet lines, copied MECHANICALLY (a throwaway script
 * reading the constant's source text and printing a TS literal, never retyped by hand) from
 * `GENERAL_FAQ_FALLBACK` as it stood at the commit before this task removed it -- byte-identical,
 * `- ` prefixes included, one line per bullet, joined by \n. Operator gate G2 (2026-09-10)
 * reviewed every one of those facts for correctness before this task ran ("semua benar" -- all
 * correct), so the content moves verbatim, with no edits.
 *
 * `topics` are from the plan's Step 3 table, mapping each block to the `ResolverTopic`(s) whose
 * questions it answers (module-resolver.ts's `RESOLVER_TOPICS`). GENERAL carries all 14 -- it is
 * the one block with no natural single topic, matching how `GENERAL_FAQ_FALLBACK` used to reach
 * every prompt unconditionally.
 *
 * `question` is a natural, customer-phrased question a real message might ask -- this is ONLY
 * phrasing to drive `managedFactsFor`'s word-overlap matching and to read naturally in the
 * knowledge explorer; it carries no fact of its own that isn't already in `answer`.
 *
 * --- Who reads this ---
 *
 * `scripts/seed-faq-knowledge.ts` writes these as managed `KnowledgeSource`/`KnowledgeRevision`
 * rows via `createManagedKnowledge`. Tests import it directly to verify each entry validates
 * against `validateKnowledgeBody` and that `managedFactsFor`/`allManagedFacts` resolve the
 * expected lines from it (the deterministic replacement for the deferred eval run, Ruling R94).
 */
import type { ResolverTopic } from '@/lib/bot/module-resolver'

export type FaqSeedEntry = {
  title: string
  question: string
  answer: string
  topics: ResolverTopic[]
}

export const FAQ_SEED_DATA: FaqSeedEntry[] = [
  {
    "title": "GENERAL",
    "question": "Are your tours private, and where do they depart from?",
    "answer": "- All tours are 100% PRIVATE -- your group only, no strangers ever.\n- Guides: certified, English-speaking local guides.\n- Tours depart from Surabaya or Bali.",
    "topics": [
      "inclusions",
      "price",
      "private_tour",
      "vehicle",
      "rooming",
      "hotel",
      "route_endpoint",
      "destination_readiness",
      "booking",
      "payment",
      "cancellation",
      "blue_fire",
      "greeting",
      "general"
    ]
  },
  {
    "title": "BLUE FIRE",
    "question": "Can we see the Blue Fire at Ijen, and is it guaranteed?",
    "answer": "- A rare natural phenomenon caused by ignited sulfuric gas -- one of Earth's most unique sights.\n- NOT guaranteed -- visibility depends on weather, volcanic activity, and local authority clearance.\n- Best chance: dry season (April-October), typically between 2am-4am before sunrise.\n- Even without blue fire, the sunrise and turquoise crater lake are spectacular.",
    "topics": [
      "blue_fire"
    ]
  },
  {
    "title": "MEDICAL SCREENING",
    "question": "Is a medical screening required before the Ijen hike?",
    "answer": "- Required for ALL participants before the Ijen hike.\n- Conducted by our licensed doctor on-site before departure.\n- Basic fitness check -- anyone with heart, respiratory, or mobility conditions should consult their doctor beforehand.\n- The screening takes about 10-15 minutes.",
    "topics": [
      "destination_readiness"
    ]
  },
  {
    "title": "INCLUSIONS",
    "question": "What's included in the tour package?",
    "answer": "- Private transport & dedicated driver throughout the tour.\n- Hotel accommodation as per the package duration.\n- All entrance tickets to attractions visited.\n- Certified English-speaking local guide.\n- 4WD Jeep for Bromo (where applicable).\n- Gas mask for Ijen hike (where applicable).\n- Medical health screening for Ijen hike (where applicable).",
    "topics": [
      "inclusions"
    ]
  },
  {
    "title": "EXCLUSIONS",
    "question": "What's not included in the tour package?",
    "answer": "- International & domestic flights.\n- Personal travel insurance.\n- Personal expenses, tips, souvenirs.\n- Meals unless stated in the specific package itinerary.",
    "topics": [
      "inclusions"
    ]
  },
  {
    "title": "PAYMENT",
    "question": "How much is the deposit, and when is the balance due?",
    "answer": "- Deposit: 20% of total to confirm booking.\n- Balance due 3 days before Day 1 via Bank Transfer / Wise / Revolut.\n- Cash on Arrival is available for some packages, subject to approval.\n- Last-minute bookings (under 6 days before Day 1): 100% full payment via Bank Transfer required.\n- Within 14 days of Day 1: JVTO may require full payment instead of the standard deposit.",
    "topics": [
      "payment"
    ]
  },
  {
    "title": "WHAT TO BRING",
    "question": "What should we bring or pack for the Bromo and Ijen tour?",
    "answer": "- Warm layers / jacket -- Bromo and Ijen are cold at night (5-15°C).\n- Sturdy closed-toe walking shoes.\n- Headlamp or flashlight (for early morning hikes).\n- Sunscreen and sunglasses for daytime.\n- Small backpack, water bottle, light snacks.\n- Camera or fully charged phone.\n- Passport / ID for entrance tickets.",
    "topics": [
      "destination_readiness"
    ]
  },
  {
    "title": "BEST TIME",
    "question": "What's the best time of year to visit for Blue Fire?",
    "answer": "- Dry season (April-October): best visibility, highest chance of Blue Fire at Ijen.\n- Wet season (November-March): possible rain and fog; Bromo can still be beautiful; Ijen hikes still possible but blue fire less likely.",
    "topics": [
      "blue_fire",
      "destination_readiness"
    ]
  },
  {
    "title": "PHYSICAL DIFFICULTY",
    "question": "How physically difficult is the Ijen hike compared to Bromo?",
    "answer": "- Bromo: Moderate -- short 15-20 min walk to crater rim across volcanic sand (or horse ride available).\n- Ijen: Moderate-Challenging -- 3km hike each way, about 1.5-2 hours, steep in sections; requires good physical fitness.\n- Tumpak Sewu: Moderate -- 30-45 min steep descent and ascent; very rewarding.\n- Not recommended for guests with serious heart, lung, or severe mobility conditions.",
    "topics": [
      "destination_readiness"
    ]
  },
  {
    "title": "DESTINATIONS",
    "question": "What destinations do you offer tours to?",
    "answer": "- Mount Bromo: iconic active volcano, sunrise viewpoints, Sea of Sand, 4WD Jeep ride.\n- Ijen Crater: blue fire phenomenon, turquoise sulfuric crater lake, sunrise, sulfur miners.\n- Tumpak Sewu: Java's most spectacular multi-tiered waterfall.\n- Madakaripura: sacred hidden canyon waterfall, tallest in Java.\n- Papuma Beach: pristine hidden beach in Jember, great for sunsets.\n- Malang / Batu City: Rainbow Village, apple farms, Batu Night Spectacular.\n- Taman Safari Prigen: family-friendly safari park near Bromo (open-air safari).",
    "topics": [
      "general"
    ]
  },
  {
    "title": "FERRY / TRANSPORT",
    "question": "How do we get from Java to Bali, and is transport included?",
    "answer": "- Java-Bali crossing: done via Ketapang-Gilimanuk ferry, included in overland packages.\n- All transport is private and handled by JVTO -- no public buses or shared vans.",
    "topics": [
      "route_endpoint"
    ]
  }
]
