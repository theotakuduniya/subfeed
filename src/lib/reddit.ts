import type {
  CommentSortOption,
  FeedResponse,
  RedditComment,
  RedditPost,
  SortOption,
  SubredditSuggestion,
  TimeframeOption,
} from '../types/reddit';
import { cacheDelete, cacheGet, cacheSet } from './cache';

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const COMMENTS_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

export function buildFeedCacheKey(
  subreddits: string[],
  sort: SortOption,
  timeframe: TimeframeOption
): string {
  const normalized = Array.from(
    new Set(subreddits.map((s) => sanitizeSubredditName(s).toLowerCase()).filter(Boolean))
  ).sort();
  const tfPart = sort === 'top' || sort === 'controversial' ? timeframe : 'none';
  return `feed:${normalized.join('+')}:${sort}:${tfPart}`;
}

export function getCachedFeed(
  subreddits: string[],
  sort: SortOption,
  timeframe: TimeframeOption
): FeedResponse | null {
  if (subreddits.length === 0) return null;
  return cacheGet<FeedResponse>(buildFeedCacheKey(subreddits, sort, timeframe));
}

export function updateCachedFeed(
  subreddits: string[],
  sort: SortOption,
  timeframe: TimeframeOption,
  response: FeedResponse
): void {
  if (subreddits.length === 0) return;
  cacheSet(buildFeedCacheKey(subreddits, sort, timeframe), response, FEED_CACHE_TTL_MS);
}

export const DEFAULT_SUBREDDITS = [
  'programming',
  'design',
  'technology',
  'webdev',
  'minimalism',
];

export const STARTER_PACKS: { label: string; subreddits: string[] }[] = [
  {
    label: 'Engineering',
    subreddits: ['programming', 'webdev', 'rust', 'typescript', 'compsci'],
  },
  {
    label: 'Design & Craft',
    subreddits: ['design', 'typography', 'minimalism', 'IndustrialDesign', 'UI_Design'],
  },
  {
    label: 'Science & Ideas',
    subreddits: ['science', 'space', 'technology', 'books', 'philosophy'],
  },
];

export function sanitizeSubredditName(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.|old\.|np\.)?reddit\.com\/r\//i, '')
    .replace(/^\/?r\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

export function formatCompactNumber(num: number): string {
  if (!Number.isFinite(num)) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(num);
}

export function formatRelativeTime(createdUtc: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSec - createdUtc);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 30 * 86_400) return `${Math.floor(diff / 86_400)}d ago`;
  if (diff < 365 * 86_400) return `${Math.floor(diff / (30 * 86_400))}mo ago`;
  return `${Math.floor(diff / (365 * 86_400))}y ago`;
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeBrowserPost(raw: Record<string, any>): RedditPost {
  let thumbnail: string | null = null;
  if (
    typeof raw.thumbnail === 'string' &&
    raw.thumbnail.startsWith('http') &&
    !raw.over_18 &&
    !raw.spoiler
  ) {
    thumbnail = decodeHtml(raw.thumbnail);
  }

  let previewImage: string | null = null;
  const previewSource = raw.preview?.images?.[0]?.source?.url;
  if (typeof previewSource === 'string' && previewSource.startsWith('http')) {
    previewImage = decodeHtml(previewSource);
  } else if (
    typeof raw.url === 'string' &&
    /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(raw.url)
  ) {
    previewImage = decodeHtml(raw.url);
  }

  const galleryImages: string[] = [];
  if (raw.is_gallery && raw.gallery_data?.items && raw.media_metadata) {
    for (const item of raw.gallery_data.items) {
      const meta = raw.media_metadata[item.media_id];
      const src = meta?.s?.u || meta?.s?.gif;
      if (typeof src === 'string' && src.startsWith('http')) {
        galleryImages.push(decodeHtml(src));
      }
    }
    if (!previewImage && galleryImages.length > 0) {
      previewImage = galleryImages[0];
    }
  }

  if (!thumbnail && previewImage && !raw.over_18 && !raw.spoiler) {
    const resolutions = raw.preview?.images?.[0]?.resolutions;
    if (Array.isArray(resolutions) && resolutions.length > 0) {
      const small = resolutions[Math.min(1, resolutions.length - 1)]?.url;
      if (typeof small === 'string' && small.startsWith('http')) {
        thumbnail = decodeHtml(small);
      }
    } else {
      thumbnail = previewImage;
    }
  }

  const permalink =
    typeof raw.permalink === 'string' && raw.permalink.startsWith('/')
      ? raw.permalink
      : `/r/${raw.subreddit || 'all'}/comments/${raw.id}/`;

  return {
    id: String(raw.id || ''),
    fullname: String(raw.name || `t3_${raw.id || ''}`),
    title: decodeHtml(String(raw.title || '')),
    subreddit: String(raw.subreddit || ''),
    author: String(raw.author || '[deleted]'),
    score: Number(raw.score ?? raw.ups ?? 0),
    upvoteRatio: typeof raw.upvote_ratio === 'number' ? raw.upvote_ratio : null,
    numComments: Number(raw.num_comments ?? 0),
    createdUtc: Number(raw.created_utc ?? Math.floor(Date.now() / 1000)),
    permalink,
    url: decodeHtml(String(raw.url || `https://www.reddit.com${permalink}`)),
    domain: String(raw.domain || (raw.is_self ? `self.${raw.subreddit || ''}` : 'reddit.com')),
    isSelf: Boolean(raw.is_self),
    selftext: decodeHtml(String(raw.selftext || '')),
    flair: raw.link_flair_text ? decodeHtml(String(raw.link_flair_text)).trim() || null : null,
    thumbnail,
    previewImage,
    galleryImages,
    isVideo: Boolean(raw.is_video || raw.media?.reddit_video?.fallback_url),
    videoUrl:
      typeof raw.media?.reddit_video?.fallback_url === 'string'
        ? decodeHtml(raw.media.reddit_video.fallback_url)
        : null,
    over18: Boolean(raw.over_18),
    spoiler: Boolean(raw.spoiler),
    stickied: Boolean(raw.stickied),
  };
}

