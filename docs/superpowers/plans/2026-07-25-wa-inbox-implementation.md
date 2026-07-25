# wa-inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build wa-inbox — a single Next.js application that is the unified WhatsApp workspace for JVTO's team: inbox, CRM, bot brain, and both channel connectors (official Cloud API + wa-coexist), replacing waba-jvto, chatbot-web, and eventually wa-dashboard.

**Architecture:** wa-inbox is the hub. It owns the Meta webhook (sole inbound source), calls wa-coexist's API for unofficial sends/status, calls the JVTO Booking API live for existing-booking lookups, and runs its own bot decision logic (ported from `jvto-whatsapp-agent-runtime`, kept in sync manually) against a periodically-synced knowledge catalog. See `docs/design/wa-inbox-concept.html` for the full concept this plan implements.

**Tech Stack:** Next.js 16 (App Router) + TypeScript + React 19, Tailwind CSS v4, Prisma 7 + `@prisma/adapter-pg` + PostgreSQL, `jose` (JWT session) + `bcryptjs` (passwords), `zod` (validation), Vitest + `@testing-library/react` + `vitest-mock-extended` (testing), Server-Sent Events (real-time), deployed on Vercel.

## Global Constraints

- One WhatsApp number only for v1: JVTO's `6282244788833`, accessed via two parallel surfaces (coexistence) — not modeled as two separate numbers.
- Inbound messages arrive **only** via the Meta Cloud API webhook. Never poll or listen to a second inbound source.
- Outbound messages go through Official (Graph API, direct) or Unofficial (wa-coexist API) — template sends are always forced to Official.
- Five top-level menus only: Beranda, Chat/Inbox, Kontak (CRM), Template Pesan, Pengaturan. No separate "Nomor & Koneksi" or "Bot & Otomasi" nav items — both live inside Pengaturan.
- Bot decision logic (route gate, sales classification, response composition, deployment gate) is ported to TypeScript from `jvto-whatsapp-agent-runtime` Python source — read the actual source file before porting, never invent behavior.
- Booking lookups and wa-coexist calls are always live HTTP calls, never cached-and-synced like the knowledge catalog.
- Bot must fail safe: any classification failure, timeout, or ambiguity defaults to human handoff, never a guess.
- Numeric/price/booking-flow replies use static validated templates, never free-form LLM generation. LLM is only used to phrase answers from already-verified facts (catalog or booking data), never to source facts itself.
- Every Prisma model, function signature, and field name introduced in one task must be reused verbatim by later tasks — do not rename silently.
- All API routes validate input with `zod` and return `{ error: string }` with a 4xx status on validation failure.
- Test runner is Vitest. Unit/route tests mock Prisma via `vitest-mock-extended`'s `mockDeep<PrismaClient>()`; no test hits a real database.
- All UI matches the approved `docs/design/wa-inbox-ui-mockup.html` — Plus Jakarta Sans, navy `#0B1B3D` + brand blue `#2563EB`, shadcn-derived token classes (`border-input`, `text-muted-foreground`, `bg-accent`, `rounded-lg`, `h-8` controls). Always use the shared `src/components/ui/*` primitives (`Button`, `Input`, `Select`, `Textarea`, `Badge`, `Card`, `Table`) from Task 1 instead of raw `<button>`/`<input>`/`<select>` with inline ad-hoc classes — this was a deliberate, explicitly-approved trust-repair step after prior design mismatches, so treat any deviation from the mockup's palette/components as a bug, not a style choice.
- **No live message testing against real customers, ever, during implementation.** Any step that sends or triggers a real WhatsApp message (manual verification steps, ad-hoc `curl`/dev-server checks, and especially anything that exercises the bot orchestrator end-to-end) must target **only the whitelisted test number `6282143403501`** — never a real JVTO customer conversation, and never broadcast/bulk sends. This applies with extra force to the bot (Fase 3, Tasks 20–34 and the cutover in Task 46): the orchestrator must never be exercised against live production customer traffic during implementation, regardless of how confident a task's automated tests are — automated tests use mocked Prisma/fetch and never touch a real number, so they're always safe; it's only manual/exploratory verification steps that carry this risk. If a task's "manual verification" step would otherwise touch a real number, substitute the whitelist number or skip that specific manual check and rely on the automated test coverage instead, flagging the skip in that task's completion report.

---

## Fase 1 — Fondasi + Official Channel

### Task 1: Project scaffold + design system foundation

**Design reference (must match exactly):** `docs/design/wa-inbox-ui-mockup.html` — an approved, pixel-real mockup built from the actual token/component source in `/Users/macbook/Code/waba-jvto/app/globals.css`, `/Users/macbook/Code/waba-jvto/components/ui/*.tsx`, and `/Users/macbook/Code/jvto-cms/src/components/ui/*.tsx`. Font is **Plus Jakarta Sans**, brand colors are **navy `#0B1B3D`** and **brand blue `#2563EB`**, base is the standard shadcn neutral token set at `--radius: 0.625rem`. Do not invent different colors, fonts, radii, or component heights anywhere in this plan — every later task's UI code must use the shared components and token classes this task establishes.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/table.tsx`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: root layout `RootLayout({ children }: { children: React.ReactNode })`, home page that redirects to `/login`. Produces the shared UI primitives every later component task imports from `@/components/ui/*`: `Button({ variant?: 'default'|'outline'|'secondary'|'ghost'|'destructive', size?: 'default'|'sm'|'icon' })`, `Input`, `Select`, `Textarea` (thin styled wrappers over the native elements — matching the mockup's plain-element approach, not a full Radix/`@base-ui` primitive port), `Badge({ variant?: 'default'|'brand'|'success'|'warning'|'destructive'|'muted' })`, `Card`, and `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` (structurally identical to jvto-cms's real `table.tsx`, read in Step 5). `cn(...)` from `src/lib/utils.ts` is the classname-merge helper every one of these uses internally, and every later task uses it too instead of manual template-string concatenation.

- [ ] **Step 1: Scaffold the Next.js app**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir=false --import-alias "@/*" --eslint --use-npm --yes
```

If the directory isn't empty enough for the CLI, create files manually matching the structure below instead.

- [ ] **Step 2: Install remaining dependencies**

```bash
npm install @prisma/client @prisma/adapter-pg pg jose bcryptjs zod date-fns clsx tailwind-merge lucide-react
npm install -D prisma @types/pg @types/bcryptjs vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom vitest-mock-extended tsx
```

- [ ] **Step 3: Configure `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

Create `vitest.setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest'
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write `.env.example`**

```bash
DATABASE_URL="postgresql://user:password@host/db?sslmode=require"
SESSION_SECRET="replace-with-32-byte-random-hex"
META_ACCESS_TOKEN=""
META_APP_SECRET=""
META_WEBHOOK_VERIFY_TOKEN=""
META_PHONE_NUMBER_ID=""
META_WABA_ID=""
COEXIST_BASE_URL="http://localhost:4000"
COEXIST_API_KEY=""
COEXIST_NUMBER_KEY=""
BOOKING_API_URL=""
BOOKING_API_KEY=""
OPENAI_API_KEY=""
OLLAMA_URL="http://localhost:11434"
```

- [ ] **Step 5: Read the real design-system source before writing tokens**

Read `/Users/macbook/Code/jvto-cms/src/app/globals.css` (the `@theme`/`:root` token block and the `bg-slate-50 text-navy` body rule) and `/Users/macbook/Code/jvto-cms/src/components/ui/table.tsx` in full — Step 8 below replicates their structure natively.

- [ ] **Step 6: `tailwind.config` theme extension + `globals.css` with real tokens**

Tailwind v4 reads theme from CSS `@theme` blocks, not a JS config file — write `src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --color-navy: #0B1B3D;
  --color-navy-light: #162C5A;
  --color-brand: #2563EB;
  --color-brand-light: #3B82F6;
  --color-brand-dark: #1D4ED8;
  --font-sans: var(--font-plus-jakarta-sans);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --radius-lg: 0.625rem;
}

:root {
  --background: #FFFFFF;
  --foreground: #0B1B3D;
  --border: #E5E7EB;
  --input: #E5E7EB;
  --muted: #F1F5F9;
  --muted-foreground: #64748B;
  --secondary: #F1F5F9;
  --secondary-foreground: #0B1B3D;
  --accent: #EFF6FF;
  --accent-foreground: #1D4ED8;
  --destructive: #DC2626;
}

@layer base {
  * { border-color: var(--border); }
  body { @apply bg-slate-50 text-navy antialiased; }
  html { @apply font-sans; }
}

.badge {
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.5rem;
  border-radius: 2rem;
  font-size: 0.75rem;
  font-weight: 500;
  gap: 0.25rem;
  white-space: nowrap;
}
```

- [ ] **Step 7: `cn` utility**

`src/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 8: Shared UI primitives**

`src/components/ui/button.tsx`:
```tsx
import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'
type Size = 'default' | 'sm' | 'icon'

const variantClasses: Record<Variant, string> = {
  default: 'bg-navy text-white hover:bg-navy-light',
  outline: 'border border-input bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-200',
  ghost: 'hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
}

const sizeClasses: Record<Size, string> = {
  default: 'h-8 px-3.5 text-sm',
  sm: 'h-7 px-2.5 text-xs',
  icon: 'size-8',
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
}
```

`src/components/ui/input.tsx`:
```tsx
import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20 disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
```

`src/components/ui/select.tsx`:
```tsx
import { cn } from '@/lib/utils'
import type { SelectHTMLAttributes } from 'react'

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn('h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-brand', className)}
      {...props}
    />
  )
}
```

`src/components/ui/textarea.tsx`:
```tsx
import { cn } from '@/lib/utils'
import type { TextareaHTMLAttributes } from 'react'

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20',
        className
      )}
      {...props}
    />
  )
}
```

`src/components/ui/badge.tsx`:
```tsx
import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

type Variant = 'default' | 'brand' | 'success' | 'warning' | 'destructive' | 'muted'

const variantClasses: Record<Variant, string> = {
  default: 'bg-secondary text-secondary-foreground',
  brand: 'bg-brand/10 text-brand',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  destructive: 'bg-red-50 text-red-700',
  muted: 'bg-slate-100 text-slate-600',
}

export function Badge({ variant = 'default', className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return <span className={cn('badge', variantClasses[variant], className)} {...props} />
}
```

`src/components/ui/card.tsx`:
```tsx
import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-white shadow-sm', className)} {...props} />
}
```

`src/components/ui/table.tsx` — structurally ported from the real `jvto-cms/src/components/ui/table.tsx` read in Step 5, using this project's `cn`:
```tsx
import { cn } from '@/lib/utils'
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}
export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />
}
export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-muted/50', className)} {...props} />
}
export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-10 px-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground', className)} {...props} />
}
export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('p-2 align-middle', className)} {...props} />
}
```

- [ ] **Step 9: Root layout with Plus Jakarta Sans loaded**

`src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = { title: 'wa-inbox' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={plusJakartaSans.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
```

`src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/login')
}
```

- [ ] **Step 10: Verify the app boots with the real font and tokens applied**

Run: `npm run dev`, open `http://localhost:3000/login` (it 404s — no route yet, that's fine) then open dev tools on any rendered text and confirm the computed `font-family` includes `Plus Jakarta Sans`.

- [ ] **Step 11: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js 16 app with design system foundation (Plus Jakarta Sans, navy/brand tokens, shared UI primitives) ported from waba-jvto/jvto-cms"
```

---

### Task 2: Prisma schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Create: `prisma/seed.ts`

**Interfaces:**
- Produces: `prisma` singleton export from `src/lib/db.ts` — `import { prisma } from '@/lib/db'`, typed as `PrismaClient`. Every model below is the canonical schema every later task relies on; do not add/rename fields elsewhere without updating this file.

- [ ] **Step 1: Write the full schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AccountRole {
  ADMIN
  AGENT
}

model Account {
  id                    String         @id @default(cuid())
  email                 String         @unique
  passwordHash          String
  name                  String
  role                  AccountRole    @default(AGENT)
  createdAt             DateTime       @default(now())
  assignedConversations Conversation[] @relation("AssignedAgent")
  notes                 Note[]
}

model WaNumber {
  id               String   @id @default(cuid())
  phoneNumber      String   @unique
  phoneNumberId    String
  wabaId           String
  accessToken      String
  coexistBaseUrl   String
  coexistApiKey    String
  coexistNumberKey String
  createdAt        DateTime @default(now())
}

model Contact {
  id        String     @id @default(cuid())
  phone     String     @unique
  name      String?
  avatarUrl String?
  source    String?
  createdAt DateTime   @default(now())
  conversation Conversation?
  notes     Note[]
  reminders Reminder[]
}

enum ConversationStatus {
  OPEN
  PENDING
  CLOSED
}

model Conversation {
  id               String                @id @default(cuid())
  contactId        String                @unique
  contact          Contact               @relation(fields: [contactId], references: [id])
  botEnabled       Boolean               @default(true)
  assignedAgentId  String?
  assignedAgent    Account?              @relation("AssignedAgent", fields: [assignedAgentId], references: [id])
  status           ConversationStatus    @default(OPEN)
  pipelineStage    String                @default("new")
  bookingData      Json?
  bookingCheckedAt DateTime?
  tripBrief        Json?
  lastMessageAt    DateTime              @default(now())
  createdAt        DateTime              @default(now())
  messages         Message[]
  labels           LabelOnConversation[]
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageChannel {
  OFFICIAL
  UNOFFICIAL
}

enum SentBy {
  BOT
  AGENT
  CUSTOMER
}

enum DeliveryStatus {
  PENDING
  SENT
  DELIVERED
  READ
  FAILED
}

model Message {
  id             String           @id @default(cuid())
  conversationId String
  conversation   Conversation     @relation(fields: [conversationId], references: [id])
  externalId     String?          @unique
  direction      MessageDirection
  type           String
  content        String?
  mediaUrl       String?
  channel        MessageChannel
  sentBy         SentBy
  agentId        String?
  botTrace       Json?
  deliveryStatus DeliveryStatus   @default(PENDING)
  createdAt      DateTime         @default(now())

  @@index([conversationId, createdAt])
}

model Label {
  id            String                @id @default(cuid())
  name          String                @unique
  color         String
  conversations LabelOnConversation[]
}

model LabelOnConversation {
  labelId        String
  conversationId String
  label          Label        @relation(fields: [labelId], references: [id])
  conversation   Conversation @relation(fields: [conversationId], references: [id])

  @@id([labelId, conversationId])
}

model Note {
  id        String   @id @default(cuid())
  contactId String
  contact   Contact  @relation(fields: [contactId], references: [id])
  authorId  String
  author    Account  @relation(fields: [authorId], references: [id])
  body      String
  createdAt DateTime @default(now())
}

model Reminder {
  id        String   @id @default(cuid())
  contactId String
  contact   Contact  @relation(fields: [contactId], references: [id])
  dueAt     DateTime
  note      String
  done      Boolean  @default(false)
  createdAt DateTime @default(now())
}

enum TemplateType {
  OFFICIAL
  QUICK_REPLY
}

enum TemplateMetaStatus {
  APPROVED
  PENDING
  REJECTED
  NOT_APPLICABLE
}

model Template {
  id         String              @id @default(cuid())
  name       String
  type       TemplateType
  metaStatus TemplateMetaStatus  @default(NOT_APPLICABLE)
  category   String?
  body       String
  variables  Json?
  createdAt  DateTime            @default(now())
}

model Settings {
  id                Int             @id @default(1)
  defaultChannel    MessageChannel  @default(OFFICIAL)
  workingHoursStart String?
  workingHoursEnd   String?
  offHoursAutoReply String?
  botKillSwitch     Boolean         @default(false)
  catalogSyncedAt   DateTime?
}
```

- [ ] **Step 2: Create the Prisma client singleton**

`src/lib/db.ts`:
```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 3: Seed script — first admin account + default settings row**

`prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const passwordHash = await bcrypt.hash('Admin1234', 12)
  await prisma.account.upsert({
    where: { email: 'admin@jvto.com' },
    update: {},
    create: { email: 'admin@jvto.com', passwordHash, name: 'Admin', role: 'ADMIN' },
  })
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })
}

main().finally(() => prisma.$disconnect())
```

Add to `package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`.

- [ ] **Step 4: Generate client and run migration**

Run: `npx prisma migrate dev --name init`
Expected: migration succeeds, `Account`, `WaNumber`, `Contact`, `Conversation`, `Message`, `Label`, `LabelOnConversation`, `Note`, `Reminder`, `Template`, `Settings` tables created.

Run: `npx prisma db seed`
Expected: one `Account` row (`admin@jvto.com`) and one `Settings` row exist.

- [ ] **Step 5: Commit**

```bash
git add prisma src/lib/db.ts package.json
git commit -m "feat: add Prisma schema for full data model + seed script"
```

---

### Task 3: Password + session helpers

**Files:**
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/session.ts`
- Test: `src/lib/auth/session.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>` from `password.ts`.
- Produces: `createSessionCookie(payload: { accountId: string; role: 'ADMIN' | 'AGENT' }): Promise<string>` (returns a signed JWT string), `verifySessionToken(token: string): Promise<{ accountId: string; role: 'ADMIN' | 'AGENT' } | null>` from `session.ts`. Every later route that needs the current user calls `verifySessionToken`.

- [ ] **Step 1: Password helpers**

`src/lib/auth/password.ts`:
```typescript
import bcrypt from 'bcryptjs'

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
```

- [ ] **Step 2: Write the failing test for session tokens**

`src/lib/auth/session.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionCookie, verifySessionToken } from './session'

beforeAll(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64)
})

describe('session tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'AGENT' })
    const payload = await verifySessionToken(token)
    expect(payload).toEqual({ accountId: 'acc_1', role: 'AGENT' })
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionCookie({ accountId: 'acc_1', role: 'AGENT' })
    const tampered = token.slice(0, -2) + 'xx'
    const payload = await verifySessionToken(tampered)
    expect(payload).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: FAIL — `session.ts` does not exist yet.

- [ ] **Step 3: Implement session helpers**

`src/lib/auth/session.ts`:
```typescript
import { SignJWT, jwtVerify } from 'jose'

export type SessionPayload = { accountId: string; role: 'ADMIN' | 'AGENT' }

function secretKey() {
  return new TextEncoder().encode(process.env.SESSION_SECRET)
}

export async function createSessionCookie(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey())
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return { accountId: payload.accountId as string, role: payload.role as 'ADMIN' | 'AGENT' }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth package.json
git commit -m "feat: add password hashing and JWT session helpers"
```

---

### Task 4: Login page, logout, and route protection

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/middleware.ts`
- Test: `src/app/api/auth/login/route.test.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 3), `createSessionCookie`/`verifySessionToken` (Task 3), `prisma` (Task 2).
- Produces: cookie name `wa_inbox_session`, set as `httpOnly`, `sameSite: 'lax'`, `secure` in production.

- [ ] **Step 1: Write the failing test for the login route**

`src/app/api/auth/login/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockPrisma = mockDeep<PrismaClient>()
  process.env.SESSION_SECRET = 'a'.repeat(64)
})

describe('POST /api/auth/login', () => {
  it('returns 401 for unknown email', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null)
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@jvto.com', password: 'x' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for malformed body', async () => {
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/auth/login/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the login route**

`src/app/api/auth/login/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { createSessionCookie } from '@/lib/auth/session'

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Email atau kata sandi tidak valid' }, { status: 400 })

  const account = await prisma.account.findUnique({ where: { email: parsed.data.email } })
  if (!account || !(await verifyPassword(parsed.data.password, account.passwordHash))) {
    return NextResponse.json({ error: 'Email atau kata sandi salah' }, { status: 401 })
  }

  const token = await createSessionCookie({ accountId: account.id, role: account.role })
  const res = NextResponse.json({ ok: true })
  res.cookies.set('wa_inbox_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })
  return res
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/auth/login/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Logout route**

`src/app/api/auth/logout/route.ts`:
```typescript
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('wa_inbox_session', '', { path: '/', maxAge: 0 })
  return res
}
```

- [ ] **Step 6: Login page UI**

`src/app/login/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error)
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={onSubmit} className="w-80 space-y-4 rounded-lg border border-border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-navy">Masuk ke wa-inbox</h1>
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="Kata sandi" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full">Masuk</Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 7: Route protection middleware**

`src/middleware.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/auth/session'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/webhooks/meta']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next()

  const token = req.cookies.get('wa_inbox_session')?.value
  const session = token ? await verifySessionToken(token) : null
  if (!session) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 8: Commit**

```bash
git add src/app/login src/app/api/auth src/middleware.ts
git commit -m "feat: add login page, logout route, and session middleware"
```

---

### Task 5: Meta webhook — verification handshake + HMAC signature check

**Files:**
- Create: `src/lib/meta/webhook-verify.ts`
- Create: `src/app/api/webhooks/meta/route.ts`
- Test: `src/lib/meta/webhook-verify.test.ts`
- Test: `src/app/api/webhooks/meta/route.test.ts`

**Interfaces:**
- Produces: `verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean` from `webhook-verify.ts`. Later inbound-processing tasks call this before touching the payload.

- [ ] **Step 1: Write the failing test for signature verification**

`src/lib/meta/webhook-verify.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifyMetaSignature } from './webhook-verify'

