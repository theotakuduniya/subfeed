export interface QuotedPost {
  author: string;
  authorName?: string;
  text: string;
  url: string;
}

export interface NormalizedXPost {
  id: string;
  fullname: string;
  source: 'x';
  title: string;
  subreddit: string; // Stores @handle without @ for uniform filtering
  author: string;
  authorName?: string;
  score: number; // Likes
  upvoteRatio: number | null;
  numComments: number; // Replies
  reposts: number;
  views: number;
  createdUtc: number;
  permalink: string;
  url: string;
  domain: string;
  isSelf: boolean;
  selftext: string;
  flair: string | null;
  thumbnail: string | null;
  previewImage: string | null;
  galleryImages: string[];
  isVideo: boolean;
  videoUrl: string | null;
  over18: boolean;
  spoiler: boolean;
  stickied: boolean;
  isRetweet?: boolean;
  retweetedBy?: string | null;
  quotedPost?: QuotedPost | null;
}

export interface NormalizedXComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  isSubmitter: boolean;
  distinguished: string | null;
  depth: number;
  replies: NormalizedXComment[];
}

export interface XProfileInfo {
  handle: string;
  name: string;
  followers: number;
  description: string;
  avatarUrl: string | null;
  verified: boolean;
}

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const xCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = xCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    xCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  if (xCache.size > 400) {
    const firstKey = xCache.keys().next().value;
    if (firstKey) xCache.delete(firstKey);
  }
  xCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const DEFAULT_NITTER_HOSTS = [
  'https://nitter.netbub.com',
  'https://nitter.mie.foundation',
];

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function sanitizeXHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 20);
}

function decodeEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    });
}

