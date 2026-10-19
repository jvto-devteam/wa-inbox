import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SnapshotStatusBadge, snapshotStatusLabel } from './SnapshotStatusBadge'

afterEach(cleanup)

describe('SnapshotStatusBadge', () => {
  it('label potret "Saat itu: ..." untuk tiap status', () => {
    expect(snapshotStatusLabel('perlu_tindakan')).toBe('Saat itu: perlu tindakan')
    expect(snapshotStatusLabel('selesai')).toBe('Saat itu: selesai')
    expect(snapshotStatusLabel('tidak_jelas')).toBe('Saat itu: tidak jelas')
  })

  it('selalu netral: perlu_tindakan tidak merah', () => {
    render(<SnapshotStatusBadge status="perlu_tindakan" />)
    expect(screen.getByText('Saat itu: perlu tindakan').className).not.toMatch(/danger|destructive|red/)
  })
})
