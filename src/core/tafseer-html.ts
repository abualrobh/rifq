// Untrusted Tafseer markup (RQ-005 AC23). The Quran Foundation API documents `text` as an
// "HTML-formatted tafsir body". RIFQ never puts that string into an HTML parser in the browser:
// it is split here into a flat list of tokens, and the island builds elements from the tokens
// with React (text nodes and a short list of plain tags, with no attributes at all). So whatever
// the string holds, no script can run and no outside resource can load, and the worst a malformed
// string can do is show some markup as plain text. The content security policy is a second wall.
//
// The words are never changed: text tokens hold the characters of the string as delivered, with
// only HTML character references decoded (a small, fixed list, see ENTITIES). Nothing is
// normalized, reordered, trimmed or translated. The delivered string itself is passed to the
// browser unchanged (AC4); only its display goes through this file.
//
// Pure TypeScript with no DOM, so the Worker, the build scripts, the tests and the island share it.

// Plain formatting tags that are shown as tags. Every attribute is dropped.
export const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'sup', 'sub', 'span', 'div', 'blockquote', 'ul', 'ol', 'li', 'h3', 'h4', 'h5', 'h6']);
// Tags whose content is not reading text (code, styles, embedded documents, form fields). The tag
// and everything inside it are dropped. Any other tag is unwrapped: the tag goes, its text stays.
export const DROP_WITH_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'textarea', 'title', 'head', 'select', 'option', 'xmp', 'noembed', 'noframes', 'plaintext', 'frameset']);
// Void tags: never have a closing tag.
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param']);
// Block tags: the D-078 quote finder treats their edges as text breaks.
export const BLOCK_TAGS = new Set(['p', 'br', 'div', 'blockquote', 'ul', 'ol', 'li', 'h3', 'h4', 'h5', 'h6']);

// Named character references that are decoded. Others are left as written (shown literally).
export const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  zwnj: '\u200c', zwj: '\u200d', lrm: '\u200e', rlm: '\u200f', shy: '\u00ad',
};

export type Token =
  | { t: 'text'; v: string }
  | { t: 'open'; tag: string; attrs: Record<string, string> }
  | { t: 'close'; tag: string };

export function decodeEntities(s: string): string {
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (m, body: string) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Surrogates, NUL and values past U+10FFFF are not characters: keep the reference as text.
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return m;
      return String.fromCodePoint(n);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of s.matchAll(re)) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

// Splits the string into tokens. Comments, doctypes and processing instructions are dropped.
// A "<" that does not start a tag is kept as text.
export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: decodeEntities(text) }); text = ''; } };
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text += html.slice(i); break; }
    text += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt, Math.min(n, lt + 4096)));
    if (!m) { text += '<'; i = lt + 1; continue; }
    flush();
    const tag = m[2].toLowerCase();
    if (m[1]) out.push({ t: 'close', tag });
    else {
      out.push({ t: 'open', tag, attrs: parseAttrs(m[3]) });
      if (DROP_WITH_CONTENT.has(tag)) {
        // Raw content: skip to the matching close tag (case-insensitive), or to the end.
        const close = new RegExp(`</${tag}\\s*>`, 'i');
        const rest = html.slice(lt + m[0].length);
        const c = close.exec(rest);
        const skip = c ? c.index + c[0].length : rest.length;
        out.push({ t: 'close', tag });
        i = lt + m[0].length + skip;
        continue;
      }
    }
    i = lt + m[0].length;
  }
  flush();
  return out;
}

// A display node: a text run or an allowed element with children. No attributes exist here.
export type Node = string | { tag: string; children: Node[] };

// Turns tokens into a tree of allowed tags. Dropped tags lose their content; other unknown tags are
// unwrapped. Unbalanced tags are closed at the end; a stray close tag is ignored.
export function sanitize(html: string): Node[] {
  const root: Node[] = [];
  const stack: { tag: string; children: Node[] }[] = [];
  const top = () => (stack.length ? stack[stack.length - 1].children : root);
  let dropping = 0;
  let dropTag = '';
  for (const tk of tokenize(html)) {
    if (dropping) {
      if (tk.t === 'close' && tk.tag === dropTag) dropping--;
      continue;
    }
    if (tk.t === 'text') { if (tk.v) top().push(tk.v); continue; }
    if (tk.t === 'open') {
      if (DROP_WITH_CONTENT.has(tk.tag)) { dropping = 1; dropTag = tk.tag; continue; }
      if (!ALLOWED_TAGS.has(tk.tag)) continue;
      if (tk.tag === 'br') { top().push({ tag: 'br', children: [] }); continue; }
      const el = { tag: tk.tag, children: [] as Node[] };
      top().push(el);
      if (!VOID.has(tk.tag)) stack.push(el);
      continue;
    }
    if (!ALLOWED_TAGS.has(tk.tag) || VOID.has(tk.tag)) continue;
    const k = stack.map((x) => x.tag).lastIndexOf(tk.tag);
    if (k >= 0) stack.length = k;
  }
  return root;
}

// The words a reader sees, in order: every text run joined with nothing added.
export function visibleText(nodes: Node[]): string {
  let s = '';
  for (const n of nodes) s += typeof n === 'string' ? n : visibleText(n.children);
  return s;
}

// The same text, with a line break at block edges. Used by the D-078 quote finder so a quote can
// never be read across two paragraphs.
export function blockText(html: string): string {
  let s = '';
  let dropping = 0, dropTag = '';
  for (const tk of tokenize(html)) {
    if (dropping) { if (tk.t === 'close' && tk.tag === dropTag) dropping--; continue; }
    if (tk.t === 'text') s += tk.v;
    else if (tk.t === 'open' && DROP_WITH_CONTENT.has(tk.tag)) { dropping = 1; dropTag = tk.tag; }
    else if (BLOCK_TAGS.has(tk.tag)) s += '\n';
  }
  return s;
}
