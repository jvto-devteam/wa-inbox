/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { authenticateApiClient, bearerApiKey, generateApiKey, hashApiKey } from './auth'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const request = (authorization?: string) =>
  new Request('http://x/api/v1/system-messages', { headers: authorization ? { authorization } : {} })

beforeEach(() => {
  mockReset(mockPrisma)
  mockPrisma.apiClient.update.mockResolvedValue({} as never)
})

describe('generateApiKey', () => {
  it('returns a prefixed key, its hash, and a short prefix — never the key twice', () => {
    const { key, keyHash, keyPrefix } = generateApiKey()
    expect(key.startsWith('wai_')).toBe(true)
    expect(key.length).toBeGreaterThan(40)
    expect(keyHash).toBe(hashApiKey(key))
    expect(keyHash).not.toContain(key)
    expect(key.startsWith(keyPrefix)).toBe(true)
    expect(keyPrefix.length).toBeLessThan(key.length / 2)
  })

  it('never repeats', () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key)
  })
})

describe('bearerApiKey', () => {
  it('reads a Bearer token shaped like our keys', () => {
    expect(bearerApiKey(request('Bearer wai_abc'))).toBe('wai_abc')
  })

  it('ignores a missing header, another scheme, or a foreign token', () => {
    expect(bearerApiKey(request())).toBeNull()
    expect(bearerApiKey(request('Basic wai_abc'))).toBeNull()
    expect(bearerApiKey(request('Bearer something-else'))).toBeNull()
  })
})

describe('authenticateApiClient', () => {
  it('finds the client by the hash of the presented key', async () => {
    mockPrisma.apiClient.findUnique.mockResolvedValue({ id: 'c1', name: 'jvto', revokedAt: null } as never)

    expect(await authenticateApiClient(request('Bearer wai_secret'))).toEqual({ id: 'c1', name: 'jvto' })
    expect(mockPrisma.apiClient.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash: hashApiKey('wai_secret') } })
    )
  })

  it('rejects a revoked key', async () => {
    mockPrisma.apiClient.findUnique.mockResolvedValue({ id: 'c1', name: 'jvto', revokedAt: new Date() } as never)
    expect(await authenticateApiClient(request('Bearer wai_secret'))).toBeNull()
  })

  it('rejects an unknown key, and never queries without one', async () => {
    mockPrisma.apiClient.findUnique.mockResolvedValue(null)
    expect(await authenticateApiClient(request('Bearer wai_nope'))).toBeNull()

    mockPrisma.apiClient.findUnique.mockClear()
    expect(await authenticateApiClient(request())).toBeNull()
    expect(mockPrisma.apiClient.findUnique).not.toHaveBeenCalled()
  })
})
