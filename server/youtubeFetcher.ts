// Server-side YouTube Data API v3 fetcher with quota-efficient caching
// and resilient Atom RSS / public page fallback when YOUTUBE_API_KEY is unset or quota-exhausted.

export interface NormalizedYoutubePost {
  id: string;
  fullname: string;
  source: 'youtube';
  videoId: string;
  title: string;
  subreddit: string; // channel handle or channel title slug
  author: string; // channel handle (without @)
  authorName: string; // channel display name
  channelId: string | null;
  channelTitle: string | null;
  score: number; // like count
  upvoteRatio: null;
  numComments: number;
  views: number;
  durationSeconds: number | null;
  isShort: boolean;
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
}

export interface NormalizedYoutubeComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  isSubmitter: boolean;
  distinguished: string | null;
  depth: number;
  replies: NormalizedYoutubeComment[];
}

export interface YoutubeChannelInfo {
  handle: string;
  channelId: string;
  uploadsPlaylistId: string;
  title: string;
  subscribers: number;
  description: string;
  avatarUrl: string | null;
}

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const CHANNEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FEED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOPIC_API_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (saves 100u search.list quota)
const VIDEO_DETAILS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ytCache = new Map<string, CacheEntry<unknown>>();
let apiQuotaPausedUntil = 0;

