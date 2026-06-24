import { defineConfig } from 'vitest/config'

/**
 * Unit-Tests fuer die reinen (Vue-/Nuxt-/DB-freien) Module unter `shared/`.
 * Bewusst minimal gehalten: Node-Umgebung, nur `test/**` als Test-Quellen,
 * damit der Runner nicht die Nuxt-App mitlaedt.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
