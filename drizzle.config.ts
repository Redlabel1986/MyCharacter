import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || ''

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
})
