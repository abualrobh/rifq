// Shared by the RQ-006 continuity spec and the in-place mode of every spec (helpers.ts): the
// approved audio host is answered here with a made-up silent WAV of the length the mock says the
// surah file has (Range supported), so no request leaves the machine. No recitation audio is used.
import type { Page, Route } from '@playwright/test';
import { AUDIO_HOST } from '../../src/core/audio.ts';

export const STEP = 5000; // the mock's timing: ayah i runs from (i-1)*5000 to (i-1)*5000+4900 ms
const wavs = new Map<string, Buffer>();
export function wav(ms: number): Buffer {
  const k = String(ms);
  let b = wavs.get(k);
  if (b) return b;
  const rate = 4000, len = Math.ceil(ms / 1000) * rate + rate;
  b = Buffer.alloc(44 + len, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + len, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(len, 40);
  wavs.set(k, b);
  return b;
}
export type Hit = { url: string; headers: Record<string, string> };
// lengthOf(surah) in ms; the surah number is read from the file name (any path, double slashes too).
export async function serveAudio(page: Page, lengthOf: (s: number) => number, hits: Hit[] = []) {
  await page.context().route(`https://${AUDIO_HOST}/**`, async (route: Route) => {
    const req = route.request();
    hits.push({ url: req.url(), headers: await req.allHeaders() });
    const s = Number(/\/(\d+)\.mp3/.exec(new URL(req.url()).pathname)?.[1] ?? 1);
    const body = wav(lengthOf(s));
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
    if (!m) return route.fulfill({ status: 200, body, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' } });
    const a = Number(m[1]), z = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: 206, body: body.subarray(a, z + 1), headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${z}/${body.length}` } });
  });
}
export const audioState = (page: Page) => page.evaluate(() => { const a = document.querySelector('audio[data-audio]') as HTMLAudioElement | null; return a ? { paused: a.paused, ready: a.readyState, t: a.currentTime * 1000, src: a.currentSrc || a.getAttribute('src') || '', rate: a.playbackRate } : null; });
