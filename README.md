# myCharacter

Webapp zum Pflegen von Pen-and-Paper-Charakterbögen für **D&D 5e (2014)**, **D&D 2024 (5.5e)**, **DSA 4.1**, **DSA 5** und **How to be a Hero**.

## Stack

- Nuxt 3 (mit `compatibilityVersion: 4`) + Vue 3
- Nuxt UI v3 + Tailwind v4
- Postgres + Drizzle ORM (postgres-js)
- `nuxt-auth-utils` (selbst gehostet, sealed Cookies)
- Google Fonts: Cinzel, IM Fell English, Inter
- Pergament-Theme mit System-spezifischen Akzentfarben, nautische Tinte

## Lokales Setup

```powershell
# 1. Dependencies installieren
npm install

# 2. .env aus .env.example kopieren und füllen
copy .env.example .env
# DATABASE_URL: Connection-String aus Neon (siehe https://neon.tech )
#               oder einem lokalen Postgres (z.B. via Docker / Postgres.app)
# NUXT_SESSION_PASSWORD: 32+ Zeichen kryptographisch zufällig
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Dev-Server starten — Schema wird beim ersten Request idempotent angelegt
npm run dev
```

App läuft unter http://localhost:3000.

### Tipp: Neon-Branch für Dev

Bei Neon kannst du einen separaten Branch für Dev anlegen (`main` für Prod, `dev` für lokal). Beide haben eigene Connection-Strings, das Schema bleibt synchron.

## Deployment auf Vercel

1. **Projekt importieren:** In Vercel "Add New → Project" → Git-Repo wählen. Vercel erkennt Nuxt automatisch.

2. **Datenbank verlinken:**
   - Vercel-Projekt → **Storage** → "Create Database" → **Neon Postgres** wählen.
   - Vercel setzt die Env-Variablen `DATABASE_URL`, `POSTGRES_URL` etc. automatisch im Projekt.

3. **Session-Secret setzen:**
   - Vercel-Projekt → **Settings → Environment Variables**
   - `NUXT_SESSION_PASSWORD` = ein 32+ Zeichen kryptographischer Random-String (z.B. via `openssl rand -hex 32`)

4. **Deployen:** Push auf den Default-Branch löst automatisch ein Deploy aus. Beim ersten Request wird das Schema in der Postgres-DB angelegt.

### Konfiguration

- `vercel.json` setzt Region `fra1` (Frankfurt — EU-DSGVO-freundlich, niedrige Latenz). Anpassen falls gewünscht.
- `runtimeConfig.databaseUrl` liest aus `DATABASE_URL` oder `POSTGRES_URL` — beide werden unterstützt.

## Erste Schritte (in der App)

1. Auf `/register` ein Konto anlegen
2. Über `/characters/new` einen Helden erstellen — Regelwerk wählen, Name vergeben
3. Werte pflegen — Berechnungen (Modifier, Probenwerte, Spell DC etc.) laufen automatisch

## Projektstruktur

```
app/
  app.vue                    # Root, lädt CSS
  app.config.ts              # Nuxt-UI-Theme (primary = sky)
  layouts/default.vue        # Header/Footer + System-Theme-Hook
  middleware/                # auth, guest
  pages/                     # Login, Register, Charakter-Liste, Detail, Wizard
  components/sheets/         # SheetDnd, SheetDsa5, SheetDsa41, SheetHtbah
  components/ui/             # SheetSection, StatBlock
  assets/css/main.css        # Pergament-Theme + Tailwind + Nuxt-UI-Overrides
server/
  api/auth/                  # register, login, logout, me
  api/characters/            # CRUD
  database/schema.ts         # Drizzle-Schema (users, characters)
  utils/db.ts                # postgres-js + Drizzle + Schema-Bootstrap
  utils/password.ts          # scrypt aus node:crypto
shared/
  systems.ts                 # Game-System-Registry
  engines/                   # dnd, dsa5, dsa41, htbah — Berechnungslogik
docs/research/               # Briefings zu jedem Regelwerk
vercel.json                  # Vercel-Deploy-Konfiguration
```

## Datenmodell

- `users(id, email, username, password_hash, created_at, updated_at)`
- `characters(id, user_id, system, name, data jsonb, created_at, updated_at)`
- Index auf `characters.user_id`

`data` ist ein JSONB-Blob, dessen Struktur vom gewählten `system` abhängt. Schema ist in `shared/engines/<system>.ts` als TypeScript-Interface definiert (`createBlankX(name)` liefert ein gültiges Skelett).

## Berechnungen

Pro System eigene Engine in `shared/engines/`:

- **D&D**: `abilityModifier`, `proficiencyBonus`, `skillBonus`, `saveBonus`, `passivePerception`, `initiativeTotal`, `spellSaveDC`, `spellAttackBonus`, `carryingCapacity`, `levelFromXp`
- **DSA 5**: `dsa5Derived` (LeP/AsP/KP/SK/ZK/INI/AW/GS/WS), `dsa5RollProbe` (3W20-Probe mit QS)
- **DSA 4.1**: `dsa41Derived` (LeP/AuP/AsP/KaP/MR/INI/AT/PA/FK/GS), `dsa41RollProbe` (3W20-Probe mit TaP*)
- **HtbaH**: `htbahTalentScore`, `htbahCapForLevel`, `htbahRollProbe` (W100), `htbahDamage`

Alle Berechnungen sind pure Funktionen und ohne Vue-Abhängigkeiten geschrieben — beliebig wiederverwendbar.

## Lizenzhinweise

- D&D-SRD-Inhalte unter [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (Wizards of the Coast). Listen werden NICHT hartkodiert; Nutzer pflegt eigene Werte.
- DSA-Inhalte (Talente, Zauber, Liturgien) sind urheberrechtlich geschützt (Ulisses Spiele) — die App speichert ausschließlich Nutzer-Eingaben, keine offiziellen Listen.
- How to be a Hero © Sebastian Wenzel, frei verfügbar via [howtobeahero.de](https://howtobeahero.de).

Berechnungsformeln und Spielregel-Mechanik sind nicht urheberrechtlich schutzfähig.

## Scripts

| Script | Zweck |
|---|---|
| `npm run dev` | Dev-Server (Hot Reload) |
| `npm run build` | Produktions-Build |
| `npm run preview` | Build lokal testen |
| `npm run db:generate` | Drizzle-Migrations generieren |
| `npm run db:push` | Schema direkt in DB pushen (Dev/Prototyping) |
| `npm run db:migrate` | Migrations anwenden |
| `npm run db:studio` | Drizzle Studio (DB-Browser) |
