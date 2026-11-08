// Shape diagnostic for the private development page /dev/tafseer-shape/ (behind the password gate).
// It lists the key paths of a JSON response with each value's type, and for strings their length
// only. It never shows a string's content, a number's value or a boolean's value, so no Tafseer
// text reaches the page. Object keys are shown, because they are field names or ayah keys.
// Arrays are summarised: their length, then the merged shape of their elements as "[]".

export type ShapeLine = { path: string; type: string; count: number; minLen?: number; maxLen?: number; length?: number };

const MAX_LINES = 400;
const MAX_DEPTH = 8;
// Object keys come from the API. A key is shown only if it looks like a field name or an ayah
// key; anything else is replaced by a placeholder so no free text can appear through a key.
const SAFE_KEY = /^(?:[A-Za-z_][A-Za-z0-9_]{0,63}|\d{1,3}:\d{1,3}|\d{1,9})$/;

export function shapeOf(j: unknown): { lines: ShapeLine[]; truncated: boolean } {
  const map = new Map<string, ShapeLine>();
  let truncated = false;
  const note = (path: string, type: string, len?: number, arrLen?: number) => {
    const k = `${path}|${type}`;
    let l = map.get(k);
    if (!l) {
      if (map.size >= MAX_LINES) { truncated = true; return; }
      l = { path, type, count: 0 };
      map.set(k, l);
    }
    l.count++;
    if (len !== undefined) { l.minLen = Math.min(l.minLen ?? len, len); l.maxLen = Math.max(l.maxLen ?? len, len); }
    if (arrLen !== undefined) l.length = Math.max(l.length ?? 0, arrLen);
  };
  const walk = (x: unknown, path: string, depth: number) => {
    if (depth > MAX_DEPTH) { note(path, 'deeper (not shown)'); return; }
    if (x === null) return note(path, 'null');
    if (Array.isArray(x)) { note(path, 'array', undefined, x.length); x.forEach((e) => walk(e, path + '[]', depth + 1)); return; }
    if (typeof x === 'object') {
      note(path, 'object');
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) walk(v, `${path}.${SAFE_KEY.test(k) ? k : '<key not shown>'}`, depth + 1);
      return;
    }
    if (typeof x === 'string') return note(path, 'string', [...x].length);
    note(path, typeof x);
  };
  walk(j, '$', 0);
  return { lines: [...map.values()], truncated };
}