function getCache<T>(key: string): T | null {
  const entry = ytCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ytCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  if (ytCache.size > 400) {
    const firstKey = ytCache.keys().next().value;
    if (firstKey) ytCache.delete(firstKey);
  }
  ytCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function getYoutubeApiKey(): string | null {
  if (Date.now() < apiQuotaPausedUntil) return null;
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  return key || null;
}

export function sanitizeYoutubeHandle(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '')
    .replace(/^yt\//i, '')
    .replace(/^channel\//i, '')
    .replace(/^c\//i, '')
    .replace(/^user\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 40);
  return trimmed;
}

export function sanitizeYoutubeTopic(raw: string): string {
  return raw
    .trim()
    .replace(/^yt#/i, '')
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}\s_\-+.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export function sanitizeYoutubeVideoId(raw: string): string {
  const cleaned = raw.trim().replace(/^yt_/, '');
  return /^[a-zA-Z0-9_-]{11}$/.test(cleaned) ? cleaned : '';
}

function isChannelId(input: string): boolean {
  return /^UC[a-zA-Z0-9_-]{22}$/.test(input);
}

function deriveUploadsPlaylistId(channelId: string): string {
  if (channelId.startsWith('UC') && channelId.length === 24) {
    return `UU${channelId.slice(2)}`;
  }
  return '';
}

export function parseIsoDurationSeconds(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function parseClockDurationSeconds(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null;
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number(p.replace(/[^0-9]/g, '')));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseCompactCount(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') return 0;
  const cleaned = text.replace(/,/g, '').trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return 0;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (match[2] || '').toUpperCase();
  if (unit === 'B') return Math.round(num * 1_000_000_000);
  if (unit === 'M') return Math.round(num * 1_000_000);
  if (unit === 'K') return Math.round(num * 1_000);
  return Math.round(num);
}

function parseRelativeTimeToUtc(text: string | null | undefined): number {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!text || typeof text !== 'string') return nowSec;
  const lower = text.toLowerCase();
  const match = lower.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return nowSec;
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86_400,
    week: 7 * 86_400,
    month: 30 * 86_400,
    year: 365 * 86_400,
  };
  return Math.max(0, nowSec - amount * (multipliers[unit] || 3600));
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtmlTags(str: string): string {
  return decodeXmlEntities(
    str
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function youtubeApiGet<T>(
  endpoint: string,
  params: Record<string, string>
): Promise<T | null> {
  const apiKey = getYoutubeApiKey();
  if (!apiKey) return null;

  const qs = new URLSearchParams({ ...params, key: apiKey });
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs.toString()}`;

  try {
    const res = await fetchWithTimeout(url, { Accept: 'application/json' }, 8000);
    if (!res.ok) {
      const errBody: any = await res.json().catch(() => null);
      const reason = errBody?.error?.errors?.[0]?.reason || '';
      if (
        res.status === 403 &&
        (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')
      ) {
        // Pause Data API attempts for 15 minutes and transparently fall back to RSS/public data
        apiQuotaPausedUntil = Date.now() + 15 * 60 * 1000;
      }
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function getTimeframeSeconds(timeframe: string): number | null {
  switch (timeframe) {
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

export async function lookupYoutubeChannel(
  rawHandle: string
): Promise<YoutubeChannelInfo | null> {
  const clean = sanitizeYoutubeHandle(rawHandle);
  if (!clean) return null;

  const cacheKey = `yt_channel:${clean.toLowerCase()}`;
  const cached = getCache<YoutubeChannelInfo>(cacheKey);
  if (cached) return cached;

  // 1. Try YouTube Data API v3 (1 unit)
  if (getYoutubeApiKey()) {
    const queryParams: Record<string, string> = isChannelId(clean)
      ? { part: 'snippet,contentDetails,statistics', id: clean }
      : { part: 'snippet,contentDetails,statistics', forHandle: clean };

    const apiData = await youtubeApiGet<any>('channels', queryParams);
    let item = Array.isArray(apiData?.items) ? apiData.items[0] : null;

    // Fallback to forUsername if forHandle returned nothing (legacy handles)
    if (!item && !isChannelId(clean)) {
      const legacyData = await youtubeApiGet<any>('channels', {
        part: 'snippet,contentDetails,statistics',
        forUsername: clean,
      });
      item = Array.isArray(legacyData?.items) ? legacyData.items[0] : null;
    }

    if (item?.id) {
      const customUrl = String(item.snippet?.customUrl || '')
        .replace(/^@+/, '')
        .trim();
      const info: YoutubeChannelInfo = {
        handle: customUrl || clean,
        channelId: String(item.id),
        uploadsPlaylistId:
          String(item.contentDetails?.relatedPlaylists?.uploads || '') ||
          deriveUploadsPlaylistId(String(item.id)),
        title: String(item.snippet?.title || clean),
        subscribers: Number(item.statistics?.subscriberCount || 0),
        description: String(item.snippet?.description || '').slice(0, 180),
        avatarUrl:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          null,
      };
      setCache(cacheKey, info, CHANNEL_CACHE_TTL_MS);
      return info;
    }
  }

  // 2. Resilient zero-key fallback: resolve @handle from public YouTube channel page
  if (isChannelId(clean)) {
    const fallback: YoutubeChannelInfo = {
      handle: clean,
      channelId: clean,
      uploadsPlaylistId: deriveUploadsPlaylistId(clean),
      title: clean,
      subscribers: 0,
      description: '',
      avatarUrl: null,
    };
    setCache(cacheKey, fallback, CHANNEL_CACHE_TTL_MS);
    return fallback;
  }

  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/@${encodeURIComponent(clean)}`,
      {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+667',
      },
      7500
    );
    if (!res.ok) return null;
    const html = await res.text();

    const idMatch =
      html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/) ||
      html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/) ||
      html.match(/channel_id=(UC[a-zA-Z0-9_-]{22})/);

    if (!idMatch?.[1]) return null;
    const channelId = idMatch[1];

    const titleMatch =
      html.match(/<meta property="og:title" content="([^"]+)"/i) ||
      html.match(/"title":"([^"]{1,80})","description"/);
    const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/i);
    const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const subsMatch = html.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/);

    const info: YoutubeChannelInfo = {
      handle: clean,
      channelId,
      uploadsPlaylistId: deriveUploadsPlaylistId(channelId),
      title: titleMatch?.[1] ? decodeXmlEntities(titleMatch[1]) : clean,
      subscribers: parseCompactCount(subsMatch?.[1]),
      description: descMatch?.[1] ? decodeXmlEntities(descMatch[1]).slice(0, 180) : '',
      avatarUrl: imgMatch?.[1] || null,
    };
    setCache(cacheKey, info, CHANNEL_CACHE_TTL_MS);
    return info;
  } catch {
    return null;
  }
}

