import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { viewFromPath } from './store'
import { AgentView } from './views/AgentView'
import { AntreanView } from './views/AntreanView'
import { BotView } from './views/BotView'
import { HubView } from './views/HubView'
import { InboxView } from './views/InboxView'
import { KontakView } from './views/KontakView'
import { RingkasanView } from './views/RingkasanView'

let path = '/new/dashboard'
const push = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => ({ push }) }))

beforeEach(() => {
  push.mockClear()
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

function at(p: string, el: React.ReactNode) {
  path = p
  return render(<NewShell>{el}</NewShell>)
}

describe('/new', () => {
  it('memetakan URL ke tampilan', () => {
    expect(viewFromPath('/new/dashboard')).toBe('hub')
    expect(viewFromPath('/new/agent')).toBe('agent')
    expect(viewFromPath('/new')).toBe('hub')
  })

  it.each([
    ['/new/dashboard', <HubView key="h" />, 'Perlu perhatian'],
    ['/new/inbox', <InboxView key="i" />, 'Tulis balasan…'],
    ['/new/antrean', <AntreanView key="a" />, 'Janji Admin'],
    ['/new/ringkasan', <RingkasanView key="r" />, 'Per percakapan'],
    ['/new/agent', <AgentView key="g" />, 'Semua status'],
    ['/new/kontak', <KontakView key="k" />, 'Vendor Transport Bali'],
    ['/new/bot', <BotView key="b" />, 'Mode bot'],
  ])('%s tergambar dengan data contoh', (p, el, text) => {
    at(p, el)
    expect(document.body.textContent + Array.from(document.querySelectorAll('textarea')).map((t) => t.placeholder).join(' ')).toContain(text)
    expect(screen.getByText('Data contoh')).toBeInTheDocument()
  })

  it('menu sidebar berpindah lewat router, bukan hash', () => {
    at('/new/dashboard', <HubView />)
    fireEvent.click(screen.getByTitle('Kontak'))
    expect(push).toHaveBeenCalledWith('/new/kontak')
  })

  it('Kirim di Inbox menambah pesan admin dan membuang draf', () => {
    at('/new/inbox', <InboxView />)
    fireEvent.click(screen.getByText('Lukas B.', { selector: '.row b *, .row b' }).closest('button')!)
    const ta = screen.getByLabelText('Tulis balasan') as HTMLTextAreaElement
    expect(ta.value).toContain('Hello Lukas')
    fireEvent.click(screen.getByText('Kirim'))
    expect(document.querySelectorAll('#i-chat .m.a')).toHaveLength(1)
    expect(screen.queryByText(/Draf dari/)).toBeNull()
  })
})
