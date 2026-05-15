import { DEFAULT_THEME, isThemeId, type ThemeId } from '~~/shared/themes'

/**
 * Theme-Status fuer paperheros. Wird in einem Cookie persistiert, damit SSR
 * und CSR ohne Flicker rendern. Anwendung als data-theme-Attribut auf <html>
 * (siehe app.vue).
 */
export function useTheme() {
  const themeCookie = useCookie<ThemeId>('phx-theme', {
    default: () => DEFAULT_THEME,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  })

  const theme = computed<ThemeId>({
    get: () => (isThemeId(themeCookie.value) ? themeCookie.value : DEFAULT_THEME),
    set: (v) => {
      themeCookie.value = isThemeId(v) ? v : DEFAULT_THEME
    },
  })

  return { theme }
}