function buildThumbnailUrl(videoId: string, provided?: string | null): string {
  if (provided && provided.startsWith('http')) return provided;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function normalizeApiVideoItem(
  item: any,
  handleByChannelId: Map<string, string>,
  flair: string | null = null
): NormalizedYoutubePost | null {
  const videoId = sanitizeYoutubeVideoId(String(item?.id || ''));
  if (!videoId) return null;
  const snippet = item.snippet || {};
  const stats = item.statistics || {};
  const content = item.contentDetails || {};

  const channelId = String(snippet.channelId || '') || null;
  const channelTitle = String(snippet.channelTitle || 'YouTube');
  const resolvedHandle =
    (channelId && handleByChannelId.get(channelId)) ||
    sanitizeYoutubeHandle(channelTitle.replace(/\s+/g, '')) ||
    channelId ||
    'youtube';

  const durationSeconds = parseIsoDurationSeconds(content.duration);
  const title = decodeXmlEntities(String(snippet.title || 'Untitled video'));
  const description = decodeXmlEntities(String(snippet.description || ''));
  const isShort =
    (durationSeconds !== null && durationSeconds <= 60) ||
    /#shorts\b/i.test(title) ||
    /#shorts\b/i.test(description.slice(0, 200));

  const publishedMs = Date.parse(String(snippet.publishedAt || ''));
  const createdUtc = Number.isFinite(publishedMs)
    ? Math.floor(publishedMs / 1000)
    : Math.floor(Date.now() / 1000);

  const thumb =
    snippet.thumbnails?.maxres?.url ||
    snippet.thumbnails?.standard?.url ||
    snippet.thumbnails?.high?.url ||
    snippet.thumbnails?.medium?.url ||
    buildThumbnailUrl(videoId);

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return {
    id: `yt_${videoId}`,
    fullname: `yt_${videoId}`,
    source: 'youtube',
    videoId,
    title,
    subreddit: resolvedHandle,
    author: resolvedHandle,
    authorName: channelTitle,
    channelId,
    channelTitle,
    score: Number(stats.likeCount || 0),
    upvoteRatio: null,
    numComments: Number(stats.commentCount || 0),
    views: Number(stats.viewCount || 0),
    durationSeconds,
    isShort,
    createdUtc,
    permalink: `/watch?v=${videoId}`,
    url: watchUrl,
    domain: 'youtube.com',
    isSelf: false,
    selftext: description,
    flair,
    thumbnail: buildThumbnailUrl(videoId, snippet.thumbnails?.medium?.url || thumb),
    previewImage: buildThumbnailUrl(videoId, thumb),
    galleryImages: [],
    isVideo: true,
    videoUrl: watchUrl,
    over18: false,
    spoiler: false,
    stickied: false,
  };
}

async function fetchVideosByIdsApi(
  videoIds: string[],
  handleByChannelId: Map<string, string>,
  flairByVideoId: Map<string, string>
): Promise<NormalizedYoutubePost[]> {
  const uniqueIds = Array.from(new Set(videoIds.map(sanitizeYoutubeVideoId).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const posts: NormalizedYoutubePost[] = [];
  // Batch 50 IDs per 1-unit videos.list call
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const data = await youtubeApiGet<any>('videos', {
      part: 'snippet,contentDetails,statistics',
      id: chunk.join(','),
      maxResults: '50',
    });
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const norm = normalizeApiVideoItem(
        item,
        handleByChannelId,
        flairByVideoId.get(String(item.id)) || null
      );
      if (norm) posts.push(norm);
    }
  }
  return posts;
}

async function fetchChannelRssFallback(
  channelInfo: YoutubeChannelInfo
): Promise<NormalizedYoutubePost[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
    channelInfo.channelId
  )}`;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        'User-Agent': 'minisocial-reader/1.0',
        Accept: 'application/atom+xml, application/xml, text/xml',
      },
      7500
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
    const posts: NormalizedYoutubePost[] = [];

    for (const entry of entries.slice(0, 15)) {
      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
      const videoId = sanitizeYoutubeVideoId(videoIdMatch?.[1] || '');
      if (!videoId) continue;

      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/i);
      const authorMatch = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i);
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/i);
      const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/i);
      const thumbMatch = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
      const viewsMatch = entry.match(/<media:statistics[^>]+views="(\d+)"/i);
      const likesMatch = entry.match(/<media:starRating[^>]+count="(\d+)"/i);
      const linkMatch = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i);

      const title = decodeXmlEntities(titleMatch?.[1] || 'Untitled video').trim();
      const channelTitle = decodeXmlEntities(authorMatch?.[1] || channelInfo.title).trim();
      const description = decodeXmlEntities(descMatch?.[1] || '').trim();
      const linkHref = linkMatch?.[1] || `https://www.youtube.com/watch?v=${videoId}`;
      const isShort = /\/shorts\//i.test(linkHref) || /#shorts\b/i.test(title);

      const publishedMs = Date.parse(publishedMatch?.[1] || '');
      const createdUtc = Number.isFinite(publishedMs)
        ? Math.floor(publishedMs / 1000)
        : Math.floor(Date.now() / 1000);

      const views = Number(viewsMatch?.[1] || 0);
      const likes = Number(likesMatch?.[1] || 0);
      const thumb = buildThumbnailUrl(videoId, thumbMatch?.[1]);

      posts.push({
        id: `yt_${videoId}`,
        fullname: `yt_${videoId}`,
        source: 'youtube',
        videoId,
        title,
        subreddit: channelInfo.handle,
        author: channelInfo.handle,
        authorName: channelTitle,
        channelId: channelInfo.channelId,
        channelTitle,
        score: likes,
        upvoteRatio: null,
        numComments: 0,
        views,
        durationSeconds: null,
        isShort,
        createdUtc,
        permalink: `/watch?v=${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        domain: 'youtube.com',
        isSelf: false,
        selftext: description,
        flair: null,
        thumbnail: thumb,
        previewImage: thumb,
        galleryImages: [],
        isVideo: true,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        over18: false,
        spoiler: false,
        stickied: false,
      });
    }

    return posts;
  } catch {
    return [];
  }
}

function extractBalancedJson(source: string, marker: string): any | null {
  const idx = source.indexOf(marker);
  if (idx === -1) return null;
  const start = source.indexOf('{', idx + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectVideoRenderers(node: any, out: any[], limit = 20): void {
  if (!node || typeof node !== 'object' || out.length >= limit) return;
  if (node.videoRenderer && typeof node.videoRenderer === 'object') {
    out.push(node.videoRenderer);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (out.length >= limit) break;
      collectVideoRenderers(item, out, limit);
    }
    return;
  }
  for (const key of Object.keys(node)) {
    if (out.length >= limit) break;
    collectVideoRenderers(node[key], out, limit);
  }
}

async function fetchTopicSearchFallback(
  topic: string,
  sort: string
): Promise<NormalizedYoutubePost[]> {
  const cacheKey = `yt_topic_web:${topic.toLowerCase()}:${sort}`;
  const cached = getCache<NormalizedYoutubePost[]>(cacheKey);
  if (cached) return cached;

  const qs = new URLSearchParams({ search_query: topic, hl: 'en', gl: 'US' });
  // YouTube search sp filter for upload date when sorting by 'new'
  if (sort === 'new') {
    qs.set('sp', 'CAI%253D');
  }

  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/results?${qs.toString()}`,
      {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+667',
      },
      8500
    );
    if (!res.ok) return [];
    const html = await res.text();
    const initialData =
      extractBalancedJson(html, 'var ytInitialData =') ||
      extractBalancedJson(html, 'window["ytInitialData"] =');
    if (!initialData) return [];

    const renderers: any[] = [];
    collectVideoRenderers(initialData, renderers, 18);

    const posts: NormalizedYoutubePost[] = [];
    const seen = new Set<string>();

    for (const vr of renderers) {
      const videoId = sanitizeYoutubeVideoId(String(vr.videoId || ''));
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);

      const title =
        vr.title?.runs?.map((r: any) => r.text).join('') ||
        vr.title?.simpleText ||
        'Untitled video';
      const channelTitle =
        vr.ownerText?.runs?.[0]?.text ||
        vr.longBylineText?.runs?.[0]?.text ||
        'YouTube';
      const canonicalPath =
        vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ||
        '';
      const channelId =
        vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || null;
      const handle =
        sanitizeYoutubeHandle(canonicalPath) ||
        sanitizeYoutubeHandle(channelTitle.replace(/\s+/g, '')) ||
        'youtube';

      const lengthText = vr.lengthText?.simpleText || '';
      const durationSeconds = parseClockDurationSeconds(lengthText);
      const isShort =
        (durationSeconds !== null && durationSeconds <= 60) ||
        /#shorts\b/i.test(title);

      const viewText =
        vr.viewCountText?.simpleText ||
        vr.shortViewCountText?.simpleText ||
        '';
      const views = parseCompactCount(viewText);
      const publishedText = vr.publishedTimeText?.simpleText || '';
      const createdUtc = parseRelativeTimeToUtc(publishedText);

      const snippetText = Array.isArray(vr.detailedMetadataSnippets)
        ? vr.detailedMetadataSnippets[0]?.snippetText?.runs
            ?.map((r: any) => r.text)
            .join('') || ''
        : '';

      const thumbs = Array.isArray(vr.thumbnail?.thumbnails)
        ? vr.thumbnail.thumbnails
        : [];
      const bestThumb =
        thumbs[thumbs.length - 1]?.url || buildThumbnailUrl(videoId);

      posts.push({
        id: `yt_${videoId}`,
        fullname: `yt_${videoId}`,
        source: 'youtube',
        videoId,
        title: decodeXmlEntities(title).trim(),
        subreddit: handle,
        author: handle,
        authorName: decodeXmlEntities(channelTitle).trim(),
        channelId,
        channelTitle: decodeXmlEntities(channelTitle).trim(),
        score: Math.round(views * 0.03), // approximate engagement weight when likes are unavailable in search HTML
        upvoteRatio: null,
        numComments: 0,
        views,
        durationSeconds,
        isShort,
        createdUtc,
        permalink: `/watch?v=${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        domain: 'youtube.com',
        isSelf: false,
        selftext: decodeXmlEntities(snippetText).trim(),
        flair: `yt#${topic}`,
        thumbnail: buildThumbnailUrl(videoId, thumbs[0]?.url || bestThumb),
        previewImage: buildThumbnailUrl(videoId, bestThumb),
        galleryImages: [],
        isVideo: true,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        over18: false,
        spoiler: false,
        stickied: false,
      });
    }

    if (posts.length > 0) {
      setCache(cacheKey, posts, 10 * 60 * 1000);
    }
    return posts;
  } catch {
    return [];
  }
}

