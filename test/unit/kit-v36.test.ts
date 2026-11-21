// Kit v36: display fixes for English Tafseer (RQ-007) from QA v35.
//   FIND-BB  the English work's <h1>/<h2> headings are shown as headings, each on its own line
//            (src/core/tafseer-display.ts headingBlocks); display only, no character changes;
//   FIND-BA  <<...>> quotations split by markup inside an English line are one group (quoteGroups);
//            nested brackets and curly quotes around Arabic runs; lines that are Arabic apart from a
//            few Latin words (src/core/bidi.ts arabicRuns, isMostlyArabicLine).
// The matching files (scripts/build.ts MATCHING_FILES) are unchanged, so the Arabic check version
// stays m1-04181a887a9f0151 (tested below against the kit v35 value).
// Synthetic Quran data and made-up text only. This file holds no Arabic characters: Arabic letters
// are cut by program from the synthetic source or written as escapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetic } from '../fixtures/load.ts';
import { bareAyah, indexFromSource } from '../../src/core/tafseer-quotes.ts';
import { computeMarks, markedNodes, markedText, type MNode } from '../../src/core/tafseer-marks.ts';
import { sanitize, visibleText } from '../../src/core/tafseer-html.ts';
import { arabicRuns, hasOtherLetter, isArabicLine, isMostlyArabicLine } from '../../src/core/bidi.ts';
import { headingBlocks, quoteGroups, QUOTE_GROUP } from '../../src/core/tafseer-display.ts';
import { checkVersion } from '../../scripts/build.ts';

const { src } = synthetic('kit-v36');
const ix = indexFromSource(src.list);
const ayah = (s: number, a: number) => bareAyah(src.list.find((x) => x.sora === s && x.aya_no === a)!.aya_text).split(' ');
const [A, B, C] = ayah(1, 2);
const LQ = '\u00ab', RQ = '\u00bb', QM = '\u061f', SAW = '\ufdfa';
const tags = (n: MNode[]): string[] => n.map((x) => (typeof x === 'string' ? '#' : 'tfq' in x ? 'q' : x.tag));
const textOfNodes = (n: MNode[]) => markedText(n);

let seed = 36;
const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };

test('the matching files are unchanged: the Arabic check version is still the kit v35 one', () => {
  assert.equal(checkVersion(), 'm1-04181a887a9f0151');
});

test('FIND-BB: h1 and h2 become heading blocks around the same words, nothing added', () => {
  const html = '<h1>Title One</h1><h2>Heading A</h2><h2>Heading B</h2><p>Body words.</p>';
  const plain = sanitize(html) as MNode[];
  assert.deepEqual(tags(plain), ['#', '#', '#', 'p'], 'the sanitizer unwraps them (unchanged)');
  const r = headingBlocks(html, plain);
  assert.equal(r.headings, 3);
  assert.deepEqual(tags(r.nodes), ['tf-h1', 'tf-h2', 'tf-h2', 'p']);
  assert.deepEqual(r.nodes[0], { tag: 'tf-h1', children: ['Title One'] });
  assert.equal(textOfNodes(r.nodes), visibleText(sanitize(html)));
  // Headings between paragraphs, with inline markup, an entity and a stray close tag.
  const h2 = '<p>One.</p><h2>The <strong>Meaning</strong> &amp; more</h2><p>Two.</p></h2><h1></h1><p>Three</p>';
  const r2 = headingBlocks(h2, sanitize(h2) as MNode[]);
  assert.deepEqual(tags(r2.nodes), ['p', 'tf-h2', 'p', 'p'], 'the empty h1 has no words and no block');
  assert.equal(textOfNodes(r2.nodes), visibleText(sanitize(h2)));
});

