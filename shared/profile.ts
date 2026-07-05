/**
 * Validierung fuer das oeffentliche Selbstprofil (PATCH /api/profile).
 * Liegt in shared/, damit die reinen Regeln ohne Nuxt/DB unit-testbar sind
 * (siehe test/profile.test.ts) und das Frontend dieselben Grenzen kennt.
 */
import { z } from 'zod'

export const PROFILE_LIMITS = {
  displayNameMin: 3,
  displayNameMax: 40,
  bioMax: 2000,
  favoriteSystemMax: 100,
} as const

export const profilePatchSchema = z.object({
  /**
   * '' oder null setzt den Anzeigenamen zurueck (der Benutzername gilt wieder),
   * sonst 3–40 Zeichen.
   */
  displayName: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .min(PROFILE_LIMITS.displayNameMin, 'Anzeigename mind. 3 Zeichen.')
        .max(PROFILE_LIMITS.displayNameMax, 'Anzeigename max. 40 Zeichen.'),
    ])
    .nullish(),
  bio: z.string().max(PROFILE_LIMITS.bioMax, 'Über-mich-Text max. 2000 Zeichen.').optional(),
  favoriteSystem: z
    .string()
    .trim()
    .max(PROFILE_LIMITS.favoriteSystemMax, 'Lieblingssystem max. 100 Zeichen.')
    .optional(),
  showCharacters: z.boolean().optional(),
})

export type ProfilePatch = z.infer<typeof profilePatchSchema>
