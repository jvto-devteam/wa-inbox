import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ConversationList } from './ConversationList'

const SEARCH_INPUT_PLACEHOLDER = 'Cari nama, nomor, atau isi pesan...'

function jsonResponse(body: unknown) {
  return { json: () => Promise.resolve(body) } as Response
}

// Wraps timer advancement (which flushes the pending setTimeout, its fetch mock, and the
// resulting setConversations state update) in `act` so React doesn't warn about updates
// happening outside of a rendered/asserted batch.
async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([]))))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ConversationList search debounce', () => {
  it('fetches the unfiltered list immediately on mount, with no debounce delay', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)

    // No timer advance at all -- the very first load must not wait out the debounce window.
    await advanceTimers(0)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations')
  })

  it('schedules exactly one fetch after the debounce delay when typing quickly, not one per keystroke', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch
    vi.mocked(fetch).mockClear()

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'i' } }) })
    act(() => { fireEvent.change(input, { target: { value: 'ij' } }) })
    act(() => { fireEvent.change(input, { target: { value: 'ije' } }) })
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })

    // Still inside the debounce window -- nothing should have fired yet, and each keystroke
    // must not have triggered its own immediate fetch alongside the delayed one.
    expect(fetch).not.toHaveBeenCalled()

    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations?q=ijen')
  })

  it('clears the debounce timer on unmount, so no stale fetch fires afterward', async () => {
    const { unmount } = render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch
    vi.mocked(fetch).mockClear()

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })

    unmount()

    await advanceTimers(1000)

    expect(fetch).not.toHaveBeenCalled()
  })

  it('re-fetches the unfiltered list when the search input is cleared', async () => {
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await advanceTimers(0) // flush the initial mount fetch

    const input = screen.getByPlaceholderText(SEARCH_INPUT_PLACEHOLDER)
    act(() => { fireEvent.change(input, { target: { value: 'ijen' } }) })
    await advanceTimers(300)
    vi.mocked(fetch).mockClear()

    act(() => { fireEvent.change(input, { target: { value: '' } }) })
    await advanceTimers(300)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/conversations')
  })
})
