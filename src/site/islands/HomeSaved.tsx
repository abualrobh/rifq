// RQ-008 home (kit v37): the continue-reading card (AC11, AC12) and the mySaved row (AC14 to
// AC16, D-185 A), read from the device's saves (RQ-003). Nothing is sent anywhere. Saved references
// are untrusted: each is checked against this build's source before it becomes a link (RQ-003 AC10).
// With storage blocked, the storageBlocked message shows once here and no cards show (AC13).
// The full list, Remove, Clear all and clear last position are on the Saved screen (AC22).
import { useEffect, useState } from 'react';
import { getStorage, load, refExists, type Saves } from '../../core/store.ts';
import { juzOfAyah } from '../../core/recent.ts';
import { ayahPath, savedPath, t, type Lang } from '../../core/strings.ts';

type Props = { lang: Lang; counts: number[]; names: [string, string][]; juz: { juz: number; s: number; a: number }[]; juzOk: boolean };

export const HOME_BOOKMARKS = 3;

export default function HomeSaved({ lang, counts, names, juz, juzOk }: Props) {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(true);
  const [saves, setSaves] = useState<Saves>({ v: 1, b: [], l: null });
  useEffect(() => {
    const st = getStorage(window);
    const read = () => { const r = load(st); setOk(r.ok); setSaves(r.saves); };
    read(); setReady(true);
    // AC24: a change made in another RIFQ tab shows without a reload.
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);

  const name = (s: number) => names[s - 1]?.[lang === 'ar' ? 0 : 1] ?? '';
  const nameLang = lang === 'ar' ? 'ar' : 'en';
  const last = saves.l;
  // D-185 A: the first 3 bookmarks in Quran order, as stored. AC15: a reference not in the source is
  // not shown as a card (the Saved screen shows its badRef message).
  const cards = saves.b.filter((r) => refExists(counts, r)).slice(0, HOME_BOOKMARKS);
  const j = last && juzOk ? juzOfAyah(juz, last[0], last[1]) : 0;

  return (
    <div className="home-saved" data-home-saved>
      {ready && !ok && <p className="msg alert" data-storage-blocked>{t(lang, 'storageBlocked')}</p>}
      {ready && ok && last && (refExists(counts, last)
        ? <p className="continue home-continue">
            <a data-continue href={ayahPath(lang, last[0], last[1])}>
              <span className="cc-kicker">{t(lang, 'continueCard')}</span>
              <span className="cc-name"><bdi lang={nameLang} data-continue-name>{name(last[0])}</bdi></span>
              <span className="cc-sub" data-continue-sub>{j ? t(lang, 'cardAyahJuz', { a: last[1], j }) : t(lang, 'audioNowAyah', { a: last[1] })}</span>
              <span className="cc-go" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" focusable="false"><path className="cc-arrow" d="M9 6l6 6-6 6" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            </a>
          </p>
        : <p className="msg alert" data-bad-last>{t(lang, 'badRef', { s: last[0], a: last[1] })}</p>)}
      {/* AC93 (P-4): before the island loads, room for the card when the early script saw a saved
          position (html.rifq-last); hidden, no text. */}
      {!ready && <p className="continue home-continue reserve-last" aria-hidden="true"><a><span className="cc-kicker">{'\u00a0'}</span><span className="cc-name">{'\u00a0'}</span><span className="cc-sub">{'\u00a0'}</span><span className="cc-go" /></a></p>}
      <section className="home-sec" aria-labelledby="my-saved-h" data-my-saved>
        <div className="home-sec-head">
          <h2 id="my-saved-h">{t(lang, 'mySaved')}</h2>
          <a href={savedPath(lang)} data-view-all>{t(lang, 'viewAll')}</a>
        </div>
        <p className="hint" data-saved-note>{t(lang, 'bookmarksNote')}</p>
        {ready && ok && cards.length === 0 && <p data-empty>{t(lang, 'noBookmarks')}</p>}
        {/* Before the island loads, the empty line keeps its space (hidden), as on today's home. */}
        {!ready && <p className="reserve reserve-empty" aria-hidden="true">{t(lang, 'noBookmarks')}</p>}
        {!ready && <ul className="bm-cards reserve-bm" aria-hidden="true"><li><a><span className="bm-card-title">{'\u00a0'}</span><span className="bm-card-kind">{'\u00a0'}</span></a></li></ul>}
        {ready && ok && cards.length > 0 && (
          <ul className="bm-cards" data-bm-cards>
            {cards.map(([s, a]) => (
              <li key={`${s}:${a}`}>
                <a href={ayahPath(lang, s, a)} data-bm-card={`${s}:${a}`}>
                  <span className="bm-card-title"><bdi lang={nameLang}>{name(s)}</bdi>{' '}<bdi dir="ltr">{a}</bdi></span>
                  <span className="bm-card-kind">{t(lang, 'bookmarkKind')}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
