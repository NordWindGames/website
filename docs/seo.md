# SEO und GEO

Die SEO-Oberfläche der Seite hängt an [`src/components/Seo.astro`](../src/components/Seo.astro),
die Daten dazu liegen in [`src/lib/seo.ts`](../src/lib/seo.ts) und
[`src/lib/schema.ts`](../src/lib/schema.ts). Vier Endpoints leiten sich aus derselben Registry ab:
`/sitemap.xml`, `/robots.txt`, `/llms.txt` und die beiden RSS-Feeds.

GEO (Generative Engine Optimization) heißt hier: von Assistenten **gefunden und zitiert** werden.
Das ist überwiegend derselbe Hebel wie klassisches SEO — saubere Canonicals, korrekte Sprach-Cluster,
strukturierte Daten — plus ein paar bewusste Entscheidungen, die unten begründet sind.

## Eine neue Seite anlegen

1. `<Seo title=… description=… />` in den `<head>`. Die Komponente ersetzt genau zwei Zeilen
   (`<title>` und `<meta name="description">`); charset, viewport, Favicon, Fonts und
   `<Analytics />` bleiben, wo sie sind — die unterscheiden sich pro Seite.
2. Titel und Description als `StaticPage` in `src/lib/seo.ts` eintragen und in `STATIC_PAGES`
   aufnehmen. **Das ist nicht optional:** der Sitemap-Endpoint bricht den Build ab, wenn eine
   Seite unter `src/pages/` in keinem Sitemap-Eintrag auftaucht
   (`assertNoUnlistedPages` in [`sitemap.xml.ts`](../src/pages/sitemap.xml.ts)).
3. JSON-LD über den `jsonLd`-Prop mitgeben, mindestens `identityNodes(site)`.
4. Wenn die Seite in beiden Sprachen existiert: `alternates` setzen (siehe unten). Wenn nicht:
   **weglassen**.

Endpoints (`.ts` unter `src/pages/`) sind vom Drift-Guard ausgenommen — `sitemap.xml`, `robots.txt`,
`llms.txt` und die Feeds gehören selbst nicht in die Sitemap.

## Canonicals

`canonicalUrl()` in `src/lib/seo.ts` normalisiert auf **absolut, genau ein Trailing Slash**.
`trailingSlash: 'always'` in [`astro.config.mjs`](../astro.config.mjs) hält die interne
Verlinkung passend dazu — jeder interne Link behält seinen Slash, `/holdstrong` ohne Slash ist
ein Redirect-Hop.

Die 404-Seite bekommt **kein** Canonical, sondern `<meta name="robots" content="noindex, follow">`.
Ein Self-Canonical auf einer Seite, die nicht indexiert werden will, widerspricht sich selbst.

## hreflang — die wichtigste Regel

**Ein `alternate` ist nur erlaubt, wenn die andere Sprachfassung wirklich existiert.**

`/` und `/holdstrong/` sind bewusst englisch-only; es gibt kein `src/pages/de/index.astro`. Beide
tragen deshalb **gar kein** hreflang. Nur der Devlog hat echte Sprachpaare.

Für Posts liefert `postAlternates()` ein **leeres Array**, solange die Übersetzung fehlt. Der Grund
steht in [`src/lib/blog.ts`](../src/lib/blog.ts) an `translatedPostPath()`: die Funktion für den
sichtbaren Sprachumschalter (`getTranslationPath()`) fällt absichtlich auf den Devlog-Index zurück —
für einen Leser ist das der nächstbeste Ort. Als hreflang wäre derselbe Fallback eine Falschaussage:
er würde eine _andere_ Seite als deutsche Fassung dieser Seite deklarieren, und eine Suchmaschine,
die den Widerspruch bemerkt, verwirft das gesamte Cluster statt nur den falschen Eintrag.

Jedes Cluster nennt sich selbst mit (`en`, `de`, `x-default`). Eine Seite, die ihr eigenes hreflang
nicht listet, gilt als einseitig annotiert und wird ignoriert. `x-default` zeigt auf Englisch, die
Basissprache der Seite.

Dieselbe Funktion speist die `<xhtml:link>`-Einträge der Sitemap — Seite und Sitemap können sich
über ein Cluster also nicht widersprechen. Genau das war der Grund, die Sitemap von Hand zu
schreiben statt `@astrojs/sitemap` einzusetzen: die Integration hätte eine zweite Kopie dieser
Logik in `node_modules` gehalten, mit anderer Semantik (kein `x-default`).

## Sitemap

Sechs URLs, generiert aus `STATIC_PAGES` plus Content-Collection.

- `lastmod` kommt aus `data.date` (Publikationsdatum). Die Devlog-Indexe erben das Datum des
  neuesten Posts — diese Seite ändert sich tatsächlich mit jedem Post.
