import type {
  FeedResponse,
  RedditComment,
  RedditPost,
  SortOption,
  TimeframeOption,
  YoutubeChannelPreview,
} from '../types/reddit';
import { cacheDelete, cacheGet, cacheSet } from './cache';

const YT_FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const YT_VIDEO_CACHE_TTL_MS = 5 * 60 * 1000;
const YT_CHANNEL_CACHE_TTL_MS = 15 * 60 * 1000;

export const DEFAULT_YOUTUBE_CHANNELS = ['Fireship', 'veritasium'];
export const DEFAULT_YOUTUBE_TOPICS = ['AI', 'Web Dev'];

export const POPULAR_YOUTUBE_TOPICS = [
  'AI',
  'Web Dev',
  'System Design',
  'Tech News',
  'Design',
  'Science',
  'Startups',
  'Linux',
  'Gaming',
  'Hardware',
];

export function sanitizeYoutubeHandle(input: string): string {
  return input
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
}

export function sanitizeYoutubeTopic(input: string): string {
  return input
    .trim()
    .replace(/^yt#/i, '')
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}\s_\-+.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export function sanitizeYoutubeVideoId(input: string | null | undefined): string {
  if (!input) return '';
  const cleaned = input.trim().replace(/^yt_/, '');
  return /^[a-zA-Z0-9_-]{11}$/.test(cleaned) ? cleaned : '';
}

export function formatVideoDuration(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function buildYoutubeFeedCacheKey(
  channels: string[],
  topics: string[],
  sort: SortOption,
  timeframe: TimeframeOption,
  hideShorts: boolean
): string {
  const normChannels = Array.from(
    new Set(channels.map((c) => sanitizeYoutubeHandle(c).toLowerCase()).filter(Boolean))
  ).sort();
  const normTopics = Array.from(
    new Set(topics.map((t) => sanitizeYoutubeTopic(t).toLowerCase()).filter(Boolean))
  ).sort();
  const tfPart = sort === 'top' || sort === 'controversial' ? timeframe : 'none';
  return `ytfeed:${normChannels.join(',')}|t:${normTopics.join(',')}:${sort}:${tfPart}:${
    hideShorts ? 'ns' : 'all'
  }`;
}

export function getCachedYoutubeFeed(
  channels: string[],
  topics: string[],
  sort: SortOption,
  timeframe: TimeframeOption,
  hideShorts: boolean
): FeedResponse | null {
  if (channels.length === 0 && topics.length === 0) return null;
  return cacheGet<FeedResponse>(
    buildYoutubeFeedCacheKey(channels, topics, sort, timeframe, hideShorts)
  );
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 14_000,
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

export async function fetchYoutubeFeed(params: {
  channels?: string[];
  topics?: string[];
  sort: SortOption;
  timeframe: TimeframeOption;
  hideShorts?: boolean;
  limit?: number;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<FeedResponse> {
  const {
    channels = [],
    topics = [],
    sort,
    timeframe,
    hideShorts = false,
    limit = 25,
    forceRefresh = false,
    signal,
  } = params;

  const cleanChannels = channels.map(sanitizeYoutubeHandle).filter(Boolean);
  const cleanTopics = topics.map(sanitizeYoutubeTopic).filter(Boolean);
  if (cleanChannels.length === 0 && cleanTopics.length === 0) {
    return { posts: [], after: null };
  }

  const cacheKey = buildYoutubeFeedCacheKey(
    cleanChannels,
    cleanTopics,
    sort,
    timeframe,
    hideShorts
  );

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
  if (cleanChannels.length > 0) qs.set('channels', cleanChannels.join(','));
  if (cleanTopics.length > 0) qs.set('topics', cleanTopics.join(','));
  if (hideShorts) qs.set('hideShorts', '1');
  if (forceRefresh) qs.set('refresh', '1');

  const res = await fetchWithTimeout(`/api/youtube/feed?${qs.toString()}`, 16_000, signal);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      errBody.error || `Unable to load YouTube videos (HTTP ${res.status}).`
    );
  }

  const data = (await res.json()) as FeedResponse;
  const result: FeedResponse = {
    posts: Array.isArray(data.posts) ? data.posts : [],
    after: null,
    source: data.source || 'youtube',
  };

  if (result.posts.length > 0) {
    cacheSet(cacheKey, result, YT_FEED_CACHE_TTL_MS);
  }
  return result;
}

export async function fetchYoutubeVideo(params: {
  videoId: string;
  sort?: string;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<{
  comments: RedditComment[];
  post?: RedditPost;
  commentsDisabled?: boolean;
  apiKeyConfigured?: boolean;
}> {
  const cleanId = sanitizeYoutubeVideoId(params.videoId);
  if (!cleanId) return { comments: [] };

  const sort = params.sort || 'best';
  const cacheKey = `ytvideo:${cleanId}:${sort}`;

  if (params.forceRefresh) {
    cacheDelete(cacheKey);
  } else {
    const cached = cacheGet<{
      comments: RedditComment[];
      post?: RedditPost;
      commentsDisabled?: boolean;
      apiKeyConfigured?: boolean;
    }>(cacheKey);
    if (cached) return cached;
  }

  const qs = new URLSearchParams({ sort });
  if (params.forceRefresh) qs.set('refresh', '1');

  const res = await fetchWithTimeout(
    `/api/youtube/video/${encodeURIComponent(cleanId)}?${qs.toString()}`,
    12_000,
    params.signal
  );
  if (!res.ok) {
    throw new Error('Could not load YouTube comments right now.');
  }

  const data = (await res.json()) as {
    comments: RedditComment[];
    post?: RedditPost;
    commentsDisabled?: boolean;
    apiKeyConfigured?: boolean;
  };
  cacheSet(cacheKey, data, YT_VIDEO_CACHE_TTL_MS);
  return data;
}

export async function lookupYoutubeChannel(
  rawHandle: string,
  signal?: AbortSignal
): Promise<YoutubeChannelPreview | null> {
  const clean = sanitizeYoutubeHandle(rawHandle);
  if (clean.length < 2) return null;

  const cacheKey = `ytchannel:${clean.toLowerCase()}`;
  const cached = cacheGet<YoutubeChannelPreview>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(
      `/api/youtube/channel/${encodeURIComponent(clean)}`,
      6500,
      signal
    );
    if (!res.ok) return null;
    const data = (await res.json()) as YoutubeChannelPreview;
    if (data?.channelId) {
      cacheSet(cacheKey, data, YT_CHANNEL_CACHE_TTL_MS);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
