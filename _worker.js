/**
 * Cloudflare Worker for protik.info
 *
 * 0. Forces https and the apex host (http:// and www. → https://protik.info)
 * 1. 301-redirects legacy URLs (/speaking, /publications, /blog, /sitemap.xml)
 * 2. Serves a clean robots.txt (bypasses Cloudflare's managed injection)
 * 3. Returns markdown when agents send Accept: text/markdown
 * 4. Passes everything else through to the ASSETS binding
 * 5. Adds security headers (HSTS, nosniff, referrer, frame, permissions) to every response
 * 6. Logs AI crawler and AI-agent fetches: structured console line + a row in D1 (METRICS_DB.ai_crawl)
 *
 * NOTE: requires "run_worker_first": true in wrangler.jsonc — without it,
 * Cloudflare serves matching static assets before this worker runs and
 * features 1–3 never execute.
 */

// Legacy URL → canonical URL (301)
const REDIRECTS = {
  '/speaking': '/media',
  '/publications': '/media',
  '/blog': '/ideas',
  '/blog/payments-at-scale-lessons-from-grab': '/ideas/payments-at-scale-lessons-from-grab',
  '/blog/marketplace-lessons-from-ola': '/ideas/marketplace-lessons-from-ola',
  '/sitemap.xml': '/sitemap.website.xml',
};

const CLEAN_ROBOTS_TXT = `# robots.txt for protik.info
# Welcome all crawlers including LLM bots

User-agent: *
Allow: /
Disallow:

Sitemap: https://protik.info/sitemap.website.xml

# LLM crawlers — explicitly welcomed
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Googlebot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Bytespider
Allow: /

User-agent: CCBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Applebot
Allow: /

User-agent: meta-externalagent
Allow: /

User-agent: Meta-ExternalFetcher
Allow: /

User-agent: FacebookBot
Allow: /

User-agent: BingBot
Allow: /

User-agent: DuckAssistBot
Allow: /

User-agent: MistralAI-User
Allow: /

User-agent: Manus Bot
Allow: /

User-agent: PetalBot
Allow: /
`;

// AI crawlers and AI-agent fetchers we want to count. Matched case-insensitively against the UA.
// The CPO's leading indicator: hits per bot per week (see ops/metrics.md).
const AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'GoogleOther', 'Bytespider', 'CCBot', 'Amazonbot',
  'Applebot-Extended', 'meta-externalagent', 'Meta-ExternalFetcher', 'DuckAssistBot', 'MistralAI-User',
  'cohere-ai', 'YouBot', 'PetalBot',
];
const AI_BOT_RE = new RegExp(AI_BOTS.map(b => b.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|'), 'i');

function logAiCrawl(request, env, ctx, status, kind) {
  const ua = request.headers.get('User-Agent') || '';
  const m = ua.match(AI_BOT_RE);
  if (!m) return;
  const bot = AI_BOTS.find(b => b.toLowerCase() === m[0].toLowerCase()) || m[0];
  const path = new URL(request.url).pathname;
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ event: 'ai-crawl', ts, bot, path, status, kind, ua: ua.slice(0, 200) }));
  // Queryable record: D1 (binding METRICS_DB, table ai_crawl). Written after the response is sent.
  if (env.METRICS_DB && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(
      env.METRICS_DB.prepare('INSERT INTO ai_crawl (ts, bot, path, status, kind, ua) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(ts, bot, path, status, kind, ua.slice(0, 200)).run().catch(() => {})
    );
  }
  // Analytics Engine, if the account ever enables it (binding AI_CRAWL).
  if (env.AI_CRAWL && typeof env.AI_CRAWL.writeDataPoint === 'function') {
    try { env.AI_CRAWL.writeDataPoint({ blobs: [bot, path, kind], doubles: [status], indexes: [bot] }); } catch {}
  }
}

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function withSecurityHeaders(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 0a. Canonical scheme + host: http:// and www. → https://protik.info
    if (url.protocol === 'http:' || url.hostname === 'www.protik.info') {
      url.protocol = 'https:';
      url.hostname = 'protik.info';
      return Response.redirect(url.toString(), 301);
    }

    // 0b. Permanent redirects for legacy URLs
    if (REDIRECTS[url.pathname]) {
      return Response.redirect('https://protik.info' + REDIRECTS[url.pathname], 301);
    }

    // 1. Serve clean robots.txt
    if (url.pathname === '/robots.txt') {
      return withSecurityHeaders(new Response(CLEAN_ROBOTS_TXT, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      }));
    }

    // 2. Check if the request wants markdown
    const accept = request.headers.get('Accept') || '';
    const wantsMarkdown = accept.includes('text/markdown');

    if (wantsMarkdown) {
      const md = withSecurityHeaders(await handleMarkdownRequest(request, url, env));
      logAiCrawl(request, env, ctx, md.status, 'markdown');
      return md;
    }

    // 3. Pass everything else through via ASSETS binding (not fetch, which loops through Cloudflare)
    const res = withSecurityHeaders(await env.ASSETS.fetch(request));
    logAiCrawl(request, env, ctx, res.status, 'html');
    return res;
  },
};

