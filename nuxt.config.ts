// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-05-01',
  devtools: { enabled: true },

  // Aktiviert die Nuxt-4-Defaults: srcDir = 'app/', shared/, etc.
  future: {
    compatibilityVersion: 4,
  },

  modules: [
    '@nuxt/ui',
    'nuxt-auth-utils',
    '@nuxtjs/google-fonts',
  ],

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
    fallback: 'light',
    classSuffix: '',
  },

  googleFonts: {
    families: {
      Cinzel: [400, 600, 700],
      'IM Fell English': [400],
      'IM Fell English SC': [400],
      Inter: [400, 500, 600, 700],
    },
    display: 'swap',
    download: true,
    inject: true,
  },

  ui: {
    // Nuxt UI v3 config — uses Tailwind v4 under the hood
  },

  runtimeConfig: {
    sessionPassword: process.env.NUXT_SESSION_PASSWORD,
    databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
    public: {},
  },

  typescript: {
    strict: true,
  },

  nitro: {
    preset: process.env.NITRO_PRESET || 'node-server',
    experimental: {
      tasks: true,
    },
  },

  experimental: {
    // Workaround: Vite scheitert beim Auflösen von '#app-manifest' nach
    // Cache-Resets. Wir brauchen das Feature nicht (kein server-side
    // route-rules manifest), also abschalten.
    appManifest: false,
  },
})
