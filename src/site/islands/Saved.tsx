// Home page panel (RQ-003): continue reading, the bookmark list, remove, and clear all with a
// confirm step. Saved references are untrusted: each one is checked against this build's source
// before it becomes a link, and one that does not exist shows a message instead (AC10).
import { useEffect, useState } from 'react';
import { clearBookmarks, getStorage, load, refExists, removeBookmark, type Saves, type StorageLike } from '../../core/store.ts';
import { ayahPath, t, type Lang } from '../../core/strings.ts';

type Props = { lang: Lang; counts: number[]; names: [string, string][] };

export default function Saved({ lang, counts, names }: Props) {
  const [ready, setReady] = useState(false);
  const [st, setSt] = useState<StorageLike | null>(null);
  const [ok, setOk] = useState(true);
  const [saves, setSaves] = useState<Saves>({ v: 1, b: [], l: null });
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = (s: StorageLike | null) => { const r = load(s); setOk(r.ok); setSaves(r.saves); };
  useEffect(() => {
    const s = getStorage(window);
    setSt(s); refresh(s); setReady(true);
    const onStorage = () => refresh(s);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const name = (s: number) => names[s - 1]?.[lang === 'ar' ? 0 : 1] ?? '';
  const last = saves.l;

  function remove(s: number, a: number) {
    setMsg(removeBookmark(st, [s, a]) === 'failed' ? t(lang, 'saveFailed') : t(lang, 'removed'));
    refresh(st);
  }
  function clear() {
    setMsg(clearBookmarks(st) ? t(lang, 'cleared') : t(lang, 'saveFailed'));
    setConfirm(false);
    refresh(st);
  }

  return (
    <section className="saved" aria-labelledby="saved-h" data-saved>
      {ready && !ok && <p className="msg alert" data-storage-blocked>{t(lang, 'storageBlocked')}</p>}
      {ready && last && (refExists(counts, last)
        ? <p className="continue"><a data-continue href={ayahPath(lang, last[0], last[1])}>{t(lang, 'continueReading', { name: name(last[0]), a: last[1] })}</a></p>
        : <p className="msg alert" data-bad-last>{t(lang, 'badRef', { s: last[0], a: last[1] })}</p>)}
      <h2 id="saved-h">{t(lang, 'bookmarks')}</h2>
      <p className="hint">{t(lang, 'bookmarksNote')}</p>
      {ready && ok && saves.b.length === 0 && <p data-empty>{t(lang, 'noBookmarks')}</p>}
      {/* Before the island loads, the empty-state line keeps its space (hidden), so the surah list
          below does not move when it appears and a tap during loading opens the surah under it. */}
      {!ready && <p className="reserve" aria-hidden="true">{t(lang, 'noBookmarks')}</p>}
      {ready && saves.b.length > 0 && (
        <ul className="bookmarks" data-bookmarks>
          {saves.b.map(([s, a]) => (
            <li key={`${s}:${a}`} data-bm={`${s}:${a}`}>
              {refExists(counts, [s, a])
                ? <a href={ayahPath(lang, s, a)}>{name(s)} {s}:{a}</a>
                : <span className="msg alert" data-bad-bm>{t(lang, 'badRef', { s, a })}</span>}
              <button type="button" className="btn" aria-label={t(lang, 'removeBookmark', { name: name(s) || String(s), a })} onClick={() => remove(s, a)}>{t(lang, 'remove')}</button>
            </li>
          ))}
        </ul>
      )}
      {ready && saves.b.length > 0 && (!confirm
        ? <button type="button" className="btn" data-clear onClick={() => setConfirm(true)}>{t(lang, 'clearAll')}</button>
        : <p className="confirm">
            <button type="button" className="btn danger" data-clear-confirm onClick={clear}>{t(lang, 'clearConfirm')}</button>
            <button type="button" className="btn" data-clear-cancel onClick={() => setConfirm(false)}>{t(lang, 'cancel')}</button>
          </p>)}
      <p role="status" aria-live="polite" className="msg" data-saved-status>{msg}</p>
    </section>
  );
}
