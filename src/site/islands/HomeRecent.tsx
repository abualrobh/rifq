// RQ-008 home (kit v37): the recently read row (AC19, D-182 A): up to 3 surahs, most recent first,
// each opening that surah at its first ayah. Read from the device only (src/core/recent.ts); a surah
// number not in this build's source is dropped. Not shown when there is nothing to show, or when
// storage is blocked (AC13; HomeSaved shows the storageBlocked message once).
import { useEffect, useState } from 'react';
import { getStorage } from '../../core/store.ts';
import { loadRecent } from '../../core/recent.ts';
import { ayahPath, t, type Lang } from '../../core/strings.ts';
import { onDeviceChange } from '../client/device-events.ts';

type Props = { lang: Lang; counts: number[]; names: [string, string][] };

export default function HomeRecent({ lang, counts, names }: Props) {
  const [list, setList] = useState<number[]>([]);
  useEffect(() => {
    const st = getStorage(window);
    const read = () => setList(loadRecent(st).list.filter((s) => s >= 1 && s < counts.length && counts[s] >= 1));
    read();
    return onDeviceChange(read);
  }, [counts]);
  if (!list.length) return null;
  const nameLang = lang === 'ar' ? 'ar' : 'en';
  return (
    <section className="home-sec" aria-labelledby="recent-h" data-recent>
      <h2 id="recent-h">{t(lang, 'recentTitle')}</h2>
      <ul className="chips">
        {list.map((s) => (
          <li key={s}><a href={ayahPath(lang, s, 1)} data-recent-chip={s}><bdi lang={nameLang}>{names[s - 1]?.[lang === 'ar' ? 0 : 1] ?? ''}</bdi></a></li>
        ))}
      </ul>
    </section>
  );
}
