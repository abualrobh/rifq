// The message the Tafseer view shows for a "not configured" answer (kept apart from the island so
// unit tests can read it without a browser).
// RQ-007 AC8 and AC12, kit v35 D-175 A (QA v34 FIND-AV): in the English interface, a development
// build names the unset English work (tafseerEnNotConfigured, D-136); a release build shows the
// AC10 "unavailable" message (tafseerUnavailable) and names no decision. The Arabic interface keeps
// tafseerNotConfigured (RQ-005).
export type NotConfiguredMessage = { key: 'tafseerEnNotConfigured' | 'tafseerUnavailable' | 'tafseerNotConfigured'; msg: 'not_configured' | 'unavailable' };
export function notConfiguredMessage(lang: 'ar' | 'en', dev: boolean): NotConfiguredMessage {
  if (lang === 'en') return dev ? { key: 'tafseerEnNotConfigured', msg: 'not_configured' } : { key: 'tafseerUnavailable', msg: 'unavailable' };
  return { key: 'tafseerNotConfigured', msg: 'not_configured' };
}
