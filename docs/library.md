# Bibliothek (PDFs + Uebersetzungen)

Geschuetzter Bereich `/bibliothek` mit PDFs fuer eingeloggte Mitglieder.
Originale liegen in **Vercel Blob (privat)** unter dem Prefix `pdfs/`,
maschinelle deutsche Uebersetzungen unter `library-translations/`.

## Datenfluss

```
Vercel Blob
├── pdfs/<filename>.pdf                        (vom User hochgeladen)
└── library-translations/<slug>.de.json        (vom Uebersetzer geschrieben)

Server
├── /api/library                  -> Liste, scant pdfs/-Prefix
├── /api/library/:slug/file       -> PDF-Stream (Auth)
└── /api/library/:slug/translation -> JSON der dt. Uebersetzung (Auth)

Frontend
├── /bibliothek                   -> Listenansicht
└── /bibliothek/:slug             -> PDF-Viewer + dt. Panel
```

`slug` wird automatisch aus dem Dateinamen abgeleitet
(`Book_of_Blades_Expanding_the_Ranger_for_5th_Edition.pdf`
-> `book-of-blades-expanding-the-ranger-for-5th-edition`).

## PDFs hinzufuegen

Im Vercel-Dashboard -> Storage -> dein Blob-Store -> **Upload** in den
Ordner `pdfs/`. Wichtig: **Access = private** waehlen. Beim naechsten
Reload von `/bibliothek` taucht das Buch auf (kein Manifest, kein Deploy).

## Env-Variablen

```
ANTHROPIC_API_KEY=sk-ant-...        (fuer Uebersetzungs-Lauf + PDF-Import)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...  (fuer Library-Zugriff)
```

Der `BLOB_READ_WRITE_TOKEN` steht im Vercel-Dashboard unter
*Storage -> dein Store -> .env.local* (Copy Snippet).

In Production setzt Vercel den Token automatisch, sobald der Blob-Store
mit dem Projekt verbunden ist. Pruefen: *Project -> Settings ->
Environment Variables*.

## Uebersetzungen erzeugen

Der Uebersetzer laeuft lokal (braucht keine DB), liest die PDFs aus
Blob, ruft Claude und schreibt die JSON-Uebersetzung zurueck nach Blob.
Damit ist die Uebersetzung sofort online verfuegbar — kein Re-Deploy.

Voraussetzung lokal: `.env` enthaelt `ANTHROPIC_API_KEY` und
`BLOB_READ_WRITE_TOKEN`.

```bash
# Test mit einem kleinen PDF, 2 Seiten
node --env-file=.env scripts/run-translate.mjs warlock-zine-elves 2

# Komplettes PDF
node --env-file=.env scripts/run-translate.mjs warlock-zine-elves

# Alle PDFs uebersetzen (dauert Stunden, Default-Modell claude-haiku-4-5)
node --env-file=.env scripts/run-translate.mjs

# Mit anderem Modell (z.B. fuer Sonnet-Qualitaet)
node --env-file=.env scripts/run-translate.mjs warlock-zine-elves 0 claude-sonnet-4-6
```

Argumente: `<slug?> <pageLimit?> <model?>`
- `slug` leer = alle PDFs
- `pageLimit` 0 oder leer = alle Seiten
- `model` Default `claude-haiku-4-5-20251001`

Der Lauf ist **resumierbar** und **inkrementell**: bereits uebersetzte
Seiten werden uebersprungen, nach jeder Seite wird das JSON in Blob
aktualisiert. Du kannst jederzeit abbrechen und neu starten.

Alternative: ueber den Nitro-Task, wenn du `npx nuxi dev` laufen hast:
```bash
npx nuxi task run translate-pdfs
npx nuxi task run translate-pdfs --payload '{"onlySlug":"warlock-zine-elves","pageLimit":5}'
```

## Lizenz-Hinweis

Die maschinelle Uebersetzung ist eine Hilfe fuer eingeloggte Mitglieder.
Verbindlich ist das englische Original. Beim Hinzufuegen neuer Werke
bitte vorab pruefen, ob die Lizenz Bereitstellung im
geschlossenen-Mitglieder-Bereich und Anfertigung einer Uebersetzung
explizit erlaubt.
