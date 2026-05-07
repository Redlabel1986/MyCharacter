import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

// Eigene Implementierung — bewusst andere Namen als die in nuxt-auth-utils,
// damit kein Auto-Import-Konflikt entsteht.
export async function hashUserPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyUserPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':')
  if (!salt || !key) return false
  const keyBuf = Buffer.from(key, 'hex')
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  if (derived.length !== keyBuf.length) return false
  return timingSafeEqual(derived, keyBuf)
}
