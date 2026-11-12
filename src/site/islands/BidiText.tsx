// React form of src/site/components/Bidi.astro: each Latin run in Arabic text is isolated as a
// left-to-right box, and the text itself is unchanged (src/core/bidi.ts).
import { bidiParts } from '../../core/bidi.ts';
import type { Lang } from '../../core/strings.ts';

export default function BidiText({ text, lang }: { text: string; lang: Lang }) {
  return <>{bidiParts(text, lang === 'ar').map((p, i) => (p.ltr ? <bdi key={i} dir="ltr" data-ltr-run="">{p.text}</bdi> : p.text))}</>;
}
