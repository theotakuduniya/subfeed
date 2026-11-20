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

export type NitterInstanceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface NitterInstanceHealth {
  url: string;
  host: string;
  status: NitterInstanceStatus;
  latencyMs: number | null;
  rssOk: boolean;
  searchOk: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  isActive: boolean;
}

export class NitterConnectionError extends Error {
  code = 'NITTER_UNAVAILABLE' as const;
  failedInstance: string | null;

  constructor(message: string, failedInstance: string | null = null) {
    super(message);
    this.name = 'NitterConnectionError';
    this.failedInstance = failedInstance;
  }
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

export function clearXFeedCache(): void {
  for (const key of Array.from(xCache.keys())) {
    if (key.startsWith('x:feed:') || key.startsWith('x:topic:') || key.startsWith('x:handle:') || key.startsWith('x:tweet:')) {
      xCache.delete(key);
    }
  }
}

const DEFAULT_NITTER_HOSTS = [
  'https://nitter.kareem.one',
  'https://nitter.mizuki.st',
  'https://nitter.netbub.com',
  'https://nitter.mie.foundation',
];

// Hosts verified at runtime to support advanced search operators (min_faves, e-replies)
const verifiedSearchHosts = new Set<string>(['https://nitter.kareem.one']);
const failedAdvancedSearchHosts = new Map<string, number>();

// Live health registry for every known Nitter instance
const instanceHealthMap = new Map<string, NitterInstanceHealth>();
let activePreferredHost: string = DEFAULT_NITTER_HOSTS[0];
let lastMonitorSweepAt: number | null = null;
let monitorIntervalHandle: ReturnType<typeof setInterval> | null = null;
let activeHealthSweepPromise: Promise<NitterInstanceHealth[]> | null = null;

function normalizeHostUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function hostLabelFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }
}

function ensureInstanceRecord(rawUrl: string): NitterInstanceHealth {
  const url = normalizeHostUrl(rawUrl);
  const existing = instanceHealthMap.get(url);
  if (existing) return existing;

  const record: NitterInstanceHealth = {
    url,
    host: hostLabelFromUrl(url),
    status: 'unknown',
    latencyMs: null,
    rssOk: false,
    searchOk: verifiedSearchHosts.has(url),
    lastCheckedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
    isActive: url === activePreferredHost,
  };
  instanceHealthMap.set(url, record);
  return record;
}

for (const host of DEFAULT_NITTER_HOSTS) {
  ensureInstanceRecord(host);
}

function recordInstanceOutcome(
  hostUrl: string,
  outcome: {
    ok: boolean;
    latencyMs: number;
    error?: string | null;
    isSearch?: boolean;
    searchSupported?: boolean;
  }
): void {
  const rec = ensureInstanceRecord(hostUrl);
  rec.lastCheckedAt = Date.now();
  rec.latencyMs = Math.round(outcome.latencyMs);

  if (outcome.ok) {
    rec.successCount += 1;
    rec.consecutiveFailures = 0;
    rec.rssOk = true;
    rec.lastError = null;
    if (outcome.isSearch || outcome.searchSupported) {
      rec.searchOk = true;
    }
    rec.status = outcome.latencyMs > 3800 ? 'degraded' : 'healthy';
  } else {
    rec.failureCount += 1;
    rec.consecutiveFailures += 1;
    rec.lastError = outcome.error || 'Request failed';
    if (outcome.isSearch && outcome.searchSupported === false) {
      rec.searchOk = false;
      // Search operator unsupported doesn't necessarily mean timeline RSS is down
      rec.status = rec.rssOk ? 'degraded' : 'down';
    } else if (rec.consecutiveFailures >= 2 || !rec.rssOk) {
      rec.rssOk = false;
      rec.status = 'down';
    } else {
      rec.status = 'degraded';
    }
  }
}

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

export function sanitizeXTopic(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}\s_\-+.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
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
  for (const host of merged) {
    ensureInstanceRecord(host);
  }
  cacheSet('nitter:hosts', merged, 15 * 60 * 1000);
  return merged;
}

