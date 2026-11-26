// The recitation source details (RQ-006, RQ-008 AC52, audioSourceDetails): the table behind the
// reader page's reciter button (islands/AudioPlayer.tsx). Kit v42: shared, unchanged in content, with
// the mini-player's "more" sheet at large text (D-270 A), which shows the same details; idBase keeps
// the heading's id unique when both are on a page. The markup with idBase "ap" is the kit v41 markup.
// D-267 A (QA FIND-CO): the two columns stack when the panel is narrow for its text (global.css).
import { t, type Lang } from '../../core/strings.ts';
import type { Reciter } from '../client/recitation.ts';
import BidiText from './BidiText.tsx';

// A name with Latin letters is English, otherwise Arabic (as before).
const nameLang = (n: string) => (/[A-Za-z]/.test(n) ? 'en' : 'ar');

export default function SourceDetails({ lang, reciter, idBase }: { lang: Lang; reciter: Reciter; idBase: string }) {
  const h = `${idBase}-src-h`;
  return (
    <>
      <p className="ap-src-h" id={h}>{t(lang, 'audioSourceDetails')}</p>
      <dl className="ap-source" data-audio-source aria-labelledby={h}>
        <dt>{t(lang, 'audioReciter')}</dt><dd><bdi lang={nameLang(reciter.name)}>{reciter.name}</bdi></dd>
        {/* QA FIND-4: Latin text inside the Arabic page is isolated. */}
        <dt>{t(lang, 'audioStyle')}</dt><dd>{reciter.style ? <bdi lang={nameLang(reciter.style)}>{reciter.style}</bdi> : t(lang, 'notStated')}</dd>
        <dt>{t(lang, 'audioRiwayah')}</dt><dd>{reciter.qirat ? <bdi lang={nameLang(reciter.qirat)}>{reciter.qirat}</bdi> : t(lang, 'notStated')}</dd>
        <dt><BidiText text={t(lang, 'audioReciterId')} lang={lang} /></dt><dd>{reciter.id}</dd>
        <dt>{t(lang, 'source')}</dt><dd><bdi lang="en" dir="ltr">Quran Foundation</bdi></dd>
        <dt>{t(lang, 'audioLicenceL')}</dt><dd><BidiText text={t(lang, 'audioLicence')} lang={lang} /></dd>
      </dl>
    </>
  );
}
