# NordWindGames Website

Astro-basierte Static-Site des GameStudios NordWindGames, gehostet auf GitHub Pages.
Deploy-Ziel: `https://nordwind.games` (eigene Domain via `public/CNAME`, DNS zeigt auf GitHub Pages).

## Workflow

- Niemals direkt auf `main` pushen, immer über einen Feature-Branch und einen PR (Konvention;
  der technische Branch-Schutz ist aktuell mangels zweitem Reviewer-Account deaktiviert und wird
  wieder eingerichtet, siehe [README.md](./README.md)).
- Branch-Namen: `feature/…`, `fix/…`, `chore/…`.
- Commit-Messages folgen Conventional Commits (`feat:`, `fix:`, `chore:`).
- Vor dem Öffnen eines PRs lokal `npm run build` laufen lassen — der gleiche Check läuft als
  Pflicht-Status-Check in der PR-CI (`.github/workflows/ci.yml`).
- Nach Merge auf `main` baut `.github/workflows/deploy.yml` die Seite und deployed sie automatisch
  auf GitHub Pages. Kein manueller Deploy-Schritt nötig.

## Development

Beim Starten des Dev-Servers den Hintergrundmodus nutzen:

```
astro dev --background
```

Verwaltung über `astro dev stop`, `astro dev status`, `astro dev logs`.

## Analytics

Google Analytics 4 hängt an `<Analytics />` ([src/components/Analytics.astro](./src/components/Analytics.astro)),
die Logik liegt in [src/lib/analytics/](./src/lib/analytics/). Neue Seiten binden `<Analytics />` im
`<head>` ein und markieren Elemente mit `data-analytics="cta|outbound"`, `data-analytics-id`,
`data-analytics-location` bzw. `data-analytics-section` — keine eigenen Event-Listener schreiben.

Neue Events zuerst im Katalog in `src/lib/analytics/events.ts` deklarieren (`track()` nimmt nur
bekannte Namen an) und [docs/analytics.md](./docs/analytics.md) mitpflegen. Niemals
personenbezogene Daten als Event-Parameter senden.

Die Measurement-ID kommt aus `PUBLIC_GA_MEASUREMENT_ID`; ohne sie wird kein Tag gerendert und der
Dev-Server loggt die Events nur in die Konsole.

## Dokumentation

Vollständige Doku: https://docs.astro.build

Vor verwandten Aufgaben konsultieren:

- [Seiten, dynamische Routen, Middleware](https://docs.astro.build/en/guides/routing/)
- [Astro-Komponenten](https://docs.astro.build/en/basics/astro-components/)
- [React/Vue/Svelte/andere Framework-Komponenten](https://docs.astro.build/en/guides/framework-components/)
- [Content hinzufügen/verwalten](https://docs.astro.build/en/guides/content-collections/)
- [Styles/Tailwind](https://docs.astro.build/en/guides/styling/)
- [Mehrsprachigkeit](https://docs.astro.build/en/guides/internationalization/)
