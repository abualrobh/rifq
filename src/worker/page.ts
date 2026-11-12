// Server-rendered results page for a search sent before the island has loaded, or with JavaScript
// off. The form posts the query in the request body, so it never appears in a URL. This page has no
// script at all. Displayed ayah text is the index bytes, unchanged; highlights wrap whole words.
import type { ApiOut, SearchOk } from '../core/api.ts';
import { escapeHtml, segment } from '../core/highlight.ts';
import { PAGE } from '../core/search-core.ts';
import { ayahPath, homePath, surahPath, t, type Lang } from '../core/strings.ts';
import { bidiHtml } from '../core/bidi.ts';

export type PageCfg = { dev: boolean; record: { name: string; edition: string; status: string } };

export function errorText(lang: Lang, out: ApiOut, q: string, wait = 60): string | null {
  if (out.status === 200) return null;
  const e = (out.data as { error: string }).error;
  if (e === 'latin') return t(lang, 'latinOnly');
  if (e === 'too_long') return t(lang, 'tooLong', { n: [...q].length });
  if (e === 'empty') return t(lang, 'empty');
  if (e === 'rate_limited') return t(lang, 'rateLimited', { s: wait });
  return t(lang, 'searchError');
}

export function renderPage(lang: Lang, q: string, out: ApiOut, cfg: PageCfg, wait = 60): string {
  const h = escapeHtml;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const parts: string[] = [];
  const err = errorText(lang, out, q, wait);
  // Surah names in the interface language, from the index (copied from the source at build time).
  const nameLang = lang === 'en' ? 'en' : 'ar';
  const nameOf = (x: { name: string; en: string }) => (lang === 'en' ? x.en : x.name);
  if (err) {
    parts.push(`<p role="alert" class="msg">${h(err)}</p>`);
  } else {
    const d = out.data as SearchOk;
    if (d.ref === 'missing') parts.push(`<p class="msg">${h(t(lang, 'refMissing'))}</p>`);
    if (d.offers.length) {
      parts.push(`<nav aria-label="${h(t(lang, 'offersLabel'))}"><ul class="offers">`);
      for (const o of d.offers) {
        const label = o.kind === 'ayah' ? t(lang, 'offerAyah', { s: o.s, a: o.a, name: '' }) : t(lang, 'offerSurah', { s: o.s, name: '' });
        const href = o.kind === 'ayah' ? ayahPath(lang, o.s, o.a) : surahPath(lang, o.s);
        parts.push(`<li><a href="${h(href)}">${h(label)}<bdi lang="${nameLang}">${h(nameOf(o))}</bdi></a></li>`);
      }
      parts.push('</ul></nav>');
    }
    const status = d.total > 0 ? t(lang, 'resultCount', { n: d.total }) : d.offers.length ? t(lang, 'offerCount', { n: d.offers.length }) : t(lang, 'noResults');
    parts.push(`<p role="status">${h(status)}</p>`);
    parts.push('<ol class="results">');
    for (const r of d.results) {
      const text = segment(r.text, r.hl).map((p) => (p.hl ? `<mark>${h(p.text)}</mark>` : h(p.text))).join('');
      parts.push(`<li data-res="${r.s}:${r.a}"><a href="${h(ayahPath(lang, r.s, r.a))}"><bdi lang="${nameLang}">${h(nameOf(r))}</bdi>${h(t(lang, 'resultRef', { s: r.s, a: r.a }))}</a><p class="ayah" lang="ar" dir="rtl">${text}</p></li>`);
    }
    parts.push('</ol>');
    const pages = Math.ceil(d.total / PAGE);
    if (pages > 1) {
      parts.push(`<nav aria-label="${h(t(lang, 'pagesLabel'))}"><p>${h(t(lang, 'resultsPage', { p: d.page, n: pages }))}</p>`);
      for (const [p, key] of [[d.page - 1, 'prevPage'], [d.page + 1, 'nextPage']] as const) {
        if (p < 1 || p > pages) continue;
        parts.push(`<form method="post" action="/api/search" class="inline"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="q" value="${h(q)}"><input type="hidden" name="page" value="${p}"><button type="submit">${h(t(lang, key))}</button></form>`);
      }
      parts.push('</nav>');
    }
  }
  const banner = cfg.dev ? `<p class="banner" role="note">${bidiHtml(t(lang, 'devBanner'), lang === 'ar', h)}</p>` : '';
  return `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${h(t(lang, 'searchButton'))} - ${h(t(lang, 'siteName'))}</title><link rel="stylesheet" href="/rifq-basic.css"></head>
<body>${banner}<main>
<p><a href="${homePath(lang)}">${h(t(lang, 'home'))}</a></p>
<form method="post" action="/api/search" role="search"><input type="hidden" name="lang" value="${lang}"><label for="q">${h(t(lang, 'searchLabel'))}</label> <input id="q" name="q" type="search" dir="rtl" lang="ar" autocomplete="off" spellcheck="false" value="${h(q)}"> <button type="submit">${h(t(lang, 'searchButton'))}</button></form>
<p class="hint">${bidiHtml(t(lang, 'searchPlaceholderForm'), lang === 'ar', h)}</p>
${parts.join('\n')}
</main>
<footer><p>${h(t(lang, 'source'))}: <span dir="ltr">${h(cfg.record.name)}; ${h(cfg.record.edition)}; ${h(cfg.record.status)}</span></p></footer>
</body></html>`;
}
