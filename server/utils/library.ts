/**
 * PDF-Bibliothek: Storage-Abstraktion ueber Vercel Blob (Production)
 * mit lokalem Filesystem-Fallback fuer Dev-Builds ohne BLOB-Token.
 *
 * Layout in Blob:
 *   pdfs/<filename>.pdf                            -> Originaldateien (vom User hochgeladen)
 *   library-translations/<slug>.de.json            -> Generierte Uebersetzungen
 */
import { promises as fs } from 'node:fs'
import { resolve, join, basename, extname } from 'node:path'
import { put, get, head, list, type ListBlobResultBlob } from '@vercel/blob'

export interface LibraryEntry {
  slug: string
  title: string
  filename: string
  blobUrl: string
  sizeBytes: number
  hasTranslation: boolean
}

export interface TranslationDoc {
  slug: string
  sourceLang: string
  targetLang: 'de'
  generatedAt: string
  pages: Array<{
    page: number
    sourceExcerpt?: string
    text: string
  }>
}

const SOURCE_PREFIX = 'pdfs/'
const TRANSLATIONS_PREFIX = 'library-translations/'

export function toSlug(filename: string): string {
  const base = basename(filename, extname(filename))
  return base
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function toTitle(filename: string): string {
  const base = basename(filename, extname(filename))
  return base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function blobToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN ?? null
}

function localPdfsDir(): string {
  return resolve(process.cwd(), 'pdfs')
}

function localTranslationsDir(): string {
  return resolve(localPdfsDir(), '.translations')
}

function blobTranslationKey(slug: string): string {
  return `${TRANSLATIONS_PREFIX}${slug}.de.json`
}

async function listAll(prefix: string): Promise<ListBlobResultBlob[]> {
  const token = blobToken()
  if (!token) return []
  const out: ListBlobResultBlob[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix, token, cursor })
    out.push(...page.blobs)
    cursor = page.cursor
  } while (cursor)
  return out
}

async function knownTranslationSlugs(): Promise<Set<string>> {
  const token = blobToken()
  if (token) {
    try {
      const blobs = await listAll(TRANSLATIONS_PREFIX)
      const slugs = new Set<string>()
      for (const b of blobs) {
        const m = b.pathname.match(/^library-translations\/(.+)\.de\.json$/)
        if (m && m[1]) slugs.add(m[1])
      }
      return slugs
    } catch (err) {
      console.warn('[library] Translation-Listing fehlgeschlagen:', err)
      return new Set()
    }
  }
  try {
    const files = await fs.readdir(localTranslationsDir())
    return new Set(
      files.filter((f) => f.endsWith('.de.json')).map((f) => f.replace(/\.de\.json$/, '')),
    )
  } catch {
    return new Set()
  }
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const token = blobToken()
  const translations = await knownTranslationSlugs()

  if (token) {
    const blobs = await listAll(SOURCE_PREFIX)
    const entries: LibraryEntry[] = []
    for (const b of blobs) {
      const m = b.pathname.match(/^pdfs\/(.+)$/)
      if (!m || !m[1]) continue
      const filename = m[1]
      if (!filename.toLowerCase().endsWith('.pdf')) continue
      const slug = toSlug(filename)
      entries.push({
        slug,
        title: toTitle(filename),
        filename,
        blobUrl: b.url,
        sizeBytes: b.size,
        hasTranslation: translations.has(slug),
      })
    }
    return entries.sort((a, b) => a.title.localeCompare(b.title, 'de'))
  }

  try {
    const files = await fs.readdir(localPdfsDir())
    const entries: LibraryEntry[] = []
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.pdf')) continue
      const path = join(localPdfsDir(), f)
      try {
        const stat = await fs.stat(path)
        const slug = toSlug(f)
        entries.push({
          slug,
          title: toTitle(f),
          filename: f,
          blobUrl: '',
          sizeBytes: stat.size,
          hasTranslation: translations.has(slug),
        })
      } catch {
        // ignore
      }
    }
    return entries.sort((a, b) => a.title.localeCompare(b.title, 'de'))
  } catch {
    return []
  }
}

export async function findEntry(slug: string): Promise<LibraryEntry | null> {
  const all = await listLibrary()
  return all.find((e) => e.slug === slug) ?? null
}

export interface SourceFetch {
  bytes: Buffer
  contentType: string
  filename: string
}

export async function fetchSource(entry: LibraryEntry): Promise<SourceFetch | null> {
  const token = blobToken()
  if (token && entry.blobUrl) {
    try {
      const got = await get(entry.blobUrl, { access: 'private', token })
      if (!got?.stream) return null
      const buf = Buffer.from(await new Response(got.stream).arrayBuffer())
      return {
        bytes: buf,
        contentType: got.blob.contentType || 'application/pdf',
        filename: entry.filename,
      }
    } catch (err) {
      console.error('[library] Konnte PDF nicht aus Blob laden:', err)
      return null
    }
  }
  try {
    const localPath = join(localPdfsDir(), entry.filename)
    const buf = await fs.readFile(localPath)
    return { bytes: buf, contentType: 'application/pdf', filename: entry.filename }
  } catch {
    return null
  }
}

export async function fetchSourceBytes(entry: LibraryEntry): Promise<Uint8Array | null> {
  const fetched = await fetchSource(entry)
  return fetched ? new Uint8Array(fetched.bytes) : null
}

export async function loadTranslation(slug: string): Promise<TranslationDoc | null> {
  const token = blobToken()
  if (token) {
    try {
      const meta = await head(blobTranslationKey(slug), { token })
      if (!meta?.url) return null
      const got = await get(meta.url, { access: 'private', token })
      if (!got?.stream) return null
      const text = await new Response(got.stream).text()
      return JSON.parse(text) as TranslationDoc
    } catch {
      return null
    }
  }
  try {
    const path = join(localTranslationsDir(), `${slug}.de.json`)
    const buf = await fs.readFile(path, 'utf8')
    return JSON.parse(buf) as TranslationDoc
  } catch {
    return null
  }
}

export async function saveTranslation(doc: TranslationDoc): Promise<void> {
  const token = blobToken()
  const payload = JSON.stringify(doc, null, 2)
  if (token) {
    await put(blobTranslationKey(doc.slug), payload, {
      access: 'private',
      contentType: 'application/json',
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return
  }
  await fs.mkdir(localTranslationsDir(), { recursive: true })
  await fs.writeFile(
    join(localTranslationsDir(), `${doc.slug}.de.json`),
    payload,
    'utf8',
  )
}
