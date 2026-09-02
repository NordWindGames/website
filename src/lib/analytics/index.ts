// Public surface of the analytics layer. Pages and page scripts import from
// here; nothing outside src/lib/analytics should reach for `window.gtag`.

export { initAnalytics } from './auto';
export { setUserProperties, track } from './events';
export type { AnalyticsEventName, AnalyticsEvents, AnalyticsUserProperties, Placement } from './events';
export { isTagPresent } from './gtag';
