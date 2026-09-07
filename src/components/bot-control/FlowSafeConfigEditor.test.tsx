import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FlowSafeConfigEditor } from './FlowSafeConfigEditor'
import { SAFE_CONFIG_FIELDS, type SafeConfigField } from '@/lib/bot-control/flow-config'

afterEach(cleanup)

const REASON = 'Kalimat fallback lama terdengar menyalahkan customer'

function renderEditor(props: Partial<Parameters<typeof FlowSafeConfigEditor>[0]> = {}) {
  const onSave = vi.fn()
  render(
    <FlowSafeConfigEditor
      flowName="WhatsApp Existing Bot"
      fields={SAFE_CONFIG_FIELDS}
      initial={{}}
      saving={false}
      error={null}
      onCancel={vi.fn()}
      onSave={onSave}
      {...props}
    />
  )
  return { onSave }
}

describe('FlowSafeConfigEditor', () => {
  it('says branching stays read-only', () => {
    renderEditor()
    expect(screen.getByText(/Percabangan flow tetap read-only/)).toBeInTheDocument()
  })

  it('explains what an empty box means', () => {
    // Without saying so, reverting a bad edit means retyping the original sentence from memory.
    renderEditor()
    expect(screen.getByText(/Kosongkan sebuah kolom untuk kembali memakai kalimat bawaan/)).toBeInTheDocument()
  })

  it('renders only the fields the server permitted', () => {
    // A field the runtime will not honour must not appear: an operator who fills in a box that
    // does nothing believes they changed the bot.
    renderEditor({ fields: ['fallbackReply'] as SafeConfigField[] })
    expect(screen.getByLabelText('Balasan saat bot tidak tahu')).toBeInTheDocument()
    expect(screen.queryByLabelText('Maksimal minta penjelasan')).not.toBeInTheDocument()
  })

  it('offers nothing to save when the level permits no fields', () => {
    renderEditor({ fields: [] })
    expect(screen.getByText(/tidak punya konfigurasi yang bisa diubah/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simpan draft' })).toBeDisabled()
  })

  it('will not save without a substantive reason', () => {
    const { onSave } = renderEditor()
    fireEvent.change(screen.getByLabelText('Balasan saat bot tidak tahu'), { target: { value: 'Saya cek dulu.' } })
    expect(screen.getByRole('button', { name: 'Simpan draft' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))
    expect(onSave).toHaveBeenCalledWith({ fallbackReply: 'Saya cek dulu.' }, REASON)
  })

  it('strips empty boxes rather than storing an override that says nothing', () => {
    const { onSave } = renderEditor({ initial: { fallbackReply: 'Lama', greetingText: '' } })
    fireEvent.change(screen.getByLabelText('Balasan saat bot tidak tahu'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0]).toEqual({})
  })

  it('clears the attempt threshold rather than sending zero', () => {
    // Zero means "never clarify" — a behaviour change dressed as a typo, and rejected by the
    // schema anyway.
    const { onSave } = renderEditor({ initial: { maxClarificationAttempts: 3 } })
    fireEvent.change(screen.getByLabelText('Maksimal minta penjelasan'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0]).not.toHaveProperty('maxClarificationAttempts')
  })

  it('keeps a numeric threshold as a number, not a string', () => {
    const { onSave } = renderEditor()
    fireEvent.change(screen.getByLabelText('Maksimal minta penjelasan'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0].maxClarificationAttempts).toBe(2)
  })

  it('parses comma-separated lead fields into a list', () => {
    const { onSave } = renderEditor()
    fireEvent.change(screen.getByLabelText('Data yang wajib ditanyakan'), { target: { value: 'nama, tanggal ,  ' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0].leadFields).toEqual(['nama', 'tanggal'])
  })

  it('seeds from the values it was given', () => {
    renderEditor({ initial: { fallbackReply: 'Kalimat sekarang' } })
    expect(screen.getByLabelText('Balasan saat bot tidak tahu')).toHaveValue('Kalimat sekarang')
  })

  it('surfaces a server error instead of failing silently', () => {
    renderEditor({ error: 'Level TEXT_ONLY tidak boleh mengubah: maxClarificationAttempts.' })
    expect(screen.getByText(/TEXT_ONLY tidak boleh mengubah/)).toBeInTheDocument()
  })
})
