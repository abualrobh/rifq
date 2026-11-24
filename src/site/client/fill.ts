// Fills an interface string's {placeholders} with React nodes, in the string's own order, so a value
// can be isolated (bdi) inside the text without changing the words (RQ-008 AC36: S:A is read in the
// right order). "{s}:{a}" is one reference and is filled as a whole by `ref` when it is given.
import { createElement, Fragment, type ReactNode } from 'react';
import { STRINGS, type Key, type Lang } from '../../core/strings.ts';

export function fill(lang: Lang, key: Key, vars: Record<string, ReactNode>): ReactNode {
  let tpl: string = STRINGS[lang][key];
  if ('ref' in vars) tpl = tpl.replace('{s}:{a}', '{ref}');
  const parts = tpl.split(/(\{\w+\})/);
  return createElement(Fragment, null, ...parts.map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return m ? createElement(Fragment, { key: i }, vars[m[1]] ?? '') : p;
  }));
}

// The reference S:A in Latin digits, isolated left to right (D-065, AC36).
export const refNode = (s: number, a: number, extra: Record<string, string> = {}) => createElement('bdi', { dir: 'ltr', ...extra }, `${s}:${a}`);
