/**
 * Kleine, SICHERE Formel-Auswertung fuer Custom-Regelwerke.
 *
 * Unterstuetzt arithmetische Ausdruecke mit Variablen (Attribut-/Skill-Keys),
 * Klammern, den Operatoren + - * / und einer Handvoll Funktionen
 * (floor, ceil, round, abs, min, max). KEIN eval — eigener Tokenizer +
 * Recursive-Descent-Parser, damit Nutzer-Eingaben gefahrlos ausgewertet werden.
 *
 * Beispiel: evalFormula("10 + floor(KON / 2) * 5", { KON: 12 }) -> 40
 *
 * Unbekannte Variablen werden als 0 behandelt. Bei Syntaxfehlern wird der
 * Fallback (Default 0) zurueckgegeben — eine kaputte Formel soll die App nie
 * crashen lassen.
 */

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'lpar' }
  | { t: 'rpar' }
  | { t: 'comma' }

const FUNCS: Record<string, (args: number[]) => number> = {
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
  round: (a) => Math.round(a[0] ?? 0),
  abs: (a) => Math.abs(a[0] ?? 0),
  min: (a) => (a.length ? Math.min(...a) : 0),
  max: (a) => (a.length ? Math.max(...a) : 0),
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c >= '0' && c <= '9') {
      let j = i + 1
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++
      const num = Number.parseFloat(src.slice(i, j))
      if (!Number.isFinite(num)) throw new Error('bad number')
      tokens.push({ t: 'num', v: num })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++
      tokens.push({ t: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ t: 'lpar' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ t: 'rpar' })
      i++
      continue
    }
    if (c === ',') {
      tokens.push({ t: 'comma' })
      i++
      continue
    }
    throw new Error(`unexpected char: ${c}`)
  }
  return tokens
}

/** Recursive-Descent-Parser/Evaluator. */
function makeEvaluator(tokens: Token[], vars: Record<string, number>) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  const resolveVar = (name: string): number => {
    const v = vars[name]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }

  // expr = term (('+' | '-') term)* — + und - auf gleicher Ebene.
  function parseAddSub(): number {
    let left = parseTerm()
    for (;;) {
      const p = peek()
      if (p && p.t === 'op' && (p.v === '+' || p.v === '-')) {
        next()
        const right = parseTerm()
        left = p.v === '+' ? left + right : left - right
      } else break
    }
    return left
  }

  // term = factor (('*' | '/') factor)*
  function parseTerm(): number {
    let left = parseFactor()
    for (;;) {
      const p = peek()
      if (p && p.t === 'op' && (p.v === '*' || p.v === '/')) {
        next()
        const right = parseFactor()
        left = p.v === '*' ? left * right : right === 0 ? 0 : left / right
      } else break
    }
    return left
  }

  // factor = number | id | id '(' args ')' | '(' expr ')' | '-' factor
  function parseFactor(): number {
    const p = peek()
    if (!p) throw new Error('unexpected end')
    if (p.t === 'op' && p.v === '-') {
      next()
      return -parseFactor()
    }
    if (p.t === 'op' && p.v === '+') {
      next()
      return parseFactor()
    }
    if (p.t === 'num') {
      next()
      return p.v
    }
    if (p.t === 'lpar') {
      next()
      const v = parseAddSub()
      if (peek()?.t !== 'rpar') throw new Error('missing )')
      next()
      return v
    }
    if (p.t === 'id') {
      next()
      // Funktionsaufruf?
      if (peek()?.t === 'lpar') {
        next()
        const args: number[] = []
        if (peek()?.t !== 'rpar') {
          args.push(parseAddSub())
          while (peek()?.t === 'comma') {
            next()
            args.push(parseAddSub())
          }
        }
        if (peek()?.t !== 'rpar') throw new Error('missing )')
        next()
        const fn = FUNCS[p.v]
        if (!fn) throw new Error(`unknown function: ${p.v}`)
        return fn(args)
      }
      return resolveVar(p.v)
    }
    throw new Error('unexpected token')
  }

  return () => {
    const v = parseAddSub()
    if (pos !== tokens.length) throw new Error('trailing tokens')
    return v
  }
}

/**
 * Wertet eine arithmetische Formel mit Variablen-Kontext aus. Gibt bei jedem
 * Fehler (Syntax / leere Formel) den Fallback zurueck.
 */
export function evalFormula(
  formula: string,
  vars: Record<string, number> = {},
  fallback = 0,
): number {
  const src = (formula ?? '').trim()
  if (!src) return fallback
  try {
    const tokens = tokenize(src)
    if (!tokens.length) return fallback
    const result = makeEvaluator(tokens, vars)()
    return Number.isFinite(result) ? result : fallback
  } catch {
    return fallback
  }
}

/** Prueft, ob eine Formel syntaktisch gueltig ist (fuer den Builder-Editor). */
export function isValidFormula(formula: string, sampleVars: Record<string, number> = {}): boolean {
  const src = (formula ?? '').trim()
  if (!src) return true // leer = erlaubt (Fallback greift)
  try {
    const tokens = tokenize(src)
    if (!tokens.length) return true
    makeEvaluator(tokens, sampleVars)()
    return true
  } catch {
    return false
  }
}
