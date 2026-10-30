# Publishing workflow (protik.info)

## To publish a new essay
1. Write the essay HTML into `ideas/<slug>.html` (copy an existing essay as template; include the "The short version" summary block, JSON-LD with datePublished + dateModified, og:image pointing at `images/og/<slug>.png`, and the markdown/atom alternate links).
2. Add ONE entry to `site-data.json` → `essays` array (slug, title, rowTitle, headline, pillar, pillarColor, pillarLabel, readTime, dates, description, llmsTitle, llmsDesc, keywords).
3. Run: `python3 scripts/gen-og.py` (creates the OG card)
4. Run: `node build.js` (regenerates llms.txt, sitemap, feed, ideas list, homepage latest, schema)
5. Run: `node check.js` (must print ALL CHECKS PASS)
6. `git add -A && git commit -m "<what changed>" && git push` — Cloudflare deploys from `main`. Then confirm the URL returns 200 on protik.info.

## To change bio/role/profile facts
Edit `person` in `site-data.json`, run `node build.js` — it updates the schema on every page.
Then run `python3 scripts/gen-onepager.py` (needs `pip install reportlab`): it rebuilds the speaker one-pager PDF from `person.description` + `onepager` and refreshes it inside `press-kit.zip`. `check.js` fails while the PDF is stale.
Page copy and `press-kit.zip` → `bios.txt` are hand-written: search them for the old figure too.

## Never hand-edit
llms.txt essay list, sitemap.website.xml, feed.xml, the BUILD:-marked zones in ideas.html / index.html, the `twitter:` meta tags (mirrored from `og:`), protik-roychowdhury-onepager.pdf — build.js / gen-onepager.py own these and will overwrite.

## Deploy facts
- This folder IS the git clone of `protik001/personal-site` (since 17 Sep 2026). Cloudflare Workers Builds deploys `main`.
- `_worker.js` + `wrangler.jsonc` must stay in the repo: they provide the 301s, https/www redirect, security headers, markdown negotiation and the 404 page. `.assetsignore` keeps them from being served as files.
- Team-internal files (`.claude/`, `ops/`, `drafts/`, `CLAUDE.md`, `docs/`) are gitignored on purpose; the repo is public.
- CI: `.github/workflows/check.yml` runs `node build.js` (must produce no diff) and `node check.js` on every push. A red check means the push shipped something the gate would have caught; fix and push again.
- AI-crawler hits are logged by the worker: Workers & Pages → personal-site → Logs (`event: ai-crawl`), and as rows in the D1 database `protik-site-metrics`, table `ai_crawl` (query in `wrangler.jsonc`). Analytics Engine is not enabled on this account.
- The worker sends a Content-Security-Policy. Embedding a new third-party script, iframe or stylesheet host means adding it to `CSP` in `_worker.js`; `check.js` fails until you do.

## Notes
- An essay with a future date needs `"scheduled": true` or check.js fails.
- ARR figures etc. live in `site-data.json` → `person` → update once, applied everywhere.
