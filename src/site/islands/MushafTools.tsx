// RQ-009 v0.3 (D-280 A, AC36, AC38, kit v43): on a Mushaf page during surah playback, a button
// "Recitation is on page {p}" takes the reader to the page with the playing ayah, while the
// automatic turns are paused (5 s after a turn by hand or a scroll) or when the page shown holds no
// ayah of the playing surah. Page turning itself is in client/mushaf.ts.
import { t, type Lang } from '../../core/strings.ts';
import { useRecitation } from '../client/use-recitation.ts';
import { pageHas } from '../client/recitation.ts';
import { pageFor, pageHref } from '../client/view.ts';

export default function MushafTools({ lang, p, dev = false }: { lang: Lang; p: number; dev?: boolean }) {
  const { snap, engine } = useRecitation(dev);
  if (!engine || snap.mode !== 'surah' || snap.phase !== 'active' || !snap.current || !snap.s) return null;
  const at = pageFor(snap.s, snap.current);
  if (!at || at === p) return null;
  if (pageHas(snap.s) && snap.follow) return null; // following: the page turns by itself
  const href = pageHref(lang, snap.s, snap.current, false, false);
  return (
    <p className="mp-playing" data-playing-on-wrap>
      <a className="btn" href={href} data-playing-on={at} onClick={() => engine.goPlaying()}>{t(lang, 'playingOnPage', { p: at })}</a>
    </p>
  );
}
