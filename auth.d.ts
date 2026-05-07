import type { UserRole } from './server/database/schema'

declare module '#auth-utils' {
  interface User {
    id: number
    email: string
    username: string
    role: UserRole
  }

  interface UserSession {
    user?: User
  }
}

export {}
