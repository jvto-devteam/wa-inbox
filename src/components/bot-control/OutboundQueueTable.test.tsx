import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { OutboundQueueTable, type OutboundJobRow } from './OutboundQueueTable'

afterEach(cleanup)

function job(overrides: Partial<OutboundJobRow> = {}): OutboundJobRow {
  return {
    id: 'job_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    contactName: 'Budi',
    contactPhone: '6281234567890',
    channel: 'UNOFFICIAL',
    provider: 'COEXIST',
    status: 'FAILED',
    attempts: 4,
    maxAttempts: 4,
    nextAttemptAt: null,
    lastError: 'wa-coexist timeout',
    createdAt: '2026-09-07T02:00:00.000Z',
    updatedAt: '2026-09-07T02:10:00.000Z',
    ...overrides,
  }
}

describe('OutboundQueueTable', () => {
  it('shows the failure reason in full, not behind a badge', () => {
    // It is the entire reason somebody opens this page during an incident: "wa-coexist timeout"
    // and a provider mismatch call for completely different responses.
    render(<OutboundQueueTable jobs={[job()]} />)
    expect(screen.getByText('wa-coexist timeout')).toBeInTheDocument()
  })

  it('says so when the contact is gone rather than leaving a blank cell', () => {
    render(<OutboundQueueTable jobs={[job({ contactName: null, contactPhone: null })]} />)
    expect(screen.getByText('(kontak terhapus)')).toBeInTheDocument()
  })

  it('renders an empty queue as empty, not as a blank table', () => {
    render(<OutboundQueueTable jobs={[]} />)
    expect(screen.getByText(/Tidak ada job yang cocok/)).toBeInTheDocument()
  })

  it('offers no controls at all without a handler', () => {
    render(<OutboundQueueTable jobs={[job()]} canRetry canCancel />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers Retry only on a job that has actually stopped', () => {
    // A button that always 409s teaches an operator to stop trusting the page.
    const onAction = vi.fn()
    const { rerender } = render(<OutboundQueueTable jobs={[job({ status: 'QUEUED' })]} canRetry onAction={onAction} />)
    expect(screen.queryByRole('button', { name: 'Kirim ulang' })).not.toBeInTheDocument()

    rerender(<OutboundQueueTable jobs={[job({ status: 'FAILED' })]} canRetry onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }))
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'job_1' }), 'retry')
  })

  it('offers Cancel only on a job that has not gone yet', () => {
    const onAction = vi.fn()
    const { rerender } = render(<OutboundQueueTable jobs={[job({ status: 'SENT' })]} canCancel onAction={onAction} />)
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument()

    rerender(<OutboundQueueTable jobs={[job({ status: 'RETRYING' })]} canCancel onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan' }))
    expect(onAction).toHaveBeenCalledWith(expect.anything(), 'cancel')
  })

  it('never offers Retry on a job with no message to resend', () => {
    render(<OutboundQueueTable jobs={[job({ messageId: null })]} canRetry onAction={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Kirim ulang' })).not.toBeInTheDocument()
  })

  it('hides Cancel from someone who may only retry', () => {
    render(<OutboundQueueTable jobs={[job({ status: 'QUEUED' })]} canRetry onAction={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Batalkan' })).not.toBeInTheDocument()
  })

  it('shows when a retrying job will next be attempted', () => {
    render(<OutboundQueueTable jobs={[job({ status: 'RETRYING', nextAttemptAt: '2026-09-07T02:30:00.000Z' })]} />)
    expect(screen.getByText(/Coba lagi/)).toBeInTheDocument()
  })

  it('disables both controls while that job is busy', () => {
    render(<OutboundQueueTable jobs={[job({ status: 'RETRYING' })]} canRetry canCancel busyId="job_1" onAction={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Batalkan' })).toBeDisabled()
  })

  it('shows the provider alongside the channel', () => {
    render(<OutboundQueueTable jobs={[job()]} />)
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('COEXIST')).toBeInTheDocument()
  })
})
