# Styling und Responsive

Die Seite hat kein CSS-Framework und keine globale Stylesheet-Datei. Jedes Styling steht in einem
von Astro gescopten `<style>`-Block, und es gibt genau drei davon, weil es genau drei
Dokument-Shells gibt:

| Shell                      | Datei                                                             |
| :------------------------- | :---------------------------------------------------------------- |
| Startseite                 | [`src/pages/index.astro`](../src/pages/index.astro)               |
| HoldStrong                 | [`src/pages/holdstrong.astro`](../src/pages/holdstrong.astro)     |
| Alles andere (Devlog, 404) | [`src/layouts/BlogLayout.astro`](../src/layouts/BlogLayout.astro) |

Reset (`margin: 0`, `box-sizing: border-box`) und die Farbvariablen sind in allen drei dupliziert.
Das ist bekannt und bewusst nicht aufgelöst — der Umbau gehört zur geplanten Tailwind-Einführung,
nicht in einen CSS-Patch.

## Breakpoints

Zwei Stufen, beide `max-width`:

| Query                        | Bedeutung                                                                                                        |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `@media (max-width: 1023px)` | „nicht Desktop": fluide Gutter, Grids geben Spalten ab, Schriftgrößen bekommen `clamp()`, Touch-Targets auf 44px |
| `@media (max-width: 639px)`  | „Handy": Karussells greifen, Countdown wird 2×2, Sprungmarken verschwinden, CTA bricht um                        |

Die Werte sind nicht frei gewählt: sie sind deckungsgleich mit `viewportBucket()` in
[`src/lib/analytics/auto.ts`](../src/lib/analytics/auto.ts) (`< 640` = mobile, `< 1024` = tablet).
Layout und Reporting teilen sich damit dieselben Grenzen — ein GA4-Segment „mobile" ist exakt die
Menge der Besucher, die den Handy-Block gesehen haben.

## Die Regel

**Mobile Regeln kommen als `max-width`-Block ans Ende des Style-Blocks. Der Desktop-Pfad darüber
wird nicht angefasst.**

Das ist keine Stilfrage, sondern die einzige Garantie, dass eine Mobile-Änderung den Desktop nicht
verschiebt: ab 1024px greift keine einzige Regel aus diesen Blöcken. Wer eine Desktop-Änderung
will, ändert die Regel oben — sichtbar und absichtlich.

Wird ein Wert responsiv, dann bevorzugt per `clamp()` in der bestehenden Regel statt per
Breakpoint-Sprung. Sprünge sind für Dinge, die ihre Form ändern (Grid → Karussell), nicht für
Zahlen, die kleiner werden sollen.

## Die beiden Karussells auf /holdstrong/

Unterhalb von 640px werden Götter und Galerie horizontal wischbar. Sie sehen **absichtlich
unterschiedlich** aus, damit zwei Wisch-Bereiche auf derselben Seite nicht zum Rätsel werden:

- **Götter** — gerahmte Karten mit `flex: 0 0 82%`. Die angeschnittene nächste Karte ist die
  Affordanz; deshalb brauchen sie keinen Indikator.
- **Galerie** — randlos über die volle Viewport-Breite, ein Slot pro Bildschirm. Weil hier nichts
  angeschnitten ist, übernimmt ein Punkte-Indikator die Affordanz.

Der Indikator ist **reine Anzeige**: `aria-hidden`, keine Buttons, nicht anklickbar. Auf einem
Touchgerät wischt man, man zielt nicht auf 7px-Punkte. Gesetzt wird er von `bindGalleryCarousel()`
in [`src/scripts/holdstrong.ts`](../src/scripts/holdstrong.ts) über einen `IntersectionObserver`,
der per `matchMedia('(max-width: 639px)')` an- und abgehängt wird — oberhalb des Breakpoints gibt
es kein Karussell und läuft entsprechend auch kein Observer.

### Warum die Galerie einen Wrapper hat

Der Wide-Shot steht auf dem Handy fest über dem Karussell, die anderen fünf Slots sind die Slides.
Damit fünf Slots ein Scroll-Container sein können, brauchen sie **einen** Elternknoten — die lagen
aber ursprünglich in zwei getrennten Grids. Deshalb `.hs-gallery-scroll`: oberhalb 639px ist es
`display: contents` und damit unsichtbar, seine Kinder bleiben direkte Grid-Items von
`.hs-gallery-body`, und die Desktop-Geometrie ist unverändert. Unterhalb wird derselbe Knoten zum
Scroller.

## Animationskanäle, keine Theme-Tokens

`--fg`, `--line`, `--gamebg`, `--gamelift` und `--gameshadow` auf `.site` in `index.astro` sehen wie
Design-Tokens aus, sind aber keine: [`src/scripts/storm-cloud.ts`](../src/scripts/storm-cloud.ts)
schreibt sie pro Animationsframe per `setProperty()`. Wer sie umbenennt oder durch feste Werte
ersetzt, hängt die Storm-Animation von der Oberfläche ab, ohne dass etwas bricht oder warnt.

Die Canvas-Animation respektiert `prefers-reduced-motion: reduce` — dann wird ein einzelner Frame
gezeichnet und die rAF-Schleife gar nicht erst gestartet. Ein dauerlaufender Canvas ist auf dem
Handy Akku und Jank.

## Hover auf Touchgeräten

Jeder Hover-Effekt, der mehr tut als eine Farbe zu wechseln, gehört in
`@media (hover: hover)`. Auf einem Touchscreen feuert `pointerenter` beim Tap, `pointerleave` oft
nie — der Effekt bleibt dann für den Rest des Besuchs hängen. Aus demselben Grund ignoriert der
CTA-Handler in `storm-cloud.ts` `pointerType === 'touch'` und behandelt `pointercancel`.

## Touch-Targets

Interaktive Elemente sind unterhalb 1024px mindestens 44px hoch. Eine Ausnahme, bewusst:
**Inline-Links im Fließtext** eines Devlog-Posts bekommen kein Padding — das würde die Zeilenbox
aufreißen. Sie bleiben bei ihrer Zeilenhöhe.

## Bekannte offene Punkte

- **CLS bei Markdown-Bildern.** Markdown erzeugt `<img>` ohne `width`/`height`, es wird also kein
  Platz reserviert. Ehrlich lösbar nur per Rehype-Plugin oder `astro:assets`; ein CSS-`aspect-ratio`
  würde Bilder mit abweichendem Seitenverhältnis verzerren.
- **`public/holdstrong/keyart.png` ist 1,02 MB** und geht unverarbeitet an jedes Gerät. `sharp`
  liegt bereits in `node_modules` (Astro bringt es mit), `astro:assets` wäre also ohne neue
  Dependency machbar — die Bilder müssten nur nach `src/assets/` wandern.
- **Kein `:focus-visible`.** Der einzige Fokus-Stil der Seite ist `.hs-input:focus`, während
  `a { text-decoration: none }` global die Standard-Affordanz entfernt. Tastaturnutzer bekommen
  nirgends eine Fokusanzeige.
- **Render-blockierende Google Fonts.** `/holdstrong/` lädt drei Familien in acht Schnitten, der
  Devlog zwei weitere. Auf Mobilfunk der größte verbliebene Ladekostenpunkt.