function rankYoutubePosts(
  posts: NormalizedYoutubePost[],
  sort: string
): NormalizedYoutubePost[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const items = [...posts];

  if (sort === 'new') {
    return items.sort((a, b) => b.createdUtc - a.createdUtc);
  }
  if (sort === 'top') {
    return items.sort(
      (a, b) => b.views - a.views || b.score - a.score || b.createdUtc - a.createdUtc
    );
  }
  if (sort === 'rising') {
    return items.sort((a, b) => {
      const ageA = Math.max(0.5, (nowSec - a.createdUtc) / 3600);
      const ageB = Math.max(0.5, (nowSec - b.createdUtc) / 3600);
      const velA = (a.views / 40 + a.score + a.numComments * 2) / Math.pow(ageA + 1, 1.3);
      const velB = (b.views / 40 + b.score + b.numComments * 2) / Math.pow(ageB + 1, 1.3);
      return velB - velA;
    });
  }
  if (sort === 'controversial') {
    return items.sort((a, b) => {
      const ratioA = (a.numComments * 10) / Math.max(1, a.score + 5);
      const ratioB = (b.numComments * 10) / Math.max(1, b.score + 5);
      return ratioB - ratioA || b.numComments - a.numComments;
    });
  }
  // best / hot: recency-weighted views & likes blend
  return items.sort((a, b) => {
    const ageA = Math.max(0.5, (nowSec - a.createdUtc) / 3600);
    const ageB = Math.max(0.5, (nowSec - b.createdUtc) / 3600);
    const sA = (Math.log10(Math.max(10, a.views)) * 120 + a.score * 0.15) / Math.pow(ageA + 3, 0.9);
    const sB = (Math.log10(Math.max(10, b.views)) * 120 + b.score * 0.15) / Math.pow(ageB + 3, 0.9);
    return sB - sA;
  });
}

