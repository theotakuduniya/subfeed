import type {
  FeedResponse,
  NitterInstancesResponse,
  RedditComment,
  RedditPost,
  SortOption,
  TimeframeOption,
  XProfilePreview,
} from '../types/reddit';
import { cacheClearAll, cacheDelete, cacheGet, cacheSet } from './cache';

const X_FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const X_TWEET_CACHE_TTL_MS = 5 * 60 * 1000;
const X_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const NITTER_INSTANCE_STORAGE_KEY = 'subfeed:nitterInstance';

export class XFeedError extends Error {
  isNitterError: boolean;
  failedInstance: string | null;

  constructor(message: string, failedInstance: string | null = null) {
    super(message);
    this.name = 'XFeedError';
    this.isNitterError = true;
    this.failedInstance = failedInstance;
  }
}

export function getPreferredNitterInstance(): string | null {
  try {
    const val = localStorage.getItem(NITTER_INSTANCE_STORAGE_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function setPreferredNitterInstance(instanceUrl: string | null): void {
  try {
    if (instanceUrl && instanceUrl.trim()) {
      localStorage.setItem(NITTER_INSTANCE_STORAGE_KEY, instanceUrl.trim());
    } else {
      localStorage.removeItem(NITTER_INSTANCE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function fetchNitterInstances(
  forceRefresh = false,
  signal?: AbortSignal
): Promise<NitterInstancesResponse> {
  const qs = forceRefresh ? '?refresh=1' : '';
  const res = await fetchWithTimeout(`/api/x/instances${qs}`, 12_000, signal);
  if (!res.ok) {
    throw new Error('Unable to check Nitter instance health.');
  }
  return (await res.json()) as NitterInstancesResponse;
}

export async function switchNitterInstance(
  targetInstance?: string | null
): Promise<NitterInstancesResponse> {
  const res = await fetch('/api/x/instances/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(targetInstance ? { instance: targetInstance } : {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Unable to switch Nitter instance.');
  }
  const data = body as NitterInstancesResponse;
  // Persist explicit manual selection; clear pin when auto-switching so server health routing stays fresh
  setPreferredNitterInstance(targetInstance ? data.activeInstance : null);
  cacheClearAll();
  return data;
}

export const DEFAULT_X_ACCOUNTS = ['vercel', 'github'];
export const DEFAULT_X_TOPICS = ['AI', 'webdev'];

export const POPULAR_X_TOPICS = [
  'AI',
  'webdev',
  'TypeScript',
  'Design',
  'Startups',
  'OpenSource',
  'Rust',
  'React',
  'IndieHackers',
  'Cybersecurity',
];

export function sanitizeXHandle(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 20);
}

export function sanitizeXTopic(input: string): string {
  return input
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}\s_\-+.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

export function buildXFeedCacheKey(
  handles: string[],
  topics: string[],
  sort: SortOption,
  timeframe: TimeframeOption
): string {
  const normHandles = Array.from(
    new Set(handles.map((h) => sanitizeXHandle(h).toLowerCase()).filter(Boolean))
  ).sort();
  const normTopics = Array.from(
    new Set(topics.map((t) => sanitizeXTopic(t).toLowerCase()).filter(Boolean))
  ).sort();
  const tfPart = sort === 'top' || sort === 'controversial' ? timeframe : 'none';
  return `xfeed:${normHandles.join(',')}|t:${normTopics.join(',')}:${sort}:${tfPart}`;
}

export function getCachedXFeed(
  handles: string[],
  topics: string[],
  sort: SortOption,
  timeframe: TimeframeOption
): FeedResponse | null {
  if (handles.length === 0 && topics.length === 0) return null;
  return cacheGet<FeedResponse>(buildXFeedCacheKey(handles, topics, sort, timeframe));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 12_000,
  signal?: AbortSignal
): Promise<Response> {
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

export async function fetchXFeed(params: {
  handles?: string[];
  topics?: string[];
  sort: SortOption;
  timeframe: TimeframeOption;
  limit?: number;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<FeedResponse> {
  const {
    handles = [],
    topics = [],
    sort,
    timeframe,
    limit = 25,
    forceRefresh = false,
    signal,
  } = params;
  const cleanHandles = handles.map(sanitizeXHandle).filter(Boolean);
  const cleanTopics = topics.map(sanitizeXTopic).filter(Boolean);
  if (cleanHandles.length === 0 && cleanTopics.length === 0) {
    return { posts: [], after: null };
  }

  const cacheKey = buildXFeedCacheKey(cleanHandles, cleanTopics, sort, timeframe);
  if (forceRefresh) {
    cacheDelete(cacheKey);
  } else {
    const cached = cacheGet<FeedResponse>(cacheKey);
    if (cached) return cached;
  }

  const qs = new URLSearchParams({
    sort,
    t: timeframe,
    limit: String(limit),
  });
  if (cleanHandles.length > 0) qs.set('handles', cleanHandles.join(','));
  if (cleanTopics.length > 0) qs.set('topics', cleanTopics.join(','));
  if (forceRefresh) qs.set('refresh', '1');
  const preferredInstance = getPreferredNitterInstance();
  if (preferredInstance) qs.set('instance', preferredInstance);

  let res: Response;
  try {
    res = await fetchWithTimeout(`/api/x/feed?${qs.toString()}`, 16_000, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new XFeedError(
      'Request to Nitter timed out or failed. Try switching to another instance.',
      preferredInstance
    );
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new XFeedError(
      errBody.error || `Unable to load X posts via Nitter (HTTP ${res.status}).`,
      errBody.failedInstance ?? preferredInstance
    );
  }

  const data = (await res.json()) as FeedResponse;
  const result: FeedResponse = {
    posts: Array.isArray(data.posts) ? data.posts : [],
    after: null,
    source: data.source || 'nitter',
    instance: data.instance ?? null,
  };
  if (result.posts.length > 0) {
    cacheSet(cacheKey, result, X_FEED_CACHE_TTL_MS);
  }
  return result;
}

export async function fetchXTweet(params: {
  handle: string;
  postId: string;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<{ comments: RedditComment[]; post?: RedditPost }> {
  const { handle, postId, forceRefresh = false, signal } = params;
  const cleanId = postId.replace(/^x_/, '');
  const cacheKey = `xtweet:${cleanId}`;

  if (forceRefresh) {
    cacheDelete(cacheKey);
  } else {
    const cached = cacheGet<{ comments: RedditComment[]; post?: RedditPost }>(cacheKey);
    if (cached) return cached;
  }

  const qs = new URLSearchParams({
    handle: sanitizeXHandle(handle),
    id: cleanId,
  });
  if (forceRefresh) qs.set('refresh', '1');
  const preferredInstance = getPreferredNitterInstance();
  if (preferredInstance) qs.set('instance', preferredInstance);

  const res = await fetchWithTimeout(`/api/x/tweet?${qs.toString()}`, 12_000, signal);
  if (!res.ok) {
    throw new XFeedError('Could not load replies for this X post via Nitter.', preferredInstance);
  }

  const data = (await res.json()) as { comments: RedditComment[]; post?: RedditPost };
  cacheSet(cacheKey, data, X_TWEET_CACHE_TTL_MS);
  return data;
}

export async function lookupXProfile(
  rawHandle: string,
  signal?: AbortSignal
): Promise<XProfilePreview | null> {
  const clean = sanitizeXHandle(rawHandle);
  if (clean.length < 2) return null;

  const cacheKey = `xprofile:${clean.toLowerCase()}`;
  const cached = cacheGet<XProfilePreview>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(
      `/api/x/profile/${encodeURIComponent(clean)}`,
      5000,
      signal
    );
    if (!res.ok) return null;
    const data = (await res.json()) as XProfilePreview;
    if (data?.handle) {
      cacheSet(cacheKey, data, X_PROFILE_CACHE_TTL_MS);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function mergeAndRankFeeds(
  redditPosts: RedditPost[],
  xPosts: RedditPost[],
  sort: SortOption
): RedditPost[] {
  const combined = [...redditPosts, ...xPosts];
  const nowSec = Math.floor(Date.now() / 1000);

  if (sort === 'new') {
    return combined.sort((a, b) => b.createdUtc - a.createdUtc);
  }
  if (sort === 'top') {
    return combined.sort((a, b) => b.score - a.score || b.createdUtc - a.createdUtc);
  }
  if (sort === 'rising') {
    return combined.sort((a, b) => {
      const ageA = Math.max(0.25, (nowSec - a.createdUtc) / 3600);
      const ageB = Math.max(0.25, (nowSec - b.createdUtc) / 3600);
      const velA = (a.score + (a.reposts ?? 0) * 2 + a.numComments * 2) / Math.pow(ageA + 0.5, 1.3);
      const velB = (b.score + (b.reposts ?? 0) * 2 + b.numComments * 2) / Math.pow(ageB + 0.5, 1.3);
      return velB - velA;
    });
  }
  if (sort === 'controversial') {
    return combined.sort((a, b) => {
      const ratioA = (a.numComments * 4) / Math.max(1, Math.abs(a.score) + 2);
      const ratioB = (b.numComments * 4) / Math.max(1, Math.abs(b.score) + 2);
      return ratioB - ratioA || b.numComments - a.numComments;
    });
  }
  // best / hot: recency-weighted score blend across both platforms
  return combined.sort((a, b) => {
    const ageA = Math.max(0.5, (nowSec - a.createdUtc) / 3600);
    const ageB = Math.max(0.5, (nowSec - b.createdUtc) / 3600);
    const sA = (a.score + (a.reposts ?? 0) * 2 + a.numComments * 1.5 + 15) / Math.pow(ageA + 2, 1.15);
    const sB = (b.score + (b.reposts ?? 0) * 2 + b.numComments * 1.5 + 15) / Math.pow(ageB + 2, 1.15);
    return sB - sA;
  });
}