- Die statischen Seiten tragen **kein** `lastmod`. Ein erfundenes Datum ist schlechter als keins;
  Google glaubt `lastmod` nur, solange es konsistent stimmt.
- **Git-mtime funktioniert hier nicht**, auch wenn es naheliegt: `deploy.yml` checkt shallow aus,
  also meldet `git log` für jede Datei den Deploy-Commit.
- Kein `changefreq`, kein `priority` — Google ignoriert beide.
- `/404.html` steht nicht in der Liste und wird nicht herausgefiltert: eine Fehlerseite wird nie
  zum Eintrag.

Wenn ein veröffentlichter Post inhaltlich überarbeitet wird, lohnt ein optionales
`updated: z.coerce.date().optional()` in [`src/content.config.ts`](../src/content.config.ts).
`.strict()` verbietet nur _nicht deklarierte_ Felder, ein neues optionales ist unkritisch. Dann
mitpflegen: `.claude/skills/blog-write/SKILL.md` und [`docs/blog.md`](./blog.md).

## robots.txt — die Crawler-Haltung

Generiert in [`src/pages/robots.txt.ts`](../src/pages/robots.txt.ts), damit die Domain nur in
`astro.config.mjs` steht. Nichts ist für normale Crawler gesperrt.

Die AI-Haltung ist bewusst zweigeteilt:

| Gruppe                                                                                                                                           | Regel         | Warum                                                                                                                                                                                                          |
| :----------------------------------------------------------------------------------------------------------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, `DuckAssistBot`, `meta-externalagent` | `Allow: /`    | Holen eine Seite, um jetzt eine Frage zu beantworten. Der Devlog existiert, um gelesen und zitiert zu werden.                                                                                                  |
| `Google-Extended`, `Applebot-Extended`                                                                                                           | `Allow: /`    | Keine Crawler, sondern Opt-out-Token für Training/Grounding. Ein Disallow entfernt die Seite **nicht** aus AI Overviews (die speisen sich aus dem normalen Suchindex), verhindert aber Zitate mit Attribution. |
| `CCBot`, `Bytespider`                                                                                                                            | `Disallow: /` | Bulk-Sammler. CCBot füttert Common Crawl — eine Trainingskorpus-Pipeline, keine Retrieval-Pipeline; der Block kostet fast keine Zitierbarkeit. Bytespider ist der aggressivste Crawler des Feldes.             |

Wichtig beim Ändern: robots.txt ist eine Bitte, keine Durchsetzung. GitHub Pages hat keinen
serverseitigen Hook, um einen User-Agent zu blocken, der sie ignoriert.

## Structured Data

[`src/lib/schema.ts`](../src/lib/schema.ts) liefert reine Funktionen, `site: URL` als Parameter.

| Route                 | Knoten                                            |
| :-------------------- | :------------------------------------------------ |
| `/`                   | Organization, Person, WebSite                     |
| `/holdstrong/`        | Organization, Person, VideoGame, BreadcrumbList   |
| `/blog/`, `/de/blog/` | Organization, Person, Blog, BreadcrumbList        |
| Post-Seiten           | Organization, Person, BlogPosting, BreadcrumbList |
| `/404.html`           | keine                                             |

`Organization` und `Person` stehen über `identityNodes()` auf **jeder** Seite, nicht nur auf `/`.
Die `@id` hält sie ohnehin als eine Entität zusammen — aber eine Seite, die nur
`author: { "@id": "…#mathias" }` trägt, sagt für sich genommen nichts, und ein Retrieval-System,
das genau einen Post geholt hat, ist der Normalfall. Kostet ~300 Bytes pro Seite.

Post-Bilder kommen aus `heroOf()` über das Roh-Markdown. Das geht, weil der Conventions-Gate
(`require_hero_image`) garantiert, dass das Hero-Bild die erste Markdown-Bildreferenz im Body ist —
deshalb braucht kein Post ein zusätzliches Frontmatter-Feld.

### Bewusst weggelassen

Diese drei Lücken sind keine Nachlässigkeit, sondern warten auf eine Voraussetzung:

- **`sameAs` an `Organization`** — blockiert durch das TODO in
  [`src/lib/social.ts`](../src/lib/social.ts): alle Social-URLs außer Discord zeigen noch auf die
  Startseite der jeweiligen Plattform. `sameAs: ['https://www.tiktok.com/']` würde behaupten, das
  Studio _sei_ TikTok. Sobald die echten Profil-URLs stehen, hier eintragen — `sameAs` ist der
  Mechanismus, über den Suchmaschinen und LLMs „Nordwind Games" auf der Website mit „Nordwind Games"
  auf TikTok als **eine** Entität verschmelzen.
- **`logo` an `Organization`** — es gibt nur `favicon.svg`/`.ico`; Google will ein Rasterbild ab
  112×112. Nachtragen, sobald `public/logo-512.png` existiert.