describe('verifyMetaSignature', () => {
  const secret = 'test-secret'
  const body = JSON.stringify({ hello: 'world' })
  function sign(b: string) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(b).digest('hex')
  }

  it('accepts a correctly signed payload', () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    expect(verifyMetaSignature(body + 'x', sign(body), secret)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(body, null, secret)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/meta/webhook-verify.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement signature verification**

`src/lib/meta/webhook-verify.ts`:
```typescript
import crypto from 'crypto'

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  if (expected.length !== provided.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/meta/webhook-verify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the webhook route's GET verify handshake**

`src/app/api/webhooks/meta/route.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { GET } from './route'

beforeAll(() => {
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'my-verify-token'
})

describe('GET /api/webhooks/meta', () => {
  it('echoes hub.challenge when token matches', async () => {
    const url = 'http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=12345'
    const res = await GET(new Request(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('12345')
  })

  it('rejects a wrong token', async () => {
    const url = 'http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345'
    const res = await GET(new Request(url))
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/api/webhooks/meta/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 7: Implement the GET handler (POST is added in Task 6)**

`src/app/api/webhooks/meta/route.ts`:
```typescript
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/app/api/webhooks/meta/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/meta src/app/api/webhooks
git commit -m "feat: add Meta webhook GET verification handshake + HMAC signature check"
```

---

### Task 6: Inbound message ingestion (POST handler)

**Files:**
- Create: `src/lib/inbound.ts`
- Modify: `src/app/api/webhooks/meta/route.ts`
- Test: `src/lib/inbound.test.ts`
- Test: `src/app/api/webhooks/meta/route.test.ts` (extend)

**Interfaces:**
- Consumes: `prisma` (Task 2), `verifyMetaSignature` (Task 5).
- Produces: `ingestMetaMessage(payload: MetaWebhookPayload): Promise<{ skipped: boolean }>` from `src/lib/inbound.ts`. `MetaWebhookPayload` is the raw Meta webhook JSON shape (see Step 1). Later bot-orchestrator tasks (Fase 3) call `ingestMetaMessage`'s output indirectly via the `Message` row it creates.

- [ ] **Step 1: Write the failing test for idempotent ingestion**

`src/lib/inbound.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { ingestMetaMessage } from './inbound'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockPrisma = mockDeep<PrismaClient>()
})

const samplePayload = {
  entry: [{
    changes: [{
      value: {
        contacts: [{ profile: { name: 'Bruno Figarola' }, wa_id: '6281234567890' }],
        messages: [{
          id: 'wamid.ABC123',
          from: '6281234567890',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Halo, mau tanya paket Ijen' },
        }],
      },
    }],
  }],
}

describe('ingestMetaMessage', () => {
  it('creates Contact, Conversation, and Message when none exist', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', phone: '6281234567890', name: 'Bruno Figarola', avatarUrl: null, source: null, createdAt: new Date() })
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', contactId: 'contact_1', botEnabled: true, assignedAgentId: null, status: 'OPEN', pipelineStage: 'new', bookingData: null, bookingCheckedAt: null, tripBrief: null, lastMessageAt: new Date(), createdAt: new Date() })
    mockPrisma.message.create.mockResolvedValue({} as never)

    const result = await ingestMetaMessage(samplePayload)

    expect(result.skipped).toBe(false)
    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '6281234567890' },
    }))
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalId: 'wamid.ABC123', direction: 'INBOUND', sentBy: 'CUSTOMER' }),
    }))
  })

  it('skips a message already ingested (retry from Meta)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_existing' } as never)

    const result = await ingestMetaMessage(samplePayload)

    expect(result.skipped).toBe(true)
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: FAIL — `inbound.ts` does not exist.

- [ ] **Step 3: Implement ingestion**

`src/lib/inbound.ts`:
```typescript
import { prisma } from '@/lib/db'

export type MetaWebhookPayload = {
  entry: Array<{
    changes: Array<{
      value: {
        contacts?: Array<{ profile: { name: string }; wa_id: string }>
        messages?: Array<{
          id: string
          from: string
          timestamp: string
          type: string
          text?: { body: string }
        }>
      }
    }>
  }>
}

export async function ingestMetaMessage(payload: MetaWebhookPayload): Promise<{ skipped: boolean }> {
  const change = payload.entry?.[0]?.changes?.[0]?.value
  const message = change?.messages?.[0]
  if (!message) return { skipped: true }

  const existing = await prisma.message.findUnique({ where: { externalId: message.id } })
  if (existing) return { skipped: true }

  const profileName = change?.contacts?.[0]?.profile.name
  const contact = await prisma.contact.upsert({
    where: { phone: message.from },
    update: profileName ? { name: profileName } : {},
    create: { phone: message.from, name: profileName ?? null },
  })

  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: { lastMessageAt: new Date(Number(message.timestamp) * 1000) },
    create: { contactId: contact.id, lastMessageAt: new Date(Number(message.timestamp) * 1000) },
  })

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId: message.id,
      direction: 'INBOUND',
      type: message.type,
      content: message.text?.body ?? null,
      channel: 'OFFICIAL',
      sentBy: 'CUSTOMER',
      deliveryStatus: 'DELIVERED',
      createdAt: new Date(Number(message.timestamp) * 1000),
    },
  })

  return { skipped: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the POST handler into the webhook route, with signature verification**

Add to `src/app/api/webhooks/meta/route.ts`:
```typescript
import { verifyMetaSignature } from '@/lib/meta/webhook-verify'
import { ingestMetaMessage } from '@/lib/inbound'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  if (!verifyMetaSignature(rawBody, signature, process.env.META_APP_SECRET!)) {
    return new Response('Invalid signature', { status: 401 })
  }

  const payload = JSON.parse(rawBody)
  await ingestMetaMessage(payload)
  return new Response('OK', { status: 200 })
}
```

- [ ] **Step 6: Extend the route test for the POST handler**

Append to `src/app/api/webhooks/meta/route.test.ts`:
```typescript
import crypto from 'crypto'
import { POST } from './route'
import { ingestMetaMessage } from '@/lib/inbound'

vi.mock('@/lib/inbound', () => ({ ingestMetaMessage: vi.fn().mockResolvedValue({ skipped: false }) }))

describe('POST /api/webhooks/meta', () => {
  beforeAll(() => {
    process.env.META_APP_SECRET = 'app-secret'
  })

  it('accepts a correctly signed payload and ingests it', async () => {
    const body = JSON.stringify({ entry: [] })
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')
    const req = new Request('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(ingestMetaMessage).toHaveBeenCalled()
  })

  it('rejects a payload with a bad signature', async () => {
    const req = new Request('http://localhost/api/webhooks/meta', {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      body: JSON.stringify({ entry: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 7: Run the full webhook route test file**

Run: `npx vitest run src/app/api/webhooks/meta/route.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 8: Commit**

```bash
git add src/lib/inbound.ts src/app/api/webhooks
git commit -m "feat: ingest inbound Meta messages idempotently into Contact/Conversation/Message"
```

---

### Task 7: Meta Graph API client — send text message

**Files:**
- Create: `src/lib/meta/client.ts`
- Create: `src/lib/meta/messages.ts`
- Test: `src/lib/meta/messages.test.ts`

**Interfaces:**
- Produces: `sendMetaText(waNumber: { phoneNumberId: string; accessToken: string }, to: string, text: string): Promise<{ externalId: string }>` from `messages.ts`. Task 8's `sendMessage` calls this for the Official channel.

- [ ] **Step 1: Write the failing test**

`src/lib/meta/messages.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMetaText } from './messages'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('sendMetaText', () => {
  it('posts to the Graph API messages endpoint and returns the message id', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.OUT1' }] }),
    })

    const result = await sendMetaText({ phoneNumberId: '123', accessToken: 'tok' }, '6281234567890', 'Halo!')

    expect(result).toEqual({ externalId: 'wamid.OUT1' })
    expect(fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/123/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    )
  })

  it('throws with the Graph API error message on failure', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token' } }),
    })

    await expect(sendMetaText({ phoneNumberId: '123', accessToken: 'bad' }, '628', 'x')).rejects.toThrow('Invalid token')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/meta/messages.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the Graph API fetch wrapper**

`src/lib/meta/client.ts`:
```typescript
const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export async function metaFetch(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error?.message ?? 'Meta Graph API error')
  return body
}
```

- [ ] **Step 4: Implement `sendMetaText`**

`src/lib/meta/messages.ts`:
```typescript
import { metaFetch } from './client'

export async function sendMetaText(
  waNumber: { phoneNumberId: string; accessToken: string },
  to: string,
  text: string
): Promise<{ externalId: string }> {
  const body = await metaFetch(`/${waNumber.phoneNumberId}/messages`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  })
  return { externalId: body.messages[0].id }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/meta/messages.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/meta
git commit -m "feat: add Meta Graph API client and text-message sender"
```

---

### Task 8: Core `sendMessage` function

**Files:**
- Create: `src/lib/send.ts`
- Test: `src/lib/send.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `sendMetaText` (Task 7).
- Produces: `sendMessage(params: { conversationId: string; text: string; channel?: 'OFFICIAL' | 'UNOFFICIAL'; sentBy: 'AGENT' | 'BOT'; agentId?: string; botTrace?: unknown }): Promise<{ id: string; deliveryStatus: 'SENT' | 'FAILED' }>` from `send.ts`. This is the single choke point every outbound path (compose box API, bot orchestrator, `/api/send` gateway) uses. In this task it only supports `channel: 'OFFICIAL'` (default) — Task 15 (Fase 2) adds Unofficial routing without changing this signature.

- [ ] **Step 1: Write the failing test**

`src/lib/send.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { sendMessage } from './send'
import { sendMetaText } from '@/lib/meta/messages'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/meta/messages', () => ({ sendMetaText: vi.fn() }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockPrisma = mockDeep<PrismaClient>()
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1', contact: { phone: '6281234567890' },
  } as never)
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({
    phoneNumberId: 'pnid', accessToken: 'tok',
  } as never)
})

describe('sendMessage', () => {
  it('sends via Official Graph API by default and records a SENT message', async () => {
    ;(sendMetaText as any).mockResolvedValue({ externalId: 'wamid.OUT1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT', agentId: 'acc_1' })

    expect(result.deliveryStatus).toBe('SENT')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channel: 'OFFICIAL', direction: 'OUTBOUND', sentBy: 'AGENT', externalId: 'wamid.OUT1' }),
    }))
  })

  it('records a FAILED message when the send throws, without throwing itself', async () => {
    ;(sendMetaText as any).mockRejectedValue(new Error('rate limited'))
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_2', deliveryStatus: 'FAILED' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'BOT' })

    expect(result.deliveryStatus).toBe('FAILED')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveryStatus: 'FAILED' }),
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/send.test.ts`
Expected: FAIL — `send.ts` does not exist.

- [ ] **Step 3: Implement `sendMessage`**

`src/lib/send.ts`:
```typescript
import { prisma } from '@/lib/db'
import { sendMetaText } from '@/lib/meta/messages'

export async function sendMessage(params: {
  conversationId: string
  text: string
  channel?: 'OFFICIAL' | 'UNOFFICIAL'
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  botTrace?: unknown
}) {
  const channel = params.channel ?? 'OFFICIAL'
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: params.conversationId },
    include: { contact: true },
  })
  const waNumber = await prisma.waNumber.findFirstOrThrow()

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  try {
    if (channel === 'OFFICIAL') {
      const result = await sendMetaText(waNumber, conversation.contact.phone, params.text)
      externalId = result.externalId
    } else {
      throw new Error('Unofficial channel not implemented until Task 15')
    }
  } catch {
    deliveryStatus = 'FAILED'
  }

  return prisma.message.create({
    data: {
      conversationId: params.conversationId,
      externalId,
      direction: 'OUTBOUND',
      type: 'text',
      content: params.text,
      channel,
      sentBy: params.sentBy,
      agentId: params.agentId,
      botTrace: params.botTrace as never,
      deliveryStatus,
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/send.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/send.ts
git commit -m "feat: add core sendMessage function (Official channel only for now)"
```

---

### Task 9: `/api/send` gateway-compatible endpoint

**Files:**
- Create: `src/app/api/send/route.ts`
- Test: `src/app/api/send/route.test.ts`

**Interfaces:**
- Consumes: `sendMessage` (Task 8), `verifySessionToken` via middleware (already enforced), `prisma` (Task 2).
- Produces: `POST /api/send` accepting `{ conversationId: string, text: string, channel?: 'OFFICIAL' | 'UNOFFICIAL' }`, used both by the compose box UI (Task 11) and — later — by chatbot-web's existing gateway POST contract during the Fase 4 cutover (Task 46), so the request/response shape here must stay `{ to, text }`-compatible going forward. For v1 it accepts `conversationId` directly since the UI always knows it.

- [ ] **Step 1: Write the failing test**

`src/app/api/send/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { sendMessage } from '@/lib/send'

vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/send', () => {
  it('calls sendMessage with the request body and returns the created message', async () => {
    ;(sendMessage as any).mockResolvedValue({ id: 'msg_1', deliveryStatus: 'SENT' })
    const req = new Request('http://localhost/api/send', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'conv_1', text: 'Halo!' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'msg_1', deliveryStatus: 'SENT' })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT' }))
  })

  it('returns 400 when text is missing', async () => {
    const req = new Request('http://localhost/api/send', { method: 'POST', body: JSON.stringify({ conversationId: 'conv_1' }) })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/send/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the route**

`src/app/api/send/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendMessage } from '@/lib/send'
import { verifySessionToken } from '@/lib/auth/session'

const bodySchema = z.object({
  conversationId: z.string(),
  text: z.string().min(1),
  channel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
})

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'conversationId dan text wajib diisi' }, { status: 400 })

  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null

  const message = await sendMessage({
    conversationId: parsed.data.conversationId,
    text: parsed.data.text,
    channel: parsed.data.channel,
    sentBy: 'AGENT',
    agentId: session?.accountId,
  })
  return NextResponse.json(message)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/send/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/send
git commit -m "feat: add /api/send gateway-compatible endpoint"
```

---

### Task 10: Conversations list API + Chat/Inbox page shell

**Files:**
- Create: `src/app/api/conversations/route.ts`
- Create: `src/app/inbox/page.tsx`
- Create: `src/components/inbox/ConversationList.tsx`
- Create: `src/components/inbox/ConversationListItem.tsx`
- Test: `src/app/api/conversations/route.test.ts`
- Test: `src/components/inbox/ConversationListItem.test.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces: `GET /api/conversations` → `Array<{ id: string; contactName: string | null; contactPhone: string; lastMessage: string | null; lastMessageAt: string; unreadCount: number; botEnabled: boolean; status: string; labels: Array<{ id: string; name: string; color: string }> }>`. `ConversationListItem` component prop type `ConversationSummary` matches this exactly — later tasks (assign agent badge, Task 42) extend this type additively only.

- [ ] **Step 1: Write the failing test for the list route**

`src/app/api/conversations/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/conversations', () => {
  it('returns conversations ordered by lastMessageAt desc, with contact + last message + labels', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([{
      id: 'conv_1',
      botEnabled: true,
      status: 'OPEN',
      lastMessageAt: new Date('2026-07-25T10:00:00Z'),
      contact: { name: 'Bruno Figarola', phone: '6281234567890' },
      messages: [{ content: 'Halo!', createdAt: new Date() }],
      labels: [{ label: { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' } }],
    }] as never)

    const res = await GET(new Request('http://localhost/api/conversations'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0]).toEqual(expect.objectContaining({
      id: 'conv_1',
      contactName: 'Bruno Figarola',
      contactPhone: '6281234567890',
      lastMessage: 'Halo!',
      botEnabled: true,
      labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/conversations/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the route**

`src/app/api/conversations/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      labels: { include: { label: true } },
    },
  })

  return NextResponse.json(conversations.map((c) => ({
    id: c.id,
    contactName: c.contact.name,
    contactPhone: c.contact.phone,
    lastMessage: c.messages[0]?.content ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    unreadCount: 0,
    botEnabled: c.botEnabled,
    status: c.status,
    labels: c.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
  })))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/conversations/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing component test**

`src/components/inbox/ConversationListItem.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConversationListItem } from './ConversationListItem'

const summary = {
  id: 'conv_1', contactName: 'Bruno Figarola', contactPhone: '6281234567890',
  lastMessage: 'Halo!', lastMessageAt: new Date().toISOString(), unreadCount: 2,
  botEnabled: true, status: 'OPEN', labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
}

describe('ConversationListItem', () => {
  it('shows contact name, last message, and Bot badge', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.getByText('Halo!')).toBeInTheDocument()
    expect(screen.getByText('Bot')).toBeInTheDocument()
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/components/inbox/ConversationListItem.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 7: Implement `ConversationListItem` and `ConversationList`**

`src/components/inbox/ConversationListItem.tsx`:
```tsx
export type ConversationSummary = {
  id: string
  contactName: string | null
  contactPhone: string
  lastMessage: string | null
  lastMessageAt: string
  unreadCount: number
  botEnabled: boolean
  status: string
  labels: Array<{ id: string; name: string; color: string }>
}

export function ConversationListItem({ conversation, onClick, active }: { conversation: ConversationSummary; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full flex-col gap-1 border-b border-border p-3 text-left ${active ? 'bg-accent' : 'hover:bg-muted/50'}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{conversation.contactName ?? conversation.contactPhone}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${conversation.botEnabled ? 'bg-brand/10 text-brand' : 'bg-amber-50 text-amber-700'}`}>
          {conversation.botEnabled ? 'Bot' : 'Agen'}
        </span>
      </div>
      <span className="truncate text-sm text-muted-foreground">{conversation.lastMessage}</span>
      <div className="flex gap-1">
        {conversation.labels.map((l) => (
          <span key={l.id} className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: l.color + '22', color: l.color }}>{l.name}</span>
        ))}
      </div>
    </button>
  )
}
```

`src/components/inbox/ConversationList.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { ConversationListItem, type ConversationSummary } from './ConversationListItem'

export function ConversationList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])

  useEffect(() => {
    fetch('/api/conversations').then((r) => r.json()).then(setConversations)
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto border-r">
      {conversations.map((c) => (
        <ConversationListItem key={c.id} conversation={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/components/inbox/ConversationListItem.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 9: Inbox page shell**

`src/app/inbox/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { ConversationList } from '@/components/inbox/ConversationList'

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="grid h-screen grid-cols-[20rem_1fr]">
      <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      <div className="flex items-center justify-center text-muted-foreground">
        {selectedId ? `Thread ${selectedId} (Task 11)` : 'Pilih percakapan'}
      </div>
    </div>
  )
}
```

- [ ] **Step 10: Commit**

```bash
git add src/app/api/conversations src/app/inbox src/components/inbox
git commit -m "feat: add conversations list API and Chat/Inbox page shell"
```

---

### Task 11: Thread view + compose box (text, Official)

**Files:**
- Create: `src/app/api/conversations/[id]/messages/route.ts`
- Create: `src/components/inbox/ThreadView.tsx`
- Create: `src/components/inbox/MessageBubble.tsx`
- Create: `src/components/inbox/ComposeBox.tsx`
- Modify: `src/app/inbox/page.tsx`
- Test: `src/app/api/conversations/[id]/messages/route.test.ts`
- Test: `src/components/inbox/MessageBubble.test.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 2), `/api/send` (Task 9).
- Produces: `GET /api/conversations/:id/messages` → `Array<{ id: string; direction: 'INBOUND'|'OUTBOUND'; content: string | null; channel: string; sentBy: string; deliveryStatus: string; createdAt: string; botTrace: unknown }>`. `MessageBubble` prop type `MessageView` matches this exactly.

