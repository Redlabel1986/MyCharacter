import type { UserRole } from './server/database/schema'

declare module '#auth-utils' {
  interface User {
    id: number
    email: string
    username: string
    role: UserRole
    mustChangePassword: boolean
  }

  interface UserSession {
    user?: User
  }
}

export {}
