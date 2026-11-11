// RQ-004 AC18 to AC21: the continue reading shortcut above the surah index. It only reads the saved
// position (RQ-003); opening the index never changes it, and it is never sent anywhere. A saved
// reference that is not in this build's source shows the RQ-003 AC10 message instead.
import { useEffect, useState } from 'react';
import { getStorage, load, refExists, type Ref } from '../../core/store.ts';
import { ayahPath, t, type Lang } from '../../core/strings.ts';

type Props = { lang: Lang; counts: number[]; names: [string, string][] };

export default function Continue({ lang, counts, names }: Props) {
  const [last, setLast] = useState<Ref | null>(null);
  useEffect(() => {
    const st = getStorage(window);
    const read = () => setLast(load(st).saves.l);
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  if (!last) return null;
  if (!refExists(counts, last)) return <p className="msg alert" data-bad-last>{t(lang, 'badRef', { s: last[0], a: last[1] })}</p>;
  const name = names[last[0] - 1]?.[lang === 'ar' ? 0 : 1] ?? '';
  return (
    <p className="continue">
      <a data-continue href={ayahPath(lang, last[0], last[1])}>{t(lang, 'continueReading', { name, a: last[1] })}<span className="continue-ref"><bdi dir="ltr" data-continue-ref>{last[0]}:{last[1]}</bdi></span></a>
    </p>
  );
}