export async function fetchYoutubeFeed(params: {
  channels: string[];
  topics: string[];
  sort: string;
  timeframe: string;
  hideShorts: boolean;
  limit: number;
  forceRefresh?: boolean;
}): Promise<{ posts: NormalizedYoutubePost[]; after: null; source: string }> {
  const {
    channels,
    topics,
    sort,
    timeframe,
    hideShorts,
    limit,
    forceRefresh = false,
  } = params;

  const cleanChannels = Array.from(
    new Set(channels.map(sanitizeYoutubeHandle).filter(Boolean))
  ).slice(0, 12);
  const cleanTopics = Array.from(
    new Set(topics.map(sanitizeYoutubeTopic).filter(Boolean))
  ).slice(0, 6);

  if (cleanChannels.length === 0 && cleanTopics.length === 0) {
    return { posts: [], after: null, source: 'youtube' };
  }

  const cacheKey = `yt_feed:${cleanChannels.map((c) => c.toLowerCase()).sort().join(',')}|t:${cleanTopics
    .map((t) => t.toLowerCase())
    .sort()
    .join(',')}:${sort}:${timeframe}:${hideShorts ? 'noshorts' : 'all'}:${limit}`;

  if (!forceRefresh) {
    const cached = getCache<{
      posts: NormalizedYoutubePost[];
      after: null;
      source: string;
    }>(cacheKey);
    if (cached) return cached;
  }

  const hasApiKey = Boolean(getYoutubeApiKey());
  const collected: NormalizedYoutubePost[] = [];
  let usedApi = false;

  if (hasApiKey) {
    const videoIdsToHydrate: string[] = [];
    const handleByChannelId = new Map<string, string>();
    const flairByVideoId = new Map<string, string>();

    // 1. Channels via quota-smart channels.list (1u) + playlistItems.list (1u)
    const resolvedChannels = (
      await Promise.all(cleanChannels.map((h) => lookupYoutubeChannel(h)))
    ).filter((c): c is YoutubeChannelInfo => Boolean(c));

    await Promise.all(
      resolvedChannels.map(async (ch) => {
        handleByChannelId.set(ch.channelId, ch.handle);
        const playlistId = ch.uploadsPlaylistId || deriveUploadsPlaylistId(ch.channelId);
        if (!playlistId) return;

        const plData = await youtubeApiGet<any>('playlistItems', {
          part: 'contentDetails',
          playlistId,
          maxResults: String(cleanChannels.length === 1 ? 15 : 8),
        });
        const items = Array.isArray(plData?.items) ? plData.items : [];
        if (items.length > 0) {
          usedApi = true;
          for (const it of items) {
            const vid = sanitizeYoutubeVideoId(String(it?.contentDetails?.videoId || ''));
            if (vid) videoIdsToHydrate.push(vid);
          }
        } else {
          // Graceful per-channel RSS fallback if playlistItems failed
          const rssPosts = await fetchChannelRssFallback(ch);
          collected.push(...rssPosts);
        }
      })
    );

    // 2. Topics via search.list (100u, strictly cached 15 minutes server-side)
    const ytOrder =
      sort === 'new' ? 'date' : sort === 'top' ? 'viewCount' : 'relevance';
    const tfSec =
      sort === 'top' || sort === 'controversial' ? getTimeframeSeconds(timeframe) : null;
    const publishedAfter = tfSec
      ? new Date(Date.now() - tfSec * 1000).toISOString()
      : '';

    await Promise.all(
      cleanTopics.map(async (topic) => {
        const topicCacheKey = `yt_api_topic:${topic.toLowerCase()}:${ytOrder}:${timeframe}`;
        let topicIds = !forceRefresh ? getCache<string[]>(topicCacheKey) : null;

        if (!topicIds) {
          const searchParams: Record<string, string> = {
            part: 'snippet',
            type: 'video',
            q: topic,
            order: ytOrder,
            maxResults: String(cleanTopics.length === 1 ? 15 : 8),
            safeSearch: 'moderate',
          };
          if (publishedAfter) searchParams.publishedAfter = publishedAfter;

          const searchData = await youtubeApiGet<any>('search', searchParams);
          const items = Array.isArray(searchData?.items) ? searchData.items : [];
          if (items.length > 0) {
            usedApi = true;
            topicIds = items
              .map((it: any) => sanitizeYoutubeVideoId(String(it?.id?.videoId || '')))
              .filter(Boolean);
            setCache(topicCacheKey, topicIds, TOPIC_API_CACHE_TTL_MS);
          }
        }

        if (topicIds && topicIds.length > 0) {
          usedApi = true;
          for (const vid of topicIds) {
            videoIdsToHydrate.push(vid);
            if (!flairByVideoId.has(vid)) {
              flairByVideoId.set(vid, `yt#${topic}`);
            }
          }
        } else {
          // Fallback to public search if search.list quota was exhausted
          const webPosts = await fetchTopicSearchFallback(topic, sort);
          collected.push(...webPosts);
        }
      })
    );

    // 3. Batch-hydrate all collected IDs in 1-unit videos.list calls
    if (videoIdsToHydrate.length > 0) {
      const hydrated = await fetchVideosByIdsApi(
        videoIdsToHydrate,
        handleByChannelId,
        flairByVideoId
      );
      collected.push(...hydrated);
    }
  } else {
    // Zero-key mode: official YouTube Atom RSS for channels + public YouTube search for topics
    const resolvedChannels = (
      await Promise.all(cleanChannels.map((h) => lookupYoutubeChannel(h)))
    ).filter((c): c is YoutubeChannelInfo => Boolean(c));

    const [channelBatches, topicBatches] = await Promise.all([
      Promise.all(resolvedChannels.map((ch) => fetchChannelRssFallback(ch))),
      Promise.all(cleanTopics.map((topic) => fetchTopicSearchFallback(topic, sort))),
    ]);

    for (const batch of channelBatches) collected.push(...batch);
    for (const batch of topicBatches) collected.push(...batch);
  }

  // Deduplicate by videoId
  const deduped = new Map<string, NormalizedYoutubePost>();
  for (const post of collected) {
    if (!deduped.has(post.videoId)) {
      deduped.set(post.videoId, post);
    }
  }

  let results = Array.from(deduped.values());

  if (hideShorts) {
    results = results.filter((p) => !p.isShort);
  }

  if (sort === 'top' || sort === 'controversial') {
    const windowSec = getTimeframeSeconds(timeframe);
    if (windowSec) {
      const cutoff = Math.floor(Date.now() / 1000) - windowSec;
      const inWindow = results.filter((p) => p.createdUtc >= cutoff);
      if (inWindow.length > 0) {
        results = inWindow;
      }
    }
  }

  const ranked = rankYoutubePosts(results, sort).slice(0, limit);
  const payload = {
    posts: ranked,
    after: null as null,
    source: usedApi ? 'youtube-api' : 'youtube-rss',
  };

  if (ranked.length > 0) {
    setCache(cacheKey, payload, FEED_CACHE_TTL_MS);
  }
  return payload;
}