- [ ] **Step 1: Write the failing test for the messages route**

`src/app/api/conversations/[id]/messages/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/conversations/[id]/messages', () => {
  it('returns messages for the conversation ordered oldest first', async () => {
    mockPrisma.message.findMany.mockResolvedValue([
      { id: 'm1', direction: 'INBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'CUSTOMER', deliveryStatus: 'DELIVERED', createdAt: new Date(), botTrace: null },
    ] as never)

    const res = await GET(new Request('http://localhost/api/conversations/conv_1/messages'), { params: Promise.resolve({ id: 'conv_1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body[0].content).toBe('Halo')
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv_1' },
      orderBy: { createdAt: 'asc' },
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/conversations/[id]/messages/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the route**

`src/app/api/conversations/[id]/messages/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' } })
  return NextResponse.json(messages.map((m) => ({
    id: m.id, direction: m.direction, content: m.content, channel: m.channel,
    sentBy: m.sentBy, deliveryStatus: m.deliveryStatus, createdAt: m.createdAt.toISOString(), botTrace: m.botTrace,
  })))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/conversations/[id]/messages/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing component test for `MessageBubble`**

`src/components/inbox/MessageBubble.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  it('shows bot-sent messages with a Bot badge', () => {
    render(<MessageBubble message={{ id: 'm1', direction: 'OUTBOUND', content: 'Info paket Ijen...', channel: 'OFFICIAL', sentBy: 'BOT', deliveryStatus: 'SENT', createdAt: new Date().toISOString(), botTrace: { mode: 'faq' } }} />)
    expect(screen.getByText('Info paket Ijen...')).toBeInTheDocument()
    expect(screen.getByText('Bot')).toBeInTheDocument()
  })

  it('shows a retry button for failed messages', () => {
    render(<MessageBubble message={{ id: 'm2', direction: 'OUTBOUND', content: 'Halo', channel: 'OFFICIAL', sentBy: 'AGENT', deliveryStatus: 'FAILED', createdAt: new Date().toISOString(), botTrace: null }} />)
    expect(screen.getByRole('button', { name: /kirim ulang/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/components/inbox/MessageBubble.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 7: Implement `MessageBubble`, `ThreadView`, `ComposeBox`**

`src/components/inbox/MessageBubble.tsx`:
```tsx
export type MessageView = {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  content: string | null
  channel: string
  sentBy: string
  deliveryStatus: string
  createdAt: string
  botTrace: unknown
}

export function MessageBubble({ message }: { message: MessageView }) {
  const isOutbound = message.direction === 'OUTBOUND'
  return (
    <div className={`flex flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
      <div className={
        isOutbound
          ? 'max-w-md rounded-lg rounded-tr-none bg-accent px-3.5 py-2.5 ring-1 ring-brand/10'
          : 'max-w-md rounded-lg rounded-tl-none bg-white px-3.5 py-2.5 shadow-sm ring-1 ring-border'
      }>
        {message.content}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {message.sentBy === 'BOT' && <span className="badge bg-brand/10 text-brand">Bot</span>}
        {message.sentBy === 'AGENT' && <span>Agen</span>}
        <span>{message.deliveryStatus}</span>
        {message.deliveryStatus === 'FAILED' && <button aria-label="Kirim ulang" className="text-brand hover:underline">Kirim Ulang</button>}
      </div>
    </div>
  )
}
```

Note: the `.badge` utility class (pill shape, `h-5 px-2 rounded-[2rem] text-xs font-medium`) is defined once in `globals.css` by Task 2 (Design System Foundation) — every component below reuses it instead of repeating the pill styles inline.

`src/components/inbox/ThreadView.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { MessageBubble, type MessageView } from './MessageBubble'
import { ComposeBox } from './ComposeBox'

export function ThreadView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<MessageView[]>([])

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}/messages`).then((r) => r.json()).then(setMessages)
  }, [conversationId])

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
      </div>
      <ComposeBox conversationId={conversationId} onSent={(m) => setMessages((prev) => [...prev, m])} />
    </div>
  )
}
```

`src/components/inbox/ComposeBox.tsx`:
```tsx
'use client'
import { useState } from 'react'
import type { MessageView } from './MessageBubble'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function ComposeBox({ conversationId, onSent }: { conversationId: string; onSent: (m: MessageView) => void }) {
  const [text, setText] = useState('')
  const [channel, setChannel] = useState<'OFFICIAL' | 'UNOFFICIAL'>('OFFICIAL')

  async function send() {
    if (!text.trim()) return
    const res = await fetch('/api/send', { method: 'POST', body: JSON.stringify({ conversationId, text, channel }) })
    const message = await res.json()
    onSent({ id: message.id, direction: 'OUTBOUND', content: text, channel, sentBy: 'AGENT', deliveryStatus: message.deliveryStatus, createdAt: new Date().toISOString(), botTrace: null })
    setText('')
  }

  return (
    <div className="flex gap-2 border-t border-border bg-white p-3">
      <Select value={channel} onChange={(e) => setChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')} className="w-auto">
        <option value="OFFICIAL">Official</option>
        <option value="UNOFFICIAL">Unofficial</option>
      </Select>
      <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Reply on WhatsApp..." />
      <Button onClick={send}>Kirim</Button>
    </div>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/components/inbox/MessageBubble.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Wire `ThreadView` into the inbox page**

Modify `src/app/inbox/page.tsx` — replace the placeholder `div` with `{selectedId && <ThreadView conversationId={selectedId} />}`, importing `ThreadView` from `@/components/inbox/ThreadView`.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/conversations src/components/inbox src/app/inbox/page.tsx
git commit -m "feat: add thread view and compose box wired to /api/send"
```

---

### Task 12: Real-time updates via SSE

**Files:**
- Create: `src/lib/realtime.ts`
- Create: `src/app/api/sse/route.ts`
- Modify: `src/lib/send.ts`
- Modify: `src/lib/inbound.ts`
- Modify: `src/components/inbox/ThreadView.tsx`
- Test: `src/lib/realtime.test.ts`

**Interfaces:**
- Produces: `broadcast(event: { type: 'message.created'; conversationId: string; message: unknown }): void` and `subscribe(listener: (event: unknown) => void): () => void` from `realtime.ts`. `sendMessage` and `ingestMetaMessage` call `broadcast` after creating a `Message` row.

- [ ] **Step 1: Write the failing test**

`src/lib/realtime.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { broadcast, subscribe } from './realtime'

describe('realtime pub/sub', () => {
  it('delivers a broadcast event to a subscribed listener', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'message.created', conversationId: 'conv_1', message: { id: 'm1' } })
    expect(listener).toHaveBeenCalledWith({ type: 'message.created', conversationId: 'conv_1', message: { id: 'm1' } })
    unsubscribe()
  })

  it('stops delivering events after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    unsubscribe()
    broadcast({ type: 'message.created', conversationId: 'conv_1', message: { id: 'm2' } })
    expect(listener).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the in-process pub/sub**

`src/lib/realtime.ts`:
```typescript
type RealtimeEvent = { type: 'message.created'; conversationId: string; message: unknown }

const listeners = new Set<(event: RealtimeEvent) => void>()

export function broadcast(event: RealtimeEvent): void {
  for (const listener of listeners) listener(event)
}

export function subscribe(listener: (event: RealtimeEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Call `broadcast` from `sendMessage` and `ingestMetaMessage`**

In `src/lib/send.ts`, after `prisma.message.create(...)`, capture the result and add before `return`:
```typescript
  const created = await prisma.message.create({ /* ...same as before... */ })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: created })
  return created
```
(Add `import { broadcast } from '@/lib/realtime'` at the top.)

In `src/lib/inbound.ts`, after the existing `prisma.message.create(...)` call, capture its result into a `created` variable and add:
```typescript
  broadcast({ type: 'message.created', conversationId: conversation.id, message: created })
```
(Add `import { broadcast } from '@/lib/realtime'` at the top.)

- [ ] **Step 6: SSE route**

`src/app/api/sse/route.ts`:
```typescript
import { subscribe } from '@/lib/realtime'

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = subscribe((event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      })
      const keepAlive = setInterval(() => controller.enqueue(': ping\n\n'), 25000)
      // @ts-expect-error - attach for cancel()
      controller._cleanup = () => { unsubscribe(); clearInterval(keepAlive) }
    },
    cancel() {
      // @ts-expect-error - see start()
      this._cleanup?.()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
```

- [ ] **Step 7: Consume SSE in `ThreadView`**

Add to `src/components/inbox/ThreadView.tsx`, inside the component, a second `useEffect`:
```tsx
  useEffect(() => {
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'message.created' && event.conversationId === conversationId) {
        setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message]))
      }
    }
    return () => es.close()
  }, [conversationId])
```

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open the inbox in two browser tabs on the conversation for the whitelisted test number `6282143403501` (never a real customer conversation), send a message from one tab's compose box, confirm it appears in the other tab without a refresh.

- [ ] **Step 9: Commit**

```bash
git add src/lib/realtime.ts src/app/api/sse src/lib/send.ts src/lib/inbound.ts src/components/inbox/ThreadView.tsx
git commit -m "feat: add SSE real-time push for new messages"
```

---

**Fase 1 complete.** At this point wa-inbox can: log in, receive real Meta webhook messages, display them in a working inbox, and send Official-channel replies in real time. This is independently deployable and demoable before starting Fase 2.

---

## Fase 2 — Sambungkan Unofficial (wa-coexist)

### Task 13: Seed the `WaNumber` row from environment variables

**Files:**
- Modify: `prisma/seed.ts`

**Interfaces:**
- Produces: one `WaNumber` row after seeding, matching the fields Task 8's `sendMessage` already reads via `prisma.waNumber.findFirstOrThrow()`.

- [ ] **Step 1: Extend the seed script**

Add to `prisma/seed.ts`, inside `main()`, before the `Settings` upsert:
```typescript
  await prisma.waNumber.upsert({
    where: { phoneNumber: '6282244788833' },
    update: {},
    create: {
      phoneNumber: '6282244788833',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID ?? '',
      wabaId: process.env.META_WABA_ID ?? '',
      accessToken: process.env.META_ACCESS_TOKEN ?? '',
      coexistBaseUrl: process.env.COEXIST_BASE_URL ?? '',
      coexistApiKey: process.env.COEXIST_API_KEY ?? '',
      coexistNumberKey: process.env.COEXIST_NUMBER_KEY ?? '',
    },
  })
```

- [ ] **Step 2: Re-run seed and verify**

Run: `npx prisma db seed`
Expected: no errors; `SELECT * FROM "WaNumber"` shows one row for `6282244788833`.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: seed WaNumber row from environment variables"
```

---

### Task 14: wa-coexist client — send text and media

**Files:**
- Create: `src/lib/coexist/client.ts`
- Test: `src/lib/coexist/client.test.ts`

**Interfaces:**
- Produces: `sendCoexistText(waNumber: { coexistBaseUrl: string; coexistApiKey: string; coexistNumberKey: string }, to: string, text: string): Promise<{ externalId?: string }>` and `sendCoexistMedia(waNumber: same, to: string, mediaUrl: string, type: 'image' | 'video' | 'document', caption?: string): Promise<{ externalId?: string }>`, matching wa-coexist's WatZap-compatible `/api/v1/send_message` and `/api/v1/send_file_url` / `/api/v1/send_image_url` contract.

- [ ] **Step 1: Write the failing test**

`src/lib/coexist/client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendCoexistText, sendCoexistMedia } from './client'

const waNumber = { coexistBaseUrl: 'http://localhost:4000', coexistApiKey: 'key123', coexistNumberKey: 'num456' }

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

describe('sendCoexistText', () => {
  it('posts to /api/v1/send_message with api_key/number_key in the body', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { id: 'coex_1' } }) })

    const result = await sendCoexistText(waNumber, '6281234567890', 'Halo!')

    expect(result).toEqual({ externalId: 'coex_1' })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/send_message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ api_key: 'key123', number_key: 'num456', phone_no: '6281234567890', message: 'Halo!' }),
      })
    )
  })
})

describe('sendCoexistMedia', () => {
  it('posts to /api/v1/send_image_url for type image', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { id: 'coex_2' } }) })

    const result = await sendCoexistMedia(waNumber, '6281234567890', 'https://x/img.jpg', 'image', 'Caption')

    expect(result).toEqual({ externalId: 'coex_2' })
    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/v1/send_image_url', expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/coexist/client.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the client**

`src/lib/coexist/client.ts`:
```typescript
type CoexistCreds = { coexistBaseUrl: string; coexistApiKey: string; coexistNumberKey: string }

async function coexistPost(creds: CoexistCreds, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${creds.coexistBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: creds.coexistApiKey, number_key: creds.coexistNumberKey, ...body }),
  })
  const json = await res.json()
  if (!res.ok || json.status !== 'success') throw new Error(json.message ?? 'wa-coexist send failed')
  return json
}

export async function sendCoexistText(creds: CoexistCreds, to: string, text: string): Promise<{ externalId?: string }> {
  const json = await coexistPost(creds, '/api/v1/send_message', { phone_no: to, message: text })
  return { externalId: json.data?.id }
}

export async function sendCoexistMedia(
  creds: CoexistCreds,
  to: string,
  mediaUrl: string,
  type: 'image' | 'video' | 'document',
  caption?: string
): Promise<{ externalId?: string }> {
  const path = type === 'image' ? '/api/v1/send_image_url' : '/api/v1/send_file_url'
  const json = await coexistPost(creds, path, { phone_no: to, url: mediaUrl, caption })
  return { externalId: json.data?.id }
}
```

Note: the exact JSON field names (`phone_no`, `message`, `url`, `caption`) and success-envelope shape must be double-checked against wa-coexist's live `src/routes/v1.js` before this task is marked done — the fields above are inferred from the WatZap-compatible contract description in `docs/design/wa-inbox-concept.html`; read `/Users/macbook/Code/wa-coexist/src/routes/v1.js` directly and adjust the request/response shape in both this file and the test if it differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/coexist/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/coexist/client.ts
git commit -m "feat: add wa-coexist client for text/media sending"
```

---

### Task 15: wa-coexist client — status check and relink

**Files:**
- Modify: `src/lib/coexist/client.ts`
- Modify: `src/lib/coexist/client.test.ts`

**Interfaces:**
- Produces: `getCoexistStatus(creds: CoexistCreds): Promise<{ connected: boolean }>` (reads wa-coexist's `GET /api/status`) and `relinkCoexist(creds: CoexistCreds): Promise<void>` (calls `POST /api/relink`). Task 17's Settings page calls both.

- [ ] **Step 1: Extend the failing test**

Append to `src/lib/coexist/client.test.ts`:
```typescript
import { getCoexistStatus, relinkCoexist } from './client'

describe('getCoexistStatus', () => {
  it('returns connected: true when wa-coexist reports connected', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ connected: true }) })
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: true })
    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/status')
  })

  it('returns connected: false when the request fails outright', async () => {
    ;(fetch as any).mockRejectedValue(new Error('network error'))
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: false })
  })
})

describe('relinkCoexist', () => {
  it('posts to /api/relink', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })
    await relinkCoexist(waNumber)
    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/relink', expect.objectContaining({ method: 'POST' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/coexist/client.test.ts`
Expected: FAIL — `getCoexistStatus`/`relinkCoexist` not exported.

- [ ] **Step 3: Implement both functions**

Add to `src/lib/coexist/client.ts`:
```typescript
export async function getCoexistStatus(creds: CoexistCreds): Promise<{ connected: boolean }> {
  try {
    const res = await fetch(`${creds.coexistBaseUrl}/api/status`)
    const json = await res.json()
    return { connected: Boolean(json.connected) }
  } catch {
    return { connected: false }
  }
}

export async function relinkCoexist(creds: CoexistCreds): Promise<void> {
  await fetch(`${creds.coexistBaseUrl}/api/relink`, { method: 'POST' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/coexist/client.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/coexist/client.ts src/lib/coexist/client.test.ts
git commit -m "feat: add wa-coexist status check and relink"
```

---

### Task 16: Wire Unofficial sending into `sendMessage` via a channel router

**Files:**
- Create: `src/lib/channel-router.ts`
- Modify: `src/lib/send.ts`
- Test: `src/lib/channel-router.test.ts`
- Modify: `src/lib/send.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `sendCoexistText` (Task 14).
- Produces: `resolveChannel(explicit?: 'OFFICIAL' | 'UNOFFICIAL'): Promise<'OFFICIAL' | 'UNOFFICIAL'>` from `channel-router.ts` — returns `explicit` unchanged if provided, otherwise reads `Settings.defaultChannel`.

- [ ] **Step 1: Write the failing test for `resolveChannel`**

`src/lib/channel-router.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { resolveChannel } from './channel-router'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('resolveChannel', () => {
  it('returns the explicit channel unchanged when provided', async () => {
    expect(await resolveChannel('UNOFFICIAL')).toBe('UNOFFICIAL')
    expect(mockPrisma.settings.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('falls back to Settings.defaultChannel when no explicit channel is given', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ defaultChannel: 'UNOFFICIAL' } as never)
    expect(await resolveChannel()).toBe('UNOFFICIAL')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/channel-router.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `resolveChannel`**

`src/lib/channel-router.ts`:
```typescript
import { prisma } from '@/lib/db'

export async function resolveChannel(explicit?: 'OFFICIAL' | 'UNOFFICIAL'): Promise<'OFFICIAL' | 'UNOFFICIAL'> {
  if (explicit) return explicit
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return settings.defaultChannel
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/channel-router.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Update `sendMessage` to use `resolveChannel` and actually call `sendCoexistText`**

In `src/lib/send.ts`, replace the `channel` resolution line and the `else` branch:
```typescript
import { resolveChannel } from '@/lib/channel-router'
import { sendCoexistText } from '@/lib/coexist/client'
// ...
  const channel = await resolveChannel(params.channel)
  // ...
    if (channel === 'OFFICIAL') {
      const result = await sendMetaText(waNumber, conversation.contact.phone, params.text)
      externalId = result.externalId
    } else {
      const result = await sendCoexistText(waNumber, conversation.contact.phone, params.text)
      externalId = result.externalId
    }
```

- [ ] **Step 6: Update `send.test.ts`'s mocks for the new dependency**

Add `vi.mock('@/lib/channel-router', () => ({ resolveChannel: vi.fn().mockResolvedValue('OFFICIAL') }))` and `vi.mock('@/lib/coexist/client', () => ({ sendCoexistText: vi.fn() }))` to the top of `src/lib/send.test.ts`, and add a third test:
```typescript
  it('sends via wa-coexist when resolveChannel returns UNOFFICIAL', async () => {
    const { resolveChannel } = await import('@/lib/channel-router')
    const { sendCoexistText } = await import('@/lib/coexist/client')
    ;(resolveChannel as any).mockResolvedValue('UNOFFICIAL')
    ;(sendCoexistText as any).mockResolvedValue({ externalId: 'coex_1' })
    mockPrisma.message.create.mockResolvedValue({ id: 'msg_3', deliveryStatus: 'SENT' } as never)

    const result = await sendMessage({ conversationId: 'conv_1', text: 'Halo!', sentBy: 'AGENT' })

    expect(result.deliveryStatus).toBe('SENT')
    expect(mockPrisma.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ channel: 'UNOFFICIAL' }) }))
  })
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/lib/send.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/channel-router.ts src/lib/send.ts src/lib/send.test.ts
git commit -m "feat: route Unofficial sends through wa-coexist via channel resolver"
```

---

### Task 17: Pengaturan page — default channel, working hours, status nomor, user management, webhook info, notifications

**Files:**
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/api/numbers/status/route.ts`
- Create: `src/app/api/numbers/relink/route.ts`
- Create: `src/app/settings/page.tsx`
- Test: `src/app/api/settings/route.test.ts`
- Test: `src/app/api/numbers/status/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `getCoexistStatus`/`relinkCoexist` (Task 15), `verifySessionToken` (Task 3, via middleware for role checks).
- Produces: `GET/PATCH /api/settings`, `GET /api/numbers/status` → `{ officialTokenValid: boolean; unofficialConnected: boolean }`, `POST /api/numbers/relink`.

- [ ] **Step 1: Write the failing test for the settings route**

`src/app/api/settings/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET, PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/settings', () => {
  it('returns the singleton settings row', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ id: 1, defaultChannel: 'OFFICIAL', workingHoursStart: null, workingHoursEnd: null, offHoursAutoReply: null, botKillSwitch: false, catalogSyncedAt: null } as never)
    const res = await GET()
    expect((await res.json()).defaultChannel).toBe('OFFICIAL')
  })
})

