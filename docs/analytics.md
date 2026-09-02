# Analytics

Google Analytics 4, eingebunden über [`src/components/Analytics.astro`](../src/components/Analytics.astro).
Die Tracking-Logik liegt in [`src/lib/analytics/`](../src/lib/analytics/); Seiten instrumentieren
sich über `data-analytics-*`-Attribute, nicht über eigene Event-Listener.

## Setup

1. In GA4 eine **Web-Datastream** für `https://nordwind.games` anlegen und die Measurement-ID
   (`G-XXXXXXXXXX`) kopieren.
2. Im Repo unter **Settings → Secrets and variables → Actions → Variables** eine Variable
   `PUBLIC_GA_MEASUREMENT_ID` mit dieser ID anlegen. Kein Secret — die ID landet ohnehin im
   öffentlichen Bundle.
3. Lokal optional `.env` aus [`.env.example`](../.env.example) anlegen.
4. Den Internal-Traffic-Filter anlegen und aktivieren — siehe [Lokal testen](#lokal-testen).

Repo-Variablen wirken nur auf **neue** Builds: nach dem Anlegen der Variable muss ein Deploy laufen
(Merge auf `main`), bevor die Live-Seite das Tag enthält.

Ohne gesetzte ID wird **kein** GA-Tag gerendert. `npm run dev` loggt stattdessen jedes Event, das
gesendet worden wäre, als `[analytics] …` in die Browser-Konsole — so lässt sich die Instrumentierung
ohne echte Daten prüfen.

## Lokal testen

Mit gesetzter ID sendet der Dev-Server an die **echte** Property. Damit das die Reports nicht
verfälscht, setzt [`Analytics.astro`](../src/components/Analytics.astro) in Dev-Builds zwei Flags:

| Flag                       | Wirkung                                                                                                                                                |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debug_mode: true`         | Events erscheinen sofort in **Admin → DebugView**, statt die normale Reporting-Verzögerung abzuwarten. Hält sie aber **nicht** aus den Reports heraus. |
| `traffic_type: 'internal'` | Kennzeichnet die Events als interner Traffic — die Grundlage für den Ausschluss-Filter unten.                                                          |

Das Flag allein filtert nichts. In GA4 einmalig einrichten:

1. **Admin → Data streams →** Stream wählen **→ Configure tag settings → Show more → Define
   internal traffic**: Regel mit `traffic_type` **equals** `internal` anlegen.
2. **Admin → Data filters →** `Internal Traffic` von **Testing** auf **Active** schalten.

Filter greifen nur **ab Aktivierung** — bereits gesammelte Dev-Events bleiben in der Property.

Zum Prüfen der Instrumentierung ohne jede Datenerfassung: `PUBLIC_GA_MEASUREMENT_ID` in `.env`
leer lassen, dann läuft alles über die Konsole. Chrome blendet diese Ausgaben standardmäßig aus —
sie liegen auf `console.debug`, also im Log-Level **Verbose** des Konsolen-Filters.

> **Offen:** Es gibt aktuell **keinen** Consent-Layer (kein Banner, kein Google Consent Mode). GA4
> setzt damit Cookies ohne Einwilligung. Vor einem größeren Launch nachziehen.

## Was automatisch getrackt wird (GA4 Enhanced Measurement, kein Code)

| Event                          | Bedeutung                                                            |
| :----------------------------- | :------------------------------------------------------------------- |
| `page_view`                    | Seitenaufruf inkl. `page_location`, `page_referrer`, UTM-Parameter   |
| `session_start`, `first_visit` | Sessions und Neu- vs. Wiederkehrer                                   |
| `user_engagement`              | Aktive Verweildauer                                                  |
| `scroll`                       | 90 % Scrolltiefe (unsere eigene Staffelung siehe unten ist feiner)   |
| `click`                        | Outbound-Klicks generisch (`link_domain`, `link_url`)                |
| `file_download`                | Downloads — greift automatisch, sobald eine Demo-Datei verlinkt wird |

Dazu kommen aus GA4 selbst: Gerät, Browser, OS, Auflösung, Land/Region/Stadt, Sprache,
Traffic-Quelle/Medium/Kampagne.

## Custom Events — seitenübergreifend aktiv

| Event             | Parameter                                                                                                       | Wofür                                                                                                                               |
| :---------------- | :-------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `cta_click`       | `cta_id`, `cta_location`, `cta_label`, `link_url`, `click_index`                                                | Welcher CTA zieht. `click_index` zeigt Mehrfachklicks (auf der Startseite = Spielerei mit dem Blitz-Button, ein Engagement-Signal). |
| `outbound_click`  | `link_id`, `link_domain`, `link_url`, `link_location`                                                           | Welcher Social-Kanal tatsächlich geklickt wird — GA4s eingebautes `click` weiß nicht, _welcher_ Button es war.                      |
| `section_view`    | `section_id`, `section_index`, `time_to_view_seconds`                                                           | Scroll-Funnel: welcher Abschnitt wird überhaupt erreicht, und wie schnell.                                                          |
| `scroll_depth`    | `percent_scrolled` (25/50/75/100)                                                                               | Lesetiefe, feiner als GA4s 90 %-Event.                                                                                              |
| `page_engagement` | `engaged_time_seconds`, `max_scroll_percent`, `sections_viewed`, `interactions`, `exit_reason`, `summary_index` | Ein Qualitäts-Datensatz pro Seitenaufruf. Erlaubt Segmente wie „>30 s aktiv und >75 % gescrollt".                                   |

Aktive Verweildauer zählt nur, solange der Tab sichtbar ist — ein Tab, der eine Stunde im
Hintergrund liegt, ist keine Stunde Engagement.

### `page_engagement` richtig auswerten

Das Event wird bei **jedem** Aufmerksamkeits-Ende gesendet, nicht nur beim ersten:

| `exit_reason` | Auslöser                                                                       |
| :------------ | :----------------------------------------------------------------------------- |
| `hidden`      | Tab-Wechsel oder Minimieren (das einzige verlässliche Signal auf Mobilgeräten) |
| `pagehide`    | Reload, Schließen, Navigation im selben Tab                                    |
| `swap`        | View-Transition-Navigation innerhalb der Seite                                 |

Ein Seitenaufruf kann also mehrere Zeilen erzeugen, jede mit hochzählendem
`summary_index`. **Nicht summieren** — pro Seitenaufruf die Zeile mit dem höchsten
`summary_index` nehmen, bzw. das Maximum je Metrik.

Der Grund für die Mehrfach-Sendung: Nur beim ersten Signal zu senden untertreibt
systematisch. Wer nach 3 Sekunden in einen anderen Tab wechselt und dann 4 Minuten liest,
wäre sonst als 3-Sekunden-Besuch erfasst. Identische Folge-Summaries werden verworfen —
das `pagehide` direkt hinter einem `visibilitychange` (der normale Weg, einen Desktop-Tab
zu schließen) erzeugt keine Dublette.

## Custom Events — HoldStrong-Landingpage

Aufrufstellen in [`src/pages/holdstrong.astro`](../src/pages/holdstrong.astro) (Attribute) und
[`src/scripts/holdstrong.ts`](../src/scripts/holdstrong.ts) (alles, was sich nicht als Attribut
ausdrücken lässt).

| Event                     | Parameter                                       | Wofür                                                                               |
| :------------------------ | :---------------------------------------------- | :---------------------------------------------------------------------------------- |
| `wishlist_click`          | `store`, `placement`                            | **Key Event.** Steam-Wishlist-Absicht — das wichtigste Pre-Launch-Signal überhaupt. |
| `playtest_signup_start`   | `form_id`                                       | Erster Fokus oder Tastendruck im E-Mail-Feld → Funnel-Einstieg.                     |
| `playtest_signup_submit`  | `form_id`, `attempt`                            | Absenden versucht — auch bei ungültiger Eingabe.                                    |
| `playtest_signup_success` | `form_id`, `time_to_convert_seconds`, `attempt` | **Key Event.** Anmeldung gespeichert.                                               |
| `playtest_signup_error`   | `form_id`, `error_reason`                       | Woran Anmeldungen scheitern.                                                        |
| `god_card_engage`         | `god_name`, `engage_type`                       | Welcher Gott Aufmerksamkeit zieht — Signal für Marketing-Assets und Priorisierung.  |

**`error_reason`** hat drei Werte, und sie zeigen auf unterschiedliche Verantwortliche:
`invalid_email` ist der Tippfehler des Besuchers (im Browser abgefangen, nichts hat die Seite
verlassen), `network_error` heißt die Anfrage kam nie an (offline, Timeout, Ad-Blocker), und
`rejected` heißt sie kam an und der Endpunkt hat sie abgelehnt — das ist unser Fehler.
Eine bereits eingetragene Adresse ist **kein** Fehlerfall: der Endpunkt erkennt sie und antwortet
`ok`, der Besucher ist ja angemeldet.

Das Formular trägt bewusst `novalidate`. Die native Constraint-Validierung des Browsers
unterdrückt sonst das `submit`-Event komplett — dann läuft weder die eigene Fehlermeldung der
Seite noch eines der Funnel-Events. `type="email"` und `required` bleiben am Feld, für die
Mobil-Tastatur und für Screenreader.

**`god_card_engage`** kennt zwei `engage_type`: `dwell` feuert einmal pro Karte und Seitenaufruf,
sobald sie 2 Sekunden am Stück zu mindestens 60 % sichtbar war — schnelles Vorbeiscrollen zählt
nicht. `click` feuert bei jedem Klick. `god_name` ist `thor`, `loki` oder `tyr`; Odin hat keine
Karte, er vergibt keinen Orb.

> **Offen:** Die drei Wishlist-Buttons zeigen noch auf `href="#"` — es gibt keine Steam-Seite.
> `wishlist_click` feuert trotzdem, bewusst: der Klick ist das Signal, nicht das Ziel. Die Zahlen
> stammen bis zum Steam-Launch also aus einem Button, der nichts tut.

## Custom Events — definiert, aber noch nicht gefeuert

Diese Events stehen typisiert in [`src/lib/analytics/events.ts`](../src/lib/analytics/events.ts),
haben aber nichts, woran sie hängen könnten: die Gallery besteht aus Platzhalter-Blöcken statt
Bildern, einen Trailer gibt es nicht, einen Share-Button auch nicht, und die Demo erscheint erst
am 16. Oktober. Sie sind trotzdem definiert, damit Key Events und Custom Dimensions in GA4 vorab
angelegt werden können — GA4 sammelt rückwirkend **nichts**, was nicht vorher registriert war.

| Event                 | Parameter                       | Wofür                                        |
| :-------------------- | :------------------------------ | :------------------------------------------- |
| `gallery_item_click`  | `gallery_slot`, `slot_index`    | Welche Screenshots interessieren.            |
| `trailer_progress`    | `video_title`, `percent_played` | Trailer-Abbruchquoten, sobald es einen gibt. |
| `demo_download_click` | `platform`                      | Demo-Downloads pro Plattform ab Release.     |
| `share_click`         | `method`                        | Teilen der Seite.                            |

## User Properties (Custom Dimensions, user-scoped)

Werden einmal pro Seitenaufruf gesetzt. Sie beschreiben die _Umgebung_, nicht die Person.

| Property          | Werte                                 | Wofür                                                                                |
| :---------------- | :------------------------------------ | :----------------------------------------------------------------------------------- |
| `viewport_bucket` | `mobile`, `tablet`, `desktop`, `wide` | Stabiler als rohe Breiten; Basis für Layout-Entscheidungen.                          |
| `reduced_motion`  | `true`, `false`                       | Die Seite ist animationslastig — relevant, falls Conversion-Raten auseinanderlaufen. |
| `color_scheme`    | `light`, `dark`                       | Für die geplante Dark-Mode-Variante.                                                 |
| `touch_primary`   | `true`, `false`                       | Touch vs. Maus, unabhängig von der Viewport-Breite.                                  |

## In GA4 anzulegen

Ohne diese Registrierung sind die Parameter in Reports nicht auswählbar:

- **Custom Dimensions (event-scoped):** `cta_id`, `cta_location`, `link_id`, `link_location`,
  `section_id`, `error_reason`, `god_name`, `engage_type`, `form_id`, `store`, `placement`,
  `exit_reason`, `platform`
- **Custom Metrics:** `engaged_time_seconds`, `max_scroll_percent`, `sections_viewed`,
  `interactions`, `time_to_convert_seconds`, `attempt`, `summary_index`
- **Custom Dimensions (user-scoped):** `viewport_bucket`, `reduced_motion`, `color_scheme`,
  `touch_primary`
- **Key Events:** `playtest_signup_success`, `wishlist_click`

## Eine neue Seite instrumentieren

```astro
---
import Analytics from '../components/Analytics.astro';
---

<head>
  <Analytics />
</head>
<body>
  <a href="#demo" data-analytics="cta" data-analytics-id="join_playtest" data-analytics-location="hero">
    Join the Playtest
  </a>

  <a
    href="https://discord.gg/…"
    data-analytics="outbound"
    data-analytics-id="discord"
    data-analytics-location="footer">Discord</a
  >

  <!-- wishlist braucht keine data-analytics-id: der Store ist die ganze Identität. -->
  <a href="https://store.steampowered.com/…" data-analytics="wishlist" data-analytics-location="nav">
    Wishlist on Steam
  </a>

  <section id="gods" data-analytics-section="gods">…</section>
</body>
```

Scroll-Tiefe, Engagement-Zusammenfassung und User Properties laufen allein durch `<Analytics />`.
Für alles, was sich nicht als Attribut ausdrücken lässt (Formular-Funnel, Video), aus dem
Seiten-Script heraus:

```ts
import { track } from '../lib/analytics';

track('playtest_signup_error', { form_id: 'playtest', error_reason: 'invalid_email' });
```

`track()` akzeptiert nur Events aus dem Katalog in `events.ts` — ein Tippfehler im Event-Namen ist
ein Typfehler, kein stiller Datenverlust.

## View Transitions

`<ClientRouter />` tauscht das DOM aus, ohne dass das Dokument neu lädt. Damit fällt jedes
Signal weg, auf das man sich normalerweise verlässt: `pagehide` feuert nicht, und gtags
`send_page_view` deckt nur den ersten Aufruf ab. [`auto.ts`](../src/lib/analytics/auto.ts)
ist darauf vorbereitet:

- Listener auf `document`/`window` werden **einmal pro Dokument** gebunden und lesen den
  jeweils aktuellen Page View — kein Doppel-Binding, keine doppelten Events.
- `astro:before-swap` schickt die Engagement-Summary der verlassenen Seite (`exit_reason: swap`).
- `astro:page-load` sendet ein `page_view` und startet einen frischen Page View: Scroll-Tiefe,
  Meilensteine, Klickzähler, Sections und die Engagement-Uhr werden zurückgesetzt, der
  Observer der alten Seite wird getrennt.
- Reine Hash-Wechsel (`#demo`) gelten als Sprung innerhalb der Seite, nicht als Seitenaufruf.

Ohne `<ClientRouter />` ist all das inert — die Events feuern dann einfach nie. Beim Einbauen
also nichts zu tun; nur nicht wieder ausbauen.

## Datenschutz-Regeln für neue Events

- **Nie** personenbezogene Daten in Parameter: keine E-Mail-Adressen, keine Namen, keine rohen
  Formulareingaben. GA4-Konten werden dafür gesperrt; die Playtest-Anmeldungen liegen ohnehin im
  Google Sheet.
- Event-Namen `snake_case`, ≤ 40 Zeichen. Max. 25 Parameter pro Event, Werte ≤ 100 Zeichen.
- Neue Events immer zuerst in `events.ts` eintragen und diese Datei mitpflegen.
