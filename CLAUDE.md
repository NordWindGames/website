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

## SEO und GEO

Jede Seite bindet `<Seo title=… description=… />` ([src/components/Seo.astro](./src/components/Seo.astro))
im `<head>` ein — die Komponente ersetzt `<title>` und `<meta name="description">`, sonst nichts.
Titel und Description gehören als `StaticPage` nach `src/lib/seo.ts` und in `STATIC_PAGES`: der
Sitemap-Endpoint bricht den Build ab, wenn eine Seite unter `src/pages/` in keinem Eintrag steht.

`alternates` (hreflang) nur setzen, wenn die andere Sprachfassung **wirklich existiert**. `/` und
`/holdstrong/` sind englisch-only und tragen keins; für Posts liefert `postAlternates()` ohne
Übersetzung ein leeres Array. Niemals `getTranslationPath()` für hreflang verwenden — dessen
Index-Fallback ist für den sichtbaren Sprachumschalter richtig und als hreflang eine Falschaussage.

JSON-LD über den `jsonLd`-Prop, Knoten aus `src/lib/schema.ts`, mindestens `identityNodes(site)`.
Interne Links behalten ihren Trailing Slash (`trailingSlash: 'always'`).

Vollständige Doku inklusive Crawler-Haltung in `robots.txt` und der bewusst weggelassenen
Schema-Felder: [docs/seo.md](./docs/seo.md) — bei Änderungen mitpflegen.

## Devlog

Die Ideen-Pipeline für den Devlog liegt in `scripts/blog.mjs` + `scripts/lib/` +
`.claude/skills/blog-research/` + `.claude/skills/blog-write/`, dokumentiert in
[docs/blog.md](./docs/blog.md). Drei Commands: `npm run blog` (Status), `npm run blog:scan`,
`npm run blog:check`. Wichtig: `content/ideas/sources.local.json` (die echten
Referenz-Blog-URLs) und alle daraus abgeleiteten State-Files sind absichtlich gitignored —
dieses Repo ist öffentlich. Vor dem Schreiben eines Posts `npm run blog:check` laufen lassen.

## Styling und Responsive

Kein CSS-Framework, keine globale Stylesheet-Datei — alles Styling steht in den drei gescopten
`<style>`-Blöcken von [src/pages/index.astro](./src/pages/index.astro),
[src/pages/holdstrong.astro](./src/pages/holdstrong.astro) und
[src/layouts/BlogLayout.astro](./src/layouts/BlogLayout.astro).

Zwei Breakpoints, beide `max-width`: `1023px` („nicht Desktop") und `639px` („Handy"). Die Werte
sind deckungsgleich mit `viewportBucket()` in `src/lib/analytics/auto.ts`, damit Layout und
GA4-Reporting dieselben Grenzen benutzen.

**Die Regel: mobile Regeln kommen als `max-width`-Block ans Ende des Style-Blocks, der
Desktop-Pfad darüber wird nicht angefasst.** Ab 1024px greift keine dieser Regeln — das ist die
Garantie, dass eine Mobile-Änderung den Desktop nicht verschiebt. Werte, die nur kleiner werden
sollen, per `clamp()` in der bestehenden Regel statt per Breakpoint-Sprung.

Hover-Effekte, die mehr tun als eine Farbe wechseln, gehören in `@media (hover: hover)` — auf
Touch feuert `pointerleave` oft nie und der Effekt bleibt hängen. Interaktive Elemente sind
unterhalb 1024px mindestens 44px hoch; Inline-Links im Fließtext sind die bewusste Ausnahme.

Vorsicht bei `--fg`, `--line`, `--gamebg`, `--gamelift`, `--gameshadow` auf `.site`: das sind keine
Theme-Tokens, sondern Kanäle, die `src/scripts/storm-cloud.ts` pro Animationsframe beschreibt.

Vollständige Doku inklusive der beiden Karussells auf `/holdstrong/` und der offenen Punkte
(CLS bei Markdown-Bildern, 1 MB Keyart, fehlendes `:focus-visible`): [docs/styling.md](./docs/styling.md)
— bei Änderungen mitpflegen.

## Dokumentation

Vollständige Doku: https://docs.astro.build

Vor verwandten Aufgaben konsultieren:

- [Seiten, dynamische Routen, Middleware](https://docs.astro.build/en/guides/routing/)
- [Astro-Komponenten](https://docs.astro.build/en/basics/astro-components/)
- [React/Vue/Svelte/andere Framework-Komponenten](https://docs.astro.build/en/guides/framework-components/)
- [Content hinzufügen/verwalten](https://docs.astro.build/en/guides/content-collections/)
- [Styles/Tailwind](https://docs.astro.build/en/guides/styling/)
- [Mehrsprachigkeit](https://docs.astro.build/en/guides/internationalization/)