function rewriteNitterImageUrl(rawUrl: string): string | null {
  const decoded = decodeEntities(rawUrl).trim();
  if (!decoded) return null;

  // Already a direct pbs.twimg.com URL
  if (decoded.includes('pbs.twimg.com/')) {
    return decoded.replace(/^http:\/\//i, 'https://');
  }

  // Nitter proxy format: https://host/pic/media%2FABC.jpg or /pic/orig/media%2FABC.jpg or /pic/https%3A%2F%2Fpbs.twimg.com...
  const picMatch = decoded.match(/\/pic\/(.+)$/i);
  if (picMatch) {
    let inner = picMatch[1];
    try {
      inner = decodeURIComponent(inner);
    } catch {
      // Keep raw if malformed
    }
    if (inner.startsWith('http://') || inner.startsWith('https://')) {
      return inner.replace(/^http:\/\//i, 'https://');
    }
    inner = inner.replace(/^orig\//i, '');
    if (inner.startsWith('media/') || inner.startsWith('ext_tw_video_thumb/') || inner.startsWith('amplify_video_thumb/') || inner.startsWith('tweet_video_thumb/')) {
      return `https://pbs.twimg.com/${inner}`;
    }
    if (inner.startsWith('card_img/')) {
      return `https://pbs.twimg.com/${inner}`;
    }
  }

  return decoded.replace(/^http:\/\//i, 'https://');
}

export async function getHealthyNitterHosts(): Promise<string[]> {
  const cached = cacheGet<string[]>('nitter:hosts');
  if (cached && cached.length > 0) return cached;

  const discovered: string[] = [];
  try {
    const res = await fetchWithTimeout(
      'https://status.d420.de/api/v1/instances',
      { Accept: 'application/json', 'User-Agent': 'Subfeed/1.0' },
      3500
    );
    if (res.ok) {
      const json: any = await res.json();
      const hosts = Array.isArray(json?.hosts) ? json.hosts : [];
      const good = hosts
        .filter(
          (h: any) =>
            h?.healthy === true &&
            h?.rss === true &&
            !h?.is_bad_host &&
            typeof h?.url === 'string' &&
            h.url.startsWith('https://')
        )
        .sort((a: any, b: any) => (Number(a.ping_avg) || 9999) - (Number(b.ping_avg) || 9999))
        .slice(0, 6)
        .map((h: any) => String(h.url).replace(/\/$/, ''));
      discovered.push(...good);
    }
  } catch {
    // Fall back to defaults
  }

  const merged = Array.from(new Set([...discovered, ...DEFAULT_NITTER_HOSTS]));
  cacheSet('nitter:hosts', merged, 15 * 60 * 1000);
  return merged;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(re);
  return match ? match[1].trim() : '';
}

function htmlToCleanText(html: string): string {
  return decodeEntities(
    html
      .replace(/<img[^>]*>/gi, '')
      .replace(/<video[\s\S]*?<\/video>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
        const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
        const cleanHref = decodeEntities(href);
        if (cleanLabel.startsWith('@') || cleanLabel.startsWith('#')) {
          return cleanLabel;
        }
        // Rewrite nitter status links back to x.com
        const xHref = cleanHref.replace(
          /^https?:\/\/[^/]+\/([a-zA-Z0-9_]+\/status\/\d+)/i,
          'https://x.com/$1'
        );
        if (xHref.startsWith('http') && cleanLabel && !cleanLabel.includes('http')) {
          return `[${cleanLabel}](${xHref})`;
        }
        return xHref.startsWith('http') ? xHref : cleanLabel;
      })
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseNitterRss(xml: string, requestedHandle: string): NormalizedXPost[] {
  if (!xml.includes('<rss') && !xml.includes('<item>')) return [];
  if (xml.includes("You're not authorized to use RSS")) return [];

  const channelTitleRaw = decodeEntities(extractTag(xml.split('<item>')[0] || '', 'title'));
  const channelDisplayName = channelTitleRaw.includes(' / @')
    ? channelTitleRaw.split(' / @')[0].trim()
    : requestedHandle;

  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const posts: NormalizedXPost[] = [];

  for (const item of items) {
    const rawTitle = decodeEntities(extractTag(item, 'title')).trim();
    const rawCreator = decodeEntities(extractTag(item, 'dc:creator')).replace(/^@/, '').trim();
    const rawDesc = extractTag(item, 'description');
    const rawPubDate = extractTag(item, 'pubDate');
    const rawGuid = decodeEntities(extractTag(item, 'guid'));
    const rawLink = decodeEntities(extractTag(item, 'link'));

    const idMatch =
      rawGuid.match(/(\d{10,22})/) || rawLink.match(/\/status\/(\d{10,22})/);
    const tweetId = idMatch ? idMatch[1] : '';
    if (!tweetId) continue;

    // Detect retweet prefix in title ("RT by @handle: ...")
    let isRetweet = false;
    let retweetedBy: string | null = null;
    let cleanedTitle = rawTitle;
    const rtMatch = rawTitle.match(/^RT by @([a-zA-Z0-9_]+):\s*/i);
    if (rtMatch) {
      isRetweet = true;
      retweetedBy = rtMatch[1];
      cleanedTitle = rawTitle.slice(rtMatch[0].length).trim();
    } else if (/^R to @/i.test(rawTitle)) {
      cleanedTitle = rawTitle.replace(/^R to @[a-zA-Z0-9_]+:\s*/i, '').trim();
    }

    // Extract images from description HTML
    const descUnwrapped = decodeEntities(rawDesc);
    const imgMatches = Array.from(descUnwrapped.matchAll(/<img[^>]+src="([^"]+)"/gi));
    const images: string[] = [];
    for (const m of imgMatches) {
      const rewritten = rewriteNitterImageUrl(m[1]);
      if (rewritten && !rewritten.includes('profile_images') && !images.includes(rewritten)) {
        images.push(rewritten);
      }
    }

    const fullBody = htmlToCleanText(descUnwrapped);
    const effectiveAuthor = rawCreator || requestedHandle;
    const parsedTime = Date.parse(rawPubDate);
    const createdUtc = Number.isFinite(parsedTime)
      ? Math.floor(parsedTime / 1000)
      : Math.floor(Date.now() / 1000);

    // Split headline vs body cleanly for list view vs reader
    const firstLine = (cleanedTitle || fullBody).split('\n')[0].trim();
    const headline =
      firstLine.length > 180 ? `${firstLine.slice(0, 177).trimEnd()}...` : firstLine || `Post by @${effectiveAuthor}`;
    const bodyText = fullBody && fullBody !== headline ? fullBody : '';

    const xUrl = `https://x.com/${effectiveAuthor}/status/${tweetId}`;

    posts.push({
      id: `x_${tweetId}`,
      fullname: `x_${tweetId}`,
      source: 'x',
      title: headline,
      subreddit: requestedHandle,
      author: effectiveAuthor,
      authorName:
        effectiveAuthor.toLowerCase() === requestedHandle.toLowerCase()
          ? channelDisplayName
          : effectiveAuthor,
      score: 0,
      upvoteRatio: null,
      numComments: 0,
      reposts: 0,
      views: 0,
      createdUtc,
      permalink: `/${effectiveAuthor}/status/${tweetId}`,
      url: xUrl,
      domain: 'x.com',
      isSelf: true,
      selftext: bodyText,
      flair: isRetweet && retweetedBy ? `Reposted by @${retweetedBy}` : null,
      thumbnail: images[0] || null,
      previewImage: images[0] || null,
      galleryImages: images,
      isVideo: descUnwrapped.includes('<video') || descUnwrapped.includes('video_thumb'),
      videoUrl: null,
      over18: false,
      spoiler: false,
      stickied: false,
      isRetweet,
      retweetedBy,
      quotedPost: null,
    });
  }

  return posts;
}

async function fetchHandleFromNitter(
  handle: string,
  forceRefresh = false
): Promise<NormalizedXPost[]> {
  const key = `x:handle:${handle.toLowerCase()}`;
  if (!forceRefresh) {
    const cached = cacheGet<NormalizedXPost[]>(key);
    if (cached) return cached;
  }

  const hosts = await getHealthyNitterHosts();
  for (const host of hosts) {
    try {
      const url = `${host}/${encodeURIComponent(handle)}/rss`;
      const res = await fetchWithTimeout(
        url,
        {
          'User-Agent': 'Mozilla/5.0 (compatible; Subfeed/1.0)',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
        4500
      );
      if (!res.ok) continue;
      const xml = await res.text();
      const parsed = parseNitterRss(xml, handle);
      if (parsed.length > 0) {
        cacheSet(key, parsed, 3 * 60 * 1000);
        return parsed;
      }
    } catch {
      // Try next healthy Nitter host
    }
  }

  return [];
}

export async function enrichTweetWithFxTwitter(
  post: NormalizedXPost,
  forceRefresh = false
): Promise<NormalizedXPost> {
  const rawId = post.id.replace(/^x_/, '');
  const cacheKey = `x:fx:${rawId}`;

  if (!forceRefresh) {
    const cached = cacheGet<Partial<NormalizedXPost>>(cacheKey);
    if (cached) {
      return { ...post, ...cached };
    }
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.fxtwitter.com/${encodeURIComponent(post.author)}/status/${encodeURIComponent(rawId)}`,
      { Accept: 'application/json', 'User-Agent': 'Subfeed/1.0' },
      3000
    );
    if (!res.ok) return post;
    const json: any = await res.json();
    const t = json?.tweet;
    if (!t) return post;

    const photos: string[] = Array.isArray(t.media?.photos)
      ? t.media.photos.map((p: any) => p?.url).filter(Boolean)
      : [];
    const firstVideo = Array.isArray(t.media?.videos) ? t.media.videos[0] : null;
    const videoUrl = firstVideo?.url || null;
    const videoThumb = firstVideo?.thumbnail_url || null;

    const fullText = String(t.text || '').trim();
    const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] || post.title;
    const title = firstLine.length > 180 ? `${firstLine.slice(0, 177).trimEnd()}...` : firstLine;

    const quotedPost: QuotedPost | null = t.quote
      ? {
          author: String(t.quote.author?.screen_name || ''),
          authorName: String(t.quote.author?.name || ''),
          text: String(t.quote.text || ''),
          url: String(t.quote.url || ''),
        }
      : null;

    const patch: Partial<NormalizedXPost> = {
      title,
      selftext: fullText && fullText !== title ? fullText : '',
      author: String(t.author?.screen_name || post.author),
      authorName: String(t.author?.name || post.authorName || post.author),
      score: Number(t.likes ?? 0),
      numComments: Number(t.replies ?? 0),
      reposts: Number(t.retweets ?? 0),
      views: Number(t.views ?? 0),
      createdUtc:
        typeof t.created_timestamp === 'number' ? t.created_timestamp : post.createdUtc,
      galleryImages: photos.length > 0 ? photos : post.galleryImages,
      previewImage: photos[0] || videoThumb || post.previewImage,
      thumbnail: photos[0] || videoThumb || post.thumbnail,
      isVideo: Boolean(videoUrl || post.isVideo),
      videoUrl: videoUrl || post.videoUrl,
      quotedPost,
    };

    cacheSet(cacheKey, patch, 10 * 60 * 1000);
    return { ...post, ...patch };
  } catch {
    return post;
  }
}

function getTimeframeSeconds(t: string): number | null {
  switch (t) {
    case 'hour':
      return 3600;
    case 'day':
      return 86_400;
    case 'week':
      return 7 * 86_400;
    case 'month':
      return 30 * 86_400;
    case 'year':
      return 365 * 86_400;
    default:
      return null;
  }
}

function rankXPosts(posts: NormalizedXPost[], sort: string): NormalizedXPost[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const items = [...posts];

  if (sort === 'new') {
    return items.sort((a, b) => b.createdUtc - a.createdUtc);
  }
  if (sort === 'top') {
    return items.sort(
      (a, b) =>
        b.score + b.reposts * 2 - (a.score + a.reposts * 2) ||
        b.createdUtc - a.createdUtc
    );
  }
  if (sort === 'rising') {
    return items.sort((a, b) => {
      const ageA = Math.max(0.25, (nowSec - a.createdUtc) / 3600);
      const ageB = Math.max(0.25, (nowSec - b.createdUtc) / 3600);
      const velA = (a.score + a.reposts * 2 + a.numComments * 2) / Math.pow(ageA + 0.5, 1.3);
      const velB = (b.score + b.reposts * 2 + b.numComments * 2) / Math.pow(ageB + 0.5, 1.3);
      return velB - velA;
    });
  }
  if (sort === 'controversial') {
    return items.sort((a, b) => {
      const ratioA = (a.numComments * 5) / Math.max(1, a.score + 3);
      const ratioB = (b.numComments * 5) / Math.max(1, b.score + 3);
      return ratioB - ratioA || b.numComments - a.numComments;
    });
  }
  // best / hot: engagement weighted by recency
  return items.sort((a, b) => {
    const ageA = Math.max(0.5, (nowSec - a.createdUtc) / 3600);
    const ageB = Math.max(0.5, (nowSec - b.createdUtc) / 3600);
    const scoreA = (a.score + a.reposts * 2 + a.numComments * 1.5 + 10) / Math.pow(ageA + 2, 1.15);
    const scoreB = (b.score + b.reposts * 2 + b.numComments * 1.5 + 10) / Math.pow(ageB + 2, 1.15);
    return scoreB - scoreA;
  });
}

export async function fetchXFeed(params: {
  handles: string[];
  sort: string;
  timeframe: string;
  limit?: number;
  forceRefresh?: boolean;
}): Promise<{ posts: NormalizedXPost[]; after: string | null; source: string }> {
  const { handles, sort, timeframe, limit = 25, forceRefresh = false } = params;
  const cleanHandles = Array.from(
    new Set(handles.map((h) => sanitizeXHandle(h).toLowerCase()).filter(Boolean))
  ).slice(0, 12);

  if (cleanHandles.length === 0) {
    return { posts: [], after: null, source: 'nitter' };
  }

  const feedKey = `x:feed:${cleanHandles.sort().join(',')}:${sort}:${timeframe}:${limit}`;
  if (!forceRefresh) {
    const cached = cacheGet<{ posts: NormalizedXPost[]; after: string | null; source: string }>(
      feedKey
    );
    if (cached) return cached;
  }

  const perHandleLists = await Promise.all(
    cleanHandles.map((h) => fetchHandleFromNitter(h, forceRefresh))
  );

  const dedup = new Map<string, NormalizedXPost>();
  for (const list of perHandleLists) {
    for (const post of list) {
      if (!dedup.has(post.id)) {
        dedup.set(post.id, post);
      }
    }
  }

  let combined = Array.from(dedup.values()).sort((a, b) => b.createdUtc - a.createdUtc);

  // Filter by timeframe for Top / Controversial if applicable
  if (sort === 'top' || sort === 'controversial') {
    const windowSec = getTimeframeSeconds(timeframe);
    if (windowSec) {
      const cutoff = Math.floor(Date.now() / 1000) - windowSec;
      const inWindow = combined.filter((p) => p.createdUtc >= cutoff);
      if (inWindow.length > 0) {
        combined = inWindow;
      }
    }
  }

  // Enrich newest items with FxTwitter in parallel so likes, reposts, replies, views, and full media appear
  const toEnrich = combined.slice(0, Math.min(18, limit));
  const rest = combined.slice(toEnrich.length);
  const enrichedHead = await Promise.all(
    toEnrich.map((post) => enrichTweetWithFxTwitter(post, false))
  );

  const allMerged = [...enrichedHead, ...rest];
  const ranked = rankXPosts(allMerged, sort).slice(0, limit);

  const result = {
    posts: ranked,
    after: null,
    source: 'nitter',
  };
  cacheSet(feedKey, result, 3 * 60 * 1000);
  return result;
}

export async function fetchXProfile(rawHandle: string): Promise<XProfileInfo | null> {
  const handle = sanitizeXHandle(rawHandle);
  if (!handle) return null;

  const cacheKey = `x:profile:${handle.toLowerCase()}`;
  const cached = cacheGet<XProfileInfo>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(
      `https://api.fxtwitter.com/${encodeURIComponent(handle)}`,
      { Accept: 'application/json', 'User-Agent': 'Subfeed/1.0' },
      3500
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const u = json?.user;
    if (!u?.screen_name) return null;

    const info: XProfileInfo = {
      handle: String(u.screen_name),
      name: String(u.name || u.screen_name),
      followers: Number(u.followers || 0),
      description: String(u.description || '').slice(0, 140),
      avatarUrl: typeof u.avatar_url === 'string' ? u.avatar_url : null,
      verified: Boolean(u.verification?.verified),
    };
    cacheSet(cacheKey, info, 15 * 60 * 1000);
    return info;
  } catch {
    return null;
  }
}

function parseNitterHtmlReplies(html: string, postAuthor: string): NormalizedXComment[] {
  const repliesSection = html.split(/class="replies"/i)[1];
  if (!repliesSection) return [];

  const blocks = repliesSection.split(/<div class="timeline-item/i).slice(1, 35);
  const comments: NormalizedXComment[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const userMatch = block.match(/class="username"[^>]*>@?([^<]+)<\/a>/i);
    const bodyMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const dateMatch = block.match(/class="tweet-date"[^>]*><a[^>]*title="([^"]+)"/i);
    const heartMatch = block.match(/icon-heart[^>]*><\/span>\s*([0-9,]+)/i);

    if (!userMatch || !bodyMatch) continue;
    const author = decodeEntities(userMatch[1]).replace(/^@/, '').trim();
    const body = htmlToCleanText(bodyMatch[1]);
    if (!body) continue;

    const parsedDate = dateMatch ? Date.parse(dateMatch[1].replace(' · ', ' ')) : NaN;
    const createdUtc = Number.isFinite(parsedDate)
      ? Math.floor(parsedDate / 1000)
      : Math.floor(Date.now() / 1000);
    const likes = heartMatch ? Number(heartMatch[1].replace(/,/g, '')) || 0 : 0;

    comments.push({
      id: `xr_${i}_${author}`,
      author,
      body,
      score: likes,
      createdUtc,
      isSubmitter: author.toLowerCase() === postAuthor.toLowerCase(),
      distinguished: null,
      depth: 0,
      replies: [],
    });
  }

  return comments;
}

export async function fetchXTweetDetails(params: {
  handle: string;
  tweetId: string;
  forceRefresh?: boolean;
}): Promise<{ post?: NormalizedXPost; comments: NormalizedXComment[] }> {
  const handle = sanitizeXHandle(params.handle);
  const rawId = params.tweetId.replace(/^x_/, '').replace(/[^0-9]/g, '');
  if (!handle || !rawId) return { comments: [] };

  const cacheKey = `x:tweet:${rawId}`;
  if (!params.forceRefresh) {
    const cached = cacheGet<{ post?: NormalizedXPost; comments: NormalizedXComment[] }>(cacheKey);
    if (cached) return cached;
  }

  const basePost: NormalizedXPost = {
    id: `x_${rawId}`,
    fullname: `x_${rawId}`,
    source: 'x',
    title: '',
    subreddit: handle,
    author: handle,
    score: 0,
    upvoteRatio: null,
    numComments: 0,
    reposts: 0,
    views: 0,
    createdUtc: Math.floor(Date.now() / 1000),
    permalink: `/${handle}/status/${rawId}`,
    url: `https://x.com/${handle}/status/${rawId}`,
    domain: 'x.com',
    isSelf: true,
    selftext: '',
    flair: null,
    thumbnail: null,
    previewImage: null,
    galleryImages: [],
    isVideo: false,
    videoUrl: null,
    over18: false,
    spoiler: false,
    stickied: false,
  };

  const [enriched, replies] = await Promise.all([
    enrichTweetWithFxTwitter(basePost, params.forceRefresh),
    (async () => {
      const hosts = await getHealthyNitterHosts();
      for (const host of hosts.slice(0, 3)) {
        try {
          const res = await fetchWithTimeout(
            `${host}/${encodeURIComponent(handle)}/status/${encodeURIComponent(rawId)}`,
            {
              'User-Agent': 'Mozilla/5.0 (compatible; Subfeed/1.0)',
              Accept: 'text/html',
            },
            4500
          );
          if (!res.ok) continue;
          const html = await res.text();
          if (html.includes('anubis_challenge') || html.includes('Just a moment')) continue;
          const parsed = parseNitterHtmlReplies(html, handle);
          if (parsed.length > 0) return parsed;
        } catch {
          // Try next host
        }
      }
      return [] as NormalizedXComment[];
    })(),
  ]);

  const result = {
    post: enriched.title ? enriched : undefined,
    comments: replies,
  };
  cacheSet(cacheKey, result, 3 * 60 * 1000);
  return result;
}
