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