async function handleMarkdownRequest(request, url, env) {
  // Fetch the original HTML from local assets (not external fetch)
  const response = await env.ASSETS.fetch(request);

  if (!response.ok) {
    return response;
  }

  const html = await response.text();

  // Extract metadata from HTML
  const title = extractMeta(html, 'title');
  const description = extractMeta(html, 'description');
  const canonical = extractMeta(html, 'canonical');
  const author = extractMeta(html, 'author');

  // Extract JSON-LD structured data
  const jsonLd = extractJsonLd(html);

  // Extract main content (strip nav, footer, scripts, styles)
  const mainContent = htmlToMarkdown(html);

  // Build the markdown response
  const parts = [];

  // YAML frontmatter
  parts.push('---');
  if (title) parts.push(`title: "${title}"`);
  if (description) parts.push(`description: "${description}"`);
  if (canonical) parts.push(`url: "${canonical}"`);
  if (author) parts.push(`author: "${author}"`);
  parts.push(`source: "https://protik.info${url.pathname}"`);
  parts.push('---');
  parts.push('');

  // Main content
  parts.push(mainContent);

  // JSON-LD as fenced code block
  if (jsonLd) {
    parts.push('');
    parts.push('## Structured Data');
    parts.push('');
    parts.push('```json');
    parts.push(jsonLd);
    parts.push('```');
  }

  // Navigation links
  parts.push('');
  parts.push('## Site Navigation');
  parts.push('');
  // BUILD:WORKER-NAV (generated by build.js from site-data.json pages — do not edit by hand)
  parts.push('- [Home](https://protik.info/)');
  parts.push('- [About](https://protik.info/about)');
  parts.push('- [Media (Speaking, Research & Press)](https://protik.info/media)');
  parts.push('- [Ideas](https://protik.info/ideas)');
  parts.push('- [Coaching](https://protik.info/coaching)');
  parts.push('- [Working Manual (How I Work)](https://protik.info/working-with-me)');
  parts.push('- [Contact](https://protik.info/contact)');
  parts.push('- [Press Kit](https://protik.info/press)');
  parts.push('- [LLM Context](https://protik.info/llms.txt)');
  // /BUILD:WORKER-NAV

  const markdown = parts.join('\n');

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'x-markdown-tokens': String(estimateTokens(markdown)),
      'Content-Signal': 'ai-train=yes, search=yes, ai-input=yes',
      'Cache-Control': 'public, max-age=3600',
      'Vary': 'Accept',
    },
  });
}

/**
 * Extract metadata from HTML
 */
function extractMeta(html, type) {
  if (type === 'title') {
    const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
    return match ? match[1].trim() : '';
  }
  if (type === 'description') {
    const match = html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/is);
    return match ? match[1].trim() : '';
  }
  if (type === 'canonical') {
    const match = html.match(/<link\s+rel=["']canonical["']\s+href=["'](.*?)["']/is);
    return match ? match[1].trim() : '';
  }
  if (type === 'author') {
    const match = html.match(/<meta\s+name=["']author["']\s+content=["'](.*?)["']/is);
    return match ? match[1].trim() : '';
  }
  return '';
}

/**
 * Extract JSON-LD from HTML
 */
function extractJsonLd(html) {
  const match = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return '';
  try {
    const parsed = JSON.parse(match[1]);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return match[1].trim();
  }
}

/**
 * Convert HTML to markdown by stripping non-content elements
 * and converting common HTML tags to markdown equivalents
 */
function htmlToMarkdown(html) {
  let content = html;

  // Remove everything before <body>
  content = content.replace(/[\s\S]*?<body[^>]*>/i, '');
  // Remove everything after </body>
  content = content.replace(/<\/body>[\s\S]*/i, '');

  // Remove nav, footer, script, style, noscript elements
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  content = content.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  content = content.replace(/<iframe[^>]*\/>/gi, '');

  // Remove HTML comments
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  // Convert headings
  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner) => `# ${stripTags(inner).trim()}\n\n`);
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => `## ${stripTags(inner).trim()}\n\n`);
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, inner) => `### ${stripTags(inner).trim()}\n\n`);
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, inner) => `#### ${stripTags(inner).trim()}\n\n`);

  // Convert links
  content = content.replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = stripTags(text).trim();
    if (!cleanText) return '';
    // Make relative URLs absolute
    const fullHref = href.startsWith('/') ? `https://protik.info${href}` : href;
    return `[${cleanText}](${fullHref})`;
  });

  // Convert images
  content = content.replace(/<img\s+[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi, (_, alt, src) => {
    const fullSrc = src.startsWith('/') ? `https://protik.info${src}` : src;
    return `![${alt}](${fullSrc})`;
  });
  content = content.replace(/<img\s+[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, (_, src, alt) => {
    const fullSrc = src.startsWith('/') ? `https://protik.info${src}` : src;
    return `![${alt}](${fullSrc})`;
  });

  // Convert strong/bold
  content = content.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => `**${stripTags(inner).trim()}**`);

  // Convert em/italic
  content = content.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => `*${stripTags(inner).trim()}*`);

  // Convert list items
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${stripTags(inner).trim()}\n`);

  // Convert paragraphs
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `${inner.trim()}\n\n`);

  // Convert blockquotes
  content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    return stripTags(inner).trim().split('\n').map(line => `> ${line.trim()}`).join('\n') + '\n\n';
  });

  // Convert br tags
  content = content.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining HTML tags
  content = stripTags(content);

  // Decode HTML entities
  content = decodeEntities(content);

  // Clean up whitespace
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.replace(/^\s+/gm, '');
  content = content.trim();

  return content;
}

/**
 * Strip all HTML tags from a string
 */
function stripTags(str) {
  return str.replace(/<[^>]*>/g, '');
}

/**
 * Decode common HTML entities
 */
function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rarr;/g, '→')
    .replace(/&larr;/g, '←')
    .replace(/&bull;/g, '•')
    .replace(/&nbsp;/g, ' ')
    .replace(/&copy;/g, '©')
    .replace(/&hellip;/g, '…')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

/**
 * Estimate token count (rough: ~4 chars per token)
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