async function probeNitterInstance(hostUrl: string): Promise<NitterInstanceHealth> {
  const url = normalizeHostUrl(hostUrl);
  const rec = ensureInstanceRecord(url);
  const startedAt = Date.now();

  try {
    // 1. Probe search RSS with operator support first (highest-value capability)
    const searchUrl = `${url}/search/rss?f=tweets&q=${encodeURIComponent('tech min_faves:20')}&e-replies=on&e-nativeretweets=on`;
    const searchRes = await fetchWithTimeout(
      searchUrl,
      {
        'User-Agent': 'Mozilla/5.0 (compatible; minisocial/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      4200
    );
    const searchLatency = Date.now() - startedAt;

    if (searchRes.ok) {
      const xml = await searchRes.text();
      if ((xml.includes('<rss') || xml.includes('<item>')) && !xml.includes("You're not authorized to use RSS")) {
        verifiedSearchHosts.add(url);
        failedAdvancedSearchHosts.delete(url);
        recordInstanceOutcome(url, {
          ok: true,
          latencyMs: searchLatency,
          isSearch: true,
          searchSupported: true,
        });
        return { ...rec, isActive: url === activePreferredHost };
      }
    }

    // 2. Fall back to probing standard profile RSS to differentiate degraded (no search) vs down
    const rssStart = Date.now();
    const rssRes = await fetchWithTimeout(
      `${url}/github/rss`,
      {
        'User-Agent': 'Mozilla/5.0 (compatible; minisocial/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      4000
    );
    const rssLatency = Date.now() - rssStart;

    if (rssRes.ok) {
      const xml = await rssRes.text();
      if ((xml.includes('<rss') || xml.includes('<item>')) && !xml.includes("You're not authorized to use RSS")) {
        rec.rssOk = true;
        rec.searchOk = false;
        rec.latencyMs = Math.round(rssLatency);
        rec.lastCheckedAt = Date.now();
        rec.consecutiveFailures = 0;
        rec.successCount += 1;
        rec.lastError = searchRes.ok ? 'Search RSS empty' : `Search HTTP ${searchRes.status}`;
        rec.status = 'degraded';
        return { ...rec, isActive: url === activePreferredHost };
      }
    }

    recordInstanceOutcome(url, {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: `HTTP ${rssRes.status || searchRes.status}`,
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Timed out'
        : err instanceof Error
          ? err.message
          : 'Unreachable';
    recordInstanceOutcome(url, {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: msg,
    });
  }

  return { ...rec, isActive: url === activePreferredHost };
}

function sortInstancesByHealth(list: NitterInstanceHealth[]): NitterInstanceHealth[] {
  const rankStatus = (s: NitterInstanceStatus) => {
    switch (s) {
      case 'healthy':
        return 0;
      case 'degraded':
        return 1;
      case 'unknown':
        return 2;
      case 'down':
      default:
        return 3;
    }
  };

  return [...list].sort((a, b) => {
    const statusDiff = rankStatus(a.status) - rankStatus(b.status);
    if (statusDiff !== 0) return statusDiff;
    if (a.searchOk !== b.searchOk) return a.searchOk ? -1 : 1;
    const latA = a.latencyMs ?? 99999;
    const latB = b.latencyMs ?? 99999;
    return latA - latB;
  });
}

export async function runNitterHealthChecks(force = false): Promise<NitterInstanceHealth[]> {
  if (activeHealthSweepPromise) {
    return activeHealthSweepPromise;
  }

  const staleMs = 2 * 60 * 1000;
  if (!force && lastMonitorSweepAt && Date.now() - lastMonitorSweepAt < staleMs) {
    return getNitterInstancesSnapshot().instances;
  }

  activeHealthSweepPromise = (async () => {
    try {
      const hosts = await getHealthyNitterHosts();
      await Promise.allSettled(hosts.map((h) => probeNitterInstance(h)));
      lastMonitorSweepAt = Date.now();

      // If active instance is down and a healthy alternative exists, promote it automatically
      const current = instanceHealthMap.get(activePreferredHost);
      if (current && current.status === 'down') {
        const sorted = sortInstancesByHealth(Array.from(instanceHealthMap.values()));
        const healthyAlt = sorted.find((i) => i.status === 'healthy' || i.status === 'degraded');
        if (healthyAlt) {
          activePreferredHost = healthyAlt.url;
        }
      }

      return getNitterInstancesSnapshot().instances;
    } finally {
      activeHealthSweepPromise = null;
    }
  })();

  return activeHealthSweepPromise;
}

export function startNitterHealthMonitor(): void {
  if (monitorIntervalHandle) return;

  // Initial non-blocking probe shortly after server boot
  const bootTimer = setTimeout(() => {
    void runNitterHealthChecks(true).catch(() => {});
  }, 1500);
  bootTimer.unref?.();

  // Periodic health sweep every 5 minutes
  monitorIntervalHandle = setInterval(() => {
    void runNitterHealthChecks(true).catch(() => {});
  }, 5 * 60 * 1000);
  monitorIntervalHandle.unref?.();
}

export function getNitterInstancesSnapshot(): {
  activeInstance: string;
  instances: NitterInstanceHealth[];
  lastCheckedAt: number | null;
} {
  const raw = Array.from(instanceHealthMap.values()).map((item) => ({
    ...item,
    isActive: item.url === activePreferredHost,
  }));
  const sorted = sortInstancesByHealth(raw);
  return {
    activeInstance: activePreferredHost,
    instances: sorted,
    lastCheckedAt: lastMonitorSweepAt,
  };
}

export function resolveAllowedNitterInstance(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const normalized = normalizeHostUrl(rawUrl);
  if (instanceHealthMap.has(normalized)) {
    return normalized;
  }
  // Allow matching by hostname alone (e.g. "nitter.kareem.one") against allowlist
  const cleanHost = hostLabelFromUrl(normalized).toLowerCase();
  for (const key of instanceHealthMap.keys()) {
    if (hostLabelFromUrl(key).toLowerCase() === cleanHost) {
      return key;
    }
  }
  return null;
}

export async function switchNitterInstance(targetUrl?: string | null): Promise<{
  activeInstance: string;
  previousInstance: string;
  instances: NitterInstanceHealth[];
  lastCheckedAt: number | null;
}> {
  // Ensure candidate hosts are loaded before validating or rotating
  await getHealthyNitterHosts();
  const previousInstance = activePreferredHost;

  if (targetUrl) {
    const allowed = resolveAllowedNitterInstance(targetUrl);
    if (!allowed) {
      throw new Error('Selected Nitter instance is not in the verified instance pool.');
    }
    activePreferredHost = allowed;
    clearXFeedCache();
    // Run a quick probe on the newly chosen instance if never checked
    const rec = instanceHealthMap.get(allowed);
    if (!rec?.lastCheckedAt || Date.now() - rec.lastCheckedAt > 60_000) {
      await probeNitterInstance(allowed);
    }
    const snap = getNitterInstancesSnapshot();
    return {
      ...snap,
      previousInstance,
    };
  }

  // Automatic recovery switch: refresh health if stale, then pick the healthiest instance != previous
  await runNitterHealthChecks(
    !lastMonitorSweepAt || Date.now() - lastMonitorSweepAt > 45_000
  );
  const sorted = getNitterInstancesSnapshot().instances;
  const nextBest =
    sorted.find((i) => i.url !== previousInstance && i.status === 'healthy') ||
    sorted.find((i) => i.url !== previousInstance && i.status === 'degraded') ||
    sorted.find((i) => i.url !== previousInstance && i.status === 'unknown') ||
    sorted.find((i) => i.url !== previousInstance) ||
    sorted[0];

  if (nextBest) {
    activePreferredHost = nextBest.url;
  }
  clearXFeedCache();

  const snap = getNitterInstancesSnapshot();
  return {
    ...snap,
    previousInstance,
  };
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

function parseNitterRss(
  xml: string,
  requestedHandle: string,
  options: { excludeReplies?: boolean; excludeRetweets?: boolean } = {}
): NormalizedXPost[] {
  if (!xml.includes('<rss') && !xml.includes('<item>')) return [];
  if (xml.includes("You're not authorized to use RSS")) return [];

  const channelTitleRaw = decodeEntities(extractTag(xml.split('<item>')[0] || '', 'title'));
  const channelDisplayName = channelTitleRaw.includes(' / @')
    ? channelTitleRaw.split(' / @')[0].trim()
    : requestedHandle;

  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const posts: NormalizedXPost[] = [];
  const fallbackReplyPosts: NormalizedXPost[] = [];

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

    // Detect retweet / reply prefix in title ("RT by @handle: ..." / "R to @handle: ...")
    let isRetweet = false;
    let isReply = false;
    let retweetedBy: string | null = null;
    let cleanedTitle = rawTitle;
    const rtMatch = rawTitle.match(/^RT by @([a-zA-Z0-9_]+):\s*/i);
    if (rtMatch) {
      isRetweet = true;
      retweetedBy = rtMatch[1];
      cleanedTitle = rawTitle.slice(rtMatch[0].length).trim();
    } else if (/^R to @/i.test(rawTitle)) {
      isReply = true;
      cleanedTitle = rawTitle.replace(/^R to @[a-zA-Z0-9_]+:\s*/i, '').trim();
    }

    if (options.excludeRetweets && isRetweet) {
      continue;
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

    const postObj: NormalizedXPost = {
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
    };

    if (options.excludeReplies && isReply) {
      fallbackReplyPosts.push(postObj);
    } else {
      posts.push(postObj);
    }
  }

  return posts.length > 0 ? posts : fallbackReplyPosts;
}

interface NitterFetchOutcome {
  posts: NormalizedXPost[];
  hadValidResponse: boolean;
  usedHost: string | null;
  lastError: string | null;
  failedHost: string | null;
}

function buildOrderedHostPool(allHosts: string[], pinnedHost?: string | null): string[] {
  if (pinnedHost) {
    return [pinnedHost];
  }
  const active = activePreferredHost;
  const sortedHealth = sortInstancesByHealth(
    allHosts.map((h) => ensureInstanceRecord(h))
  ).map((r) => r.url);

  if (active && sortedHealth.includes(active)) {
    const activeRec = instanceHealthMap.get(active);
    if (!activeRec || activeRec.status !== 'down') {
      return [active, ...sortedHealth.filter((h) => h !== active)];
    }
  }
  return sortedHealth;
}

async function fetchHandleFromNitter(
  handle: string,
  forceRefresh = false,
  pinnedHost?: string | null
): Promise<NitterFetchOutcome> {
  const hostTag = pinnedHost ? hostLabelFromUrl(pinnedHost) : 'auto';
  const key = `x:handle:${hostTag}:${handle.toLowerCase()}`;
  if (!forceRefresh) {
    const cached = cacheGet<NitterFetchOutcome>(key);
    if (cached) return cached;
  }

  const allHosts = await getHealthyNitterHosts();
  const hosts = buildOrderedHostPool(allHosts, pinnedHost);
  let lastError: string | null = null;
  let failedHost: string | null = null;
  let hadValidResponse = false;

  for (const host of hosts) {
    const startedAt = Date.now();
    try {
      const url = `${host}/${encodeURIComponent(handle)}/rss`;
      const res = await fetchWithTimeout(
        url,
        {
          'User-Agent': 'Mozilla/5.0 (compatible; minisocial/1.0)',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
        4500
      );
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
        continue;
      }
      const xml = await res.text();
      if (!xml.includes('<rss') && !xml.includes('<item>')) {
        lastError = 'Invalid RSS response';
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
        continue;
      }
      if (xml.includes("You're not authorized to use RSS")) {
        lastError = 'RSS blocked by instance';
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
        continue;
      }

      hadValidResponse = true;
      recordInstanceOutcome(host, { ok: true, latencyMs });
      const parsed = parseNitterRss(xml, handle);
      if (parsed.length > 0) {
        const out: NitterFetchOutcome = {
          posts: parsed,
          hadValidResponse: true,
          usedHost: host,
          lastError: null,
          failedHost: null,
        };
        cacheSet(key, out, 3 * 60 * 1000);
        return out;
      }
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      lastError =
        err instanceof Error && err.name === 'AbortError'
          ? 'Connection timed out'
          : err instanceof Error
            ? err.message
            : 'Unreachable';
      failedHost = host;
      recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
    }
  }

  return { posts: [], hadValidResponse, usedHost: null, lastError, failedHost };
}

function parseNitterHtmlSearch(html: string, topic: string): NormalizedXPost[] {
  if (html.includes('anubis_challenge') || html.includes('Just a moment')) return [];
  const blocks = html.split(/<div class="timeline-item/i).slice(1, 30);
  const posts: NormalizedXPost[] = [];

  for (const block of blocks) {
    const linkMatch = block.match(/href="\/([a-zA-Z0-9_]+)\/status\/(\d{10,22})/i);
    const bodyMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!linkMatch || !bodyMatch) continue;

    const author = linkMatch[1];
    const tweetId = linkMatch[2];
    const fullBody = htmlToCleanText(bodyMatch[1]);
    if (!fullBody) continue;

    const nameMatch = block.match(/class="fullname"[^>]*title="([^"]+)"/i);
    const dateMatch = block.match(/class="tweet-date"[^>]*><a[^>]*title="([^"]+)"/i);
    const heartMatch = block.match(/icon-heart[^>]*><\/span>\s*([0-9,]+)/i);
    const rtMatch = block.match(/icon-retweet[^>]*><\/span>\s*([0-9,]+)/i);
    const commentMatch = block.match(/icon-comment[^>]*><\/span>\s*([0-9,]+)/i);

    const parsedDate = dateMatch ? Date.parse(dateMatch[1].replace(' · ', ' ')) : NaN;
    const createdUtc = Number.isFinite(parsedDate)
      ? Math.floor(parsedDate / 1000)
      : Math.floor(Date.now() / 1000);

    const imgMatches = Array.from(block.matchAll(/<img[^>]+src="([^"]+)"/gi));
    const images: string[] = [];
    for (const m of imgMatches) {
      const rewritten = rewriteNitterImageUrl(m[1]);
      if (
        rewritten &&
        !rewritten.includes('profile_images') &&
        !rewritten.includes('emoji') &&
        !images.includes(rewritten)
      ) {
        images.push(rewritten);
      }
    }

    const firstLine = fullBody.split('\n')[0].trim();
    const headline =
      firstLine.length > 180
        ? `${firstLine.slice(0, 177).trimEnd()}...`
        : firstLine || `Post by @${author}`;

    posts.push({
      id: `x_${tweetId}`,
      fullname: `x_${tweetId}`,
      source: 'x',
      title: headline,
      subreddit: author,
      author,
      authorName: nameMatch ? decodeEntities(nameMatch[1]) : author,
      score: heartMatch ? Number(heartMatch[1].replace(/,/g, '')) || 0 : 0,
      upvoteRatio: null,
      numComments: commentMatch ? Number(commentMatch[1].replace(/,/g, '')) || 0 : 0,
      reposts: rtMatch ? Number(rtMatch[1].replace(/,/g, '')) || 0 : 0,
      views: 0,
      createdUtc,
      permalink: `/${author}/status/${tweetId}`,
      url: `https://x.com/${author}/status/${tweetId}`,
      domain: 'x.com',
      isSelf: true,
      selftext: fullBody !== headline ? fullBody : '',
      flair: `#${topic}`,
      thumbnail: images[0] || null,
      previewImage: images[0] || null,
      galleryImages: images,
      isVideo: block.includes('video-container') || block.includes('video_thumb'),
      videoUrl: null,
      over18: false,
      spoiler: false,
      stickied: false,
      isRetweet: false,
      retweetedBy: null,
      quotedPost: null,
    });
  }

  return posts;
}

function buildTopicQueryExpr(cleanTopic: string): string {
  if (cleanTopic.includes(' ')) {
    return `"${cleanTopic}"`;
  }
  // Smart expansion for alphanumeric topics like "gta6" -> (gta6 OR "gta 6"), "gpt5" -> (gpt5 OR "gpt 5")
  const alphaNumMatch = cleanTopic.match(/^([a-zA-Z]{2,})(\d{1,2})$/);
  if (alphaNumMatch) {
    const spaced = `${alphaNumMatch[1]} ${alphaNumMatch[2]}`;
    return `(${cleanTopic} OR "${spaced}")`;
  }
  return cleanTopic;
}

function getSinceDateParam(timeframe: string): string | null {
  const now = Date.now();
  let daysBack: number | null = null;
  switch (timeframe) {
    case 'hour':
    case 'day':
      daysBack = 1;
      break;
    case 'week':
      daysBack = 7;
      break;
    case 'month':
      daysBack = 30;
      break;
    case 'year':
      daysBack = 365;
      break;
    default:
      daysBack = null;
  }
  if (!daysBack) return null;
  const d = new Date(now - daysBack * 86_400 * 1000);
  return d.toISOString().slice(0, 10);
}

function getOrderedSearchHosts(allHosts: string[], pinnedHost?: string | null): string[] {
  if (pinnedHost) {
    return [pinnedHost];
  }
  const now = Date.now();
  const activeFirst: string[] = [];
  const preferred: string[] = [];
  const untried: string[] = [];
  const cooledDown: string[] = [];

  for (const host of allHosts) {
    const rec = instanceHealthMap.get(host);
    if (host === activePreferredHost && rec?.status !== 'down') {
      activeFirst.push(host);
    } else if (verifiedSearchHosts.has(host) && rec?.status !== 'down') {
      preferred.push(host);
    } else {
      const failedUntil = failedAdvancedSearchHosts.get(host) ?? 0;
      if (now < failedUntil || rec?.status === 'down') {
        cooledDown.push(host);
      } else {
        untried.push(host);
      }
    }
  }

  return [...activeFirst, ...preferred, ...untried, ...cooledDown];
}

async function queryNitterTopicRss(
  hosts: string[],
  cleanTopic: string,
  query: string,
  extraParams: string,
  timeoutMs: number,
  isAdvancedQuery: boolean,
  ignoreCooldown = false
): Promise<NitterFetchOutcome> {
  const now = Date.now();
  let hadValidResponse = false;
  let lastError: string | null = null;
  let failedHost: string | null = null;

  for (const host of hosts) {
    if (!ignoreCooldown && isAdvancedQuery && (failedAdvancedSearchHosts.get(host) ?? 0) > now) {
      continue;
    }
    const startedAt = Date.now();
    try {
      const url = `${host}/search/rss?f=tweets&q=${encodeURIComponent(query)}${extraParams}`;
      const res = await fetchWithTimeout(
        url,
        {
          'User-Agent': 'Mozilla/5.0 (compatible; minisocial/1.0)',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
        timeoutMs
      );
      const latencyMs = Date.now() - startedAt;

      if (res.status === 404 || res.status === 403 || res.status === 410) {
        lastError = `HTTP ${res.status}`;
        failedHost = host;
        if (isAdvancedQuery) {
          failedAdvancedSearchHosts.set(host, now + 10 * 60 * 1000);
          recordInstanceOutcome(host, {
            ok: false,
            latencyMs,
            error: `Search ${lastError}`,
            isSearch: true,
            searchSupported: false,
          });
        } else {
          recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
        }
        continue;
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError, isSearch: true });
        continue;
      }

      const xml = await res.text();
      if (!xml.includes('<rss') && !xml.includes('<item>')) {
        lastError = 'Invalid RSS response';
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError, isSearch: true });
        continue;
      }
      if (xml.includes("You're not authorized to use RSS")) {
        lastError = 'RSS blocked by instance';
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError, isSearch: true });
        continue;
      }

      hadValidResponse = true;
      const parsed = parseNitterRss(xml, cleanTopic, {
        excludeReplies: true,
        excludeRetweets: true,
      }).map((post) => ({
        ...post,
        subreddit: post.author,
        flair: post.flair || `#${cleanTopic}`,
      }));

      if (parsed.length > 0) {
        if (isAdvancedQuery) {
          verifiedSearchHosts.add(host);
          failedAdvancedSearchHosts.delete(host);
        }
        recordInstanceOutcome(host, {
          ok: true,
          latencyMs,
          isSearch: true,
          searchSupported: isAdvancedQuery,
        });
        return {
          posts: parsed,
          hadValidResponse: true,
          usedHost: host,
          lastError: null,
          failedHost: null,
        };
      }
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      lastError =
        err instanceof Error && err.name === 'AbortError'
          ? 'Connection timed out'
          : err instanceof Error
            ? err.message
            : 'Unreachable';
      failedHost = host;
      recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError, isSearch: true });
    }
  }
  return { posts: [], hadValidResponse, usedHost: null, lastError, failedHost };
}

