# Account-Verwaltung: Anzeigename, Selbstprofil, Account-Löschung

**Datum:** 2026-07-05
**Status:** Genehmigt

## Ziel

Benutzer können (1) einen separaten Anzeigenamen führen, (2) ein kleines
öffentliches Selbstprofil pflegen, das andere eingeloggte User ansehen können,
und (3) ihren Account endgültig löschen.

## Kontext / Bestand

- Benutzername (`users.username`) ist zugleich Login-Kennung (Login per E-Mail
  ODER Benutzername) und wird an ~30 Stellen als Anzeigename gezeigt.
- Benutzername-Änderung existiert bereits (`/api/profile/change-username`).
- Migrationen laufen idempotent über `ensureSchema` in `server/utils/db.ts`
  (ALTER TABLE … ADD COLUMN IF NOT EXISTS) plus `server/database/schema.ts`.
- Uploads laufen über Vercel Blob (Muster: Charakter-Portraits).

## Entscheidungen

1. **Anzeigename — Ansatz A („effektiver Name im bestehenden Feld"):**
   Neue nullable Spalte `display_name`. Anzeige-Endpoints liefern
   `COALESCE(display_name, username)` weiterhin im Feld `username` —
   Frontend-Komponenten bleiben unangetastet. Nur Profilseite und
   Admin-Userliste unterscheiden bewusst zwischen Benutzername (Login) und
   Anzeigename. Login weiterhin über E-Mail oder echten Benutzernamen.
2. **Profil-Sichtbarkeit:** alle eingeloggten User.
3. **Löschung:** hart (DB-Cascades), Bestätigung per Passwort. Admins können
   sich nicht selbst löschen. Eigene Gruppen werden mitsamt Karten, Chat und
   Journal gelöscht — der Dialog nennt das explizit.

## Schema (users)

| Spalte | Typ | Default | Zweck |
|---|---|---|---|
| `display_name` | text, nullable | NULL | Anzeigename; NULL = Benutzername gilt |
| `avatar_url` | text, nullable | NULL | Profilbild (Vercel Blob) |
| `bio` | text | `''` | Über-mich-Text, max. 2000 Zeichen |
| `favorite_system` | text | `''` | Lieblingssystem (Freitext) |
| `show_characters` | boolean | `true` | Charakterliste auf dem Profil zeigen |

## Komponenten

### 1. Anzeigename
- Helper `userDisplayName` (SQL-Fragment `COALESCE(display_name, username)`)
  in `server/utils/db.ts` o.ä.
- Umzustellende Anzeige-Endpoints: Gruppen-Messages, Gruppen-Detail
  (Mitglieder), Journal, Shares, DM-Charakterliste, Profil-Access-Listen,
  Pusher-Auth (Presence-Name).
- Session-User erhält `displayName: string | null`; Header/Layouts zeigen
  effektiven Namen.

### 2. Profil bearbeiten
- `PATCH /api/profile` — validiert (zod): displayName (leer = zurücksetzen,
  sonst 3–40 Zeichen), bio ≤ 2000, favoriteSystem ≤ 100, showCharacters bool.
  Schreibt displayName in die Session.
- Avatar-Upload über bestehendes Upload-Muster (Blob); alter Avatar wird
  best-effort gelöscht.
- Neue Karte „Öffentliches Profil" auf `/profile` mit Vorschau-Link.

### 3. Öffentliche Profilseite
- `GET /api/users/:id/profile` (nur eingeloggt): id, Anzeigename, Rolle,
  createdAt, avatarUrl, bio, favoriteSystem; Charakterliste (id, name, system,
  portraitUrl) nur wenn `show_characters`.
- Seite `/users/[id]`: Avatar, Name, Rolle, „dabei seit", Bio, Spiel-Infos,
  Charakter-Kacheln (ohne Links auf Bearbeitung; Detail-Links nur wo ohnehin
  Zugriff besteht → einfachheitshalber keine Links).
- Klickbare Namen → `/users/:id` in: Gruppen-Chat (Sender), Mitgliederliste
  der Gruppen-Seite, Journal-Autoren.

### 4. Account löschen
- `POST /api/profile/delete-account` mit `{ password }`:
  1. Session prüfen, `role/actualRole === 'admin'` → 403.
  2. Passwort verifizieren → sonst 401.
  3. Blob-Cleanup best-effort: Avatar + Portraits eigener Charaktere.
  4. `DELETE FROM users WHERE id = …` (Cascades räumen Charaktere, eigene
     Gruppen, Nachrichten, Access, NPCs, Regelwerke ab).
  5. `clearUserSession`, Client leitet auf `/login?deleted=1`.
- UI: „Gefahrenzone"-Karte unten auf `/profile`; Modal listet Konsequenzen
  auf und verlangt das Passwort.

## Fehlerbehandlung
- Alle Endpoints: zod-Validierung, `requireUserSession`.
- Profil-GET: 404 bei unbekannter User-Id.
- Delete: 401 falsches Passwort, 403 Admin.

## Tests (Vitest)
- delete-account: falsches Passwort → 401, Admin → 403, Erfolg löscht User.
- PATCH /api/profile: Validierungsgrenzen (bio > 2000, displayName 2 Zeichen).
- users/:id/profile: showCharacters=false versteckt Charaktere; 404.
