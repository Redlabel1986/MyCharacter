import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Unit-Tests fuer die reinen (Vue-/Nuxt-/DB-freien) Module unter `shared/`
 * und fuer reine Teile unter `app/` (etwa die Wuerfelgeometrie).
 * Bewusst minimal gehalten: Node-Umgebung, nur `test/**` als Test-Quellen,
 * damit der Runner nicht die Nuxt-App mitlaedt.
 *
 * Die Aliase spiegeln die von Nuxt: `~~` ist die Projektwurzel, `~` der
 * app-Ordner. Ohne sie liesse sich kein Modul importieren, das selbst
 * `~~/shared/...` importiert.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('./', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