function normalizeBrowserComments(children: any[], depth = 0): RedditComment[] {
  if (!Array.isArray(children)) return [];
  const results: RedditComment[] = [];

  for (const node of children) {
    if (node?.kind !== 't1' || !node?.data) continue;
    const d = node.data;
    if (!d.body) continue;
    const replyChildren = d.replies?.data?.children || [];
    if (d.body === '[deleted]' && replyChildren.length === 0) continue;

    results.push({
      id: String(d.id || Math.random().toString(36).slice(2)),
      author: String(d.author || '[deleted]'),
      body: decodeHtml(String(d.body)),
      score: Number(d.score ?? d.ups ?? 0),
      createdUtc: Number(d.created_utc ?? Math.floor(Date.now() / 1000)),
      isSubmitter: Boolean(d.is_submitter),
      distinguished: d.distinguished ? String(d.distinguished) : null,
      depth,
      replies: depth < 5 ? normalizeBrowserComments(replyChildren, depth + 1) : [],
    });
  }

  return results;
}

async function fetchWithTimeout(url: string, timeoutMs = 4500, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchFeed(params: {
  subreddits: string[];
  sort: SortOption;
  timeframe: TimeframeOption;
  after?: string | null;
  limit?: number;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<FeedResponse> {
  const { subreddits, sort, timeframe, after, limit = 25, forceRefresh = false, signal } = params;
  const cleanSubs = subreddits.map(sanitizeSubredditName).filter(Boolean);
  if (cleanSubs.length === 0) {
    return { posts: [], after: null };
  }

  const cacheKey = buildFeedCacheKey(cleanSubs, sort, timeframe);
  if (!after) {
    if (forceRefresh) {
      cacheDelete(cacheKey);
    } else {
      const cached = cacheGet<FeedResponse>(cacheKey);
      if (cached) return cached;
    }
  }

  const joined = cleanSubs.join('+');

  // 1. Primary: Direct browser simple GET to www.reddit.com (no custom headers to avoid CORS preflight)
  if (!after || !after.startsWith('as_')) {
    const tryDirectSort = async (sortEndpoint: string): Promise<FeedResponse | null> => {
      const qs = new URLSearchParams({
        raw_json: '1',
        limit: String(limit),
      });
      if (sortEndpoint === 'top' || sortEndpoint === 'controversial') {
        qs.set('t', timeframe);
      }
      if (after) {
        qs.set('after', after);
      }

      const url = `https://www.reddit.com/r/${encodeURIComponent(joined).replace(/%2B/gi, '+')}/${sortEndpoint}.json?${qs.toString()}`;
      try {
        const res = await fetchWithTimeout(url, 4200, signal);
        if (res.status === 404 && cleanSubs.length === 1 && sortEndpoint !== 'best') {
          throw new Error(`r/${cleanSubs[0]} could not be found.`);
        }
        if (res.status === 403 && cleanSubs.length === 1) {
          // Could be private or IP-blocked; fall through to backend proxy to verify
          return null;
        }
        if (!res.ok) return null;
        const json = await res.json();
        const children = json?.data?.children;
        if (!Array.isArray(children)) return null;
        const posts = children
          .filter((c: any) => c?.kind === 't3' && c?.data)
          .map((c: any) => normalizeBrowserPost(c.data));
        return {
          posts,
          after: json?.data?.after || null,
          source: 'reddit-direct',
        };
      } catch (err: any) {
        if (err?.name === 'AbortError' && signal?.aborted) throw err;
        if (err?.message?.includes('could not be found')) throw err;
        return null;
      }
    };

    let directResult = await tryDirectSort(sort);
    // Some subreddits do not expose /best.json; gracefully fall back to /hot.json directly
    if (!directResult && sort === 'best') {
      directResult = await tryDirectSort('hot');
    }
    if (directResult && (directResult.posts.length > 0 || after)) {
      if (!after) {
        cacheSet(cacheKey, directResult, FEED_CACHE_TTL_MS);
      }
      return directResult;
    }
  }

  // 2. Resilient backend proxy (/api/reddit/feed with Reddit + live archive fallback)
  const apiParams = new URLSearchParams({
    subreddits: joined,
    sort,
    t: timeframe,
    limit: String(limit),
  });
  if (after) apiParams.set('after', after);
  if (forceRefresh) apiParams.set('refresh', '1');

  const proxyRes = await fetchWithTimeout(
    `/api/reddit/feed?${apiParams.toString()}`,
    12_000,
    signal
  );
  if (!proxyRes.ok) {
    const errBody = await proxyRes.json().catch(() => ({}));
    throw new Error(errBody.error || `Unable to load posts (HTTP ${proxyRes.status}).`);
  }
  const data = (await proxyRes.json()) as FeedResponse;
  const result: FeedResponse = {
    posts: Array.isArray(data.posts) ? data.posts : [],
    after: data.after ?? null,
    source: data.source,
  };
  if (!after) {
    cacheSet(cacheKey, result, FEED_CACHE_TTL_MS);
  }
  return result;
}

export async function fetchPostComments(params: {
  permalink: string;
  postId: string;
  sort: CommentSortOption;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<{ comments: RedditComment[]; post?: RedditPost }> {
  const { permalink, postId, sort, forceRefresh = false, signal } = params;
  const cacheKey = `comments:${postId || permalink}:${sort}`;

  if (forceRefresh) {
    cacheDelete(cacheKey);
  } else {
    const cached = cacheGet<{ comments: RedditComment[]; post?: RedditPost }>(cacheKey);
    if (cached) return cached;
  }

  // 1. Direct browser fetch to www.reddit.com
  if (permalink.startsWith('/r/')) {
    try {
      const cleanPath = permalink.replace(/\/$/, '');
      const url = `https://www.reddit.com${cleanPath}.json?raw_json=1&limit=80&sort=${encodeURIComponent(sort)}`;
      const res = await fetchWithTimeout(url, 4200, signal);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json) && json.length >= 2) {
          const postRaw = json[0]?.data?.children?.[0]?.data;
          const commentChildren = json[1]?.data?.children || [];
          const result = {
            post: postRaw ? normalizeBrowserPost(postRaw) : undefined,
            comments: normalizeBrowserComments(commentChildren),
          };
          cacheSet(cacheKey, result, COMMENTS_CACHE_TTL_MS);
          return result;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' && signal?.aborted) throw err;
    }
  }

  // 2. Fallback to backend proxy
  const qs = new URLSearchParams({
    permalink,
    postId,
    sort,
  });
  if (forceRefresh) qs.set('refresh', '1');
  const proxyRes = await fetchWithTimeout(
    `/api/reddit/comments?${qs.toString()}`,
    10_000,
    signal
  );
  if (!proxyRes.ok) {
    throw new Error('Could not load comments for this post.');
  }
  const result = (await proxyRes.json()) as { comments: RedditComment[]; post?: RedditPost };
  cacheSet(cacheKey, result, COMMENTS_CACHE_TTL_MS);
  return result;
}

export async function searchSubreddits(
  query: string,
  signal?: AbortSignal
): Promise<SubredditSuggestion[]> {
  const clean = sanitizeSubredditName(query);
  if (clean.length < 2) return [];

  const cacheKey = `search:${clean.toLowerCase()}`;
  const cached = cacheGet<SubredditSuggestion[]>(cacheKey);
  if (cached) return cached;

  // 1. Try direct Reddit autocomplete
  try {
    const url = `https://www.reddit.com/api/subreddit_autocomplete_v2.json?query=${encodeURIComponent(clean)}&include_over_18=false&limit=7&raw_json=1`;
    const res = await fetchWithTimeout(url, 3200, signal);
    if (res.ok) {
      const json = await res.json();
      const children = json?.data?.children || [];
      const items: SubredditSuggestion[] = children
        .filter((c: any) => c?.kind === 't5' && c?.data?.display_name)
        .map((c: any) => ({
          name: String(c.data.display_name),
          title: decodeHtml(String(c.data.title || c.data.display_name)),
          subscribers: Number(c.data.subscribers || 0),
          description: decodeHtml(String(c.data.public_description || '')).slice(0, 120),
        }));
      if (items.length > 0) {
        cacheSet(cacheKey, items, SEARCH_CACHE_TTL_MS);
        return items;
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
  }

  // 2. Fallback to backend search
  try {
    const proxyRes = await fetchWithTimeout(
      `/api/reddit/search-subreddits?q=${encodeURIComponent(clean)}`,
      6000,
      signal
    );
    if (!proxyRes.ok) return [];
    const data = await proxyRes.json();
    const items = Array.isArray(data?.subreddits) ? data.subreddits : [];
    if (items.length > 0) {
      cacheSet(cacheKey, items, SEARCH_CACHE_TTL_MS);
    }
    return items;
  } catch {
    return [];
  }
}
