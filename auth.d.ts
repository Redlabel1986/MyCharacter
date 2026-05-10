import type { UserRole } from './server/database/schema'

declare module '#auth-utils' {
  interface User {
    id: number
    email: string
    username: string
    role: UserRole
    mustChangePassword: boolean
    canBeDm: boolean
  }

  interface UserSession {
    user?: User
    /** True, sobald der Bibliotheks-Code in dieser Session korrekt eingegeben wurde. */
    libraryUnlocked?: boolean
  }
}

export {}