describe('PATCH /api/settings', () => {
  it('updates defaultChannel', async () => {
    mockPrisma.settings.update.mockResolvedValue({ id: 1, defaultChannel: 'UNOFFICIAL' } as never)
    const req = new Request('http://localhost/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultChannel: 'UNOFFICIAL' }) })
    const res = await PATCH(req)
    expect((await res.json()).defaultChannel).toBe('UNOFFICIAL')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/settings/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the settings route**

`src/app/api/settings/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET() {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return NextResponse.json(settings)
}

const patchSchema = z.object({
  defaultChannel: z.enum(['OFFICIAL', 'UNOFFICIAL']).optional(),
  workingHoursStart: z.string().optional(),
  workingHoursEnd: z.string().optional(),
  offHoursAutoReply: z.string().optional(),
})

export async function PATCH(req: Request) {
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Data pengaturan tidak valid' }, { status: 400 })
  const settings = await prisma.settings.update({ where: { id: 1 }, data: parsed.data })
  return NextResponse.json(settings)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/settings/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for numbers/status**

`src/app/api/numbers/status/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'
import { getCoexistStatus } from '@/lib/coexist/client'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/coexist/client', () => ({ getCoexistStatus: vi.fn() }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/numbers/status', () => {
  it('reports official token presence and unofficial connection status', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ accessToken: 'tok', coexistBaseUrl: 'http://x', coexistApiKey: 'k', coexistNumberKey: 'n' } as never)
    ;(getCoexistStatus as any).mockResolvedValue({ connected: true })

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ officialTokenValid: true, unofficialConnected: true })
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/api/numbers/status/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 7: Implement `numbers/status` and `numbers/relink`**

`src/app/api/numbers/status/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCoexistStatus } from '@/lib/coexist/client'

export async function GET() {
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  const coexist = await getCoexistStatus(waNumber)
  return NextResponse.json({ officialTokenValid: Boolean(waNumber.accessToken), unofficialConnected: coexist.connected })
}
```

`src/app/api/numbers/relink/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { relinkCoexist } from '@/lib/coexist/client'

export async function POST() {
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  await relinkCoexist(waNumber)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/app/api/numbers/status/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 9: Settings page UI**

`src/app/settings/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Settings = { defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'; workingHoursStart: string | null; workingHoursEnd: string | null }
type NumberStatus = { officialTokenValid: boolean; unofficialConnected: boolean }

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setSettings)
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
  }, [])

  async function updateDefaultChannel(defaultChannel: 'OFFICIAL' | 'UNOFFICIAL') {
    const res = await fetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultChannel }) })
    setSettings(await res.json())
  }

  async function relink() {
    await fetch('/api/numbers/relink', { method: 'POST' })
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
  }

  if (!settings || !status) return <div className="p-6 text-muted-foreground">Memuat...</div>

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-xl font-semibold text-navy">Pengaturan</h1>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium text-navy">Default jalur kirim</h2>
        <Select value={settings.defaultChannel} onChange={(e) => updateDefaultChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')} className="w-auto">
          <option value="OFFICIAL">Official</option>
          <option value="UNOFFICIAL">Unofficial</option>
        </Select>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium text-navy">Status nomor</h2>
        <div className="flex items-center gap-3">
          <Badge variant={status.officialTokenValid ? 'success' : 'destructive'}>
            Official: {status.officialTokenValid ? 'Valid' : 'Tidak valid'}
          </Badge>
          <Badge variant={status.unofficialConnected ? 'success' : 'destructive'}>
            Unofficial: {status.unofficialConnected ? 'Tersambung' : 'Terputus'}
          </Badge>
          {!status.unofficialConnected && (
            <Button onClick={relink} variant="outline" size="sm">Sambungkan Ulang</Button>
          )}
        </div>
      </Card>
    </main>
  )
}
```

- [ ] **Step 10: Commit**

```bash
git add src/app/api/settings src/app/api/numbers src/app/settings
git commit -m "feat: add Pengaturan page with default channel and merged number status"
```

---

### Task 18: [External repo] wa-coexist — add profile-picture endpoint

**Repo:** `/Users/macbook/Code/wa-coexist` (not wa-inbox — this task edits a sibling repository).

**Files:**
- Modify: `/Users/macbook/Code/wa-coexist/src/client-webjs.js`
- Modify: `/Users/macbook/Code/wa-coexist/src/routes/v1.js` (or wherever local/UI routes are registered — read `src/server.js` first to confirm the mount point)

**Interfaces:**
- Produces: `GET /api/contact/:jid/avatar` → `{ url: string | null }`, called by wa-inbox's Task 19.

- [ ] **Step 1: Read the current client and route structure**

Read `/Users/macbook/Code/wa-coexist/src/client-webjs.js` (confirm `this.client` is the live `whatsapp-web.js` `Client` instance) and `/Users/macbook/Code/wa-coexist/src/server.js` (confirm how local/UI routes like `/api/status` are registered, so the new route follows the same pattern).

- [ ] **Step 2: Add a `getProfilePicUrl` method to `WaCoexistWebClient`**

In `src/client-webjs.js`, add a method on the class:
```javascript
async getProfilePicUrl(jid) {
  try {
    return await this.client.getProfilePicUrl(jid)
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Register the route**

Following the exact pattern used by the existing `/api/status` route in `src/server.js` (same middleware, same response conventions), add:
```javascript
app.get('/api/contact/:jid/avatar', async (req, res) => {
  const url = await waClient.getProfilePicUrl(req.params.jid)
  res.json({ url })
})
```
Adjust `waClient` to whatever variable name the file already uses for the active client instance.

- [ ] **Step 4: Manual verification**

This is a read-only lookup (no message is sent), but still only query against the whitelisted test number to avoid looking up real customers' data during implementation. Run wa-coexist locally (`npm run dev` or equivalent per its `package.json`), then:
```bash
curl http://localhost:4000/api/contact/6282143403501@s.whatsapp.net/avatar
```
Expected: `{"url": "https://..."}` if that test number has a visible photo, `{"url": null}` otherwise.

- [ ] **Step 5: Commit (in the wa-coexist repo)**

```bash
cd /Users/macbook/Code/wa-coexist
git add src/client-webjs.js src/server.js
git commit -m "feat: add GET /api/contact/:jid/avatar profile picture endpoint"
```

---

### Task 19: Contact avatar enrichment

**Files:**
- Modify: `src/lib/inbound.ts`
- Modify: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: `GET /api/contact/:jid/avatar` from wa-coexist (Task 18), `prisma.waNumber` (Task 2).

- [ ] **Step 1: Extend the failing test**

Add to `src/lib/inbound.test.ts`, a new case in the existing `describe('ingestMetaMessage', ...)` block:
```typescript
  it('fetches and stores an avatar URL for a newly created contact', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', phone: '6281234567890', name: 'Bruno Figarola', avatarUrl: null, source: null, createdAt: new Date() })
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1' } as never)
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ coexistBaseUrl: 'http://localhost:4000' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://pic.example/x.jpg' }) }))

    await ingestMetaMessage(samplePayload)

    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/contact/6281234567890@s.whatsapp.net/avatar')
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({ where: { id: 'contact_1' }, data: { avatarUrl: 'https://pic.example/x.jpg' } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: FAIL — no avatar fetch happens yet.

- [ ] **Step 3: Implement enrichment, only for newly-created contacts without an avatar**

Modify `src/lib/inbound.ts` — after the `contact` upsert, add:
```typescript
  if (!contact.avatarUrl) {
    const waNumber = await prisma.waNumber.findFirstOrThrow()
    try {
      const res = await fetch(`${waNumber.coexistBaseUrl}/api/contact/${message.from}@s.whatsapp.net/avatar`)
      const { url } = await res.json()
      if (url) await prisma.contact.update({ where: { id: contact.id }, data: { avatarUrl: url } })
    } catch {
      // wa-coexist unreachable — leave avatarUrl null, not fatal to message ingestion
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: PASS (4 tests total; re-run the earlier two tests too since they now also touch `waNumber` — add `mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)` and a `fetch` stub returning `{ url: null }` to the first test's setup so it doesn't throw).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "feat: enrich new contacts with profile picture from wa-coexist"
```

---

**Fase 2 complete.** wa-inbox now sends and receives on both channels, shows live connection status, and enriches contacts with avatars.

---

## Fase 3 — Otak Bot

Every porting task below (Tasks 22–24) starts with reading the real Python source in `/Users/macbook/Code/jvto-whatsapp-agent-runtime/src/jvto_agent_runtime/` — the behavior contracts given here are grounded in verified exploration of that repo's docs and decision log, not the full line-by-line source, so **the implementer must read the cited file before writing the port** and adjust field names/edge cases to match what's actually there, per this plan's Global Constraints.

### Task 20: Bot types + catalog loader

**Files:**
- Create: `src/lib/bot/types.ts`
- Create: `src/lib/bot/catalog.ts`
- Create: `catalog/.gitkeep`
- Test: `src/lib/bot/catalog.test.ts`

**Interfaces:**
- Produces: shared types `TripBrief`, `RouteGateResult`, `SalesClassification`, `BotDecision`, `Catalog` from `types.ts` — every subsequent Fase 3 task imports these, never redefines them locally. Produces `loadCatalog(): Catalog` from `catalog.ts`, reading JSON files from `catalog/` at the project root (populated by Task 21's sync script).

- [ ] **Step 1: Define shared bot types**

`src/lib/bot/types.ts`:
```typescript
export type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
  notes?: string
}

export type RouteGateResult =
  | { status: 'clear' }
  | { status: 'needs_review'; reason: string }
  | { status: 'handoff'; reason: string }

export type SalesClassification = {
  job: 'J1' | 'J2' | 'J3' | 'J4' | 'J5'
  missingInfo: string[]
  needsLiveData: boolean
}

export type BotDecision =
  | { mode: 'handoff'; reason: string }
  | { mode: 'funnel'; reply: string; nextState: string }
  | { mode: 'faq'; draft: string; sourceTopic: string }
  | { mode: 'booking_context'; reply: string }

export type CatalogPackage = {
  packageKey: string
  destination: string
  title: string
  priceIdr: number | null
  inclusions: string[]
  policyNotes: string[]
  links: Record<string, string>
}

export type Catalog = {
  packages: CatalogPackage[]
  syncedAt: string | null
}
```

- [ ] **Step 2: Write the failing test for the loader**

`src/lib/bot/catalog.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { loadCatalog } from './catalog'

vi.mock('fs')

describe('loadCatalog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads and merges package JSON files from catalog/', () => {
    ;(fs.existsSync as any).mockReturnValue(true)
    ;(fs.readdirSync as any).mockReturnValue(['ijen.json'])
    ;(fs.readFileSync as any).mockImplementation((p: string) =>
      p.endsWith('ijen.json')
        ? JSON.stringify([{ packageKey: 'ijen-1d', destination: 'Ijen', title: 'Ijen Blue Fire 1D', priceIdr: 850000, inclusions: ['guide', 'transport'], policyNotes: [], links: {} }])
        : '{}'
    )

    const catalog = loadCatalog()

    expect(catalog.packages).toHaveLength(1)
    expect(catalog.packages[0].packageKey).toBe('ijen-1d')
  })

  it('returns an empty catalog when catalog/ has not been synced yet', () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    const catalog = loadCatalog()
    expect(catalog.packages).toEqual([])
    expect(catalog.syncedAt).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/catalog.test.ts`
Expected: FAIL — `catalog.ts` does not exist.

- [ ] **Step 4: Implement the loader**

`src/lib/bot/catalog.ts`:
```typescript
import fs from 'fs'
import path from 'path'
import type { Catalog, CatalogPackage } from './types'

const CATALOG_DIR = path.join(process.cwd(), 'catalog')

export function loadCatalog(): Catalog {
  if (!fs.existsSync(CATALOG_DIR)) return { packages: [], syncedAt: null }

  const packages: CatalogPackage[] = []
  for (const file of fs.readdirSync(CATALOG_DIR)) {
    if (!file.endsWith('.json') || file === 'meta.json') continue
    const parsed = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), 'utf-8'))
    if (Array.isArray(parsed)) packages.push(...parsed)
  }

  let syncedAt: string | null = null
  const metaPath = path.join(CATALOG_DIR, 'meta.json')
  if (fs.existsSync(metaPath)) syncedAt = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).syncedAt ?? null

  return { packages, syncedAt }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Ensure `catalog/` exists but stays out of source control until synced**

`catalog/.gitkeep` (empty file), and add `catalog/*.json` to `.gitignore` (keep `.gitkeep` tracked by also adding `!catalog/.gitkeep`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/bot/types.ts src/lib/bot/catalog.ts src/lib/bot/catalog.test.ts catalog/.gitkeep .gitignore
git commit -m "feat: add shared bot types and catalog loader"
```

---

### Task 21: Catalog + deployment-gate sync script

**Files:**
- Create: `scripts/sync-agent-catalog.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run sync:knowledge`, which populates `catalog/*.json`, `catalog/meta.json` (`{ syncedAt: string }`), and `catalog/deployment-gate.json` (`{ readyForApproval: boolean; blocking: string[] }`). Task 33's Settings UI and Task 29's orchestrator both read `catalog/deployment-gate.json`.

- [ ] **Step 1: Read the reference implementation and current CLI**

Read `/Users/macbook/Code/chatbot-web/scripts/sync-agent-catalog.js` in full (the proven pattern this ports) and `/Users/macbook/Code/jvto-whatsapp-agent-runtime/docs/deployment-approval.md` (for the exact `deployment-gate` CLI invocation and its JSON output shape).

- [ ] **Step 2: Implement the sync script**

`scripts/sync-agent-catalog.ts` — same structure as chatbot-web's script (resolve `jvto-whatsapp-agent-runtime` as a sibling directory, copy the JSON files under its `catalog/agent-catalog/` and `catalog/customer-sales/` into this project's `catalog/`), plus two additions: write `catalog/meta.json` with the current timestamp, and shell out to `python -m jvto_agent_runtime deployment-gate --release-dir <release-dir>` (per `deployment-approval.md`'s documented CLI), capturing its JSON output into `catalog/deployment-gate.json`. Use `execSync` from `node:child_process` for the CLI call; if it exits non-zero or the CLI isn't available, write `{ readyForApproval: false, blocking: ['deployment-gate command unavailable'] }` instead of crashing the sync.

- [ ] **Step 3: Add the npm script**

Add to `package.json`: `"sync:knowledge": "tsx scripts/sync-agent-catalog.ts"`.

- [ ] **Step 4: Manual verification**

Run: `npm run sync:knowledge`
Expected: `catalog/*.json` populated with real package data, `catalog/meta.json` has a recent `syncedAt`, `catalog/deployment-gate.json` exists (either real gate output or the unavailable fallback).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-agent-catalog.ts package.json
git commit -m "feat: add catalog + deployment-gate sync script"
```

---

### Task 22: Port `route_gate.py` → `route-gate.ts`

**Files:**
- Create: `src/lib/bot/route-gate.ts`
- Test: `src/lib/bot/route-gate.test.ts`

**Interfaces:**
- Consumes: `RouteGateResult`, `Catalog` (Task 20).
- Produces: `checkRouteGate(input: { destination?: string; catalog: Catalog }): RouteGateResult`.

- [ ] **Step 1: Read the source**

Read `/Users/macbook/Code/jvto-whatsapp-agent-runtime/src/jvto_agent_runtime/route_gate.py` and `/Users/macbook/Code/jvto-whatsapp-agent-runtime/docs/resolver-layer.md` in full. Confirm the exact statuses it returns and what "gap/unknown route" and "needs_review" mean in terms of the actual data fields on a catalog package entry (documented behavior per the runtime's decision log: unknown/gap route integrity → handoff; needs_review → disclosure, never a silent claim).

- [ ] **Step 2: Write the failing test**

`src/lib/bot/route-gate.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { checkRouteGate } from './route-gate'
import type { Catalog } from './types'

const catalog: Catalog = {
  syncedAt: '2026-07-25T00:00:00Z',
  packages: [{ packageKey: 'ijen-1d', destination: 'Ijen', title: 'Ijen Blue Fire 1D', priceIdr: 850000, inclusions: [], policyNotes: [], links: {} }],
}

describe('checkRouteGate', () => {
  it('returns clear for a destination matching a known package', () => {
    expect(checkRouteGate({ destination: 'Ijen', catalog })).toEqual({ status: 'clear' })
  })

  it('returns handoff for a destination with no matching package', () => {
    const result = checkRouteGate({ destination: 'Atlantis', catalog })
    expect(result.status).toBe('handoff')
  })

  it('returns handoff when no destination has been extracted yet', () => {
    const result = checkRouteGate({ catalog })
    expect(result.status).toBe('handoff')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/route-gate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, matching the source's actual logic**

`src/lib/bot/route-gate.ts` — start from this MVP shape and correct it against the real `route_gate.py` read in Step 1:
```typescript
import type { RouteGateResult, Catalog } from './types'

export function checkRouteGate(input: { destination?: string; catalog: Catalog }): RouteGateResult {
  if (!input.destination) return { status: 'handoff', reason: 'Tujuan belum diketahui dari percakapan' }

  const match = input.catalog.packages.find(
    (p) => p.destination.toLowerCase() === input.destination!.toLowerCase()
  )
  if (!match) return { status: 'handoff', reason: `Tidak ada paket terverifikasi untuk "${input.destination}"` }

  return { status: 'clear' }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/route-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/route-gate.ts src/lib/bot/route-gate.test.ts
git commit -m "feat: port route_gate.py to TypeScript"
```

---

### Task 23: Port `customer_sales_executor.py` + `sales_intelligence.py` → `sales-classifier.ts`

**Files:**
- Create: `src/lib/bot/sales-classifier.ts`
- Test: `src/lib/bot/sales-classifier.test.ts`

**Interfaces:**
- Consumes: `TripBrief`, `SalesClassification` (Task 20).
- Produces: `classifySalesNeed(input: { message: string; tripBrief: TripBrief }): SalesClassification`.

- [ ] **Step 1: Read the source**

Read `/Users/macbook/Code/jvto-whatsapp-agent-runtime/src/jvto_agent_runtime/customer_sales_executor.py`, `sales_intelligence.py`, and `/Users/macbook/Code/jvto-whatsapp-agent-runtime/docs/customer-sales-decision-layer.md` in full. Confirm the exact meaning of jobs J1–J5 and how missing-info detection works — the test below encodes only what's documented (job classification exists; missing destination/dates/pax should be flagged); correct the job definitions against the real source.

- [ ] **Step 2: Write the failing test**

`src/lib/bot/sales-classifier.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { classifySalesNeed } from './sales-classifier'

describe('classifySalesNeed', () => {
  it('flags missing destination, dates, and pax when TripBrief is empty', () => {
    const result = classifySalesNeed({ message: 'Halo, mau tanya paket wisata', tripBrief: {} })
    expect(result.missingInfo).toEqual(expect.arrayContaining(['destination', 'dateRange', 'pax']))
  })

  it('does not flag fields already present in TripBrief', () => {
    const result = classifySalesNeed({ message: 'Berapa harganya?', tripBrief: { destination: 'Ijen', dateRange: '2026-08-01', pax: 2 } })
    expect(result.missingInfo).toEqual([])
  })

  it('flags needsLiveData for price/availability questions', () => {
    const result = classifySalesNeed({ message: 'Ada slot kosong tanggal 1 Agustus?', tripBrief: { destination: 'Ijen' } })
    expect(result.needsLiveData).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/sales-classifier.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, matching the source's actual logic**

`src/lib/bot/sales-classifier.ts` — start from this MVP shape and correct it against the real Python source read in Step 1:
```typescript
import type { TripBrief, SalesClassification } from './types'

const LIVE_DATA_KEYWORDS = ['slot', 'kosong', 'tersedia', 'ketersediaan', 'available', 'harga sekarang', 'stok']

export function classifySalesNeed(input: { message: string; tripBrief: TripBrief }): SalesClassification {
  const missingInfo: string[] = []
  if (!input.tripBrief.destination) missingInfo.push('destination')
  if (!input.tripBrief.dateRange) missingInfo.push('dateRange')
  if (!input.tripBrief.pax) missingInfo.push('pax')

  const lower = input.message.toLowerCase()
  const needsLiveData = LIVE_DATA_KEYWORDS.some((kw) => lower.includes(kw))

  return { job: missingInfo.length > 0 ? 'J1' : 'J3', missingInfo, needsLiveData }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/sales-classifier.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/sales-classifier.ts src/lib/bot/sales-classifier.test.ts
git commit -m "feat: port customer_sales_executor + sales_intelligence to TypeScript"
```

---

### Task 24: Port `response_composer.py` → `response-composer.ts`

**Files:**
- Create: `src/lib/bot/response-composer.ts`
- Test: `src/lib/bot/response-composer.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CatalogPackage` (Task 20).
- Produces: `composeResponse(input: { topic: 'inclusions' | 'how_to_book' | 'policy' | 'price'; packageKey: string; catalog: Catalog; isHandoff: boolean }): string`.

- [ ] **Step 1: Read the source**

Read `/Users/macbook/Code/jvto-whatsapp-agent-runtime/src/jvto_agent_runtime/response_composer.py` in full, and the `customer-response` and `route-truth-audit` milestone entries in `/Users/macbook/Code/jvto-whatsapp-agent-runtime/docs/project-context.md`. Confirm the exact rule already verified in this plan's design phase: **price is only surfaced when the topic is price-relevant and the result is not a handoff** — never attach a price to an unrelated answer.

- [ ] **Step 2: Write the failing test**

`src/lib/bot/response-composer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { composeResponse } from './response-composer'
import type { Catalog } from './types'

const catalog: Catalog = {
  syncedAt: '2026-07-25T00:00:00Z',
  packages: [{ packageKey: 'ijen-1d', destination: 'Ijen', title: 'Ijen Blue Fire 1D', priceIdr: 850000, inclusions: ['Guide lokal', 'Transport'], policyNotes: ['Tidak bisa refund H-1'], links: { booking: 'https://javavolcano-touroperator.com/travel-guide/booking-information' } }],
}

describe('composeResponse', () => {
  it('includes price when topic is price and not a handoff', () => {
    const text = composeResponse({ topic: 'price', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).toContain('850000')
  })

  it('never includes price when topic is inclusions', () => {
    const text = composeResponse({ topic: 'inclusions', packageKey: 'ijen-1d', catalog, isHandoff: false })
    expect(text).not.toContain('850000')
    expect(text).toContain('Guide lokal')
  })

  it('never includes price when isHandoff is true, even for the price topic', () => {
    const text = composeResponse({ topic: 'price', packageKey: 'ijen-1d', catalog, isHandoff: true })
    expect(text).not.toContain('850000')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/response-composer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, matching the source's actual logic**

`src/lib/bot/response-composer.ts` — start from this MVP shape and correct it against the real Python source read in Step 1:
```typescript
import type { Catalog } from './types'

export function composeResponse(input: {
  topic: 'inclusions' | 'how_to_book' | 'policy' | 'price'
  packageKey: string
  catalog: Catalog
  isHandoff: boolean
}): string {
  const pkg = input.catalog.packages.find((p) => p.packageKey === input.packageKey)
  if (!pkg) return ''

  switch (input.topic) {
    case 'inclusions':
      return `Yang termasuk di paket ${pkg.title}: ${pkg.inclusions.join(', ')}.`
    case 'how_to_book':
      return `Untuk booking ${pkg.title}, ikuti panduan ini: ${pkg.links.booking ?? '(link belum tersedia)'}`
    case 'policy':
      return pkg.policyNotes.join(' ')
    case 'price':
      if (input.isHandoff || pkg.priceIdr === null) return ''
      return `Harga ${pkg.title} saat ini Rp${pkg.priceIdr.toLocaleString('id-ID')}.`
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/response-composer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/response-composer.ts src/lib/bot/response-composer.test.ts
git commit -m "feat: port response_composer.py to TypeScript"
```

---

### Task 25: Deployment-gate reader

**Files:**
- Create: `src/lib/bot/deployment-gate.ts`
- Test: `src/lib/bot/deployment-gate.test.ts`

**Interfaces:**
- Produces: `checkDeploymentGate(): { readyForApproval: boolean; blocking: string[] }`, reading `catalog/deployment-gate.json` written by Task 21's sync script. This is a reader, not a reimplementation of agent-runtime's HMAC signing — the actual gate computation (including verifying `JVTO_DEPLOYMENT_APPROVAL_KEY` signatures) stays exclusively in agent-runtime per this plan's Global Constraints; wa-inbox only ever displays and gates on the synced result.

- [ ] **Step 1: Write the failing test**

`src/lib/bot/deployment-gate.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import { checkDeploymentGate } from './deployment-gate'

vi.mock('fs')

describe('checkDeploymentGate', () => {
  it('reads the synced gate status', () => {
    ;(fs.existsSync as any).mockReturnValue(true)
    ;(fs.readFileSync as any).mockReturnValue(JSON.stringify({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] }))

    expect(checkDeploymentGate()).toEqual({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] })
  })

  it('defaults to not-ready when the catalog has never been synced', () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    expect(checkDeploymentGate()).toEqual({ readyForApproval: false, blocking: ['catalog belum pernah disinkron'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/deployment-gate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/lib/bot/deployment-gate.ts`:
```typescript
import fs from 'fs'
import path from 'path'

const GATE_PATH = path.join(process.cwd(), 'catalog', 'deployment-gate.json')

export function checkDeploymentGate(): { readyForApproval: boolean; blocking: string[] } {
  if (!fs.existsSync(GATE_PATH)) return { readyForApproval: false, blocking: ['catalog belum pernah disinkron'] }
  return JSON.parse(fs.readFileSync(GATE_PATH, 'utf-8'))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/deployment-gate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/deployment-gate.ts src/lib/bot/deployment-gate.test.ts
git commit -m "feat: add deployment-gate status reader"
```

---

### Task 26: Booking API client (Mode 3 data source)

**Files:**
- Create: `src/lib/booking/client.ts`
- Test: `src/lib/booking/client.test.ts`

**Interfaces:**
- Produces: `lookupBooking(phone: string): Promise<BookingData | null>`, `type BookingData = { bookingId: string; destination: string; dateStart: string; dateEnd: string; pax: number; amountPaid: number; amountDue: number; status: string }`.

- [ ] **Step 1: Read the source**

Read `/Users/macbook/Code/chatbot-web/src/bookingApiClient.js` in full — this is the proven, currently-live implementation being ported. Confirm the exact query-string shape (`filter_type=range&date_range=<from>_2099-12-31&phone_no=<phone>`), the `Authorization: Bearer <key>` header, the array-vs-single-object response handling (pick latest by `date.start_ymd` when an array), and the 10s timeout.

- [ ] **Step 2: Write the failing test**

`src/lib/booking/client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { lookupBooking } from './client'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.BOOKING_API_URL = 'https://booking.jvto.example/bookings'
  process.env.BOOKING_API_KEY = 'booking-key'
})

describe('lookupBooking', () => {
  it('returns null when no booking is found', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => [] })
    expect(await lookupBooking('6281234567890')).toBeNull()
  })

  it('returns the single booking when the API returns one object', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ booking_id: 'B1', destination: 'Ijen', date: { start_ymd: '2026-08-01', end_ymd: '2026-08-02' }, pax: 2, amount_paid: 500000, amount_due: 350000, status: 'confirmed' }),
    })
    const result = await lookupBooking('6281234567890')
    expect(result).toEqual({ bookingId: 'B1', destination: 'Ijen', dateStart: '2026-08-01', dateEnd: '2026-08-02', pax: 2, amountPaid: 500000, amountDue: 350000, status: 'confirmed' })
  })

  it('picks the booking with the latest start date when the API returns an array', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { booking_id: 'B1', destination: 'Ijen', date: { start_ymd: '2026-08-01', end_ymd: '2026-08-02' }, pax: 2, amount_paid: 500000, amount_due: 0, status: 'confirmed' },
        { booking_id: 'B2', destination: 'Bromo', date: { start_ymd: '2026-09-01', end_ymd: '2026-09-02' }, pax: 4, amount_paid: 0, amount_due: 900000, status: 'confirmed' },
      ],
    })
    const result = await lookupBooking('6281234567890')
    expect(result?.bookingId).toBe('B2')
  })

  it('returns null instead of throwing when the request fails', async () => {
    ;(fetch as any).mockRejectedValue(new Error('timeout'))
    expect(await lookupBooking('6281234567890')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/booking/client.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, matching the source's actual field names**

`src/lib/booking/client.ts` — adjust field names against the real `bookingApiClient.js` read in Step 1:
```typescript
export type BookingData = {
  bookingId: string
  destination: string
  dateStart: string
  dateEnd: string
  pax: number
  amountPaid: number
  amountDue: number
  status: string
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '')
}

function toBookingData(raw: any): BookingData {
  return {
    bookingId: raw.booking_id,
    destination: raw.destination,
    dateStart: raw.date.start_ymd,
    dateEnd: raw.date.end_ymd,
    pax: raw.pax,
    amountPaid: raw.amount_paid,
    amountDue: raw.amount_due,
    status: raw.status,
  }
}

export async function lookupBooking(phone: string): Promise<BookingData | null> {
  try {
    const from = new Date()
    from.setMonth(from.getMonth() - 1)
    const fromStr = from.toISOString().slice(0, 10)
    const url = `${process.env.BOOKING_API_URL}?filter_type=range&date_range=${fromStr}_2099-12-31&phone_no=${normalizePhone(phone)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.BOOKING_API_KEY}` }, signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) return null
    const body = await res.json()

    if (Array.isArray(body)) {
      if (body.length === 0) return null
      const latest = body.reduce((a, b) => (a.date.start_ymd > b.date.start_ymd ? a : b))
      return toBookingData(latest)
    }
    if (!body || Object.keys(body).length === 0) return null
    return toBookingData(body)
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/booking/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/booking/client.ts src/lib/booking/client.test.ts
git commit -m "feat: port bookingApiClient.js to TypeScript"
```

---

### Task 27: Funnel state machine (ported from `orderFlow.js`, 4 states)

**Files:**
- Create: `src/lib/bot/funnel.ts`
- Test: `src/lib/bot/funnel.test.ts`

**Interfaces:**
- Consumes: `Catalog` (Task 20).
- Produces: `processFunnelState(input: { currentState: string; message: string; catalog: Catalog }): { reply: string; nextState: string }`. States (per the corrected 4-state scope confirmed during design, not the stale 10-state doc): `GREETING`, `TANYA_ORIGIN`, `REKOMENDASI`, `HUMAN_HANDOFF`.

- [ ] **Step 1: Read the source**

Read `/Users/macbook/Code/chatbot-web/src/orderFlow.js` in full (lines 6-14 for the state enum, 90-163 for `processState`). Confirm the exact transition conditions and static reply text per state before porting — do not invent copy.

- [ ] **Step 2: Write the failing test**

`src/lib/bot/funnel.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { processFunnelState } from './funnel'
import type { Catalog } from './types'

const catalog: Catalog = { syncedAt: null, packages: [{ packageKey: 'ijen-1d', destination: 'Ijen', title: 'Ijen Blue Fire 1D', priceIdr: 850000, inclusions: [], policyNotes: [], links: {} }] }

describe('processFunnelState', () => {
  it('moves from GREETING to TANYA_ORIGIN on first contact', () => {
    const result = processFunnelState({ currentState: 'GREETING', message: 'Halo', catalog })
    expect(result.nextState).toBe('TANYA_ORIGIN')
  })

  it('moves from TANYA_ORIGIN to REKOMENDASI when a known destination is mentioned', () => {
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Saya mau ke Ijen', catalog })
    expect(result.nextState).toBe('REKOMENDASI')
    expect(result.reply).toContain('Ijen Blue Fire 1D')
  })

  it('stays in TANYA_ORIGIN when the destination is not recognized', () => {
    const result = processFunnelState({ currentState: 'TANYA_ORIGIN', message: 'Saya mau ke Mars', catalog })
    expect(result.nextState).toBe('TANYA_ORIGIN')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/funnel.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, matching `orderFlow.js`'s actual copy and transitions**

`src/lib/bot/funnel.ts` — start from this shape and correct the reply copy/transition rules against the real source read in Step 1:
```typescript
import type { Catalog } from './types'

export function processFunnelState(input: { currentState: string; message: string; catalog: Catalog }): { reply: string; nextState: string } {
  switch (input.currentState) {
    case 'GREETING':
      return { reply: 'Halo! Mau liburan ke mana? (Ijen, Bromo, ...)', nextState: 'TANYA_ORIGIN' }

    case 'TANYA_ORIGIN': {
      const match = input.catalog.packages.find((p) => input.message.toLowerCase().includes(p.destination.toLowerCase()))
      if (!match) return { reply: 'Maaf, tujuan itu belum ada di paket kami. Coba sebutkan tujuan lain?', nextState: 'TANYA_ORIGIN' }
      return { reply: `Rekomendasi untuk ${match.destination}: ${match.title}. Mau lanjut booking?`, nextState: 'REKOMENDASI' }
    }

    case 'REKOMENDASI':
      return { reply: 'Baik, saya sambungkan ke tim kami untuk lanjut booking.', nextState: 'HUMAN_HANDOFF' }

    default:
      return { reply: 'Saya sambungkan ke tim kami ya.', nextState: 'HUMAN_HANDOFF' }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/funnel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/funnel.ts src/lib/bot/funnel.test.ts
git commit -m "feat: port orderFlow.js 4-state funnel to TypeScript"
```

---

### Task 28: LLM client wrapper (OpenAI + Ollama fallback)

**Files:**
- Create: `src/lib/bot/llm.ts`
- Test: `src/lib/bot/llm.test.ts`

**Interfaces:**
- Produces: `callLLM(prompt: string, opts?: { forceLocal?: boolean }): Promise<string>`. `forceLocal: true` skips OpenAI entirely and calls Ollama directly — used by the orchestrator (Task 29) for Mode 3 (booking-context), matching chatbot-web's documented behavior of forcing local Ollama whenever real booking data is in the prompt.

- [ ] **Step 1: Write the failing test**

`src/lib/bot/llm.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callLLM } from './llm'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OLLAMA_URL = 'http://localhost:11434'
})

describe('callLLM', () => {
  it('calls OpenAI by default', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Jawaban dari OpenAI' } }] }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Jawaban dari OpenAI')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api.openai.com'), expect.anything())
  })

  it('calls Ollama when forceLocal is true, never touching OpenAI', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ response: 'Jawaban dari Ollama' }) })
    const result = await callLLM('Booking saya kapan?', { forceLocal: true })
    expect(result).toBe('Jawaban dari Ollama')
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/generate', expect.anything())
  })

  it('falls back to Ollama when OpenAI errors', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'rate limited' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'Fallback dari Ollama' }) })
    const result = await callLLM('Apa saja paket Ijen?')
    expect(result).toBe('Fallback dari Ollama')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/llm.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/lib/bot/llm.ts`:
```typescript
async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: 'llama3', prompt, stream: false }),
  })
  const body = await res.json()
  return body.response
}

async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error('OpenAI request failed')
  const body = await res.json()
  return body.choices[0].message.content
}

export async function callLLM(prompt: string, opts?: { forceLocal?: boolean }): Promise<string> {
  if (opts?.forceLocal) return callOllama(prompt)
  try {
    return await callOpenAI(prompt)
  } catch {
    return callOllama(prompt)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/llm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/llm.ts src/lib/bot/llm.test.ts
git commit -m "feat: add LLM client wrapper with OpenAI-primary, Ollama-fallback/forced"
```

---

### Task 29: Bot orchestrator — the 3-mode decision flow

**Files:**
- Create: `src/lib/bot/orchestrator.ts`
- Test: `src/lib/bot/orchestrator.test.ts`

**Interfaces:**
- Consumes: `lookupBooking` (26), `processFunnelState` (27), `checkRouteGate` (22), `classifySalesNeed` (23), `composeResponse` (24), `callLLM` (28), `loadCatalog` (20), `checkDeploymentGate` (25), `prisma` (2).
- Produces: `decideAndRespond(conversationId: string, inboundText: string): Promise<BotDecision>` — the single entry point Task 30 wires into the webhook handler. This is where the escalation → booking-lookup → 3-mode branch documented in the design happens; every rule here must match the "Kapan bot balas sendiri, kapan handoff" table from `docs/design/wa-inbox-concept.html`.

- [ ] **Step 1: Write the failing test**

`src/lib/bot/orchestrator.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { decideAndRespond } from './orchestrator'
import { lookupBooking } from '@/lib/booking/client'
import { checkRouteGate } from './route-gate'
import { classifySalesNeed } from './sales-classifier'
import { processFunnelState } from './funnel'
import { callLLM } from './llm'
import { loadCatalog } from './catalog'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/booking/client')
vi.mock('./route-gate')
vi.mock('./sales-classifier')
vi.mock('./funnel')
vi.mock('./llm')
vi.mock('./catalog')
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockPrisma = mockDeep<PrismaClient>()
  vi.clearAllMocks()
  ;(loadCatalog as any).mockReturnValue({ packages: [], syncedAt: null })
  mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ id: 'conv_1', tripBrief: {}, bookingData: null, bookingCheckedAt: null, contact: { phone: '6281234567890' } } as never)
})

describe('decideAndRespond', () => {
  it('escalates immediately on complaint keywords, skipping every other check', async () => {
    const result = await decideAndRespond('conv_1', 'Saya mau komplain dan minta refund!')
    expect(result).toEqual({ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' })
    expect(lookupBooking).not.toHaveBeenCalled()
  })

  it('uses Mode 3 (booking_context) when an existing booking is found, skipping the funnel entirely', async () => {
    ;(lookupBooking as any).mockResolvedValue({ bookingId: 'B1', destination: 'Ijen', dateStart: '2026-08-01', dateEnd: '2026-08-02', pax: 2, amountPaid: 500000, amountDue: 0, status: 'confirmed' })
    ;(callLLM as any).mockResolvedValue('Booking Anda ke Ijen tanggal 1 Agustus sudah lunas.')

    const result = await decideAndRespond('conv_1', 'Booking saya sudah lunas belum?')

    expect(result.mode).toBe('booking_context')
    expect(processFunnelState).not.toHaveBeenCalled()
    expect(callLLM).toHaveBeenCalledWith(expect.stringContaining('B1'), { forceLocal: true })
  })

  it('handoffs when route gate is not clear and no booking exists', async () => {
    ;(lookupBooking as any).mockResolvedValue(null)
    ;(checkRouteGate as any).mockReturnValue({ status: 'handoff', reason: 'Tidak ada paket terverifikasi' })

    const result = await decideAndRespond('conv_1', 'Saya mau ke Atlantis')

    expect(result).toEqual({ mode: 'handoff', reason: 'Tidak ada paket terverifikasi' })
  })

  it('falls back to handoff if any step throws (fail-safe)', async () => {
    ;(lookupBooking as any).mockRejectedValue(new Error('booking API down'))

    const result = await decideAndRespond('conv_1', 'Halo')

    expect(result.mode).toBe('handoff')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the orchestrator**

`src/lib/bot/orchestrator.ts`:
```typescript
import { prisma } from '@/lib/db'
import { lookupBooking } from '@/lib/booking/client'
import { checkRouteGate } from './route-gate'
import { classifySalesNeed } from './sales-classifier'
import { processFunnelState } from './funnel'
import { composeResponse } from './response-composer'
import { callLLM } from './llm'
import { loadCatalog } from './catalog'
import type { BotDecision, TripBrief } from './types'

const ESCALATION_KEYWORDS = ['komplain', 'refund', 'bicara dengan manusia', 'agen manusia', 'cs manusia']

function isEscalation(message: string): boolean {
  const lower = message.toLowerCase()
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw))
}

const BOOKING_CACHE_MS = 24 * 60 * 60 * 1000

export async function decideAndRespond(conversationId: string, inboundText: string): Promise<BotDecision> {
  try {
    if (isEscalation(inboundText)) {
      return { mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }
    }

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { contact: true } })

    let bookingData = conversation.bookingData as unknown
    const stale = !conversation.bookingCheckedAt || Date.now() - conversation.bookingCheckedAt.getTime() > BOOKING_CACHE_MS
    if (stale) {
      bookingData = await lookupBooking(conversation.contact.phone)
      await prisma.conversation.update({ where: { id: conversationId }, data: { bookingData: bookingData as never, bookingCheckedAt: new Date() } })
    }

    // Mode 3 — booking context: bypasses funnel and route gate entirely.
    if (bookingData) {
      const prompt = `Data booking pelanggan (JSON): ${JSON.stringify(bookingData)}\n\nPertanyaan: "${inboundText}"\n\nJawab HANYA berdasarkan data booking di atas. Jangan menebak apa pun yang tidak ada di data.`
      const reply = await callLLM(prompt, { forceLocal: true })
      return { mode: 'booking_context', reply }
    }

    // Mode 1/2 — funnel + FAQ, gated by route integrity.
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

    const funnelResult = processFunnelState({ currentState: 'GREETING', message: inboundText, catalog })
    if (funnelResult.nextState !== 'HUMAN_HANDOFF') {
      return { mode: 'funnel', reply: funnelResult.reply, nextState: funnelResult.nextState }
    }

    const draft = composeResponse({ topic: 'inclusions', packageKey: catalog.packages[0]?.packageKey ?? '', catalog, isHandoff: false })
    return { mode: 'faq', draft, sourceTopic: 'inclusions' }
  } catch {
    return { mode: 'handoff', reason: 'Terjadi kegagalan saat memproses — default gagal-aman' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "feat: add bot orchestrator implementing the 3-mode decision flow"
```

---

### Task 30: Wire the orchestrator into inbound message handling

**Files:**
- Modify: `src/lib/inbound.ts`
- Modify: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: `decideAndRespond` (Task 29), `sendMessage` (Task 8, now channel-aware via Task 16).

- [ ] **Step 1: Extend the failing test**

Add to `src/lib/inbound.test.ts`:
```typescript
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { sendMessage } from '@/lib/send'

vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

  it('calls the bot orchestrator and sends its reply when the conversation has botEnabled', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', avatarUrl: 'x' } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', botEnabled: true } as never)
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ coexistBaseUrl: 'http://x' } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: null }) }))
    ;(decideAndRespond as any).mockResolvedValue({ mode: 'faq', draft: 'Info paket...', sourceTopic: 'inclusions' })

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).toHaveBeenCalledWith('conv_1', 'Halo, mau tanya paket Ijen')
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_1', text: 'Info paket...', sentBy: 'BOT' }))
  })

  it('does not call the orchestrator when botEnabled is false', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null)
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_1', avatarUrl: 'x' } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_1', botEnabled: false } as never)
    mockPrisma.message.create.mockResolvedValue({} as never)

    await ingestMetaMessage(samplePayload)

    expect(decideAndRespond).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: FAIL — orchestrator is never called yet.

- [ ] **Step 3: Wire it in**

Add to the end of `ingestMetaMessage` in `src/lib/inbound.ts`, after the inbound `message.create` call, before `return { skipped: false }`:
```typescript
  if (conversation.botEnabled) {
    const decision = await decideAndRespond(conversation.id, message.text?.body ?? '')
    if (decision.mode === 'funnel' || decision.mode === 'faq' || decision.mode === 'booking_context') {
      const text = decision.mode === 'funnel' ? decision.reply : decision.mode === 'faq' ? decision.draft : decision.reply
      await sendMessage({ conversationId: conversation.id, text, sentBy: 'BOT', botTrace: decision })
    }
    // mode 'handoff' intentionally sends nothing — the conversation just waits for a human.
  }
```
(Add `import { decideAndRespond } from '@/lib/bot/orchestrator'` and `import { sendMessage } from '@/lib/send'` at the top.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/inbound.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "feat: wire bot orchestrator into inbound message handling"
```

---

### Task 31: Per-conversation bot toggle

**Files:**
- Create: `src/app/api/conversations/[id]/toggle-bot/route.ts`
- Modify: `src/components/inbox/ComposeBox.tsx`
- Test: `src/app/api/conversations/[id]/toggle-bot/route.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2).
- Produces: `POST /api/conversations/:id/toggle-bot` → `{ botEnabled: boolean }` (flips the current value).

- [ ] **Step 1: Write the failing test**

`src/app/api/conversations/[id]/toggle-bot/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('POST /api/conversations/[id]/toggle-bot', () => {
  it('flips botEnabled from true to false', async () => {
    mockPrisma.conversation.findUniqueOrThrow.mockResolvedValue({ botEnabled: true } as never)
    mockPrisma.conversation.update.mockResolvedValue({ botEnabled: false } as never)

    const res = await POST(new Request('http://localhost'), { params: Promise.resolve({ id: 'conv_1' }) })

    expect((await res.json()).botEnabled).toBe(false)
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'conv_1' }, data: { botEnabled: false } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/conversations/[id]/toggle-bot/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

`src/app/api/conversations/[id]/toggle-bot/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const current = await prisma.conversation.findUniqueOrThrow({ where: { id } })
  const updated = await prisma.conversation.update({ where: { id }, data: { botEnabled: !current.botEnabled } })
  return NextResponse.json({ botEnabled: updated.botEnabled })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/conversations/[id]/toggle-bot/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add the "Ambil Alih dari Bot" button to `ComposeBox`**

Modify `src/components/inbox/ComposeBox.tsx` — add a `botEnabled` prop and a toggle button:
```tsx
export function ComposeBox({ conversationId, botEnabled, onSent, onBotToggled }: {
  conversationId: string
  botEnabled: boolean
  onSent: (m: MessageView) => void
  onBotToggled: (enabled: boolean) => void
}) {
  // ...existing state...

  async function toggleBot() {
    const res = await fetch(`/api/conversations/${conversationId}/toggle-bot`, { method: 'POST' })
    const { botEnabled: newValue } = await res.json()
    onBotToggled(newValue)
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-white p-3">
      {botEnabled && (
        <button onClick={toggleBot} className="badge self-start cursor-pointer bg-amber-50 text-amber-700">
          Ambil Alih dari Bot
        </button>
      )}
      <div className="flex gap-2">
        {/* ...existing select/input/button... */}
      </div>
    </div>
  )
}
```
Thread the `botEnabled`/`onBotToggled` props through from `ThreadView`, which fetches the conversation's `botEnabled` alongside its messages (extend the `GET /api/conversations/:id/messages` response or add a small `GET /api/conversations/:id` route returning `{ botEnabled: boolean }` — reuse the existing messages fetch's conversation join if straightforward, otherwise add the dedicated route now).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/conversations src/components/inbox/ComposeBox.tsx
git commit -m "feat: add per-conversation bot toggle and Ambil Alih button"
```

