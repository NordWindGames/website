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

Ohne gesetzte ID wird **kein** GA-Tag gerendert. `npm run dev` loggt stattdessen jedes Event, das
gesendet worden wäre, als `[analytics] …` in die Browser-Konsole — so lässt sich die Instrumentierung
ohne echte Daten prüfen.

> **Offen:** Es gibt aktuell **keinen** Consent-Layer (kein Banner, kein Google Consent Mode). GA4
> setzt damit Cookies ohne Einwilligung. Vor einem größeren Launch nachziehen.

## Was automatisch getrackt wird (GA4 Enhanced Measurement, kein Code)

| Event | Bedeutung |
| :--- | :--- |
| `page_view` | Seitenaufruf inkl. `page_location`, `page_referrer`, UTM-Parameter |
| `session_start`, `first_visit` | Sessions und Neu- vs. Wiederkehrer |
| `user_engagement` | Aktive Verweildauer |
| `scroll` | 90 % Scrolltiefe (unsere eigene Staffelung siehe unten ist feiner) |
| `click` | Outbound-Klicks generisch (`link_domain`, `link_url`) |
| `file_download` | Downloads — greift automatisch, sobald eine Demo-Datei verlinkt wird |

Dazu kommen aus GA4 selbst: Gerät, Browser, OS, Auflösung, Land/Region/Stadt, Sprache,
Traffic-Quelle/Medium/Kampagne.

## Custom Events — jetzt aktiv

| Event | Parameter | Wofür |
| :--- | :--- | :--- |
| `cta_click` | `cta_id`, `cta_location`, `cta_label`, `link_url`, `click_index` | Welcher CTA zieht. `click_index` zeigt Mehrfachklicks (auf der Startseite = Spielerei mit dem Blitz-Button, ein Engagement-Signal). |
| `outbound_click` | `link_id`, `link_domain`, `link_url`, `link_location` | Welcher Social-Kanal tatsächlich geklickt wird — GA4s eingebautes `click` weiß nicht, *welcher* Button es war. |
| `section_view` | `section_id`, `section_index`, `time_to_view_seconds` | Scroll-Funnel: welcher Abschnitt wird überhaupt erreicht, und wie schnell. |
| `scroll_depth` | `percent_scrolled` (25/50/75/100) | Lesetiefe, feiner als GA4s 90 %-Event. |
| `page_engagement` | `engaged_time_seconds`, `max_scroll_percent`, `sections_viewed`, `interactions`, `exit_reason` | Ein Qualitäts-Datensatz pro Seitenaufruf, gesendet beim Verlassen. Erlaubt Segmente wie „>30 s aktiv und >75 % gescrollt". |

Aktive Verweildauer zählt nur, solange der Tab sichtbar ist — ein Tab, der eine Stunde im
Hintergrund liegt, ist keine Stunde Engagement.

## Custom Events — definiert, aber noch nicht gefeuert

Diese Events stehen typisiert in [`src/lib/analytics/events.ts`](../src/lib/analytics/events.ts).
Die Aufrufstellen landen mit der HoldStrong-Demo-Seite (`feature/holdstrong-landing-page`). Sie sind
jetzt schon definiert, damit Key Events und Custom Dimensions in GA4 vorab konfiguriert werden können
— GA4 sammelt rückwirkend **nichts**, was nicht vorher angelegt war.

| Event | Parameter | Wofür |
| :--- | :--- | :--- |
| `wishlist_click` | `store`, `placement` | **Key Event.** Steam-Wishlist-Absicht — das wichtigste Pre-Launch-Signal überhaupt. |
| `playtest_signup_start` | `form_id` | Erster Fokus/Tastendruck im E-Mail-Feld → Funnel-Einstieg. |
| `playtest_signup_submit` | `form_id`, `attempt` | Absenden versucht (auch bei ungültiger Eingabe). |
| `playtest_signup_success` | `form_id`, `time_to_convert_seconds`, `attempt` | **Key Event.** Anmeldung akzeptiert. |
| `playtest_signup_error` | `form_id`, `error_reason` | Wo Anmeldungen scheitern (`invalid_email`, `duplicate`, `network_error`). |
| `god_card_engage` | `god_name`, `engage_type` | Welcher Gott zieht Aufmerksamkeit — Signal für Marketing-Assets und Feature-Priorisierung. |
| `gallery_item_click` | `gallery_slot`, `slot_index` | Welche Screenshots interessieren. |
| `countdown_view` | `days_to_demo` | Countdown gesehen, inkl. Abstand zum Demo-Termin. |
| `trailer_progress` | `video_title`, `percent_played` | Trailer-Abbruchquoten, sobald ein Trailer existiert. |
| `demo_download_click` | `platform` | Demo-Downloads pro Plattform ab Release. |
| `share_click` | `method` | Teilen der Seite. |

## User Properties (Custom Dimensions, user-scoped)

Werden einmal pro Seitenaufruf gesetzt. Sie beschreiben die *Umgebung*, nicht die Person.

| Property | Werte | Wofür |
| :--- | :--- | :--- |
| `viewport_bucket` | `mobile`, `tablet`, `desktop`, `wide` | Stabiler als rohe Breiten; Basis für Layout-Entscheidungen. |
| `reduced_motion` | `true`, `false` | Die Seite ist animationslastig — relevant, falls Conversion-Raten auseinanderlaufen. |
| `color_scheme` | `light`, `dark` | Für die geplante Dark-Mode-Variante. |
| `touch_primary` | `true`, `false` | Touch vs. Maus, unabhängig von der Viewport-Breite. |

## In GA4 anzulegen

Ohne diese Registrierung sind die Parameter in Reports nicht auswählbar:

- **Custom Dimensions (event-scoped):** `cta_id`, `cta_location`, `link_id`, `link_location`,
  `section_id`, `error_reason`, `god_name`, `placement`, `exit_reason`, `platform`
- **Custom Metrics:** `engaged_time_seconds`, `max_scroll_percent`, `sections_viewed`,
  `interactions`, `time_to_convert_seconds`, `days_to_demo`
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

  <a href="https://discord.gg/…" data-analytics="outbound" data-analytics-id="discord"
     data-analytics-location="footer">Discord</a>

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

## Datenschutz-Regeln für neue Events

- **Nie** personenbezogene Daten in Parameter: keine E-Mail-Adressen, keine Namen, keine rohen
  Formulareingaben. GA4-Konten werden dafür gesperrt; die Playtest-Anmeldungen liegen ohnehin im
  Google Sheet.
- Event-Namen `snake_case`, ≤ 40 Zeichen. Max. 25 Parameter pro Event, Werte ≤ 100 Zeichen.
- Neue Events immer zuerst in `events.ts` eintragen und diese Datei mitpflegen.
