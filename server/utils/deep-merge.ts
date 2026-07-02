/**
 * Tiefer Merge von Plain-Objects: `source` gewinnt, Objekte werden rekursiv
 * gemerged, Arrays/Primitives ersetzt, `undefined` in source wird ignoriert.
 * Genutzt, um KI-Antworten robust mit den Blank-Schemas zu vervollstaendigen.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target }
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}
