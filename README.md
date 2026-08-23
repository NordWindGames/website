# NordWindGames Website

Statische Website des GameStudios NordWindGames, gebaut mit [Astro](https://astro.build) und
gehostet über GitHub Pages.

Aktuell erreichbar unter `https://nordwindgames.github.io/website/` (eigene Domain folgt in einem
späteren Schritt).

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
