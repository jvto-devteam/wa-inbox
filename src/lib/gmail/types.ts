/** Bentuk respons Gmail API v1 yang benar-benar dibaca repo ini -- bukan skema lengkapnya. */
export interface GmailHeader {
  name: string
  value: string
}

export interface GmailMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailMessagePart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  /** Epoch milidetik, dalam string. */
  internalDate?: string
  payload?: GmailMessagePart
}

export interface GmailHistoryPage {
  history?: Array<{ messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }> }>
  nextPageToken?: string
  historyId?: string
}