test('FIND-BB: unclosed, nested and inline headings', () => {
  const un = '<h2>Open heading<p>Para</p>tail';
  assert.deepEqual(tags(headingBlocks(un, sanitize(un) as MNode[]).nodes), ['tf-h2', 'p', '#'], 'an unclosed heading ends at the next block');
  const nest = '<h2>First<h1>Second</h1>after</h2>';
  assert.deepEqual(tags(headingBlocks(nest, sanitize(nest) as MNode[]).nodes), ['tf-h2', 'tf-h1', '#'], 'a heading start ends the open heading');
  const inner = '<p>Text <b><h2>In bold</h2></b> more</p>';
  const r = headingBlocks(inner, sanitize(inner) as MNode[]);
  assert.deepEqual(tags((r.nodes[0] as { children: MNode[] }).children), ['#', 'b', '#']);
  assert.deepEqual(tags(((r.nodes[0] as { children: MNode[] }).children[1] as { children: MNode[] }).children), ['tf-h2']);
  const none = '<p>No headings</p><h3>An h3 stays an h3</h3>';
  const n0 = sanitize(none) as MNode[];
  assert.equal(headingBlocks(none, n0).nodes, n0, 'no h1/h2: the same nodes');
  // Dropped content (script) holding a heading is still dropped.
  const drop = '<script><h1>x</h1></script><h2>Shown</h2>';
  assert.deepEqual(headingBlocks(drop, sanitize(drop) as MNode[]).nodes, [{ tag: 'tf-h2', children: ['Shown'] }]);
});

test('FIND-BB: with the D-149 marks, the styled phrases stay as they are inside and outside headings', () => {
  const html = `<h1>Mock title (${A} ${B})</h1><h2>Mock heading</h2><p>Mock (${A} ${B} ${C}) and (mock words) and {${A}}.</p>`;
  const marks = computeMarks(ix, html, { s: 1, from: 2, to: 2 }, false);
  const m = markedNodes(html, marks)!;
  const r = headingBlocks(html, m.nodes);
  assert.deepEqual(tags(r.nodes), ['tf-h1', 'tf-h2', 'p']);
  assert.equal(textOfNodes(r.nodes), textOfNodes(m.nodes));
  const q = (n: MNode[]): number => n.reduce<number>((k, x) => k + (typeof x === 'string' ? 0 : 'tfq' in x ? 1 : q(x.children)), 0);
  assert.equal(q(r.nodes), q(m.nodes));
});

test('FIND-BB: fuzz: the words in order are the same before and after, and every h1/h2 with words is one heading', () => {
  const P = ['<h1>', '</h1>', '<h2>', '</h2>', '<p>', '</p>', '<b>', '</b>', '<br>', '<span>', '</span>', '<div>', '</div>', ' ', 'Mock', 'Words', '(', ')', '{', '}', '&amp;', '<script>s</script>', '<!-- c -->', A, B, C, SAW, LQ, RQ];
  let made = 0;
  for (let k = 0; k < 20000; k++) {
    let html = '';
    const n = 1 + rnd(30);
    for (let i = 0; i < n; i++) html += P[rnd(P.length)];
    const plain = sanitize(html) as MNode[];
    const r = headingBlocks(html, plain);
    assert.equal(textOfNodes(r.nodes), markedText(plain), html);
    made += r.headings;
    const marks = computeMarks(ix, html, { s: 1, from: 2, to: 2 }, false);
    const m = markedNodes(html, marks);
    if (m) {
      const r2 = headingBlocks(html, m.nodes);
      assert.equal(textOfNodes(r2.nodes), textOfNodes(m.nodes), html);
      assert.equal(r2.headings, r.headings, html);
    }
  }
  assert.ok(made > 1000);
});

test('FIND-BA 1: a quotation split by markup in one line is one group with both marks; otherwise unchanged', () => {
  const html = `<p>Split ${LQ}<b>${A}</b> ${B}${RQ} end</p>`;
  const n = quoteGroups(sanitize(html) as MNode[]);
  const p = (n[0] as { children: MNode[] }).children;
  assert.deepEqual(tags(p), ['#', QUOTE_GROUP, '#']);
  assert.deepEqual(p[0], 'Split ');
  assert.deepEqual((p[1] as { children: MNode[] }).children, [LQ, { tag: 'b', children: [A] }, ` ${B}${RQ}`]);
  assert.equal(p[2], ' end');
  assert.equal(markedText(n), visibleText(sanitize(html)));
  // Not grouped: a Latin letter inside, a line break inside, the marks in one text node, no close.
  for (const h of [`<p>X ${LQ}<b>${A}</b> Ibn ${B}${RQ} y</p>`, `<p>X ${LQ}${A}<br>${B}${RQ} y</p>`, `<p>X ${LQ}${A} ${B}${RQ} y</p>`, `<p>X ${LQ}<b>${A}</b> ${B} y</p>`, `<p>X ${LQ}<b>${A} ${B}${RQ}</b> y</p>`]) {
    const s = sanitize(h) as MNode[];
    assert.deepEqual(quoteGroups(s), s, h);
  }
  // With a styled phrase in the middle, and two quotations in one paragraph.
  const h2 = `<p>Mock ${LQ}${A} (${B} ${C}) ${A}${RQ} and ${LQ}<i>${B}</i>${QM}${RQ} done</p>`;
  const marks = computeMarks(ix, h2, { s: 1, from: 2, to: 2 }, false);
  const m = markedNodes(h2, marks)!;
  const g = quoteGroups(m.nodes);
  assert.deepEqual(tags((g[0] as { children: MNode[] }).children), ['#', QUOTE_GROUP, '#', QUOTE_GROUP, '#']);
  assert.equal(markedText(g), markedText(m.nodes));
});