- **`offers` an `VideoGame`** — die Steam-Links auf `/holdstrong/` sind noch `href="#"`. Ein Angebot,
  das nirgendwohin zeigt, ist schlechter als keins.
- **`VideoGame.datePublished`** — der 16.10.2026 ist der Demo-Start, nicht das Release.

## Open Graph

`OG_DEFAULT` und `OG_HOLDSTRONG` in `src/lib/seo.ts` zeigen auf `public/og/*.png`, je 1200×630 —
das Format, auf das X, LinkedIn und Discord ihre großen Karten zuschneiden. Erzeugt mit
[`scripts/make-og-images.mjs`](../scripts/make-og-images.mjs) aus dem Keyart.

Das Script ist ein Einmal-Werkzeug und **nicht** in den Build verdrahtet: es nutzt das `sharp`, das
Astros Image-Pipeline ohnehin mitbringt, statt daraus eine eigene Dependency zu machen. Die
fertigen PNGs sind committed — wenn `sharp` eines Tages verschwindet, läuft nur das Script nicht
mehr, die Seite bleibt intakt.

`public/blog/welcome/hero.webp` ist als `og:image` ungeeignet (4:3 wird auf 1,91:1 hart beschnitten,
und LinkedIn rendert WebP nicht zuverlässig), taugt aber als `image` im BlogPosting-JSON-LD — dort
akzeptieren Schema.org und Google WebP.

`twitter:site` fehlt absichtlich, bis es einen echten Account zu nennen gibt. Titel, Beschreibung
und Bild leitet X aus `og:*` ab, deshalb steht dort nur `twitter:card`.

## llms.txt

Nüchtern eingeordnet: kein Anbieter konsumiert [`/llms.txt`](../src/pages/llms.txt.ts) nachweislich.
Sie steht drin, weil sie sich aus derselben Registry ableitet — also nicht veralten kann, wie eine
handgepflegte Datei in `public/` es nach dem dritten Post täte — und weil sie sich auszahlt, sobald
jemand einen Agenten direkt auf die Domain richtet.

Der `## Facts`-Block ist der eigentliche Inhalt: kurze, datierte, kontextfreie Aussagen, inklusive
der wichtigsten für ein Spiel, das noch nicht existiert — _not released, no launch date announced_.

Kein `llms-full.txt`: das wäre der komplette Post-Korpus ein zweites Mal unter einer zweiten URL,
also Duplicate Content, den man danach wieder einfangen müsste. Ab etwa zwanzig Posts neu bewerten.

## GEO ist nicht nur Markup

Markup macht die Seite maschinenlesbar; **zitiert** wird sie wegen der Textform. Für neue Posts:

- **Fakten-Sätze statt Marketing.** „Der öffentliche Demo-Start ist der 16. Oktober 2026, kostenlos
  auf Steam" ist zitierbar. „Bald verfügbar" nicht. Datum, Zahl, Eigenname in _einem_ Satz.
- **Definitionssatz oben.** Ein Retrieval-System sieht oft nur einen Chunk, also sollte der erste
  Satz ohne Kontext funktionieren („HoldStrong ist ein …").
- **H2 als Frage.** „Warum kein Win-State?" wird als Passage zu einer Frage gematcht,
  „Gedanken zum Design" nicht.
- **Eine Schreibweise pro Entität.** `GAME_NAME` / `GAME_FULL_NAME` in `src/lib/seo.ts` sind die
  Referenz; „Hold Strong" mit Leerzeichen ist dasselbe Spiel und kostet die Entitätszuordnung.

## Offene Punkte

- **Search Console und Bing Webmaster Tools**: Sitemap einreichen, hreflang-Report prüfen.
  Verifizierung besser per DNS-TXT als per Meta-Tag — dann hängt sie nicht an einer Seite.
- **`/about/` in EN und DE** wäre der größte verbleibende GEO-Hebel: die Seite, die Assistenten für
  „wer ist Nordwind Games" zitieren, und die natürliche Heimat des vollständigen
  `Organization`-Knotens inklusive `sameAs`. Sobald sie existiert, ist sie das erste echte
  Sprachpaar außerhalb des Devlogs, und die hreflang-Logik trägt sie ohne Änderung.
- **FAQ-Block auf `/holdstrong/`** mit `FAQPage`-JSON-LD. Googles FAQ-Rich-Results sind für die
  meisten Seiten abgeschaltet, für LLM-Extraktion ist das Format weiterhin ideal.
- **`keyart.png` ist 1,0 MB** und das LCP-Element von `/holdstrong/`. Eine WebP-Variante
  (~120–180 KB) für den Hero-`<img>` wäre ein echter Core-Web-Vitals-Gewinn; das PNG bliebe für
  OG. `hs-hero-img` hat außerdem `alt=""` — als dekorativ verteidigbar, aber es ist das Keyart.
