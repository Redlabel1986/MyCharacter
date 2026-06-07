// Schlanker In-Memory-Rate-Limiter (Sliding-Window) pro Schluessel.
//
// Hinweis: Auf serverless (Vercel) ist der Zustand PRO Instanz und ueberlebt
// keinen Cold-Start — das ist als leichter Missbrauchs-/Kostenschutz fuer teure
// Endpunkte (KI-Import) gedacht, NICHT als harte Sicherheitsgrenze. Fuer echte
// globale Limits braeuchte es einen geteilten Store (z.B. Redis/Upstash).

interface Bucket {
  // Zeitstempel (ms) der Treffer im aktuellen Fenster.
  hits: number[]
}

const buckets = new Map<string, Bucket>()

export interface RateLimitOptions {
  // Maximale Anzahl Treffer pro Fenster.
  max: number
  // Fensterlaenge in Millisekunden.
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  // Sekunden bis wieder ein Treffer erlaubt ist (nur gesetzt, wenn !ok).
  retryAfter: number
}

/**
 * Zaehlt einen Treffer fuer `key`. Gibt ok=false zurueck, wenn das Limit im
 * gleitenden Fenster erreicht ist. Alte Buckets werden lazy aufgeraeumt.
 */
export function rateLimit(key: string, opts: RateLimitOptions, now: number): RateLimitResult {
  const cutoff = now - opts.windowMs
  const bucket = buckets.get(key) ?? { hits: [] }
  // Treffer ausserhalb des Fensters verwerfen.
  bucket.hits = bucket.hits.filter((t) => t > cutoff)

  if (bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0]!
    const retryAfter = Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000))
    buckets.set(key, bucket)
    return { ok: false, retryAfter }
  }

  bucket.hits.push(now)
  buckets.set(key, bucket)

  // Gelegentliches Aufraeumen leerer/alter Buckets, damit die Map nicht waechst.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => t <= cutoff)) buckets.delete(k)
    }
  }

  return { ok: true, retryAfter: 0 }
}
