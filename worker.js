/**
 * Cloudflare Worker for protik.info
 *
 * 1. Serves a clean robots.txt (bypasses Cloudflare's managed injection)
 * 2. Returns markdown when agents send Accept: text/markdown
 * 3. Passes everything else through to origin
 */

const CLEAN_ROBOTS_TXT = `# robots.txt for protik.info
# Welcome all crawlers including LLM bots

User-agent: *
Allow: /
Disallow:

Sitemap: https://protik.info/sitemap.xml

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Serve clean robots.txt
    if (url.pathname === '/robots.txt') {
      return new Response(CLEAN_ROBOTS_TXT, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // 2. Check if the request wants markdown
    const accept = request.headers.get('Accept') || '';
    const wantsMarkdown = accept.includes('text/markdown');

    if (wantsMarkdown) {
      return handleMarkdownRequest(request, url);
    }

    // 3. Pass everything else through
    return fetch(request);
  },
};

async function handleMarkdownRequest(request, url) {
  // Fetch the original HTML from origin
  const originRequest = new Request(request.url, {
    headers: {
      'Accept': 'text/html',
      'User-Agent': request.headers.get('User-Agent') || 'Cloudflare-Worker',
    },
  });

  const response = await fetch(originRequest);

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
  parts.push('- [Home](https://protik.info/)');
  parts.push('- [About](https://protik.info/about)');
  parts.push('- [Ideas](https://protik.info/ideas)');
  parts.push('- [Speaking](https://protik.info/speaking)');
  parts.push('- [Publications](https://protik.info/publications)');
  parts.push('- [Coaching](https://protik.info/coaching)');
  parts.push('- [Contact](https://protik.info/contact)');
  parts.push('- [LLM Context](https://protik.info/llms.txt)');

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