export async function fetchYoutubeVideoDetails(params: {
  videoId: string;
  sort?: string;
  forceRefresh?: boolean;
}): Promise<{
  post?: NormalizedYoutubePost;
  comments: NormalizedYoutubeComment[];
  commentsDisabled?: boolean;
  apiKeyConfigured: boolean;
}> {
  const videoId = sanitizeYoutubeVideoId(params.videoId);
  const apiKey = getYoutubeApiKey();

  if (!videoId) {
    return { comments: [], apiKeyConfigured: Boolean(apiKey) };
  }

  const ytCommentOrder = params.sort === 'new' ? 'time' : 'relevance';
  const cacheKey = `yt_video:${videoId}:${ytCommentOrder}`;

  if (!params.forceRefresh) {
    const cached = getCache<{
      post?: NormalizedYoutubePost;
      comments: NormalizedYoutubeComment[];
      commentsDisabled?: boolean;
      apiKeyConfigured: boolean;
    }>(cacheKey);
    if (cached) return cached;
  }

  if (!apiKey) {
    return {
      comments: [],
      commentsDisabled: false,
      apiKeyConfigured: false,
    };
  }

  // Fetch video details (1u) & top comments (1u) in parallel
  const [videoData, commentsRes] = await Promise.all([
    youtubeApiGet<any>('videos', {
      part: 'snippet,contentDetails,statistics',
      id: videoId,
    }),
    (async () => {
      const qs = new URLSearchParams({
        part: 'snippet,replies',
        videoId,
        order: ytCommentOrder,
        maxResults: '30',
        textFormat: 'plainText',
        key: apiKey,
      });
      try {
        const res = await fetchWithTimeout(
          `https://www.googleapis.com/youtube/v3/commentThreads?${qs.toString()}`,
          { Accept: 'application/json' },
          8000
        );
        if (!res.ok) {
          const errBody: any = await res.json().catch(() => null);
          const reason = errBody?.error?.errors?.[0]?.reason || '';
          if (reason === 'commentsDisabled') {
            return { items: [], commentsDisabled: true };
          }
          return { items: [], commentsDisabled: false };
        }
        const json: any = await res.json();
        return {
          items: Array.isArray(json?.items) ? json.items : [],
          commentsDisabled: false,
        };
      } catch {
        return { items: [], commentsDisabled: false };
      }
    })(),
  ]);

  const rawVideo = Array.isArray(videoData?.items) ? videoData.items[0] : null;
  const post = rawVideo
    ? normalizeApiVideoItem(rawVideo, new Map(), null) ?? undefined
    : undefined;

  const comments: NormalizedYoutubeComment[] = [];
  for (const thread of commentsRes.items) {
    const top = thread?.snippet?.topLevelComment;
    const snip = top?.snippet;
    if (!snip?.textDisplay && !snip?.textOriginal) continue;

    const publishedMs = Date.parse(String(snip.publishedAt || ''));
    const replies: NormalizedYoutubeComment[] = [];
    const rawReplies = Array.isArray(thread?.replies?.comments)
      ? thread.replies.comments
      : [];

    for (const rep of rawReplies.slice(0, 6)) {
      const rSnip = rep?.snippet;
      if (!rSnip?.textDisplay && !rSnip?.textOriginal) continue;
      const rMs = Date.parse(String(rSnip.publishedAt || ''));
      replies.push({
        id: String(rep.id || Math.random().toString(36).slice(2)),
        author: String(rSnip.authorDisplayName || 'YouTube User').replace(/^@+/, ''),
        body: stripHtmlTags(String(rSnip.textOriginal || rSnip.textDisplay || '')),
        score: Number(rSnip.likeCount || 0),
        createdUtc: Number.isFinite(rMs)
          ? Math.floor(rMs / 1000)
          : Math.floor(Date.now() / 1000),
        isSubmitter: Boolean(
          post?.channelId &&
            rSnip.authorChannelId?.value &&
            rSnip.authorChannelId.value === post.channelId
        ),
        distinguished: null,
        depth: 1,
        replies: [],
      });
    }

    comments.push({
      id: String(top?.id || thread?.id || Math.random().toString(36).slice(2)),
      author: String(snip.authorDisplayName || 'YouTube User').replace(/^@+/, ''),
      body: stripHtmlTags(String(snip.textOriginal || snip.textDisplay || '')),
      score: Number(snip.likeCount || 0),
      createdUtc: Number.isFinite(publishedMs)
        ? Math.floor(publishedMs / 1000)
        : Math.floor(Date.now() / 1000),
      isSubmitter: Boolean(
        post?.channelId &&
          snip.authorChannelId?.value &&
          snip.authorChannelId.value === post.channelId
      ),
      distinguished: null,
      depth: 0,
      replies,
    });
  }

  const payload = {
    post,
    comments,
    commentsDisabled: commentsRes.commentsDisabled,
    apiKeyConfigured: true,
  };
  setCache(cacheKey, payload, VIDEO_DETAILS_CACHE_TTL_MS);
  return payload;
}
