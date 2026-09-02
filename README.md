# NordWindGames Website

Statische Website des GameStudios NordWindGames, gebaut mit [Astro](https://astro.build) und
gehostet über GitHub Pages.

Erreichbar unter `https://nordwind.games`.

## Commands

Alle Befehle werden im Projekt-Root ausgeführt:

| Command             | Aktion                                          |
| :------------------ | :----------------------------------------------- |
| `npm install`        | Installiert Abhängigkeiten                       |
| `npm run dev`         | Startet den Dev-Server auf `localhost:4321`      |
| `npm run build`       | Baut die Produktions-Site nach `./dist/`         |
| `npm run preview`     | Zeigt den Build lokal an, vor dem Deploy         |
| `npm run astro ...`   | Astro-CLI-Befehle wie `astro add`, `astro check` |

## Workflow

Änderungen laufen über Pull Requests gegen `main` (siehe [CLAUDE.md](./CLAUDE.md)). Nach dem Merge
baut und deployed eine GitHub-Actions-Pipeline die Seite automatisch auf GitHub Pages.

> **Hinweis:** Der Branch-Schutz für `main` ist aktuell deaktiviert, da PRs mangels eines zweiten
> Reviewer-Accounts nicht approved werden konnten (GitHub verbietet Self-Approval). Er wird wieder
> eingerichtet, sobald ein Reviewer-Setup steht.

## Analytics

Die Seite ist mit Google Analytics 4 instrumentiert. Die Measurement-ID kommt aus der
GitHub-Actions-Repository-Variable `PUBLIC_GA_MEASUREMENT_ID`; ist sie nicht gesetzt, wird kein
Tag gerendert. Was genau getrackt wird und wie neue Seiten instrumentiert werden, steht in
[docs/analytics.md](./docs/analytics.md).
