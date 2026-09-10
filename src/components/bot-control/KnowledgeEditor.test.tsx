import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KnowledgeEditor, type KnowledgeDraft } from './KnowledgeEditor'

afterEach(cleanup)

const REASON = 'Menutup knowledge gap harga ATV'

function draft(overrides: Partial<KnowledgeDraft> = {}): KnowledgeDraft {
  return {
    title: 'FAQ Harga ATV',
    summary: '',
    items: [{ question: 'Berapa harga ATV?', answer: 'Mengikuti paket di katalog aktif.' }],
    ...overrides,
  }
}

function renderEditor(props: Partial<Parameters<typeof KnowledgeEditor>[0]> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <KnowledgeEditor
      initial={draft()}
      title="FAQ Harga ATV"
      saving={false}
      error={null}
      onCancel={onCancel}
      onSave={onSave}
      {...props}
    />
  )
  return { onSave, onCancel }
}

describe('KnowledgeEditor', () => {
  it('says plainly that a draft does not reach the bot', () => {
    // A draft that looks applied is the failure mode of this whole workflow: an operator who
    // thinks they fixed an answer walks away.
    renderEditor()
    expect(screen.getByText(/bot belum membacanya/i)).toBeInTheDocument()
  })

  it('offers exactly two ways forward: save it, or save it and turn it on', () => {
    // The six-state workflow this replaces put three more buttons between writing a fact and
    // the bot using it, and knowledge routinely stopped at the first of them.
    renderEditor()

    expect(screen.getByRole('button', { name: 'Simpan draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simpan & aktifkan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('flags the activate button as activating, and the draft button as not', () => {
    const { onSave } = renderEditor()
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })

    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))
    expect(onSave).toHaveBeenLastCalledWith(expect.anything(), REASON, false)

    fireEvent.click(screen.getByRole('button', { name: 'Simpan & aktifkan' }))
    expect(onSave).toHaveBeenLastCalledWith(expect.anything(), REASON, true)
  })

  it('opens with one empty item rather than no fields at all', () => {
    renderEditor({ initial: draft({ items: [] }) })
    expect(screen.getByLabelText('Pertanyaan item 1')).toBeInTheDocument()
  })

  it('will not save without a substantive reason', () => {
    const { onSave } = renderEditor()
    const save = screen.getByRole('button', { name: 'Simpan draft' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: 'pendek' } })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'FAQ Harga ATV' }), REASON, false)
  })

  it('will not save an item missing its answer', () => {
    // The bot reads this; a missing answer is a customer being told `undefined`.
    renderEditor({ initial: draft({ items: [{ question: 'Halo?', answer: '' }] }) })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    expect(screen.getByRole('button', { name: 'Simpan draft' })).toBeDisabled()
  })

  it('adds and removes items, never dropping below one', () => {
    renderEditor()
    // One item: no remove button, because an empty body is rejected by the API anyway.
    expect(screen.queryByRole('button', { name: 'Hapus item' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tambah item' }))
    expect(screen.getByLabelText('Pertanyaan item 2')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Hapus item' })[1])
    expect(screen.queryByLabelText('Pertanyaan item 2')).not.toBeInTheDocument()
  })

  it('collects prices as structured fields, currency included', () => {
    // `bot.no_invented_price` is CRITICAL: the bot may only state a price it can SOURCE, and a
    // figure buried in prose is indistinguishable from one the model made up.
    const { onSave } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Tambah harga' }))

    fireEvent.change(screen.getByLabelText('Label harga 1 item 1'), { target: { value: 'ATV 1 jam' } })
    fireEvent.change(screen.getByLabelText('Nominal harga 1 item 1'), { target: { value: '350000' } })
    fireEvent.change(screen.getByLabelText('Mata uang harga 1 item 1'), { target: { value: 'IDR' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0].items[0].prices).toEqual([
      { label: 'ATV 1 jam', amount: 350000, currency: 'IDR' },
    ])
  })

  it('collects links as structured fields too', () => {
    const { onSave } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Tambah tautan' }))

    fireEvent.change(screen.getByLabelText('Label tautan 1 item 1'), { target: { value: 'Detail' } })
    fireEvent.change(screen.getByLabelText('URL tautan 1 item 1'), { target: { value: 'https://example.com' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0].items[0].links).toEqual([{ label: 'Detail', url: 'https://example.com' }])
  })

  it('parses comma-separated tags into a list', () => {
    const { onSave } = renderEditor()
    fireEvent.change(screen.getByLabelText('Tag item 1'), { target: { value: 'atv, harga ,  ' } })
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0].items[0].tags).toEqual(['atv', 'harga'])
  })

  it('surfaces a server error instead of failing silently', () => {
    renderEditor({ error: 'Isi knowledge tidak valid pada: answer.' })
    expect(screen.getByText(/Isi knowledge tidak valid/)).toBeInTheDocument()
  })

  it('menampilkan 14 pilihan topik', () => {
    renderEditor()
    expect(screen.getAllByRole('checkbox', { name: /topik/i })).toHaveLength(14)
  })

  it('mengirim topik terpilih saat disimpan', () => {
    const { onSave } = renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: /topik payment/i }))
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ topics: ['payment'] })] }),
      REASON,
      false
    )
  })

  it('menampilkan topik yang sudah tersimpan sebagai terpilih', () => {
    renderEditor({
      initial: draft({ items: [{ question: 'Q', answer: 'A', topics: ['booking'] }] }),
    })
    expect(screen.getByRole('checkbox', { name: /topik booking/i })).toBeChecked()
  })

  it('melepas semua centang topik mengirim topics: undefined, seperti pola prices/links', () => {
    const { onSave } = renderEditor({
      initial: draft({ items: [{ question: 'Q', answer: 'A', topics: ['booking'] }] }),
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /topik booking/i }))
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft' }))

    expect(onSave.mock.calls[0][0].items[0].topics).toBeUndefined()
  })

  it('label topik yang tampil adalah id topik apa adanya', () => {
    renderEditor()
    expect(screen.getByRole('checkbox', { name: 'Topik payment item 1' })).toBeInTheDocument()
  })

  // Ruling R88: mengosongkan semua centang topik mengirim `topics: undefined`, lalu
  // classifyFactTopics (Task 8) mengisinya lagi saat disimpan -- operator perlu diberi tahu
  // kotak kosong bukan "topik permanen kosong".
  it('menjelaskan bahwa topik kosong diisi otomatis saat disimpan', () => {
    renderEditor()
    expect(screen.getByText('Kosongkan semua = topik diisi otomatis saat disimpan.')).toBeInTheDocument()
  })
})
