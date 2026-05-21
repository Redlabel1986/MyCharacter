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
    // Pusher Channels — server-only Secrets. Wenn nicht gesetzt, faellt die
    // Realtime-Schicht stumm auf das langsamere Polling-Fallback zurueck.
    pusherAppId: process.env.PUSHER_APP_ID || '',
    pusherSecret: process.env.PUSHER_SECRET || '',
    public: {
      // Im Browser sichtbar: Pusher-Public-Key + Cluster. Auch hier optional.
      pusherKey: process.env.PUSHER_KEY || process.env.NUXT_PUBLIC_PUSHER_KEY || '',
      pusherCluster:
        process.env.PUSHER_CLUSTER || process.env.NUXT_PUBLIC_PUSHER_CLUSTER || 'eu',
    },
  },

  typescript: {
    strict: true,
  },

  nitro: {
    // Preset wird automatisch erkannt: lokal 'node-server', auf Vercel 'vercel'
    // (durch VERCEL=1 env). Override via NITRO_PRESET-Env möglich.
    experimental: {
      tasks: true,
    },
    vercel: {
      // Vercel-Function-Timeout auf 60 Sekunden — KI-Extraktion via Anthropic
      // kann bei großen PDFs > 10s (Hobby-Default) dauern.
      functions: {
        maxDuration: 60,
      },
    },
  },

  routeRules: {
    '/api/import/**': {
      // Override für KI-Endpoints: bis zu 60s (Vercel Hobby max).
      vercel: { maxDuration: 60 },
    },
  },

  experimental: {
    // Workaround: Vite scheitert beim Auflösen von '#app-manifest' nach
    // Cache-Resets. Wir brauchen das Feature nicht (kein server-side
    // route-rules manifest), also abschalten.
    appManifest: false,
  },
})
