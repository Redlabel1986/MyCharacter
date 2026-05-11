import type { UserRole } from './server/database/schema'

declare module '#auth-utils' {
  interface User {
    id: number
    email: string
    username: string
    /**
     * Effektive Rolle für UI/Middleware/Permission-Checks. Stimmt bei
     * normalen Usern mit `actualRole` überein. Bei Admins kann der Admin
     * die Ansicht über `/api/admin/view-as` auf 'player' oder 'dm'
     * umschalten – dann weicht `role` von `actualRole` ab.
     */
    role: UserRole
    /** Echte, in der DB gespeicherte Rolle. Wird nie durch viewAs überschrieben. */
    actualRole: UserRole
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
