// Kit v41 (D-254, Quran Foundation Developer Terms 2026-11-20: "Credit Quran Foundation and the
// reciter"): the recitation credit, behind the reader page's reciter button (islands/AudioPlayer.tsx)
// and in Settings (islands/SettingsScreen.tsx), names the reciter, as Quran Foundation gives the
// name, and Quran Foundation (audioCreditBy). The name is isolated as everywhere else (Latin letters:
// English, otherwise Arabic); the words around it keep BidiText's isolation of Latin runs (the same
// markup as islands/BidiText.tsx). Before the reciter list has loaded in this tab the name is not
// known, and the earlier credit (audioCredit, Quran Foundation only) shows until it is.
import { createElement, Fragment, type ReactNode } from 'react';
import { bidiParts } from '../../core/bidi.ts';
import { STRINGS, type Lang } from '../../core/strings.ts';

const bidi = (text: string, lang: Lang): ReactNode[] =>
  bidiParts(text, lang === 'ar').map((p, i) => (p.ltr ? createElement('bdi', { key: i, dir: 'ltr', 'data-ltr-run': '' }, p.text) : p.text));

export function creditNode(lang: Lang, name: string | null | undefined): ReactNode {
  if (!name) return createElement(Fragment, null, ...bidi(STRINGS[lang].audioCredit, lang));
  const [before, after] = STRINGS[lang].audioCreditBy.split('{name}');
  return createElement(Fragment, null,
    createElement(Fragment, { key: 'b' }, ...bidi(before, lang)),
    createElement('bdi', { key: 'n', lang: /[A-Za-z]/.test(name) ? 'en' : 'ar', 'data-credit-reciter': '' }, name),
    createElement(Fragment, { key: 'a' }, ...bidi(after ?? '', lang)));
}
