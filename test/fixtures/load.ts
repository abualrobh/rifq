// Shared helper: synthetic source, index and Worker inputs for unit tests. No Quran data.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { makeSynthetic } from './synthetic.ts';
import { loadSource } from '../../src/core/source-adapter.ts';
import { buildIndex } from '../../scripts/build-index.ts';
import { openIndex } from '../../src/core/search-core.ts';

export function synthetic(tag = 'unit') {
  const dir = join(process.cwd(), '.synthetic', `${tag}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const syn = makeSynthetic(dir);
  const src = loadSource(syn.recordPath);
  const { buf } = buildIndex(src);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return { syn, src, ab, ix: openIndex(ab) };
}
