#!/usr/bin/env node
/**
 * check.js — validation gate for protik.info. Run after build.js, before pushing.
 * Exits non-zero if anything is inconsistent. Usage: node check.js
 */
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('site-data.json', 'utf8'));
const SITE = data.site.url;
const issues = [];
const today = new Date().toISOString().slice(0, 10);
const PAGES = ['index.html', 'about.html', 'media.html', 'coaching.html', 'contact.html', 'working-with-me.html', 'ideas.html', 'press.html'];
const { execSync } = require('child_process');
const essayFiles = fs.readdirSync('ideas').filter(f => f.endsWith('.html'));
const BLOCK_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

// 1. site-data <-> files parity
const dataSlugs = new Set(data.essays.map(e => e.slug));
for (const f of essayFiles) if (!dataSlugs.has(f.replace('.html', ''))) issues.push(`ideas/${f} not in site-data.json`);
for (const s of dataSlugs) if (!essayFiles.includes(s + '.html')) issues.push(`site-data essay missing file: ${s}`);

// 2. dates
for (const e of data.essays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.datePublished) || !/^\d{4}-\d{2}-\d{2}$/.test(e.dateModified)) issues.push(`bad date format: ${e.slug}`);
  if (e.dateModified < e.datePublished) issues.push(`dateModified < datePublished: ${e.slug}`);
  if (e.datePublished > today && !e.scheduled) issues.push(`future datePublished without scheduled flag: ${e.slug} (${e.datePublished})`);
}

// 2b. every essay has keywords in site-data (the single source for BlogPosting keywords)
for (const e of data.essays) if (!Array.isArray(e.keywords) || e.keywords.length === 0) issues.push(`site-data essay has no keywords: ${e.slug}`);