---

### Task 32: Bot trace popover in thread view

**Files:**
- Create: `src/components/inbox/BotTracePopover.tsx`
- Modify: `src/components/inbox/MessageBubble.tsx`
- Test: `src/components/inbox/BotTracePopover.test.tsx`

**Interfaces:**
- Consumes: `Message.botTrace` (the `BotDecision` object stored by Task 30).
- Produces: clicking a bot-sent message bubble opens a popover showing the decision mode and reasoning.

- [ ] **Step 1: Write the failing test**

`src/components/inbox/BotTracePopover.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BotTracePopover } from './BotTracePopover'

describe('BotTracePopover', () => {
  it('shows the FAQ mode and source topic', () => {
    render(<BotTracePopover trace={{ mode: 'faq', draft: 'Info paket...', sourceTopic: 'inclusions' }} />)
    expect(screen.getByText(/faq/i)).toBeInTheDocument()
    expect(screen.getByText(/inclusions/i)).toBeInTheDocument()
  })

  it('shows the handoff reason', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} />)
    expect(screen.getByText('Kata kunci eskalasi terdeteksi')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/inbox/BotTracePopover.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement**

`src/components/inbox/BotTracePopover.tsx`:
```tsx
import type { BotDecision } from '@/lib/bot/types'

export function BotTracePopover({ trace }: { trace: BotDecision }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-xs shadow-md">
      <p className="font-mono uppercase text-brand">Mode: {trace.mode}</p>
      {trace.mode === 'handoff' && <p>{trace.reason}</p>}
      {trace.mode === 'faq' && <p>Sumber topik: {trace.sourceTopic}</p>}
      {trace.mode === 'funnel' && <p>Tahap berikutnya: {trace.nextState}</p>}
      {trace.mode === 'booking_context' && <p>Dijawab dari data booking asli (Booking API).</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/inbox/BotTracePopover.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `MessageBubble`**

Modify `src/components/inbox/MessageBubble.tsx` — make it a client component with a `useState` for popover visibility; when `message.sentBy === 'BOT' && message.botTrace`, clicking the bubble toggles `<BotTracePopover trace={message.botTrace as BotDecision} />` rendered below it. Add `'use client'` at the top of the file since it now needs interaction state.

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/BotTracePopover.tsx src/components/inbox/MessageBubble.tsx
git commit -m "feat: add bot decision trace popover on message bubbles"
```

---

### Task 33: Settings — bot kill switch, catalog sync, deployment gate status

**Files:**
- Create: `src/app/api/bot/kill-switch/route.ts`
- Create: `src/app/api/bot/sync-catalog/route.ts`
- Create: `src/app/api/bot/gate-status/route.ts`
- Modify: `src/app/settings/page.tsx`
- Test: `src/app/api/bot/kill-switch/route.test.ts`
- Test: `src/app/api/bot/gate-status/route.test.ts`

**Interfaces:**
- Consumes: `prisma.settings` (2), `checkDeploymentGate` (25).
- Produces: `POST /api/bot/kill-switch` → `{ botKillSwitch: boolean }` (flips it), `POST /api/bot/sync-catalog` (shells out to `npm run sync:knowledge`), `GET /api/bot/gate-status` → `{ readyForApproval: boolean; blocking: string[] }`.

- [ ] **Step 1: Write the failing tests**

`src/app/api/bot/kill-switch/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('POST /api/bot/kill-switch', () => {
  it('flips botKillSwitch', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botKillSwitch: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botKillSwitch: true } as never)
    const res = await POST()
    expect((await res.json()).botKillSwitch).toBe(true)
  })
})
```

`src/app/api/bot/gate-status/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { GET } from './route'
import { checkDeploymentGate } from '@/lib/bot/deployment-gate'