async function fetchTopicFromNitter(
  topic: string,
  sort = 'hot',
  timeframe = 'day',
  forceRefresh = false,
  pinnedHost?: string | null
): Promise<NitterFetchOutcome> {
  const cleanTopic = sanitizeXTopic(topic);
  if (!cleanTopic) {
    return { posts: [], hadValidResponse: true, usedHost: null, lastError: null, failedHost: null };
  }

  const bucket =
    sort === 'new'
      ? 'new'
      : sort === 'top' || sort === 'controversial'
        ? `top:${timeframe}`
        : 'hot';
  const hostTag = pinnedHost ? hostLabelFromUrl(pinnedHost) : 'auto';
  const key = `x:topic:${hostTag}:${cleanTopic.toLowerCase()}:${bucket}`;
  if (!forceRefresh) {
    const cached = cacheGet<NitterFetchOutcome>(key);
    if (cached && cached.posts.length > 0) return cached;
  }

  const baseExpr = buildTopicQueryExpr(cleanTopic);
  const allHosts = await getHealthyNitterHosts();
  const orderedHosts = getOrderedSearchHosts(allHosts, pinnedHost);
  const cleanParams = '&e-replies=on&e-nativeretweets=on';
  const sinceDate =
    sort === 'top' || sort === 'controversial' ? getSinceDateParam(timeframe) : null;
  const sinceClause = sinceDate ? ` since:${sinceDate}` : '';

  const dedup = new Map<string, NormalizedXPost>();
  let hadValidResponse = false;
  let usedHost: string | null = null;
  let lastError: string | null = null;
  let failedHost: string | null = null;

  const absorb = (outcome: NitterFetchOutcome) => {
    if (outcome.hadValidResponse) hadValidResponse = true;
    if (outcome.usedHost && !usedHost) usedHost = outcome.usedHost;
    if (outcome.lastError) lastError = outcome.lastError;
    if (outcome.failedHost) failedHost = outcome.failedHost;
    for (const item of outcome.posts) {
      if (!dedup.has(item.id)) {
        dedup.set(item.id, item);
      }
    }
  };

  if (sort === 'new') {
    const [engagedRecent, freshOriginal] = await Promise.all([
      queryNitterTopicRss(
        orderedHosts,
        cleanTopic,
        `${baseExpr} min_faves:20`,
        cleanParams,
        4200,
        true,
        Boolean(pinnedHost)
      ),
      queryNitterTopicRss(
        orderedHosts,
        cleanTopic,
        baseExpr,
        cleanParams,
        4200,
        true,
        Boolean(pinnedHost)
      ),
    ]);
    absorb(engagedRecent);
    absorb(freshOriginal);
  } else {
    const tiers =
      sort === 'top'
        ? [
            `${baseExpr} min_faves:500${sinceClause}`,
            `${baseExpr} min_faves:100${sinceClause}`,
            `${baseExpr} min_faves:20`,
          ]
        : [
            `${baseExpr} min_faves:150`,
            `${baseExpr} min_faves:25`,
          ];

    for (const q of tiers) {
      const batch = await queryNitterTopicRss(
        orderedHosts,
        cleanTopic,
        q,
        cleanParams,
        4500,
        true,
        Boolean(pinnedHost)
      );
      absorb(batch);
      if (dedup.size >= 10) break;
      // If pinned host explicitly errored with 403/404/410 on advanced search, don't waste retries on more tiers
      if (pinnedHost && !batch.hadValidResponse && batch.lastError) break;
    }

    if (dedup.size < 6 && (!pinnedHost || hadValidResponse)) {
      const fallbackClean = await queryNitterTopicRss(
        orderedHosts,
        cleanTopic,
        baseExpr,
        cleanParams,
        4200,
        true,
        Boolean(pinnedHost)
      );
      absorb(fallbackClean);
    }
  }

  // Last-resort RSS fallback (plain query on candidate hosts if advanced search failed)
  if (dedup.size === 0) {
    const simpleQuery = cleanTopic.includes(' ') ? `"${cleanTopic}"` : cleanTopic;
    const plain = await queryNitterTopicRss(
      pinnedHost ? [pinnedHost] : allHosts,
      cleanTopic,
      simpleQuery,
      '',
      4500,
      false,
      Boolean(pinnedHost)
    );
    absorb(plain);
  }

  // HTML search fallback if all RSS endpoints failed
  if (dedup.size === 0) {
    const simpleQuery = cleanTopic.includes(' ') ? `"${cleanTopic}"` : cleanTopic;
    for (const host of orderedHosts.slice(0, pinnedHost ? 1 : 3)) {
      const startedAt = Date.now();
      try {
        const url = `${host}/search?f=tweets&q=${encodeURIComponent(simpleQuery)}${cleanParams}`;
        const res = await fetchWithTimeout(
          url,
          {
            'User-Agent': 'Mozilla/5.0 (compatible; minisocial/1.0)',
            Accept: 'text/html',
          },
          4500
        );
        const latencyMs = Date.now() - startedAt;
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          failedHost = host;
          recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
          continue;
        }
        const html = await res.text();
        if (html.includes('anubis_challenge') || html.includes('Just a moment')) {
          lastError = 'Bot challenge blocked request';
          failedHost = host;
          recordInstanceOutcome(host, { ok: false, latencyMs, error: lastError });
          continue;
        }
        const parsed = parseNitterHtmlSearch(html, cleanTopic);
        if (parsed.length > 0) {
          hadValidResponse = true;
          usedHost = host;
          recordInstanceOutcome(host, { ok: true, latencyMs, isSearch: true });
          for (const item of parsed) {
            if (!dedup.has(item.id)) dedup.set(item.id, item);
          }
          break;
        }
      } catch (err) {
        lastError =
          err instanceof Error && err.name === 'AbortError'
            ? 'Connection timed out'
            : err instanceof Error
              ? err.message
              : 'Unreachable';
        failedHost = host;
        recordInstanceOutcome(host, { ok: false, latencyMs: Date.now() - startedAt, error: lastError });
      }
    }
  }

  const results = Array.from(dedup.values());
  const out: NitterFetchOutcome = {
    posts: results,
    hadValidResponse,
    usedHost,
    lastError,
    failedHost,
  };
  if (results.length > 0) {
    cacheSet(key, out, 2 * 60 * 1000);
  }
  return out;
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
  handles?: string[];
  topics?: string[];
  sort: string;
  timeframe: string;
  limit?: number;
  forceRefresh?: boolean;
  preferredInstance?: string | null;
}): Promise<{ posts: NormalizedXPost[]; after: string | null; source: string; instance: string | null }> {
  const {
    handles = [],
    topics = [],
    sort,
    timeframe,
    limit = 25,
    forceRefresh = false,
    preferredInstance = null,
  } = params;
  const cleanHandles = Array.from(
    new Set(handles.map((h) => sanitizeXHandle(h).toLowerCase()).filter(Boolean))
  ).slice(0, 12);
  const cleanTopics = Array.from(
    new Set(topics.map((t) => sanitizeXTopic(t)).filter(Boolean))
  ).slice(0, 12);

  if (cleanHandles.length === 0 && cleanTopics.length === 0) {
    return { posts: [], after: null, source: 'nitter', instance: activePreferredHost };
  }

  // Ensure allowlist is populated before validating any user-provided instance
  await getHealthyNitterHosts();
  const pinnedHost = preferredInstance ? resolveAllowedNitterInstance(preferredInstance) : null;
  const instanceKey = pinnedHost ? hostLabelFromUrl(pinnedHost) : hostLabelFromUrl(activePreferredHost);

  const feedKey = `x:feed:${instanceKey}:${cleanHandles.sort().join(',')}|t:${cleanTopics
    .map((t) => t.toLowerCase())
    .sort()
    .join(',')}:${sort}:${timeframe}:${limit}`;
  if (!forceRefresh) {
    const cached = cacheGet<{
      posts: NormalizedXPost[];
      after: string | null;
      source: string;
      instance: string | null;
    }>(feedKey);
    if (cached) return cached;
  }

  const [perHandleOutcomes, perTopicOutcomes] = await Promise.all([
    Promise.all(cleanHandles.map((h) => fetchHandleFromNitter(h, forceRefresh, pinnedHost))),
    Promise.all(
      cleanTopics.map((t) => fetchTopicFromNitter(t, sort, timeframe, forceRefresh, pinnedHost))
    ),
  ]);

  const allOutcomes = [...perHandleOutcomes, ...perTopicOutcomes];
  const anyValidResponse = allOutcomes.some((o) => o.hadValidResponse);
  const usedHost = allOutcomes.find((o) => o.usedHost)?.usedHost ?? pinnedHost ?? activePreferredHost;
  const firstError = allOutcomes.find((o) => o.lastError)?.lastError ?? null;
  const firstFailedHost = allOutcomes.find((o) => o.failedHost)?.failedHost ?? pinnedHost ?? activePreferredHost;

  const dedup = new Map<string, NormalizedXPost>();
  for (const outcome of allOutcomes) {
    for (const post of outcome.posts) {
      if (!dedup.has(post.id)) {
        dedup.set(post.id, post);
      }
    }
  }

  if (dedup.size === 0 && !anyValidResponse) {
    const hostName = firstFailedHost ? hostLabelFromUrl(firstFailedHost) : 'Nitter';
    const detail = firstError ? ` (${firstError})` : '';
    throw new NitterConnectionError(
      `Connection to ${hostName} failed${detail}. Try switching to another Nitter instance.`,
      firstFailedHost
    );
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
  const toEnrich = combined.slice(0, Math.min(24, limit));
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
    instance: usedHost,
  };
  if (ranked.length > 0) {
    cacheSet(feedKey, result, 2 * 60 * 1000);
  }
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
  preferredInstance?: string | null;
}): Promise<{ post?: NormalizedXPost; comments: NormalizedXComment[]; instance?: string | null }> {
  const handle = sanitizeXHandle(params.handle);
  const rawId = params.tweetId.replace(/^x_/, '').replace(/[^0-9]/g, '');
  if (!handle || !rawId) return { comments: [] };

  await getHealthyNitterHosts();
  const pinnedHost = params.preferredInstance
    ? resolveAllowedNitterInstance(params.preferredInstance)
    : null;
  const hostTag = pinnedHost ? hostLabelFromUrl(pinnedHost) : hostLabelFromUrl(activePreferredHost);

  const cacheKey = `x:tweet:${hostTag}:${rawId}`;
  if (!params.forceRefresh) {
    const cached = cacheGet<{
      post?: NormalizedXPost;
      comments: NormalizedXComment[];
      instance?: string | null;
    }>(cacheKey);
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

  let usedHost: string | null = null;
  const [enriched, replies] = await Promise.all([
    enrichTweetWithFxTwitter(basePost, params.forceRefresh),
    (async () => {
      const allHosts = await getHealthyNitterHosts();
      const hosts = buildOrderedHostPool(allHosts, pinnedHost);
      for (const host of hosts.slice(0, pinnedHost ? 1 : 3)) {
        const startedAt = Date.now();
        try {
          const res = await fetchWithTimeout(
            `${host}/${encodeURIComponent(handle)}/status/${encodeURIComponent(rawId)}`,
            {
              'User-Agent': 'Mozilla/5.0 (compatible; minisocial/1.0)',
              Accept: 'text/html',
            },
            4500
          );
          const latencyMs = Date.now() - startedAt;
          if (!res.ok) {
            recordInstanceOutcome(host, { ok: false, latencyMs, error: `HTTP ${res.status}` });
            continue;
          }
          const html = await res.text();
          if (html.includes('anubis_challenge') || html.includes('Just a moment')) {
            recordInstanceOutcome(host, { ok: false, latencyMs, error: 'Bot challenge' });
            continue;
          }
          recordInstanceOutcome(host, { ok: true, latencyMs });
          usedHost = host;
          const parsed = parseNitterHtmlReplies(html, handle);
          if (parsed.length > 0) return parsed;
        } catch (err) {
          recordInstanceOutcome(host, {
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : 'Unreachable',
          });
        }
      }
      return [] as NormalizedXComment[];
    })(),
  ]);

  const result = {
    post: enriched.title ? enriched : undefined,
    comments: replies,
    instance: usedHost,
  };
  cacheSet(cacheKey, result, 3 * 60 * 1000);
  return result;
}
