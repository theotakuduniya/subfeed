import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  fetchXFeed,
  fetchXProfile,
  fetchXTweetDetails,
  sanitizeXHandle,
} from './server/xFetcher.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Simple in-memory TTL cache to avoid rate-limiting and keep switching snappy
interface CacheEntry {
  expiresAt: number;
  data: unknown;
}
const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown, ttlMs = 45_000): void {
  if (cache.size > 300) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// Normalize raw Reddit / Arctic Shift post objects into a clean, consistent format
interface NormalizedPost {
  id: string;
  fullname: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  upvoteRatio: number | null;
  numComments: number;
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

interface NormalizedComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  isSubmitter: boolean;
  distinguished: string | null;
  depth: number;
  replies: NormalizedComment[];
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMedia(raw: Record<string, any>): {
  thumbnail: string | null;
  previewImage: string | null;
  galleryImages: string[];
  isVideo: boolean;
  videoUrl: string | null;
} {
  let thumbnail: string | null = null;
  if (
    typeof raw.thumbnail === 'string' &&
    raw.thumbnail.startsWith('http') &&
    !raw.over_18 &&
    !raw.spoiler
  ) {
    thumbnail = decodeHtmlEntities(raw.thumbnail);
  }

  let previewImage: string | null = null;
  const previewSource = raw.preview?.images?.[0]?.source?.url;
  if (typeof previewSource === 'string' && previewSource.startsWith('http')) {
    previewImage = decodeHtmlEntities(previewSource);
  } else if (
    typeof raw.url === 'string' &&
    /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(raw.url)
  ) {
    previewImage = decodeHtmlEntities(raw.url);
  }

  const galleryImages: string[] = [];
  if (raw.is_gallery && raw.gallery_data?.items && raw.media_metadata) {
    for (const item of raw.gallery_data.items) {
      const meta = raw.media_metadata[item.media_id];
      const src = meta?.s?.u || meta?.s?.gif;
      if (typeof src === 'string' && src.startsWith('http')) {
        galleryImages.push(decodeHtmlEntities(src));
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
        thumbnail = decodeHtmlEntities(small);
      }
    } else {
      thumbnail = previewImage;
    }
  }

  const isVideo = Boolean(raw.is_video || raw.media?.reddit_video?.fallback_url);
  const videoUrl =
    typeof raw.media?.reddit_video?.fallback_url === 'string'
      ? decodeHtmlEntities(raw.media.reddit_video.fallback_url)
      : null;

  return { thumbnail, previewImage, galleryImages, isVideo, videoUrl };
}

function normalizePost(raw: Record<string, any>): NormalizedPost {
  const media = extractMedia(raw);
  const permalink =
    typeof raw.permalink === 'string' && raw.permalink.startsWith('/')
      ? raw.permalink
      : `/r/${raw.subreddit || 'all'}/comments/${raw.id}/`;

  return {
    id: String(raw.id || ''),
    fullname: String(raw.name || `t3_${raw.id || ''}`),
    title: decodeHtmlEntities(String(raw.title || '')),
    subreddit: String(raw.subreddit || ''),
    author: String(raw.author || '[deleted]'),
    score: Number(raw.score ?? raw.ups ?? 0),
    upvoteRatio: typeof raw.upvote_ratio === 'number' ? raw.upvote_ratio : null,
    numComments: Number(raw.num_comments ?? 0),
    createdUtc: Number(raw.created_utc ?? raw.created ?? Math.floor(Date.now() / 1000)),
    permalink,
    url: decodeHtmlEntities(String(raw.url || `https://www.reddit.com${permalink}`)),
    domain: String(raw.domain || (raw.is_self ? `self.${raw.subreddit || ''}` : 'reddit.com')),
    isSelf: Boolean(raw.is_self),
    selftext: decodeHtmlEntities(String(raw.selftext || '')),
    flair: raw.link_flair_text ? decodeHtmlEntities(String(raw.link_flair_text)).trim() || null : null,
    thumbnail: media.thumbnail,
    previewImage: media.previewImage,
    galleryImages: media.galleryImages,
    isVideo: media.isVideo,
    videoUrl: media.videoUrl,
    over18: Boolean(raw.over_18),
    spoiler: Boolean(raw.spoiler),
    stickied: Boolean(raw.stickied),
  };
}

function normalizeRedditCommentTree(children: any[], depth = 0): NormalizedComment[] {
  if (!Array.isArray(children)) return [];
  const results: NormalizedComment[] = [];

  for (const node of children) {
    const data = node?.kind === 't1' ? node.data : node?.data && !node?.kind ? node.data : node;
    if (!data || !data.body || node?.kind === 'more') continue;
    if (data.body === '[deleted]' && (!data.replies || !data.replies?.data?.children?.length)) {
      continue;
    }

    let childNodes: any[] = [];
    if (data.replies && typeof data.replies === 'object') {
      if (Array.isArray(data.replies.data?.children)) {
        childNodes = data.replies.data.children;
      } else if (Array.isArray(data.replies)) {
        childNodes = data.replies;
      }
    }

    results.push({
      id: String(data.id || Math.random().toString(36).slice(2)),
      author: String(data.author || '[deleted]'),
      body: decodeHtmlEntities(String(data.body || '')),
      score: Number(data.score ?? data.ups ?? 0),
      createdUtc: Number(data.created_utc ?? Math.floor(Date.now() / 1000)),
      isSubmitter: Boolean(data.is_submitter),
      distinguished: data.distinguished ? String(data.distinguished) : null,
      depth,
      replies: depth < 5 ? normalizeRedditCommentTree(childNodes, depth + 1) : [],
    });
  }

  return results;
}

function sortCommentsTree(comments: NormalizedComment[], sort: string): NormalizedComment[] {
  const sorted = [...comments].sort((a, b) => {
    if (sort === 'new') return b.createdUtc - a.createdUtc;
    if (sort === 'controversial') {
      const aContro = a.replies.length * 10 - Math.abs(a.score);
      const bContro = b.replies.length * 10 - Math.abs(b.score);
      return bContro - aContro;
    }
    if (sort === 'top') return b.score - a.score;
    // best: score weighted slightly by reply engagement
    return b.score + b.replies.length * 2 - (a.score + a.replies.length * 2);
  });
  return sorted.map((c) => ({ ...c, replies: sortCommentsTree(c.replies, sort) }));
}

function getTimeWindowSeconds(t: string): number | null {
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
    case 'all':
    default:
      return null;
  }
}

function rankPostsBySort(posts: NormalizedPost[], sort: string): NormalizedPost[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const items = [...posts];

  if (sort === 'new') {
    return items.sort((a, b) => b.createdUtc - a.createdUtc);
  }
  if (sort === 'top') {
    return items.sort((a, b) => b.score - a.score || b.numComments - a.numComments);
  }
  if (sort === 'rising') {
    return items.sort((a, b) => {
      const ageA = Math.max(0.25, (nowSec - a.createdUtc) / 3600);
      const ageB = Math.max(0.25, (nowSec - b.createdUtc) / 3600);
      const velA = (a.score + a.numComments * 2.5) / Math.pow(ageA + 0.5, 1.35);
      const velB = (b.score + b.numComments * 2.5) / Math.pow(ageB + 0.5, 1.35);
      return velB - velA;
    });
  }
  if (sort === 'controversial') {
    return items.sort((a, b) => {
      const ratioA = (a.numComments * 4) / Math.max(1, Math.abs(a.score) + 2);
      const ratioB = (b.numComments * 4) / Math.max(1, Math.abs(b.score) + 2);
      return ratioB - ratioA || b.numComments - a.numComments;
    });
  }
  if (sort === 'best') {
    return items.sort((a, b) => {
      const ageA = Math.max(0.5, (nowSec - a.createdUtc) / 3600);
      const ageB = Math.max(0.5, (nowSec - b.createdUtc) / 3600);
      const bestA = (a.score * (a.upvoteRatio ?? 0.85) + a.numComments * 1.6) / Math.pow(ageA + 2, 1.15);
      const bestB = (b.score * (b.upvoteRatio ?? 0.85) + b.numComments * 1.6) / Math.pow(ageB + 2, 1.15);
      return bestB - bestA;
    });
  }
  // hot (classic Reddit hot algorithm)
  return items.sort((a, b) => {
    const hotScore = (p: NormalizedPost) => {
      const order = Math.log10(Math.max(Math.abs(p.score), 1));
      const sign = p.score > 0 ? 1 : p.score < 0 ? -1 : 0;
      const seconds = p.createdUtc - 1134028003;
      return sign * order + seconds / 45000;
    };
    return hotScore(b) - hotScore(a);
  });
}

async function fetchJsonWithTimeout(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromDirectReddit(
  subredditsParam: string,
  sort: string,
  timeframe: string,
  after: string,
  limit: number
): Promise<{ posts: NormalizedPost[]; after: string | null; source: string } | null> {
  const safeSort = ['best', 'hot', 'new', 'top', 'rising', 'controversial'].includes(sort)
    ? sort
    : 'hot';
  const params = new URLSearchParams({
    raw_json: '1',
    limit: String(limit),
  });
  if ((safeSort === 'top' || safeSort === 'controversial') && timeframe) {
    params.set('t', timeframe);
  }
  if (after && !after.startsWith('as_')) {
    params.set('after', after);
  }

  const url = `https://www.reddit.com/r/${encodeURIComponent(subredditsParam).replace(/%2B/gi, '+')}/${safeSort}.json?${params.toString()}`;
  try {
    const res = await fetchJsonWithTimeout(
      url,
      {
        'User-Agent': 'web:subfeed-reader:v1.0.0',
        Accept: 'application/json',
      },
      4500
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const children = json?.data?.children;
    if (!Array.isArray(children)) return null;
    const posts = children
      .filter((c: any) => c?.kind === 't3' && c?.data)
      .map((c: any) => normalizePost(c.data));
    return {
      posts,
      after: json?.data?.after || null,
      source: 'reddit',
    };
  } catch {
    return null;
  }
}

async function fetchFromArcticShift(
  subredditList: string[],
  sort: string,
  timeframe: string,
  afterCursor: string,
  limit: number
): Promise<{ posts: NormalizedPost[]; after: string | null; source: string }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const beforeSec =
    afterCursor && afterCursor.startsWith('as_')
      ? Number(afterCursor.slice(3))
      : null;

  // Determine how far back to scan based on sort and timeframe
  let windowSec: number | null = null;
  if (sort === 'top' || sort === 'controversial') {
    windowSec = getTimeWindowSeconds(timeframe);
  } else if (sort === 'rising') {
    windowSec = 24 * 3600;
  } else if (sort === 'hot' || sort === 'best') {
    windowSec = 7 * 86_400;
  }

  // Fetch per subreddit in parallel (capped to keep latency low)
  const subsToQuery = subredditList.slice(0, 12);
  const perSubLimit =
    subsToQuery.length === 1
      ? Math.min(100, Math.max(limit * 2, 50))
      : Math.min(40, Math.max(15, Math.ceil((limit * 2.5) / subsToQuery.length)));

  const fetchOneSub = async (sub: string): Promise<NormalizedPost[]> => {
    const params = new URLSearchParams({
      subreddit: sub,
      limit: String(perSubLimit),
      sort: 'desc',
    });
    if (beforeSec && Number.isFinite(beforeSec)) {
      params.set('before', String(beforeSec));
    } else if (windowSec && sort !== 'new') {
      params.set('after', String(nowSec - windowSec));
    }

    const url = `https://arctic-shift.photon-reddit.com/api/posts/search?${params.toString()}`;
    try {
      const res = await fetchJsonWithTimeout(url, { Accept: 'application/json' }, 8000);
      if (!res.ok) return [];
      const json: any = await res.json();
      const rows = Array.isArray(json?.data) ? json.data : [];
      // If window returned too few posts (quiet subreddit), retry without after window
      if (rows.length < 5 && params.has('after') && !beforeSec) {
        params.delete('after');
        const retryRes = await fetchJsonWithTimeout(
          `https://arctic-shift.photon-reddit.com/api/posts/search?${params.toString()}`,
          { Accept: 'application/json' },
          7000
        );
        if (retryRes.ok) {
          const retryJson: any = await retryRes.json();
          if (Array.isArray(retryJson?.data)) {
            return retryJson.data.map((r: any) => normalizePost(r));
          }
        }
      }
      return rows.map((r: any) => normalizePost(r));
    } catch {
      return [];
    }
  };

  const results = await Promise.all(subsToQuery.map(fetchOneSub));
  const mergedMap = new Map<string, NormalizedPost>();
  for (const list of results) {
    for (const post of list) {
      if (post.id && !mergedMap.has(post.id)) {
        mergedMap.set(post.id, post);
      }
    }
  }

  let allPosts = Array.from(mergedMap.values());
  // Filter out removed/deleted empty shells when possible
  allPosts = allPosts.filter((p) => p.title && p.title !== '[deleted by user]');

  const ranked = rankPostsBySort(allPosts, sort);
  const pagePosts = ranked.slice(0, limit);

  const oldestCreated =
    allPosts.length > 0
      ? Math.min(...allPosts.map((p) => p.createdUtc))
      : null;

  const nextCursor =
    oldestCreated && allPosts.length >= Math.min(limit, 10)
      ? `as_${oldestCreated - 1}`
      : null;

  return {
    posts: pagePosts,
    after: nextCursor,
    source: 'archive-live',
  };
}

function sanitizeSubredditName(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.|old\.)?reddit\.com\/r\//i, '')
    .replace(/^\/?r\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

async function createServer() {
  const app = express();
  app.use(express.json());

  // GET /api/reddit/feed?subreddits=programming+design&sort=best&t=day&after=...
  app.get('/api/reddit/feed', async (req, res) => {
    try {
      const rawSubs = String(req.query.subreddits || '').trim();
      const sort = String(req.query.sort || 'best').toLowerCase();
      const timeframe = String(req.query.t || 'day').toLowerCase();
      const after = String(req.query.after || '').trim();
      const limit = Math.min(50, Math.max(10, Number(req.query.limit) || 25));

      const subList = rawSubs
        .split(/[+,\s]+/)
        .map(sanitizeSubredditName)
        .filter(Boolean);

      if (subList.length === 0) {
        return res.status(400).json({ error: 'At least one subreddit is required.' });
      }

      const uniqueSubs = Array.from(new Set(subList.map((s) => s.toLowerCase())));
      const forceRefresh = req.query.refresh === '1';
      const cacheKey = `feed:${uniqueSubs.join('+')}:${sort}:${timeframe}:${after}:${limit}`;
      if (!forceRefresh) {
        const cached = getCached<{ posts: NormalizedPost[]; after: string | null; source: string }>(cacheKey);
        if (cached) {
          return res.json(cached);
        }
      }

      // 1. Try direct Reddit first
      const direct = await fetchFromDirectReddit(
        uniqueSubs.join('+'),
        sort,
        timeframe,
        after,
        limit
      );
      if (direct && direct.posts.length > 0) {
        setCached(cacheKey, direct, 120_000);
        return res.json(direct);
      }

      // 2. Resilient live fallback via Arctic Shift
      const fallback = await fetchFromArcticShift(
        uniqueSubs,
        sort,
        timeframe,
        after,
        limit
      );
      setCached(cacheKey, fallback, 120_000);
      return res.json(fallback);
    } catch (err) {
      console.error('Feed error:', err);
      return res.status(502).json({ error: 'Failed to load Reddit feed. Please try again.' });
    }
  });

  // GET /api/reddit/comments?permalink=/r/...&postId=...&sort=best
  app.get('/api/reddit/comments', async (req, res) => {
    try {
      const permalink = String(req.query.permalink || '').trim();
      const postId = String(req.query.postId || '').replace(/^t3_/, '').trim();
      const sort = String(req.query.sort || 'best').toLowerCase();

      if (!permalink && !postId) {
        return res.status(400).json({ error: 'Missing permalink or postId.' });
      }

      const forceRefresh = req.query.refresh === '1';
      const cacheKey = `comments:${postId || permalink}:${sort}`;
      if (!forceRefresh) {
        const cached = getCached<{ comments: NormalizedComment[]; post?: NormalizedPost }>(cacheKey);
        if (cached) {
          return res.json(cached);
        }
      }

      // 1. Try direct Reddit comments JSON
      if (permalink && permalink.startsWith('/r/')) {
        try {
          const cleanPath = permalink.replace(/\/$/, '');
          const url = `https://www.reddit.com${cleanPath}.json?raw_json=1&limit=80&sort=${encodeURIComponent(sort)}`;
          const r = await fetchJsonWithTimeout(
            url,
            { 'User-Agent': 'web:subfeed-reader:v1.0.0', Accept: 'application/json' },
            4500
          );
          if (r.ok) {
            const json: any = await r.json();
            if (Array.isArray(json) && json.length >= 2) {
              const postRaw = json[0]?.data?.children?.[0]?.data;
              const commentChildren = json[1]?.data?.children || [];
              const result = {
                post: postRaw ? normalizePost(postRaw) : undefined,
                comments: normalizeRedditCommentTree(commentChildren),
              };
              setCached(cacheKey, result, 120_000);
              return res.json(result);
            }
          }
        } catch {
          // Fall through to Arctic Shift
        }
      }

      // 2. Fallback to Arctic Shift comments tree
      const resolvedId =
        postId ||
        (permalink.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? '');

      if (!resolvedId) {
        return res.json({ comments: [] });
      }

      const treeRes = await fetchJsonWithTimeout(
        `https://arctic-shift.photon-reddit.com/api/comments/tree?link_id=${encodeURIComponent(resolvedId)}&limit=100`,
        { Accept: 'application/json' },
        8000
      );

      if (!treeRes.ok) {
        return res.json({ comments: [] });
      }

      const treeJson: any = await treeRes.json();
      const rawTree = Array.isArray(treeJson?.data) ? treeJson.data : [];
      const normalized = sortCommentsTree(normalizeRedditCommentTree(rawTree), sort);

      const payload = { comments: normalized };
      setCached(cacheKey, payload, 120_000);
      return res.json(payload);
    } catch (err) {
      console.error('Comments error:', err);
      return res.status(502).json({ error: 'Failed to load comments.' });
    }
  });

  // GET /api/reddit/search-subreddits?q=prog
  app.get('/api/reddit/search-subreddits', async (req, res) => {
    try {
      const q = sanitizeSubredditName(String(req.query.q || ''));
      if (!q || q.length < 2) {
        return res.json({ subreddits: [] });
      }

      const cacheKey = `search:${q.toLowerCase()}`;
      const cached = getCached<{ subreddits: any[] }>(cacheKey);
      if (cached) return res.json(cached);

      // 1. Try direct Reddit autocomplete
      try {
        const r = await fetchJsonWithTimeout(
          `https://www.reddit.com/api/subreddit_autocomplete_v2.json?query=${encodeURIComponent(q)}&include_over_18=false&limit=8&raw_json=1`,
          { 'User-Agent': 'web:subfeed-reader:v1.0.0', Accept: 'application/json' },
          3500
        );
        if (r.ok) {
          const json: any = await r.json();
          const children = json?.data?.children || [];
          const subreddits = children
            .filter((c: any) => c?.kind === 't5' && c?.data?.display_name)
            .map((c: any) => ({
              name: String(c.data.display_name),
              title: decodeHtmlEntities(String(c.data.title || c.data.display_name)),
              subscribers: Number(c.data.subscribers || 0),
              description: decodeHtmlEntities(String(c.data.public_description || '')).slice(0, 140),
            }));
          if (subreddits.length > 0) {
            const payload = { subreddits };
            setCached(cacheKey, payload, 120_000);
            return res.json(payload);
          }
        }
      } catch {
        // Fallback below
      }

      // 2. Fallback to Arctic Shift subreddit prefix search
      const asRes = await fetchJsonWithTimeout(
        `https://arctic-shift.photon-reddit.com/api/subreddits/search?subreddit_prefix=${encodeURIComponent(q)}&limit=8`,
        { Accept: 'application/json' },
        6000
      );
      if (!asRes.ok) {
        return res.json({ subreddits: [] });
      }
      const asJson: any = await asRes.json();
      const rows = Array.isArray(asJson?.data) ? asJson.data : [];
      const subreddits = rows
        .filter((r: any) => r?.display_name && !r?.over18)
        .sort((a: any, b: any) => (Number(b.subscribers) || 0) - (Number(a.subscribers) || 0))
        .slice(0, 8)
        .map((r: any) => ({
          name: String(r.display_name),
          title: decodeHtmlEntities(String(r.title || r.display_name)),
          subscribers: Number(r.subscribers || 0),
          description: decodeHtmlEntities(String(r.public_description || '')).slice(0, 140),
        }));

      const payload = { subreddits };
      setCached(cacheKey, payload, 120_000);
      return res.json(payload);
    } catch {
      return res.json({ subreddits: [] });
    }
  });

  // GET /api/reddit/subreddit/:name
  app.get('/api/reddit/subreddit/:name', async (req, res) => {
    const name = sanitizeSubredditName(req.params.name || '');
    if (!name) {
      return res.status(400).json({ error: 'Invalid subreddit name.' });
    }

    const cacheKey = `about:${name.toLowerCase()}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return res.json(cached);

    // 1. Direct Reddit about.json
    try {
      const r = await fetchJsonWithTimeout(
        `https://www.reddit.com/r/${encodeURIComponent(name)}/about.json?raw_json=1`,
        { 'User-Agent': 'web:subfeed-reader:v1.0.0', Accept: 'application/json' },
        3500
      );
      if (r.ok) {
        const json: any = await r.json();
        if (json?.data?.display_name) {
          const info = {
            name: String(json.data.display_name),
            title: decodeHtmlEntities(String(json.data.title || json.data.display_name)),
            subscribers: Number(json.data.subscribers || 0),
            description: decodeHtmlEntities(String(json.data.public_description || '')),
          };
          setCached(cacheKey, info, 300_000);
          return res.json(info);
        }
      }
    } catch {
      // Fallback below
    }

    // 2. Arctic Shift subreddit lookup
    try {
      const asRes = await fetchJsonWithTimeout(
        `https://arctic-shift.photon-reddit.com/api/subreddits/search?subreddit=${encodeURIComponent(name)}&limit=1`,
        { Accept: 'application/json' },
        6000
      );
      if (asRes.ok) {
        const asJson: any = await asRes.json();
        const item = Array.isArray(asJson?.data) ? asJson.data[0] : null;
        if (item?.display_name) {
          const info = {
            name: String(item.display_name),
            title: decodeHtmlEntities(String(item.title || item.display_name)),
            subscribers: Number(item.subscribers || 0),
            description: decodeHtmlEntities(String(item.public_description || '')),
          };
          setCached(cacheKey, info, 300_000);
          return res.json(info);
        }
      }
    } catch {
      // Ignore
    }

    return res.status(404).json({ error: `Subreddit r/${name} not found.` });
  });

  // GET /api/x/feed?handles=vercel,github&sort=best&t=day&refresh=0
  app.get('/api/x/feed', async (req, res) => {
    try {
      const rawHandles = String(req.query.handles || '').trim();
      const sort = String(req.query.sort || 'best').toLowerCase();
      const timeframe = String(req.query.t || 'day').toLowerCase();
      const limit = Math.min(50, Math.max(10, Number(req.query.limit) || 25));
      const forceRefresh = req.query.refresh === '1';

      const handles = rawHandles
        .split(/[+,\s]+/)
        .map(sanitizeXHandle)
        .filter(Boolean);

      if (handles.length === 0) {
        return res.status(400).json({ error: 'At least one X handle is required.' });
      }

      const data = await fetchXFeed({
        handles,
        sort,
        timeframe,
        limit,
        forceRefresh,
      });
      return res.json(data);
    } catch (err) {
      console.error('X feed error:', err);
      return res.status(502).json({ error: 'Unable to load X posts via Nitter right now.' });
    }
  });

  // GET /api/x/tweet?handle=vercel&id=12345
  app.get('/api/x/tweet', async (req, res) => {
    try {
      const handle = sanitizeXHandle(String(req.query.handle || ''));
      const tweetId = String(req.query.id || '').trim();
      const forceRefresh = req.query.refresh === '1';

      if (!handle || !tweetId) {
        return res.status(400).json({ error: 'Missing handle or tweet id.' });
      }

      const data = await fetchXTweetDetails({ handle, tweetId, forceRefresh });
      return res.json(data);
    } catch (err) {
      console.error('X tweet error:', err);
      return res.status(502).json({ error: 'Failed to load X post details.' });
    }
  });

  // GET /api/x/profile/:handle
  app.get('/api/x/profile/:handle', async (req, res) => {
    const handle = sanitizeXHandle(req.params.handle || '');
    if (!handle) {
      return res.status(400).json({ error: 'Invalid X handle.' });
    }
    const profile = await fetchXProfile(handle);
    if (!profile) {
      return res.status(404).json({ error: `Account @${handle} not found.` });
    }
    return res.json(profile);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Subfeed running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
