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

## Never hand-edit
llms.txt essay list, sitemap.website.xml, feed.xml, the BUILD:-marked zones in ideas.html / index.html — build.js owns these and will overwrite.

## Deploy facts
- This folder IS the git clone of `protik001/personal-site` (since 17 Sep 2026). Cloudflare Workers Builds deploys `main`.
- `_worker.js` + `wrangler.jsonc` must stay in the repo: they provide the 301s, https/www redirect, security headers, markdown negotiation and the 404 page. `.assetsignore` keeps them from being served as files.
- Team-internal files (`.claude/`, `ops/`, `drafts/`, `CLAUDE.md`, audits, strategy docs) are gitignored on purpose; the repo is public.

## Notes
- An essay with a future date needs `"scheduled": true` or check.js fails.
- ARR figures etc. live in `site-data.json` → `person` → update once, applied everywhere.