vi.mock('@/lib/bot/deployment-gate')

describe('GET /api/bot/gate-status', () => {
  it('returns the deployment gate status', async () => {
    ;(checkDeploymentGate as any).mockReturnValue({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] })
    const res = await GET()
    expect(await res.json()).toEqual({ readyForApproval: false, blocking: ['core_dataset_not_production_ready'] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/bot/kill-switch/route.test.ts src/app/api/bot/gate-status/route.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement all three routes**

`src/app/api/bot/kill-switch/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST() {
  const current = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  const updated = await prisma.settings.update({ where: { id: 1 }, data: { botKillSwitch: !current.botKillSwitch } })
  return NextResponse.json({ botKillSwitch: updated.botKillSwitch })
}
```

`src/app/api/bot/gate-status/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { checkDeploymentGate } from '@/lib/bot/deployment-gate'

export async function GET() {
  return NextResponse.json(checkDeploymentGate())
}
```

`src/app/api/bot/sync-catalog/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { prisma } from '@/lib/db'

export async function POST() {
  try {
    execSync('npm run sync:knowledge', { cwd: process.cwd() })
    await prisma.settings.update({ where: { id: 1 }, data: { catalogSyncedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Sinkronisasi gagal — cek log server' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/bot/kill-switch/route.test.ts src/app/api/bot/gate-status/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Also respect the kill switch in the orchestrator**

Modify `src/lib/bot/orchestrator.ts` — at the very top of `decideAndRespond`'s `try` block, before the escalation check, add:
```typescript
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    if (settings.botKillSwitch) return { mode: 'handoff', reason: 'Bot dimatikan sementara (kill switch aktif)' }
```

- [ ] **Step 6: Extend the Settings page**

Add a "Bot & Otomasi" section to `src/app/settings/page.tsx`, fetching `/api/bot/gate-status` alongside the existing `settings`/`status` fetches, and rendering: a kill-switch toggle button (calls `POST /api/bot/kill-switch`), the `catalogSyncedAt` timestamp with a "Sinkron Sekarang" button (calls `POST /api/bot/sync-catalog`), and the gate status as a pill (green "Siap" if `readyForApproval`, amber "Terkunci: {blocking.join(', ')}" otherwise) with a link to `/settings/bot-log` (Task 34).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/bot src/lib/bot/orchestrator.ts src/app/settings/page.tsx
git commit -m "feat: add bot kill switch, catalog sync trigger, and deployment gate status to Pengaturan"
```

---

### Task 34: Log Keputusan Bot page

**Files:**
- Create: `src/app/api/bot/decisions/route.ts`
- Create: `src/app/settings/bot-log/page.tsx`
- Test: `src/app/api/bot/decisions/route.test.ts`

**Interfaces:**
- Produces: `GET /api/bot/decisions?mode=handoff|faq|funnel|booking_context` → `Array<{ id: string; conversationId: string; contactName: string | null; mode: string; trace: unknown; createdAt: string }>`, reading `Message` rows where `sentBy = 'BOT'` or `botTrace` is set (handoff decisions currently produce no message — see Step 3 for how those are still logged).

- [ ] **Step 1: Log handoff decisions too, not just sent replies**

Modify `src/lib/inbound.ts`'s bot-wiring block from Task 30 so the `mode === 'handoff'` branch also creates a `Message` row (with `content: null`, `sentBy: 'BOT'`, `botTrace: decision`, `deliveryStatus: 'SENT'`) instead of writing nothing — this is required for the audit log to show handoffs, not just replies. Update `src/lib/inbound.test.ts`'s Task 30 tests accordingly if any asserted "nothing is created" for handoff.

- [ ] **Step 2: Write the failing test for the decisions route**

`src/app/api/bot/decisions/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/bot/decisions', () => {
  it('returns bot-authored messages with their trace, filterable by mode', async () => {
    mockPrisma.message.findMany.mockResolvedValue([{
      id: 'm1', conversationId: 'conv_1', botTrace: { mode: 'handoff', reason: 'x' }, createdAt: new Date(),
      conversation: { contact: { name: 'Bruno' } },
    }] as never)

    const res = await GET(new Request('http://localhost/api/bot/decisions?mode=handoff'))
    const body = await res.json()

    expect(body[0].mode).toBe('handoff')
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sentBy: 'BOT' }),
    }))
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/api/bot/decisions/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 4: Implement**

`src/app/api/bot/decisions/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode')
  const messages = await prisma.message.findMany({
    where: { sentBy: 'BOT' },
    include: { conversation: { include: { contact: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const decisions = messages.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    contactName: m.conversation.contact.name,
    mode: (m.botTrace as { mode: string } | null)?.mode ?? 'unknown',
    trace: m.botTrace,
    createdAt: m.createdAt.toISOString(),
  }))

  return NextResponse.json(mode ? decisions.filter((d) => d.mode === mode) : decisions)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/api/bot/decisions/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Log page UI**

`src/app/settings/bot-log/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'

type Decision = { id: string; conversationId: string; contactName: string | null; mode: string; trace: unknown; createdAt: string }

export default function BotLogPage() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetch(`/api/bot/decisions${filter ? `?mode=${filter}` : ''}`).then((r) => r.json()).then(setDecisions)
  }, [filter])

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold text-navy">Log Keputusan Bot</h1>
      <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 rounded-lg border border-input px-2 text-sm outline-none">
        <option value="">Semua mode</option>
        <option value="handoff">Handoff</option>
        <option value="faq">FAQ</option>
        <option value="funnel">Funnel</option>
        <option value="booking_context">Konteks Booking</option>
      </select>
      <div className="divide-y">
        {decisions.map((d) => (
          <div key={d.id} className="py-2 text-sm">
            <span className="font-mono uppercase text-brand">{d.mode}</span> — {d.contactName ?? d.conversationId} — {new Date(d.createdAt).toLocaleString('id-ID')}
          </div>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/inbound.ts src/app/api/bot/decisions src/app/settings/bot-log
git commit -m "feat: log handoff decisions and add Log Keputusan Bot page"
```

---

**Fase 3 complete.** The bot now runs its full 3-mode decision flow with ported logic, respects the kill switch and (read-only) deployment gate, and every decision is auditable.

---

## Fase 4 — CRM & Pensiun Lama

### Task 35: Labels — CRUD + attach/detach on conversations

**Files:**
- Create: `src/app/api/labels/route.ts`
- Create: `src/app/api/conversations/[id]/labels/route.ts`
- Test: `src/app/api/labels/route.test.ts`
- Test: `src/app/api/conversations/[id]/labels/route.test.ts`

**Interfaces:**
- Produces: `GET/POST /api/labels` (list, create `{ name, color }`), `POST/DELETE /api/conversations/:id/labels` (body `{ labelId }`, attach/detach).

- [ ] **Step 1: Write the failing tests**

`src/app/api/labels/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET, POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('labels API', () => {
  it('GET lists all labels', async () => {
    mockPrisma.label.findMany.mockResolvedValue([{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }] as never)
    const res = await GET()
    expect((await res.json())[0].name).toBe('Confirmed Booking')
  })

  it('POST creates a label', async () => {
    mockPrisma.label.create.mockResolvedValue({ id: 'lbl_2', name: 'New Customer', color: '#106877' } as never)
    const req = new Request('http://localhost/api/labels', { method: 'POST', body: JSON.stringify({ name: 'New Customer', color: '#106877' }) })
    const res = await POST(req)
    expect((await res.json()).name).toBe('New Customer')
  })
})
```

`src/app/api/conversations/[id]/labels/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { POST, DELETE } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('conversation labels API', () => {
  it('POST attaches a label to a conversation', async () => {
    mockPrisma.labelOnConversation.create.mockResolvedValue({} as never)
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ labelId: 'lbl_1' }) })
    const res = await POST(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.labelOnConversation.create).toHaveBeenCalledWith({ data: { conversationId: 'conv_1', labelId: 'lbl_1' } })
  })

  it('DELETE detaches a label', async () => {
    mockPrisma.labelOnConversation.delete.mockResolvedValue({} as never)
    const req = new Request('http://localhost', { method: 'DELETE', body: JSON.stringify({ labelId: 'lbl_1' }) })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/labels/route.test.ts src/app/api/conversations/[id]/labels/route.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement**

`src/app/api/labels/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET() {
  return NextResponse.json(await prisma.label.findMany())
}

const createSchema = z.object({ name: z.string().min(1), color: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Nama dan warna label wajib diisi' }, { status: 400 })
  return NextResponse.json(await prisma.label.create({ data: parsed.data }))
}
```

`src/app/api/conversations/[id]/labels/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const bodySchema = z.object({ labelId: z.string() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'labelId wajib diisi' }, { status: 400 })
  await prisma.labelOnConversation.create({ data: { conversationId: id, labelId: parsed.data.labelId } })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'labelId wajib diisi' }, { status: 400 })
  await prisma.labelOnConversation.delete({ where: { labelId_conversationId: { conversationId: id, labelId: parsed.data.labelId } } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/labels/route.test.ts src/app/api/conversations/[id]/labels/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add a label picker to the `ContactPanel` component**

Create `src/components/inbox/ContactPanel.tsx` — the right column of the inbox. It needs the conversation's `contactName`, `avatarUrl`, `bookingData`, and `tripBrief` (extend `GET /api/conversations/:id/messages` from Task 11 into a small `GET /api/conversations/:id` route returning `{ contactName, avatarUrl, bookingData, tripBrief }` alongside the existing messages route, or add the fields to that same response — pick one and keep it consistent with Task 31's `botEnabled` fetch need too, ideally the same route). Render:
- Contact name, avatar (`<img>` or an initial-letter fallback when `avatarUrl` is null), source.
- **If `bookingData` is present (Mode 3):** a read-only summary of the real booking — destination, date range, pax, amount paid/due, status — labeled "Booking Ada" so agents know this is verified data, not the funnel's guess.
- **Else (Mode 1/2):** a summary of `tripBrief` fields that are set (destination, dateRange, pax), labeled "Dari Funnel (belum booking)".
- The labels section described below.

Then implement the labels section: fetches `GET /api/labels` for the full set and the conversation's current labels, renders attached ones as removable pills and an "+ Add label" dropdown of the rest, calling the two routes above. Wire `ContactPanel` into `src/app/inbox/page.tsx` as the third grid column next to `ConversationList` and `ThreadView`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/labels src/app/api/conversations src/components/inbox/ContactPanel.tsx src/app/inbox/page.tsx
git commit -m "feat: add label CRUD and attach/detach on conversations"
```

---

### Task 36: Notes — CRUD on contacts

**Files:**
- Create: `src/app/api/contacts/[id]/notes/route.ts`
- Modify: `src/components/inbox/ContactPanel.tsx`
- Test: `src/app/api/contacts/[id]/notes/route.test.ts`

**Interfaces:**
- Produces: `GET/POST /api/contacts/:id/notes` (list ordered newest-first, create `{ body: string }` — `authorId` comes from the session).

- [ ] **Step 1: Write the failing test**

`src/app/api/contacts/[id]/notes/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET, POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn().mockResolvedValue({ accountId: 'acc_1', role: 'AGENT' }) }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('contact notes API', () => {
  it('GET lists notes for a contact', async () => {
    mockPrisma.note.findMany.mockResolvedValue([{ id: 'n1', body: 'Pelanggan lama', author: { name: 'Admin' }, createdAt: new Date() }] as never)
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'contact_1' }) })
    expect((await res.json())[0].body).toBe('Pelanggan lama')
  })

  it('POST creates a note tied to the current session', async () => {
    mockPrisma.note.create.mockResolvedValue({ id: 'n2', body: 'Follow up minggu depan' } as never)
    const req = new Request('http://localhost', { method: 'POST', headers: { cookie: 'wa_inbox_session=tok' }, body: JSON.stringify({ body: 'Follow up minggu depan' }) })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.note.create).toHaveBeenCalledWith({ data: { contactId: 'contact_1', authorId: 'acc_1', body: 'Follow up minggu depan' }, include: { author: true } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/contacts/[id]/notes/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

`src/app/api/contacts/[id]/notes/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const notes = await prisma.note.findMany({ where: { contactId: id }, include: { author: true }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(notes.map((n) => ({ id: n.id, body: n.body, authorName: n.author.name, createdAt: n.createdAt })))
}

const bodySchema = z.object({ body: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Isi catatan wajib diisi' }, { status: 400 })

  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const note = await prisma.note.create({ data: { contactId: id, authorId: session.accountId, body: parsed.data.body }, include: { author: true } })
  return NextResponse.json(note)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/contacts/[id]/notes/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a notes section to `ContactPanel`**

Extend `src/components/inbox/ContactPanel.tsx` with a notes list + a textarea + "Tambah Catatan" button wired to the routes above.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/contacts src/components/inbox/ContactPanel.tsx
git commit -m "feat: add contact notes"
```

---

### Task 37: Reminders — CRUD + Beranda "jatuh tempo" widget

**Files:**
- Create: `src/app/api/contacts/[id]/reminders/route.ts`
- Create: `src/app/api/reminders/due/route.ts`
- Modify: `src/components/inbox/ContactPanel.tsx`
- Test: `src/app/api/contacts/[id]/reminders/route.test.ts`
- Test: `src/app/api/reminders/due/route.test.ts`

**Interfaces:**
- Produces: `GET/POST /api/contacts/:id/reminders` (create `{ dueAt: string, note: string }`), `PATCH /api/contacts/:id/reminders` (body `{ reminderId, done: boolean }`), `GET /api/reminders/due` → today's undone reminders across all contacts, consumed by Task 45's Beranda.

- [ ] **Step 1: Write the failing tests**

`src/app/api/contacts/[id]/reminders/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET, POST, PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('contact reminders API', () => {
  it('POST creates a reminder', async () => {
    mockPrisma.reminder.create.mockResolvedValue({ id: 'r1' } as never)
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ dueAt: '2026-08-01T00:00:00Z', note: 'Follow up' }) })
    const res = await POST(req, { params: Promise.resolve({ id: 'contact_1' }) })
    expect(res.status).toBe(200)
  })

  it('PATCH marks a reminder done', async () => {
    mockPrisma.reminder.update.mockResolvedValue({ id: 'r1', done: true } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ reminderId: 'r1', done: true }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'contact_1' }) })
    expect((await res.json()).done).toBe(true)
  })
})
```

`src/app/api/reminders/due/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/reminders/due', () => {
  it('returns undone reminders due today or earlier, with contact name', async () => {
    mockPrisma.reminder.findMany.mockResolvedValue([{ id: 'r1', note: 'Follow up', dueAt: new Date(), contact: { name: 'Bruno', id: 'contact_1' } }] as never)
    const res = await GET()
    expect((await res.json())[0].contactName).toBe('Bruno')
    expect(mockPrisma.reminder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ done: false }) }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/contacts/[id]/reminders/route.test.ts src/app/api/reminders/due/route.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement**

`src/app/api/contacts/[id]/reminders/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return NextResponse.json(await prisma.reminder.findMany({ where: { contactId: id }, orderBy: { dueAt: 'asc' } }))
}

const createSchema = z.object({ dueAt: z.string(), note: z.string().min(1) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Tanggal dan catatan reminder wajib diisi' }, { status: 400 })
  const reminder = await prisma.reminder.create({ data: { contactId: id, dueAt: new Date(parsed.data.dueAt), note: parsed.data.note } })
  return NextResponse.json(reminder)
}

const patchSchema = z.object({ reminderId: z.string(), done: z.boolean() })

export async function PATCH(req: Request) {
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'reminderId dan done wajib diisi' }, { status: 400 })
  const reminder = await prisma.reminder.update({ where: { id: parsed.data.reminderId }, data: { done: parsed.data.done } })
  return NextResponse.json(reminder)
}
```

`src/app/api/reminders/due/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const reminders = await prisma.reminder.findMany({
    where: { done: false, dueAt: { lte: endOfToday } },
    include: { contact: true },
    orderBy: { dueAt: 'asc' },
  })

  return NextResponse.json(reminders.map((r) => ({ id: r.id, note: r.note, dueAt: r.dueAt, contactId: r.contact.id, contactName: r.contact.name })))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/contacts/[id]/reminders/route.test.ts src/app/api/reminders/due/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add a reminders section to `ContactPanel`**

Extend `src/components/inbox/ContactPanel.tsx` with a reminder list + a small form (date input + note) wired to `POST /api/contacts/:id/reminders`, each item with a checkbox calling `PATCH`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/contacts src/app/api/reminders src/components/inbox/ContactPanel.tsx
git commit -m "feat: add reminders CRUD and due-today endpoint"
```

---

### Task 38: Pipeline stage — dropdown + filter

**Files:**
- Create: `src/app/api/conversations/[id]/pipeline/route.ts`
- Modify: `src/components/inbox/ContactPanel.tsx`
- Test: `src/app/api/conversations/[id]/pipeline/route.test.ts`

**Interfaces:**
- Produces: `PATCH /api/conversations/:id/pipeline` (body `{ stage: 'new' | 'nego' | 'booked' | 'lunas' }`).

- [ ] **Step 1: Write the failing test**

`src/app/api/conversations/[id]/pipeline/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('PATCH /api/conversations/[id]/pipeline', () => {
  it('updates the pipeline stage', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ pipelineStage: 'nego' } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ stage: 'nego' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect((await res.json()).pipelineStage).toBe('nego')
  })

  it('rejects an unknown stage value', async () => {
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ stage: 'made-up' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/conversations/[id]/pipeline/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

`src/app/api/conversations/[id]/pipeline/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const bodySchema = z.object({ stage: z.enum(['new', 'nego', 'booked', 'lunas']) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Status pipeline tidak dikenali' }, { status: 400 })
  const conversation = await prisma.conversation.update({ where: { id }, data: { pipelineStage: parsed.data.stage } })
  return NextResponse.json(conversation)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/conversations/[id]/pipeline/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a pipeline dropdown to `ContactPanel`**

Extend `src/components/inbox/ContactPanel.tsx` with a `<select>` of the four stages, calling `PATCH` on change.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/conversations/[id]/pipeline src/components/inbox/ContactPanel.tsx
git commit -m "feat: add pipeline stage field and dropdown"
```

---

### Task 39: Kontak (CRM) menu — list + detail pages

**Files:**
- Create: `src/app/api/contacts/route.ts`
- Create: `src/app/contacts/page.tsx`
- Create: `src/app/contacts/[id]/page.tsx`
- Create: `src/components/contacts/ContactTable.tsx`
- Test: `src/app/api/contacts/route.test.ts`

**Interfaces:**
- Produces: `GET /api/contacts` → `Array<{ id: string; name: string | null; phone: string; labels: string[]; lastContactAt: string | null; pipelineStage: string }>`, filterable via `?stage=` and `?labelId=` query params.

- [ ] **Step 1: Write the failing test**

`src/app/api/contacts/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('GET /api/contacts', () => {
  it('lists contacts with their conversation pipeline stage and labels', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([{
      id: 'contact_1', name: 'Bruno', phone: '6281234567890',
      conversation: { pipelineStage: 'nego', lastMessageAt: new Date(), labels: [{ label: { name: 'Confirmed Booking' } }] },
    }] as never)
    const res = await GET(new Request('http://localhost/api/contacts'))
    const body = await res.json()
    expect(body[0]).toEqual(expect.objectContaining({ name: 'Bruno', pipelineStage: 'nego', labels: ['Confirmed Booking'] }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/contacts/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

`src/app/api/contacts/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const stage = url.searchParams.get('stage')

  const contacts = await prisma.contact.findMany({
    include: { conversation: { include: { labels: { include: { label: true } } } } },
  })

  const mapped = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    pipelineStage: c.conversation?.pipelineStage ?? 'new',
    lastContactAt: c.conversation?.lastMessageAt?.toISOString() ?? null,
    labels: c.conversation?.labels.map((l) => l.label.name) ?? [],
  }))

  return NextResponse.json(stage ? mapped.filter((c) => c.pipelineStage === stage) : mapped)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/contacts/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: `ContactTable` component + list page**

`src/components/contacts/ContactTable.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type ContactRow = { id: string; name: string | null; phone: string; pipelineStage: string; lastContactAt: string | null; labels: string[] }

export function ContactTable() {
  const [contacts, setContacts] = useState<ContactRow[]>([])

  useEffect(() => {
    fetch('/api/contacts').then((r) => r.json()).then(setContacts)
  }, [])

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nama</TableHead>
          <TableHead>Nomor</TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Kontak Terakhir</TableHead>
          <TableHead>Pipeline</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow key={c.id}>
            <TableCell><Link href={`/contacts/${c.id}`} className="font-medium text-brand hover:underline">{c.name ?? c.phone}</Link></TableCell>
            <TableCell>{c.phone}</TableCell>
            <TableCell>{c.labels.join(', ')}</TableCell>
            <TableCell>{c.lastContactAt ? new Date(c.lastContactAt).toLocaleDateString('id-ID') : '-'}</TableCell>
            <TableCell>{c.pipelineStage}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

`src/app/contacts/page.tsx`:
```tsx
import { ContactTable } from '@/components/contacts/ContactTable'

export default function ContactsPage() {
  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-navy">Kontak</h1>
      <ContactTable />
    </main>
  )
}
```

- [ ] **Step 6: Contact detail page**

`src/app/contacts/[id]/page.tsx` — a server component fetching the contact's full history: reuse `ContactPanel`'s notes/reminders/labels sub-sections (extract shared list-rendering into small presentational components if `ContactPanel` has grown large by this point — a legitimate file split per this plan's file-structure guidance) plus a read-only list of all past `Conversation.messages` for that contact.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/contacts src/app/contacts src/components/contacts
git commit -m "feat: add Kontak (CRM) list and detail pages"
```

---

### Task 40: Template Pesan — Official Meta templates

**Files:**
- Create: `src/lib/meta/templates.ts`
- Create: `src/app/api/templates/route.ts`
- Create: `src/app/api/templates/[id]/route.ts`
- Create: `src/app/templates/page.tsx`
- Test: `src/lib/meta/templates.test.ts`
- Test: `src/app/api/templates/route.test.ts`

**Interfaces:**
- Consumes: `metaFetch` (Task 7).
- Produces: `submitMetaTemplate(waNumber, template: { name, category, body, variables }): Promise<{ metaId: string; status: string }>` from `templates.ts`. `GET/POST /api/templates` and `GET/PATCH/DELETE /api/templates/:id` operate on the local `Template` table (Task 2's schema), with `POST` also calling `submitMetaTemplate` when `type === 'OFFICIAL'`.

- [ ] **Step 1: Write the failing test for the Meta template submission client**

`src/lib/meta/templates.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitMetaTemplate } from './templates'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

describe('submitMetaTemplate', () => {
  it('posts to the WABA message_templates endpoint', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_1', status: 'PENDING' }) })

    const result = await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'booking_confirmation', category: 'UTILITY', body: 'Booking Anda {{1}} sudah dikonfirmasi.', variables: ['nama'] }
    )

    expect(result).toEqual({ metaId: 'tpl_meta_1', status: 'PENDING' })
    expect(fetch).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/waba_1/message_templates', expect.objectContaining({ method: 'POST' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/meta/templates.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/lib/meta/templates.ts`:
```typescript
import { metaFetch } from './client'

export async function submitMetaTemplate(
  waNumber: { wabaId: string; accessToken: string },
  template: { name: string; category: string; body: string; variables: string[] }
): Promise<{ metaId: string; status: string }> {
  const body = await metaFetch(`/${waNumber.wabaId}/message_templates`, waNumber.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: template.name,
      language: 'id',
      category: template.category,
      components: [{ type: 'BODY', text: template.body }],
    }),
  })
  return { metaId: body.id, status: body.status }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/meta/templates.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing test for the templates route**

`src/app/api/templates/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET, POST } from './route'
import { submitMetaTemplate } from '@/lib/meta/templates'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/meta/templates', () => ({ submitMetaTemplate: vi.fn() }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('templates API', () => {
  it('GET lists all templates', async () => {
    mockPrisma.template.findMany.mockResolvedValue([{ id: 't1', name: 'booking_confirmation', type: 'OFFICIAL', metaStatus: 'PENDING' }] as never)
    const res = await GET()
    expect((await res.json())[0].name).toBe('booking_confirmation')
  })

  it('POST with type OFFICIAL submits to Meta and stores the pending status', async () => {
    mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ wabaId: 'waba_1', accessToken: 'tok' } as never)
    ;(submitMetaTemplate as any).mockResolvedValue({ metaId: 'tpl_meta_1', status: 'PENDING' })
    mockPrisma.template.create.mockResolvedValue({ id: 't2', metaStatus: 'PENDING' } as never)

    const req = new Request('http://localhost/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'booking_confirmation', type: 'OFFICIAL', category: 'UTILITY', body: 'Booking {{1}} dikonfirmasi.', variables: ['nama'] }),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockPrisma.template.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metaStatus: 'PENDING' }) }))
  })

  it('POST with type QUICK_REPLY skips Meta entirely', async () => {
    mockPrisma.template.create.mockResolvedValue({ id: 't3', metaStatus: 'NOT_APPLICABLE' } as never)
    const req = new Request('http://localhost/api/templates', { method: 'POST', body: JSON.stringify({ name: 'harga_paket', type: 'QUICK_REPLY', body: 'Info harga...', category: 'Paket & Harga' }) })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(submitMetaTemplate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/api/templates/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 7: Implement**

`src/app/api/templates/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { submitMetaTemplate } from '@/lib/meta/templates'

export async function GET() {
  return NextResponse.json(await prisma.template.findMany())
}

const bodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['OFFICIAL', 'QUICK_REPLY']),
  category: z.string().optional(),
  body: z.string().min(1),
  variables: z.array(z.string()).optional(),
})

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Data template tidak valid' }, { status: 400 })

  let metaStatus: 'PENDING' | 'NOT_APPLICABLE' = 'NOT_APPLICABLE'
  if (parsed.data.type === 'OFFICIAL') {
    const waNumber = await prisma.waNumber.findFirstOrThrow()
    const result = await submitMetaTemplate(waNumber, {
      name: parsed.data.name,
      category: parsed.data.category ?? 'UTILITY',
      body: parsed.data.body,
      variables: parsed.data.variables ?? [],
    })
    metaStatus = result.status as 'PENDING'
  }

  const template = await prisma.template.create({
    data: { ...parsed.data, variables: parsed.data.variables ?? [], metaStatus },
  })
  return NextResponse.json(template)
}
```

`src/app/api/templates/[id]/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/app/api/templates/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Templates page with two tabs**

`src/app/templates/page.tsx` — client component with `useState<'OFFICIAL' | 'QUICK_REPLY'>('OFFICIAL')` tab state, fetching `GET /api/templates` and filtering by `type`; a form to create a new template (name, category, body, and for `OFFICIAL` a variables list) posting to `POST /api/templates`; each row shows `metaStatus` as a pill for `OFFICIAL` templates only.

- [ ] **Step 10: Commit**

```bash
git add src/lib/meta/templates.ts src/app/api/templates src/app/templates
git commit -m "feat: add official Meta template submission and templates page"
```

---

### Task 41: Quick-reply insertion into the compose box

**Files:**
- Modify: `src/components/inbox/ComposeBox.tsx`
- Test: extend `src/components/inbox/ComposeBox.test.tsx` (create if it does not exist yet)

**Interfaces:**
- Consumes: `GET /api/templates` (Task 40).

- [ ] **Step 1: Write the failing test**

`src/components/inbox/ComposeBox.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ComposeBox } from './ComposeBox'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/templates') return Promise.resolve({ json: async () => [{ id: 'tpl_1', name: 'Cara Booking', type: 'QUICK_REPLY', category: 'Cara Booking', body: 'Ikuti panduan booking di link ini...' }] })
    return Promise.resolve({ ok: true, json: async () => ({ id: 'm1', deliveryStatus: 'SENT' }) })
  }))
})

