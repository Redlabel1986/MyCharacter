import { describe, it, expect } from 'vitest'
import { profilePatchSchema, PROFILE_LIMITS } from '../shared/profile'

describe('profilePatchSchema', () => {
  it('akzeptiert ein vollstaendiges gueltiges Profil', () => {
    const parsed = profilePatchSchema.parse({
      displayName: 'Tarya die Kühne',
      bio: 'Ich spiele seit Jahren HtbaH.',
      favoriteSystem: 'How to be a Hero',
      showCharacters: false,
    })
    expect(parsed.displayName).toBe('Tarya die Kühne')
    expect(parsed.showCharacters).toBe(false)
  })

  it('akzeptiert partielle Updates (nur ein Feld)', () => {
    expect(profilePatchSchema.parse({ bio: 'Hi' })).toEqual({ bio: 'Hi' })
  })

  it('erlaubt leeren/null Anzeigenamen als Reset auf den Benutzernamen', () => {
    expect(profilePatchSchema.parse({ displayName: '' }).displayName).toBe('')
    expect(profilePatchSchema.parse({ displayName: null }).displayName).toBeNull()
  })

  it('trimmt den Anzeigenamen', () => {
    expect(profilePatchSchema.parse({ displayName: '  Tarya  ' }).displayName).toBe('Tarya')
  })

  it('lehnt zu kurze und zu lange Anzeigenamen ab', () => {
    expect(() => profilePatchSchema.parse({ displayName: 'ab' })).toThrow()
    expect(() =>
      profilePatchSchema.parse({ displayName: 'x'.repeat(PROFILE_LIMITS.displayNameMax + 1) }),
    ).toThrow()
    // Grenzwerte sind gueltig
    expect(() =>
      profilePatchSchema.parse({ displayName: 'x'.repeat(PROFILE_LIMITS.displayNameMin) }),
    ).not.toThrow()
    expect(() =>
      profilePatchSchema.parse({ displayName: 'x'.repeat(PROFILE_LIMITS.displayNameMax) }),
    ).not.toThrow()
  })

  it('lehnt zu lange Bio und zu langes Lieblingssystem ab', () => {
    expect(() =>
      profilePatchSchema.parse({ bio: 'x'.repeat(PROFILE_LIMITS.bioMax + 1) }),
    ).toThrow()
    expect(() =>
      profilePatchSchema.parse({ bio: 'x'.repeat(PROFILE_LIMITS.bioMax) }),
    ).not.toThrow()
    expect(() =>
      profilePatchSchema.parse({ favoriteSystem: 'x'.repeat(PROFILE_LIMITS.favoriteSystemMax + 1) }),
    ).toThrow()
  })

  it('lehnt falsche Typen ab', () => {
    expect(() => profilePatchSchema.parse({ showCharacters: 'ja' })).toThrow()
    expect(() => profilePatchSchema.parse({ displayName: 42 })).toThrow()
  })
})
