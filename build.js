#!/usr/bin/env node
/**
 * build.js — regenerates all derived files for protik.info from site-data.json.
 *
 * Regenerates: llms.txt, sitemap.website.xml, feed.xml,
 *              ideas.html rows + Blog schema, index.html "Latest thinking",
 *              canonical Person JSON-LD on all main pages.
 * Never touches: essay body HTML, page copy, styles.
 *
 * Usage: node build.js   (then: node check.js)
 */
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('site-data.json', 'utf8'));
const SITE = data.site.url;
const essays = [...data.essays].sort((a, b) => b.datePublished.localeCompare(a.datePublished));
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = d => `${MONTHS[parseInt(d.slice(5, 7), 10)]} ${d.slice(0, 4)}`;

// ---------- llms.txt ----------
{
  let t = fs.readFileSync('templates/llms.template.txt', 'utf8');
  t = t.replace('{{ESSAY_COUNT}}', String(essays.length));
  t = t.replace('{{ESSAYS}}', essays.map(e =>
    `- "${e.llmsTitle}" — ${monYear(e.datePublished)}, ${e.readTime}. ${e.llmsDesc} ${SITE}/ideas/${e.slug}`
  ).join('\n'));
  t = t.replace('{{POSITIONS}}', data.positions.map((p, i) => `${i + 1}. "${p}"`).join('\n'));
  t = t.replace('{{ESSAY_PAGES}}', essays.map(e =>
    `- Ideas — ${e.llmsTitle}: ${SITE}/ideas/${e.slug}`
  ).join('\n'));
  fs.writeFileSync('llms.txt', t);
  console.log(`llms.txt: ${essays.length} essays`);
}