test('FIND-BA 1: fuzz: grouping keeps every character in order and groups hold no Latin letter', () => {
  const P = ['<p>', '</p>', '<b>', '</b>', '<i>', '</i>', '<br>', ' ', 'Mock', '(', ')', LQ, RQ, '\u2039', '\u203a', A, B, QM, '12'];
  for (let k = 0; k < 20000; k++) {
    let html = '';
    const n = 1 + rnd(25);
    for (let i = 0; i < n; i++) html += P[rnd(P.length)];
    const s = sanitize(html) as MNode[];
    const g = quoteGroups(s);
    assert.equal(markedText(g), markedText(s), html);
    const check = (x: MNode[]) => { for (const y of x) if (typeof y === 'object' && !('tfq' in y)) { if (y.tag === QUOTE_GROUP) assert.ok(!hasOtherLetter(markedText(y.children)), html); check(y.children); } };
    check(g);
  }
});

test('FIND-BA 2-4: nested brackets, curly quotes, line edges and mostly Arabic lines', () => {
  const runs = (t: string, e?: { open: boolean; close: boolean }) => arabicRuns(t, e).filter((p) => p.ar).map((p) => p.text);
  // Nested brackets: one run with both outer brackets.
  assert.deepEqual(runs(`see ( ${A} (${B}) ) here`), [`( ${A} (${B}) )`]);
  assert.deepEqual(runs(`see ((${A})) here`), [`(${A})`]);
  assert.deepEqual(runs(`see (${A} (2:255)) here`), [`(${A} (2:255))`]);
  // Curly quotes stay outside the run.
  assert.deepEqual(runs(`he said \u201c${A} ${B}${QM}\u201d then`), [`${A} ${B}${QM}`]);
  // Edges: without them, a guillemet at the start or end of the text stays outside.
  assert.deepEqual(runs(`${A} ${B}${RQ} end`), [`${A} ${B}${RQ}`], 'kit v35 default');
  assert.deepEqual(runs(`${A} ${B}${RQ} end`, { open: true, close: false }), [`${A} ${B}`]);
  assert.deepEqual(runs(`go ${LQ}${A} ${B}`, { open: false, close: true }), [`${A} ${B}`]);
  assert.deepEqual(runs(`go ${LQ}${A} ${B}`), [`${LQ}${A} ${B}`], 'kit v35 default');
  for (const t of [`see ( ${A} (${B}) ) here`, `he said \u201c${A}\u201d`, `${A}${RQ} x`]) for (const e of [undefined, { open: false, close: false }]) assert.equal(arabicRuns(t, e).map((p) => p.text).join(''), t);
  // Mostly Arabic lines.
  assert.equal(isMostlyArabicLine(`${LQ}${A} Ibn ${B} ${C}${RQ}`), true);
  assert.equal(isMostlyArabicLine(`${A} ${B} ${C}`), false, 'an Arabic line is not "mostly" Arabic');
  assert.equal(isArabicLine(`${A} ${B} ${C}`), true);
  assert.equal(isMostlyArabicLine(`${LQ}${A}${RQ} said the mock words ${LQ}${B}${RQ}`), false, 'English sentence');
  assert.equal(isMostlyArabicLine(`Ibn ${A} ${B} ${C}`), false, 'starts with Latin');
  assert.equal(isMostlyArabicLine('Mock only'), false);
});