// 2c. page lastmod must not predate the file's last commit (chrome changes count; content changes certainly do)
for (const p of data.pages) {
  const f = p.path === '/' ? 'index.html' : p.path.slice(1) + '.html';
  let last = '';
  try { last = execSync(`git log -1 --format=%cs -- ${f}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  if (last && p.lastmod < last) issues.push(`site-data page ${p.path} lastmod ${p.lastmod} predates last commit ${last}`);
  if (p.lastmod > today) issues.push(`site-data page ${p.path} lastmod in the future`);
}

// 3. JSON-LD validity + Person integrity
const findPersons = (o, out = []) => {
  if (Array.isArray(o)) o.forEach(x => findPersons(x, out));
  else if (o && typeof o === 'object') {
    if (o['@type'] === 'Person' && o.name === 'Protik Roychowdhury') out.push(o);
    Object.values(o).forEach(v => findPersons(v, out));
  }
  return out;
};
for (const f of [...PAGES, ...essayFiles.map(x => 'ideas/' + x)]) {
  const src = fs.readFileSync(f, 'utf8');
  let m, persons = [];
  while ((m = BLOCK_RE.exec(src))) {
    try { persons.push(...findPersons(JSON.parse(m[1]))); }
    catch (err) { issues.push(`invalid JSON-LD in ${f}: ${err.message}`); }
  }
  if (PAGES.includes(f)) {
    if (persons.length !== 1) issues.push(`${f}: ${persons.length} Protik Person nodes (want 1)`);
    else if ((persons[0].sameAs || []).length !== (data.person.sameAs || []).length) issues.push(`${f}: Person sameAs drift`);
  } else if (persons.length < 1) issues.push(`${f}: no Person stub`);
}

// 4. llms.txt / sitemap / feed parity
const llms = fs.readFileSync('llms.txt', 'utf8');
const sm = fs.readFileSync('sitemap.website.xml', 'utf8');
const feed = fs.readFileSync('feed.xml', 'utf8');
for (const e of data.essays) {
  const u = `${SITE}/ideas/${e.slug}`;
  if (!llms.includes(u)) issues.push(`llms.txt missing ${e.slug}`);
  if (!sm.includes(`<loc>${u}</loc>`)) issues.push(`sitemap missing ${e.slug}`);
  if (!feed.includes(`<id>${u}</id>`)) issues.push(`feed missing ${e.slug}`);
}
if (!llms.includes(`${data.essays.length} essays`)) issues.push('llms.txt essay count stale');
for (const p of data.pages) if (!sm.includes(`<loc>${SITE}${p.path === '/' ? '/' : p.path}</loc>`)) issues.push(`sitemap missing page ${p.path}`);

// 5. essays: summary block, og image, alternate links
for (const e of data.essays) {
  const src = fs.readFileSync(`ideas/${e.slug}.html`, 'utf8');
  if (!src.includes('article-summary')) issues.push(`no article-summary: ${e.slug}`);
  if (!fs.existsSync(`images/og/${e.slug}.png`)) issues.push(`missing og png: ${e.slug} (run scripts/gen-og.py)`);
  if (!src.includes(`images/og/${e.slug}.png`)) issues.push(`og:image tag mismatch: ${e.slug}`);
  if (!src.includes('application/atom+xml') || !src.includes('text/markdown')) issues.push(`missing alternate links: ${e.slug}`);
}

// 6. FAQ visible == schema
for (const p of ['about.html', 'media.html', 'coaching.html']) {
  const src = fs.readFileSync(p, 'utf8');
  const vis = (src.match(/class="faq-question"/g) || []).length;
  let sch = 0, m;
  while ((m = BLOCK_RE.exec(src))) {
    try { for (const n of (JSON.parse(m[1])['@graph'] || [])) if (n['@type'] === 'FAQPage') sch += n.mainEntity.length; } catch {}
  }
  if (vis !== sch) issues.push(`${p}: visible FAQs (${vis}) != schema (${sch})`);
}

// 7. internal links resolve
const allHtml = [...PAGES, ...essayFiles.map(x => 'ideas/' + x)];
for (const f of allHtml) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m2 of src.matchAll(/href="(\/[a-z0-9-]+(?:\.[a-z]+)?(?:\/[a-z0-9-]+)?)"/g)) {
    const p = m2[1].slice(1);
    if (m2[1] === '/') continue;
    if (!fs.existsSync(p + '.html') && !fs.existsSync(p)) issues.push(`broken link ${m2[1]} in ${f}`);
  }
}

// 8. shared chrome: every page carries all four BUILD zones, no page-level CSS
const ZONES = ['FONTS', 'NAV', 'FOOTER', 'SCRIPTS'];
const chromePages = [...PAGES, '404.html', ...essayFiles.map(x => 'ideas/' + x)];
for (const f of chromePages) {
  const src = fs.readFileSync(f, 'utf8');
  for (const z of ZONES) {
    if (!src.includes(`<!-- BUILD:${z} `) || !src.includes(`<!-- /BUILD:${z} -->`)) issues.push(`${f}: missing BUILD:${z} zone`);
  }
  if (src.includes('<style>')) issues.push(`${f}: page-level <style> block — move it into a named section of styles.css`);
  if (!src.includes('fonts.googleapis.com/css2')) issues.push(`${f}: no font stylesheet link in head`);
  if (!src.includes('rel="preconnect"')) issues.push(`${f}: no font preconnect in head`);
}

// 8b. the worker's nav list is generated, and the essay BlogPosting matches site-data
const worker = fs.readFileSync('_worker.js', 'utf8');
if (!worker.includes('// BUILD:WORKER-NAV')) issues.push('_worker.js: BUILD:WORKER-NAV markers missing');
for (const p of data.pages) if (!worker.includes(`[${p.title}](${SITE}${p.path === '/' ? '/' : p.path})`)) issues.push(`_worker.js nav missing ${p.path} (run build.js)`);
for (const e of data.essays) {
  const src = fs.readFileSync(`ideas/${e.slug}.html`, 'utf8');
  if (!src.includes(`"dateModified": "${e.dateModified}"`)) issues.push(`essay dateModified drift: ${e.slug} (run build.js)`);
}

// 9. first paint: nothing rests hidden, fonts are not chained through the CSS
const css = fs.readFileSync('styles.css', 'utf8');
if (/@import/.test(css)) issues.push('styles.css: @import — fonts must load via <link> in the page head');
if (/\.fade-in[^{]*\{[^}]*opacity:\s*0/.test(css)) issues.push('styles.css: .fade-in rests at opacity 0 — content must be visible at first paint');
const cssKb = Buffer.byteLength(css) / 1024;
if (cssKb > 40) issues.push(`styles.css is ${cssKb.toFixed(1)} KB (budget 40 KB)`);
const homeKb = fs.statSync('index.html').size / 1024;
if (homeKb > 40) issues.push(`index.html is ${homeKb.toFixed(1)} KB (budget 40 KB)`);

if (issues.length) {
  console.error(`CHECK FAILED — ${issues.length} issue(s):`);
  [...new Set(issues)].forEach(i => console.error(' - ' + i));
  process.exit(1);
}
console.log(`ALL CHECKS PASS ✓  (${data.essays.length} essays, ${allHtml.length} HTML files)`);