// ---------- sitemap.website.xml ----------
{
  const urls = [];
  for (const p of data.pages) {
    urls.push(`  <url>\n    <loc>${SITE}${p.path === '/' ? '/' : p.path}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`);
  }
  for (const e of essays) {
    urls.push(`  <url>\n    <loc>${SITE}/ideas/${e.slug}</loc>\n    <lastmod>${e.dateModified}</lastmod>\n    <changefreq>yearly</changefreq>\n    <priority>0.7</priority>\n  </url>`);
  }
  fs.writeFileSync('sitemap.website.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  console.log(`sitemap.website.xml: ${urls.length} URLs`);
}

// ---------- feed.xml ----------
{
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = essays.map(e => `  <entry>
    <title>${esc(e.title)}</title>
    <link href="${SITE}/ideas/${e.slug}"/>
    <id>${SITE}/ideas/${e.slug}</id>
    <published>${e.datePublished}T00:00:00Z</published>
    <updated>${e.dateModified}T00:00:00Z</updated>
    <summary>${esc(e.description)}</summary>
    <author><name>Protik Roychowdhury</name></author>
  </entry>`).join('\n');
  const updated = essays.reduce((m, e) => e.dateModified > m ? e.dateModified : m, '');
  fs.writeFileSync('feed.xml', `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${data.site.feedTitle}</title>
  <subtitle>${data.site.feedSubtitle}</subtitle>
  <link href="${SITE}/feed.xml" rel="self"/>
  <link href="${SITE}/"/>
  <id>${SITE}/</id>
  <updated>${updated}T00:00:00Z</updated>
  <author><name>Protik Roychowdhury</name></author>
${items}
</feed>
`);
  console.log(`feed.xml: ${essays.length} entries`);
}

// ---------- helpers for JSON-LD blocks ----------
const BLOCK_RE = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;
const serialize = obj => '\n  ' + JSON.stringify(obj, null, 2).replace(/\n/g, '\n  ') + '\n  ';

// ---------- ideas.html: rows + Blog schema ----------
{
  let src = fs.readFileSync('ideas.html', 'utf8');
  const rowsAll = [
    ...essays.map(e => ({ sort: e.datePublished, html:
      `        <li><a href="/ideas/${e.slug}" class="idea-row" data-pillar="${e.pillar}"><span class="idea-row-title">${e.rowTitle}</span><span class="idea-row-right"><span class="idea-row-pillar" data-color="${e.pillarColor}">${e.pillarLabel}</span><span class="idea-row-time">${e.readTime}</span></span></a></li>` })),
    ...data.externalArticles.map(x => ({ sort: x.sortDate, html:
      `        <li><a href="${x.url}" target="_blank" rel="noopener" class="idea-row" data-pillar="${x.pillar}"><span class="idea-row-title">${x.rowTitle} &nearr;</span><span class="idea-row-right"><span class="idea-row-pillar" data-color="${x.pillarColor}">${x.pillarLabel}</span></span></a></li>` })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  src = src.replace(/( *<!-- BUILD:IDEAS-ROWS[^>]*-->)[\s\S]*?( *<!-- \/BUILD:IDEAS-ROWS -->)/,
    (m, a, b) => a + '\n' + rowsAll.map(r => r.html).join('\n') + '\n' + b);

  // Blog schema: rebuild the BlogPosting array in place
  src = src.replace(BLOCK_RE, (full, open, body, close) => {
    const json = JSON.parse(body);
    const rebuild = o => {
      if (Array.isArray(o)) {
        if (o.some(x => x && x['@type'] === 'BlogPosting')) {
          return essays.map(e => ({
            '@type': 'BlogPosting', headline: e.headline, datePublished: e.datePublished,
            dateModified: e.dateModified, author: { '@id': `${SITE}/#person` },
            url: `${SITE}/ideas/${e.slug}`, description: e.llmsDesc || e.description,
            keywords: e.keywords,
          }));
        }
        return o.map(rebuild);
      }
      if (o && typeof o === 'object') { for (const k of Object.keys(o)) o[k] = rebuild(o[k]); }
      return o;
    };
    return open + serialize(rebuild(json)) + close;
  });
  fs.writeFileSync('ideas.html', src);
  console.log(`ideas.html: ${rowsAll.length} rows, Blog schema rebuilt`);
}

// ---------- index.html: Latest thinking ----------
{
  let src = fs.readFileSync('index.html', 'utf8');
  const latest = essays.slice(0, 4).map(e => `            <li>
              <a href="/ideas/${e.slug}" class="thinking-item">
                <div class="thinking-header">
                  <span class="thinking-title">${e.rowTitle}</span>
                  <span class="thinking-topic">${e.pillarLabel}</span>
                </div>
                <div class="thinking-desc">${e.llmsDesc || e.description}</div>
              </a>
            </li>`).join('\n');
  src = src.replace(/( *<!-- BUILD:LATEST[^>]*-->)[\s\S]*?( *<!-- \/BUILD:LATEST -->)/,
    (m, a, b) => a + '\n' + latest + '\n' + b);
  fs.writeFileSync('index.html', src);
  console.log(`index.html: latest 4 = ${essays.slice(0, 4).map(e => e.slug).join(', ')}`);
}

// ---------- canonical Person on all main pages ----------
{
  const pages = ['index.html', 'about.html', 'media.html', 'coaching.html', 'contact.html', 'working-with-me.html', 'ideas.html', 'press.html'];
  for (const p of pages) {
    let src = fs.readFileSync(p, 'utf8');
    let done = false;
    src = src.replace(BLOCK_RE, (full, open, body, close) => {
      if (done) return full;
      const json = JSON.parse(body);
      if (!json['@graph']) return full;
      const i = json['@graph'].findIndex(n => n['@type'] === 'Person' && String(n['@id'] || '').endsWith('#person'));
      if (i === -1) return full;
      json['@graph'][i] = data.person;
      done = true;
      return open + serialize(json) + close;
    });
    fs.writeFileSync(p, src);
  }
  console.log(`canonical Person injected on ${pages.length} pages`);
}

console.log('\nBuild complete. Now run: node check.js');
