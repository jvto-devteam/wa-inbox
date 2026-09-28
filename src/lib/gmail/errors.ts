/**
 * Kesalahan dari Gmail API atau endpoint token Google, dengan KATEGORI tetap.
 *
 * `message` dibentuk dari status HTTP dan kode status Google saja, tidak pernah dari body
 * mentah dan tidak pernah dari token: pesannya berakhir di log server, dan `kind`-nya
 * berakhir di MailAccount.lastSyncError yang tampil di UI (CLAUDE.md §5).
 */
export type GmailErrorKind = 'AUTH_REVOKED' | 'UNAUTHORIZED' | 'HISTORY_EXPIRED' | 'NOT_FOUND' | 'HTTP' | 'CONFIG'

export class GmailError extends Error {
  constructor(
    readonly kind: GmailErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'GmailError'
  }
}
