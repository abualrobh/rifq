// RQ-005 AC23: untrusted Tafseer markup. Made-up strings only; no Tafseer text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_TAGS, blockText, decodeEntities, sanitize, tokenize, visibleText, type Node } from '../../src/core/tafseer-html.ts';
import { CASE, passageText } from '../mock/qf-mock.ts';

const tags = (ns: Node[]): string[] => ns.flatMap((n) => (typeof n === 'string' ? [] : [n.tag, ...tags(n.children)]));

test('AC23: only allowed tags survive, with no attributes, and dropped tags lose their content', () => {
  const html = passageText(901, 2, CASE.hostile)!;
  const out = sanitize(html);
  for (const t of tags(out)) assert.ok(ALLOWED_TAGS.has(t), t);
  const words = visibleText(out);
  assert.ok(words.includes('MOCK HOSTILE'));
  assert.ok(words.includes('bold') && words.includes('link words') && words.includes('styled words'));
  assert.ok(words.includes('& <tag>'), 'entities decoded to plain characters');
  assert.ok(words.includes('second paragraph AB'), 'numeric references decoded');
  for (const bad of ['__pwned', 'display:none', 'svg words', 'example.invalid', 'onerror', 'javascript:']) assert.ok(!words.includes(bad), bad);
  // Nodes are plain objects with a tag and children only: no attribute can reach the page.
  const walk = (ns: Node[]) => ns.forEach((n) => { if (typeof n !== 'string') { assert.deepEqual(Object.keys(n).sort(), ['children', 'tag']); walk(n.children); } });
  walk(out);
});

test('AC23: text characters are kept exactly (no normalization, no trimming, no reordering)', () => {
  // Canonically equivalent sequences in two orders must stay different after sanitizing.
  const a = String.fromCodePoint(0x628, 0x651, 0x650), b = String.fromCodePoint(0x628, 0x650, 0x651);
  const html = `<p>  ${a} ${b}\u00a0x  </p>`;
  assert.equal(visibleText(sanitize(html)), `  ${a} ${b}\u00a0x  `);
  assert.equal(visibleText(sanitize('plain text, no markup')), 'plain text, no markup');
});

test('malformed markup never becomes markup: stray "<", unclosed tags, case and comments', () => {
  assert.equal(visibleText(sanitize('a < b and c<d')), 'a < b and c<d');
  assert.equal(visibleText(sanitize('<P>x<B>y</p>z')), 'xyz');
  assert.equal(visibleText(sanitize('a<!-- hidden <script>x</script> -->b')), 'ab');
  assert.equal(visibleText(sanitize('<SCRIPT>bad()</SCRIPT>ok<ScRiPt src=x></sCrIpT>')), 'ok');
  assert.equal(visibleText(sanitize('<style>unterminated')), '');
  assert.equal(visibleText(sanitize('<img src="x" onerror="y">t')), 't');
  assert.equal(visibleText(sanitize('</p></b>stray close')), 'stray close');
  assert.deepEqual(tags(sanitize('<p><b>x</b><br>y</p>')), ['p', 'b', 'br']);
});

test('entities: a fixed list is decoded; unknown names, surrogates and NUL stay as written', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&apos;&nbsp;'), '&<>"\'\u00a0');
  assert.equal(decodeEntities('&#1576;&#x628;'), String.fromCodePoint(0x628, 0x628));
  assert.equal(decodeEntities('&copy; &#xD800; &#0; &#x110000;'), '&copy; &#xD800; &#0; &#x110000;');
  assert.equal(decodeEntities('&amp;amp;'), '&amp;');
});

test('blockText breaks at block edges and drops script and style', () => {
  assert.equal(blockText('<p>a</p><p>b<br>c</p><script>x</script><span>d</span>'), '\na\n\nb\nc\nd');
  assert.ok(tokenize('<a href="x" class="q c">t</a>').some((t) => t.t === 'open' && t.attrs.class === 'q c'));
});