describe('ComposeBox quick replies', () => {
  it('fills the text input when a quick reply is selected', async () => {
    render(<ComposeBox conversationId="conv_1" botEnabled={false} onSent={() => {}} onBotToggled={() => {}} />)
    fireEvent.click(await screen.findByText('Template'))
    fireEvent.click(await screen.findByText('Cara Booking'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Reply on WhatsApp...')).toHaveValue('Ikuti panduan booking di link ini...')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/inbox/ComposeBox.test.tsx`
Expected: FAIL — no template picker exists yet.

- [ ] **Step 3: Add the template picker**

Modify `src/components/inbox/ComposeBox.tsx` — add state for a template dropdown/popover: a "Template" button that fetches `GET /api/templates` (filtered client-side to `type === 'QUICK_REPLY'`, grouped by `category`) and on selecting one, sets `text` to the template's `body`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/inbox/ComposeBox.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/ComposeBox.tsx src/components/inbox/ComposeBox.test.tsx
git commit -m "feat: add quick-reply template picker to compose box"
```

---

### Task 42: Assign conversation to an agent

**Files:**
- Create: `src/app/api/conversations/[id]/assign/route.ts`
- Modify: `src/components/inbox/ThreadView.tsx`
- Test: `src/app/api/conversations/[id]/assign/route.test.ts`

**Interfaces:**
- Produces: `GET /api/accounts` → `Array<{ id: string; name: string }>` (agent picker source), `PATCH /api/conversations/:id/assign` (body `{ agentId: string | null }`).

- [ ] **Step 1: Write the failing test**

`src/app/api/conversations/[id]/assign/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('PATCH /api/conversations/[id]/assign', () => {
  it('assigns the conversation to an agent', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ assignedAgentId: 'acc_2' } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: 'acc_2' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect((await res.json()).assignedAgentId).toBe('acc_2')
  })

  it('unassigns when agentId is null', async () => {
    mockPrisma.conversation.update.mockResolvedValue({ assignedAgentId: null } as never)
    const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ agentId: null }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conv_1' }) })
    expect((await res.json()).assignedAgentId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/conversations/[id]/assign/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

`src/app/api/conversations/[id]/assign/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const bodySchema = z.object({ agentId: z.string().nullable() })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'agentId wajib diisi (atau null)' }, { status: 400 })
  const conversation = await prisma.conversation.update({ where: { id }, data: { assignedAgentId: parsed.data.agentId } })
  return NextResponse.json(conversation)
}
```

Also create `src/app/api/accounts/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const accounts = await prisma.account.findMany({ select: { id: true, name: true } })
  return NextResponse.json(accounts)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/conversations/[id]/assign/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add an assign dropdown to the thread header**

Modify `src/components/inbox/ThreadView.tsx` — add a header bar above the message list with an agent `<select>` (populated from `GET /api/accounts`, current value from the conversation's `assignedAgentId`) calling `PATCH /api/conversations/:id/assign` on change.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/conversations src/app/api/accounts src/components/inbox/ThreadView.tsx
git commit -m "feat: add conversation assignment to agents"
```

---

### Task 43: Full-text search across messages

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/api/conversations/route.ts`
- Modify: `src/components/inbox/ConversationList.tsx`
- Test: extend `src/app/api/conversations/route.test.ts`

**Interfaces:**
- Produces: `GET /api/conversations?q=<term>` — matches contact name, phone, or any message content in that conversation.

- [ ] **Step 1: Add a search index migration**

Run: `npx prisma migrate dev --name add_message_content_index` after adding to the `Message` model in `prisma/schema.prisma`:
```prisma
  @@index([content])
```
(A basic B-tree index is enough for v1 substring search via Prisma's `contains`; a dedicated Postgres full-text `tsvector` column is a reasonable upgrade later but out of scope here per this plan's "no silent scope creep" — note it explicitly in the PR description instead of quietly expanding this task.)

- [ ] **Step 2: Extend the failing test**

Add to `src/app/api/conversations/route.test.ts`:
```typescript
  it('filters by a search query matching contact name or message content', async () => {
    mockPrisma.conversation.findMany.mockResolvedValue([] as never)
    await GET(new Request('http://localhost/api/conversations?q=ijen'))
    expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ contact: expect.objectContaining({ name: { contains: 'ijen', mode: 'insensitive' } }) }),
          expect.objectContaining({ messages: expect.objectContaining({ some: { content: { contains: 'ijen', mode: 'insensitive' } } }) }),
        ]),
      }),
    }))
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/api/conversations/route.test.ts`
Expected: FAIL — no `q` handling yet.

- [ ] **Step 4: Implement search in the route**

Modify `src/app/api/conversations/route.ts`:
```typescript
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')

  const conversations = await prisma.conversation.findMany({
    where: q
      ? {
          OR: [
            { contact: { name: { contains: q, mode: 'insensitive' } } },
            { contact: { phone: { contains: q } } },
            { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : undefined,
    orderBy: { lastMessageAt: 'desc' },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      labels: { include: { label: true } },
    },
  })
  // ...rest unchanged from Task 10...
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/api/conversations/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire a search input into `ConversationList`**

Modify `src/components/inbox/ConversationList.tsx` — add a search `<input>` above the list, debounced (simple `setTimeout`-based debounce is sufficient), re-fetching `/api/conversations?q=...` on change.

- [ ] **Step 7: Commit**

```bash
git add prisma src/app/api/conversations src/components/inbox/ConversationList.tsx
git commit -m "feat: add full-text search across contact name, phone, and message content"
```

---

### Task 44: Active notification on bot handoff

**Files:**
- Modify: `src/lib/inbound.ts`
- Modify: `src/lib/realtime.ts`
- Create: `src/components/NotificationListener.tsx`
- Modify: `src/app/layout.tsx`
- Test: extend `src/lib/realtime.test.ts`

**Interfaces:**
- Produces: a second `RealtimeEvent` variant `{ type: 'handoff.alert'; conversationId: string; contactName: string | null }`, broadcast whenever `decideAndRespond` returns `mode: 'handoff'` for an inbound message. `NotificationListener` renders nothing visible but plays a sound and shows a browser notification (with permission) on receipt.

- [ ] **Step 1: Extend the failing realtime test**

Add to `src/lib/realtime.test.ts`:
```typescript
  it('delivers a handoff.alert event distinctly from message.created', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    broadcast({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    expect(listener).toHaveBeenCalledWith({ type: 'handoff.alert', conversationId: 'conv_1', contactName: 'Bruno' })
    unsubscribe()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: FAIL — the `RealtimeEvent` union does not include `handoff.alert` yet (TypeScript compile error surfaces as a test failure).

- [ ] **Step 3: Widen the event type**

Modify `src/lib/realtime.ts`:
```typescript
type RealtimeEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  | { type: 'handoff.alert'; conversationId: string; contactName: string | null }
```
(`broadcast`/`subscribe` signatures are unchanged — they already operate on the union type.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/realtime.test.ts`
Expected: PASS (3 tests total).

- [ ] **Step 5: Broadcast on handoff**

Modify `src/lib/inbound.ts`'s bot-wiring block (from Task 30/34) — in the `mode === 'handoff'` branch, after creating the audit `Message` row, add:
```typescript
  broadcast({ type: 'handoff.alert', conversationId: conversation.id, contactName: contact.name })
```

- [ ] **Step 6: `NotificationListener` component**

`src/components/NotificationListener.tsx`:
```tsx
'use client'
import { useEffect } from 'react'

export function NotificationListener() {
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'handoff.alert') {
        new Audio('/notification.mp3').play().catch(() => {})
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Percakapan butuh agen', { body: event.contactName ?? 'Pelanggan baru' })
        }
      }
    }
    return () => es.close()
  }, [])

  return null
}
```

- [ ] **Step 7: Mount it globally**

Modify `src/app/layout.tsx` — render `<NotificationListener />` inside `<body>`, alongside `{children}`. Add a placeholder `public/notification.mp3` file (any short alert sound) — note this asset must be supplied before shipping; leaving it missing degrades gracefully since `.play().catch(() => {})` swallows the error.

- [ ] **Step 8: Commit**

```bash
git add src/lib/realtime.ts src/lib/inbound.ts src/components/NotificationListener.tsx src/app/layout.tsx
git commit -m "feat: add active notification (sound + browser notification) on bot handoff"
```

---

### Task 45: Beranda (dashboard) — full build

**Files:**
- Create: `src/app/api/dashboard/summary/route.ts`
- Create: `src/app/dashboard/page.tsx`
- Test: `src/app/api/dashboard/summary/route.test.ts`

**Interfaces:**
- Produces: `GET /api/dashboard/summary` → `{ unreadCount: number; openCount: number; handoffTodayCount: number; officialTokenValid: boolean; unofficialConnected: boolean; needsAttention: Array<{ id: string; contactName: string | null; reason: string }>; remindersDue: Array<{ id: string; note: string; contactName: string | null }> }`.

- [ ] **Step 1: Write the failing test**

`src/app/api/dashboard/summary/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { GET } from './route'
import { getCoexistStatus } from '@/lib/coexist/client'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/coexist/client', () => ({ getCoexistStatus: vi.fn() }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockPrisma = mockDeep<PrismaClient>()
  mockPrisma.conversation.count.mockResolvedValue(0)
  mockPrisma.message.count.mockResolvedValue(0)
  mockPrisma.conversation.findMany.mockResolvedValue([])
  mockPrisma.reminder.findMany.mockResolvedValue([])
  mockPrisma.waNumber.findFirstOrThrow.mockResolvedValue({ accessToken: 'tok' } as never)
  ;(getCoexistStatus as any).mockResolvedValue({ connected: true })
})

describe('GET /api/dashboard/summary', () => {
  it('returns zeroed counts and empty lists when there is no activity', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual(expect.objectContaining({ unreadCount: 0, openCount: 0, handoffTodayCount: 0, officialTokenValid: true, unofficialConnected: true, needsAttention: [], remindersDue: [] }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/dashboard/summary/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement**

`src/app/api/dashboard/summary/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCoexistStatus } from '@/lib/coexist/client'

export async function GET() {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [openCount, handoffTodayCount, needsAttentionConvos, remindersDueRaw, waNumber] = await Promise.all([
    prisma.conversation.count({ where: { status: 'OPEN' } }),
    prisma.message.count({ where: { sentBy: 'BOT', createdAt: { gte: startOfToday } } }),
    prisma.conversation.findMany({ where: { status: 'OPEN', botEnabled: false }, include: { contact: true }, take: 20 }),
    prisma.reminder.findMany({ where: { done: false, dueAt: { lte: new Date() } }, include: { contact: true }, take: 20 }),
    prisma.waNumber.findFirstOrThrow(),
  ])

  const coexist = await getCoexistStatus(waNumber)

  return NextResponse.json({
    unreadCount: 0,
    openCount,
    handoffTodayCount,
    officialTokenValid: Boolean(waNumber.accessToken),
    unofficialConnected: coexist.connected,
    needsAttention: needsAttentionConvos.map((c) => ({ id: c.id, contactName: c.contact.name, reason: 'Menunggu agen setelah handoff' })),
    remindersDue: remindersDueRaw.map((r) => ({ id: r.id, note: r.note, contactName: r.contact.name })),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/dashboard/summary/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Dashboard page**

`src/app/dashboard/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type Summary = {
  unreadCount: number; openCount: number; handoffTodayCount: number
  officialTokenValid: boolean; unofficialConnected: boolean
  needsAttention: Array<{ id: string; contactName: string | null; reason: string }>
  remindersDue: Array<{ id: string; note: string; contactName: string | null }>
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/summary').then((r) => r.json()).then(setSummary)
  }, [])

  if (!summary) return <div className="p-6 text-muted-foreground">Memuat...</div>

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-xl font-semibold text-navy">Beranda</h1>

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4 text-center"><p className="text-3xl font-semibold text-navy">{summary.openCount}</p><p className="text-xs text-muted-foreground">Percakapan terbuka</p></Card>
        <Card className="p-4 text-center"><p className="text-3xl font-semibold text-navy">{summary.handoffTodayCount}</p><p className="text-xs text-muted-foreground">Di-handoff hari ini</p></Card>
        <Card className="p-4 text-center"><p className="text-3xl font-semibold text-navy">{summary.remindersDue.length}</p><p className="text-xs text-muted-foreground">Reminder jatuh tempo</p></Card>
      </section>

      <section className="flex gap-3">
        <Badge variant={summary.officialTokenValid ? 'success' : 'destructive'}>Official: {summary.officialTokenValid ? 'Valid' : 'Tidak valid'}</Badge>
        <Badge variant={summary.unofficialConnected ? 'success' : 'destructive'}>Unofficial: {summary.unofficialConnected ? 'Tersambung' : 'Terputus'}</Badge>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-navy">Perlu perhatian</h2>
        <ul className="space-y-1">
          {summary.needsAttention.map((n) => (
            <li key={n.id}><Link href={`/inbox?conversation=${n.id}`} className="text-brand hover:underline">{n.contactName ?? n.id}</Link> — {n.reason}</li>
          ))}
          {summary.needsAttention.length === 0 && <li className="text-muted-foreground">Tidak ada yang perlu perhatian saat ini.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-navy">Reminder jatuh tempo</h2>
        <ul className="space-y-1">
          {summary.remindersDue.map((r) => (<li key={r.id}>{r.contactName ?? 'Kontak'}: {r.note}</li>))}
          {summary.remindersDue.length === 0 && <li className="text-muted-foreground">Tidak ada reminder jatuh tempo.</li>}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/dashboard src/app/dashboard
git commit -m "feat: build full Beranda dashboard with summary, status, and attention lists"
```

---

### Task 46: Cutover checklist — repoint chatbot-web, retire old dashboards

**Files:**
- No wa-inbox source changes — this task is an operational checklist executed once Tasks 1–45 are deployed and verified in production.

- [ ] **Step 1: Point chatbot-web's outbound gateway at wa-inbox**

In `/Users/macbook/Code/chatbot-web`, update whatever environment variable `src/whatsappSender.js` uses for its `${baseUrl}/send_message` target to wa-inbox's deployed URL. Verify the request/response shape still matches Task 9's `/api/send` contract (`{ conversationId, text }` in — wa-inbox's route currently expects `conversationId`, not the phone-based `to` chatbot-web's gateway historically posts; **before this step**, add a small compatibility branch to `/api/send` accepting either `{ conversationId, text }` or `{ to, text }`, resolving `to` to a conversation via `prisma.contact.findUnique({ where: { phone: to } })` → its `Conversation`). This compatibility branch is deliberately deferred to this task rather than built speculatively in Task 9, since it only matters once a real external caller (chatbot-web, pre-decommission) needs it.

- [ ] **Step 2: Decommission chatbot-web's own webhook + dashboard**

Once wa-inbox's bot orchestrator (Task 29) has run in production against real traffic for a monitored period, stop chatbot-web's Next.js server / webhook route from receiving traffic (Meta only calls wa-inbox's webhook already, per this plan's Global Constraints, so chatbot-web's webhook route was already unreachable from real customers — this step is about turning off the now-redundant process and dashboard).

- [ ] **Step 3: Decommission waba-jvto**

Turn off its deployment; wa-inbox has fully absorbed its Graph API sending/webhook/template/chat responsibilities since Task 5–9 and Task 40.

- [ ] **Step 4: Decommission wa-dashboard once nothing depends on it**

Confirm no other JVTO service still calls wa-dashboard's `/api/v1/*` gateway (grep sibling repos' env vars for its URL) before turning it off.

- [ ] **Step 5: Update this plan's status**

Mark this plan's header or a `docs/superpowers/plans/` changelog entry as "implemented" once all four decommissions are confirmed, referencing the production deploy date.

---

### Task 47: Pengaturan — working hours, user management, webhook/credential display

**Files:**
- Create: `src/app/api/accounts/route.ts` (extend — add `POST`/`DELETE` alongside Task 42's `GET`)
- Create: `src/app/api/accounts/[id]/route.ts`
- Modify: `src/app/settings/page.tsx`
- Test: `src/app/api/accounts/route.test.ts`
- Test: `src/app/api/accounts/[id]/route.test.ts`

**Interfaces:**
- Produces: `POST /api/accounts` (admin-only, body `{ email, name, password, role }`, creates an `Account`), `DELETE /api/accounts/:id` (admin-only), `PATCH /api/accounts/:id` (admin-only, body `{ password? }` for reset).

- [ ] **Step 1: Write the failing tests**

`src/app/api/accounts/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn().mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN' }) }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('POST /api/accounts', () => {
  it('creates a new agent account when called by an admin', async () => {
    mockPrisma.account.create.mockResolvedValue({ id: 'acc_new', email: 'agen2@jvto.com', name: 'Agen 2', role: 'AGENT' } as never)
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { cookie: 'wa_inbox_session=tok' },
      body: JSON.stringify({ email: 'agen2@jvto.com', name: 'Agen 2', password: 'Rahasia123', role: 'AGENT' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect((await res.json()).email).toBe('agen2@jvto.com')
  })

  it('rejects the request when the caller is not an admin', async () => {
    const { verifySessionToken } = await import('@/lib/auth/session')
    ;(verifySessionToken as any).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT' })
    const req = new Request('http://localhost', { method: 'POST', headers: { cookie: 'wa_inbox_session=tok' }, body: JSON.stringify({ email: 'x@jvto.com', name: 'X', password: 'x', role: 'AGENT' }) })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
```

`src/app/api/accounts/[id]/route.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { DELETE, PATCH } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn().mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN' }) }))
let mockPrisma: DeepMockProxy<PrismaClient>

beforeEach(() => { mockPrisma = mockDeep<PrismaClient>() })

describe('DELETE /api/accounts/[id]', () => {
  it('deletes the account', async () => {
    mockPrisma.account.delete.mockResolvedValue({} as never)
    const req = new Request('http://localhost', { method: 'DELETE', headers: { cookie: 'wa_inbox_session=tok' } })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/accounts/[id]', () => {
  it('resets the password', async () => {
    mockPrisma.account.update.mockResolvedValue({ id: 'acc_2' } as never)
    const req = new Request('http://localhost', { method: 'PATCH', headers: { cookie: 'wa_inbox_session=tok' }, body: JSON.stringify({ password: 'NewPass123' }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'acc_2' }) })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/accounts/route.test.ts src/app/api/accounts/[id]/route.test.ts`
Expected: FAIL — `POST`/`DELETE`/`PATCH` not exported yet.

- [ ] **Step 3: Implement, with an admin-only guard helper**

Add to `src/app/api/accounts/route.ts` (alongside Task 42's existing `GET`):
```typescript
import { verifySessionToken } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'
import { z } from 'zod'

async function requireAdmin(req: Request) {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  return session?.role === 'ADMIN' ? session : null
}

const createSchema = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8), role: z.enum(['ADMIN', 'AGENT']) })

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menambah akun' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Data akun tidak valid' }, { status: 400 })

  const passwordHash = await hashPassword(parsed.data.password)
  const account = await prisma.account.create({ data: { email: parsed.data.email, name: parsed.data.name, role: parsed.data.role, passwordHash } })
  return NextResponse.json({ id: account.id, email: account.email, name: account.name, role: account.role })
}
```
(Add `import { NextResponse } from 'next/server'` and `import { prisma } from '@/lib/db'` if not already present from Task 42.)

`src/app/api/accounts/[id]/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'

async function requireAdmin(req: Request) {
  const token = req.headers.get('cookie')?.match(/wa_inbox_session=([^;]+)/)?.[1]
  const session = token ? await verifySessionToken(decodeURIComponent(token)) : null
  return session?.role === 'ADMIN' ? session : null
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa menghapus akun' }, { status: 403 })
  const { id } = await params
  await prisma.account.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

const patchSchema = z.object({ password: z.string().min(8) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa reset kata sandi' }, { status: 403 })
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Kata sandi minimal 8 karakter' }, { status: 400 })
  const passwordHash = await hashPassword(parsed.data.password)
  await prisma.account.update({ where: { id }, data: { passwordHash } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/accounts/route.test.ts src/app/api/accounts/[id]/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Extend the Settings page with working hours, user management, and a read-only webhook/credentials panel**

Add three sections to `src/app/settings/page.tsx` (all gated on `role === 'ADMIN'` where noted — fetch the current session's role via a small `GET /api/session` route returning `{ role }`, backed by `verifySessionToken` on the request cookie, if one doesn't already exist from an earlier task):

1. **Jam kerja & auto-reply** (any role can view; admin can edit): two `<input type="time">` fields bound to `workingHoursStart`/`workingHoursEnd`, a textarea for `offHoursAutoReply`, all PATCHed through the existing `/api/settings` route from Task 17.
2. **Manajemen pengguna** (admin only): a list of accounts from `GET /api/accounts` (Task 42), each with a "Reset Kata Sandi" button (prompts for a new password, calls `PATCH /api/accounts/:id`) and a "Hapus" button (calls `DELETE /api/accounts/:id`), plus a small form to create a new agent (calls `POST /api/accounts`).
3. **Webhook & kredensial** (admin only, read-only): displays the Meta webhook URL (`{deployedBaseUrl}/api/webhooks/meta`) and the wa-coexist base URL for reference — never renders the actual `accessToken`/`coexistApiKey` values, only whether each is set (`Boolean(...)`), consistent with this plan's "sensitive data, admin-only" requirement from the concept doc.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/accounts src/app/settings/page.tsx
git commit -m "feat: add working hours, admin user management, and read-only webhook panel to Pengaturan"
```

---

**Fase 4 complete — full plan complete.** wa-inbox now covers every menu, every bot mode, both channels, and the full CRM described in `docs/design/wa-inbox-concept.html`, with the legacy apps retired.

## Catatan cakupan (self-review)

Two things intentionally not built as full tasks, disclosed here rather than silently dropped:

- **Riwayat gangguan** (a log of past connection downtime for the number, mentioned as a nice-to-have in the concept doc's original Nomor & Koneksi card) has no dedicated storage or task — Task 17/33 only show *current* status, not history. Add a small `ConnectionEvent` model + a cron/webhook-triggered logger as a follow-up if this is actually needed; it wasn't load-bearing to any other task.
- **Conversation-list filter buttons** (Semua / Belum dibaca / Bot aktif / Butuh manusia / per Label / per Agen) — Task 10 builds the list and Task 43 adds search, but no task explicitly wires the filter *buttons* shown in the concept doc's mockup description to `GET /api/conversations` query params beyond `q`. Extending `resolveChannel`-style query params (`?botEnabled=true`, `?labelId=`, `?assignedAgentId=`) onto the same route from Task 10/43 is straightforward follow-up work, not a new architectural piece.

Everything else in `docs/design/wa-inbox-concept.html` — all five menus, both channels, all three bot modes, the full CRM, and the retirement plan — has a corresponding task above.




