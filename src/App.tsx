import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, PanelLeft, RefreshCw, Search, Server, User as UserIcon, X } from 'lucide-react';
import type {
  ActiveView,
  FeedDensity,
  FontOption,
  NitterInstanceHealth,
  RedditPost,
  SortOption,
  SourceFilter,
  ThemeOption,
  TimeframeOption,
} from './types/reddit';
import {
  DEFAULT_SUBREDDITS,
  STARTER_PACKS,
  fetchFeed,
  getCachedFeed,
  sanitizeSubredditName,
  updateCachedFeed,
} from './lib/reddit';
import {
  DEFAULT_X_ACCOUNTS,
  DEFAULT_X_TOPICS,
  XFeedError,
  fetchNitterInstances,
  fetchXFeed,
  getCachedXFeed,
  mergeAndRankFeeds,
  sanitizeXHandle,
  sanitizeXTopic,
  switchNitterInstance,
} from './lib/x';
import {
  DEFAULT_YOUTUBE_CHANNELS,
  DEFAULT_YOUTUBE_TOPICS,
  fetchYoutubeFeed,
  getCachedYoutubeFeed,
  sanitizeYoutubeHandle,
  sanitizeYoutubeTopic,
} from './lib/youtube';
import { cacheClearAll } from './lib/cache';
import {
  bootstrapUserState,
  clearAllSavedPostsFromServer,
  clearReadHistoryOnServer,
  deleteSavedPostFromServer,
  fetchAuthStatus,
  logoutAccount,
  markPostReadOnServer,
  savePostToServer,
  startGoogleSignInPopup,
  syncUserFeedsToServer,
  syncUserPreferencesToServer,
  type AuthUser,
} from './lib/account';
import { Sidebar } from './components/Sidebar';
import { PostRow } from './components/PostRow';
import { PostCard } from './components/PostCard';
import { ThreadDrawer } from './components/ThreadDrawer';
import { SettingsModal } from './components/SettingsModal';
import { ProfileModal } from './components/ProfileModal';
import { SubfeedIcon } from './components/SubfeedIcon';
import { PullToRefreshIndicator } from './components/PullToRefreshIndicator';
import { usePullToRefresh } from './hooks/usePullToRefresh';

const STORAGE_KEYS = {
  subreddits: 'subfeed:subreddits',
  xAccounts: 'subfeed:xAccounts',
  xTopics: 'subfeed:xTopics',
  youtubeChannels: 'subfeed:youtubeChannels',
  youtubeTopics: 'subfeed:youtubeTopics',
  hideYoutubeShorts: 'subfeed:hideYoutubeShorts',
  saved: 'subfeed:saved',
  read: 'subfeed:read',
  theme: 'subfeed:theme',
  font: 'subfeed:font',
  density: 'subfeed:density',
  sidebar: 'subfeed:sidebar',
  sort: 'subfeed:sort',
  timeframe: 'subfeed:timeframe',
  source: 'subfeed:source',
};

const VALID_SORTS: SortOption[] = ['best', 'hot', 'new', 'top', 'rising', 'controversial'];
const VALID_TIMEFRAMES: TimeframeOption[] = ['hour', 'day', 'week', 'month', 'year', 'all'];
const VALID_SOURCES: SourceFilter[] = ['all', 'reddit', 'x', 'youtube'];
const VALID_THEMES: ThemeOption[] = ['dark', 'light', 'mocha', 'glass'];
const VALID_FONTS: FontOption[] = [
  'geist-mono',
  'geist',
  'inter',
  'jakarta',
  'space-grotesk',
  'jetbrains-mono',
];

function readStoredSubreddits(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.subreddits);
    if (!raw) return DEFAULT_SUBREDDITS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeSubredditName(String(item))).filter(Boolean);
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_SUBREDDITS;
}

function readStoredXAccounts(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.xAccounts);
    if (!raw) return DEFAULT_X_ACCOUNTS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeXHandle(String(item))).filter(Boolean);
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_X_ACCOUNTS;
}

function readStoredXTopics(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.xTopics);
    if (!raw) return DEFAULT_X_TOPICS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeXTopic(String(item))).filter(Boolean);
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_X_TOPICS;
}

function readStoredYoutubeChannels(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.youtubeChannels);
    if (!raw) return DEFAULT_YOUTUBE_CHANNELS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeYoutubeHandle(String(item))).filter(Boolean);
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_YOUTUBE_CHANNELS;
}

function readStoredYoutubeTopics(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.youtubeTopics);
    if (!raw) return DEFAULT_YOUTUBE_TOPICS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeYoutubeTopic(String(item))).filter(Boolean);
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_YOUTUBE_TOPICS;
}

function readStoredHideYoutubeShorts(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.hideYoutubeShorts) === '1';
  } catch {
    return false;
  }
}

function readStoredSavedPosts(): RedditPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.saved);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredReadPostIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.read);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string').slice(0, 250);
    }
  } catch {
    // Ignore storage errors
  }
  return [];
}

function readStoredTheme(): ThemeOption {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme) as ThemeOption | null;
    if (stored && VALID_THEMES.includes(stored)) return stored;
  } catch {
    // Ignore
  }
  return 'dark';
}

function readStoredFont(): FontOption {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.font) as FontOption | null;
    if (stored && VALID_FONTS.includes(stored)) return stored;
  } catch {
    // Ignore
  }
  return 'geist-mono';
}

function readStoredDensity(): FeedDensity {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.density);
    if (stored === 'compact' || stored === 'card' || stored === 'comfortable') {
      return stored;
    }
    return 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function readStoredSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.sidebar);
    return stored === 'closed' ? false : true;
  } catch {
    return true;
  }
}

function readStoredSort(): SortOption {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.sort) as SortOption | null;
    if (stored && VALID_SORTS.includes(stored)) return stored;
  } catch {
    // Ignore
  }
  return 'best';
}

function readStoredTimeframe(): TimeframeOption {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.timeframe) as TimeframeOption | null;
    if (stored && VALID_TIMEFRAMES.includes(stored)) return stored;
  } catch {
    // Ignore
  }
  return 'day';
}

function readStoredSourceFilter(): SourceFilter {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.source) as SourceFilter | null;
    if (stored && VALID_SOURCES.includes(stored)) return stored;
  } catch {
    // Ignore
  }
  return 'all';
}

export default function App() {
  const [subreddits, setSubreddits] = useState<string[]>(readStoredSubreddits);
  const [xAccounts, setXAccounts] = useState<string[]>(readStoredXAccounts);
  const [xTopics, setXTopics] = useState<string[]>(readStoredXTopics);
  const [youtubeChannels, setYoutubeChannels] = useState<string[]>(
    readStoredYoutubeChannels
  );
  const [youtubeTopics, setYoutubeTopics] = useState<string[]>(readStoredYoutubeTopics);
  const [hideYoutubeShorts, setHideYoutubeShorts] = useState<boolean>(
    readStoredHideYoutubeShorts
  );
  const [savedPosts, setSavedPosts] = useState<RedditPost[]>(readStoredSavedPosts);
  const [readPostIds, setReadPostIds] = useState<string[]>(readStoredReadPostIds);
  const [theme, setTheme] = useState<ThemeOption>(readStoredTheme);
  const [font, setFont] = useState<FontOption>(readStoredFont);
  const [density, setDensity] = useState<FeedDensity>(readStoredDensity);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [headerAvatarFailed, setHeaderAvatarFailed] = useState(false);

  const [activeView, setActiveView] = useState<ActiveView>({ type: 'all' });
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(readStoredSourceFilter);
  const [sort, setSort] = useState<SortOption>(readStoredSort);
  const [timeframe, setTimeframe] = useState<TimeframeOption>(readStoredTimeframe);
  const [filterQuery, setFilterQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [afterCursor, setAfterCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorIsNitter, setErrorIsNitter] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [activeNitterInstance, setActiveNitterInstance] = useState<string | null>(null);
  const [nitterInstances, setNitterInstances] = useState<NitterInstanceHealth[]>([]);
  const [checkingNitterHealth, setCheckingNitterHealth] = useState(false);
  const [switchingNitterInstance, setSwitchingNitterInstance] = useState(false);
  const [showErrorInstances, setShowErrorInstances] = useState(false);

  const [selectedPost, setSelectedPost] = useState<RedditPost | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(readStoredSidebarOpen);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const addInputRef = useRef<HTMLInputElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const feedScrollRef = useRef<HTMLElement | null>(null);
  const lastRefreshNonceRef = useRef<number>(0);
  const pendingPullRefreshRef = useRef<boolean>(false);
  const hydratingCloudRef = useRef<boolean>(false);
  const latestLocalRef = useRef({
    subreddits,
    xAccounts,
    xTopics,
    youtubeChannels,
    youtubeTopics,
    readPostIds,
    savedPosts,
    theme,
    font,
    density,
    sort,
    timeframe,
    sourceFilter,
  });

  latestLocalRef.current = {
    subreddits,
    xAccounts,
    xTopics,
    youtubeChannels,
    youtubeTopics,
    readPostIds,
    savedPosts,
    theme,
    font,
    density,
    sort,
    timeframe,
    sourceFilter,
  };

  // Check existing Google OAuth session cookie on load
  useEffect(() => {
    let active = true;
    fetchAuthStatus()
      .then((status) => {
        if (!active) return;
        setUser(status.user);
        setHeaderAvatarFailed(false);
        setAuthReady(true);
      })
      .catch(() => {
        if (!active) return;
        setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Hydrate & merge user data with PostgreSQL via Prisma when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setCloudReady(false);
      setCloudSyncing(false);
      return;
    }

    let active = true;
    setCloudReady(false);
    setCloudSyncing(true);

    const snapshot = latestLocalRef.current;

    bootstrapUserState({
      subreddits: snapshot.subreddits,
      xAccounts: snapshot.xAccounts,
      xTopics: snapshot.xTopics,
      youtubeChannels: snapshot.youtubeChannels,
      youtubeTopics: snapshot.youtubeTopics,
      savedPosts: snapshot.savedPosts,
      readPostIds: snapshot.readPostIds,
      preferences: {
        theme: snapshot.theme,
        font: snapshot.font,
        density: snapshot.density,
        sort: snapshot.sort,
        timeframe: snapshot.timeframe,
        sourceFilter: snapshot.sourceFilter,
      },
    })
      .then((cloudState) => {
        if (!active) return;
        hydratingCloudRef.current = true;
        setSubreddits(cloudState.subreddits);
        setXAccounts(cloudState.xAccounts);
        setXTopics(Array.isArray(cloudState.xTopics) ? cloudState.xTopics : []);
        setYoutubeChannels(
          Array.isArray(cloudState.youtubeChannels) ? cloudState.youtubeChannels : []
        );
        setYoutubeTopics(
          Array.isArray(cloudState.youtubeTopics) ? cloudState.youtubeTopics : []
        );
        setSavedPosts(cloudState.savedPosts);
        setReadPostIds(cloudState.readPostIds);
        setTheme(cloudState.preferences.theme);
        setFont(cloudState.preferences.font);
        setDensity(cloudState.preferences.density);
        setSort(cloudState.preferences.sort);
        setTimeframe(cloudState.preferences.timeframe);
        setSourceFilter(cloudState.preferences.sourceFilter);
        setTimeout(() => {
          hydratingCloudRef.current = false;
        }, 150);
        setCloudReady(true);
      })
      .catch((err) => {
        console.error('Failed to sync account state with PostgreSQL:', err);
      })
      .finally(() => {
        if (active) setCloudSyncing(false);
      });

    return () => {
      active = false;
    };
  }, [authReady, user?.id]);

  // Sync preferences to document root & localStorage
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-font', font);
    try {
      localStorage.setItem(STORAGE_KEYS.font, font);
    } catch {
      // Ignore
    }
  }, [font]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.subreddits, JSON.stringify(subreddits));
    } catch {
      // Ignore
    }
  }, [subreddits]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.xAccounts, JSON.stringify(xAccounts));
    } catch {
      // Ignore
    }
  }, [xAccounts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.xTopics, JSON.stringify(xTopics));
    } catch {
      // Ignore
    }
  }, [xTopics]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.youtubeChannels,
        JSON.stringify(youtubeChannels)
      );
    } catch {
      // Ignore
    }
  }, [youtubeChannels]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.youtubeTopics, JSON.stringify(youtubeTopics));
    } catch {
      // Ignore
    }
  }, [youtubeTopics]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.hideYoutubeShorts,
        hideYoutubeShorts ? '1' : '0'
      );
    } catch {
      // Ignore
    }
  }, [hideYoutubeShorts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(savedPosts));
    } catch {
      // Ignore
    }
  }, [savedPosts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.read, JSON.stringify(readPostIds));
    } catch {
      // Ignore
    }
  }, [readPostIds]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.density, density);
    } catch {
      // Ignore
    }
  }, [density]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.sidebar, desktopSidebarOpen ? 'open' : 'closed');
    } catch {
      // Ignore
    }
  }, [desktopSidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.sort, sort);
    } catch {
      // Ignore
    }
  }, [sort]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.timeframe, timeframe);
    } catch {
      // Ignore
    }
  }, [timeframe]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.source, sourceFilter);
    } catch {
      // Ignore
    }
  }, [sourceFilter]);

  // Sync followed feeds to PostgreSQL when signed in
  useEffect(() => {
    if (!user || !cloudReady || hydratingCloudRef.current) return;
    const timer = setTimeout(() => {
      if (hydratingCloudRef.current) return;
      void syncUserFeedsToServer({
        subreddits,
        xAccounts,
        xTopics,
        youtubeChannels,
        youtubeTopics,
      }).catch((err) => console.error('Failed to sync feeds:', err));
    }, 350);
    return () => clearTimeout(timer);
  }, [user, cloudReady, subreddits, xAccounts, xTopics, youtubeChannels, youtubeTopics]);

  // Sync display & feed preferences to PostgreSQL when signed in
  useEffect(() => {
    if (!user || !cloudReady || hydratingCloudRef.current) return;
    const timer = setTimeout(() => {
      if (hydratingCloudRef.current) return;
      void syncUserPreferencesToServer({
        theme,
        font,
        density,
        sort,
        timeframe,
        sourceFilter,
      }).catch((err) => console.error('Failed to sync preferences:', err));
    }, 350);
    return () => clearTimeout(timer);
  }, [user, cloudReady, theme, font, density, sort, timeframe, sourceFilter]);

  const savedIdSet = useMemo(() => new Set(savedPosts.map((p) => p.id)), [savedPosts]);
  const readIdSet = useMemo(() => new Set(readPostIds), [readPostIds]);

  const activeSubreddits = useMemo(() => {
    if (activeView.type === 'subreddit') return [activeView.name];
    if (
      activeView.type === 'all' &&
      (sourceFilter === 'all' || sourceFilter === 'reddit')
    ) {
      return subreddits;
    }
    return [];
  }, [activeView, sourceFilter, subreddits]);

  const activeXHandles = useMemo(() => {
    if (activeView.type === 'x') return [activeView.handle];
    if (activeView.type === 'all' && (sourceFilter === 'all' || sourceFilter === 'x')) {
      return xAccounts;
    }
    return [];
  }, [activeView, sourceFilter, xAccounts]);

  const activeXTopics = useMemo(() => {
    if (activeView.type === 'topic') return [activeView.topic];
    if (activeView.type === 'all' && (sourceFilter === 'all' || sourceFilter === 'x')) {
      return xTopics;
    }
    return [];
  }, [activeView, sourceFilter, xTopics]);

  const activeYoutubeChannels = useMemo(() => {
    if (activeView.type === 'youtube') return [activeView.handle];
    if (
      activeView.type === 'all' &&
      (sourceFilter === 'all' || sourceFilter === 'youtube')
    ) {
      return youtubeChannels;
    }
    return [];
  }, [activeView, sourceFilter, youtubeChannels]);

  const activeYoutubeTopics = useMemo(() => {
    if (activeView.type === 'yt-topic') return [activeView.topic];
    if (
      activeView.type === 'all' &&
      (sourceFilter === 'all' || sourceFilter === 'youtube')
    ) {
      return youtubeTopics;
    }
    return [];
  }, [activeView, sourceFilter, youtubeTopics]);

  // Fetch unified or single-source feed with instant client caching & forceRefresh support
  useEffect(() => {
    const isManualRefresh = refreshNonce !== lastRefreshNonceRef.current;
    lastRefreshNonceRef.current = refreshNonce;
    const isPullRefresh = isManualRefresh && pendingPullRefreshRef.current;
    pendingPullRefreshRef.current = false;

    if (!isPullRefresh) {
      setPullRefreshing(false);
    }

    if (activeView.type === 'saved') {
      setLoading(false);
      setPullRefreshing(false);
      setError(null);
      return;
    }

    const hasXSources = activeXHandles.length > 0 || activeXTopics.length > 0;
    const hasYtSources =
      activeYoutubeChannels.length > 0 || activeYoutubeTopics.length > 0;

    if (activeSubreddits.length === 0 && !hasXSources && !hasYtSources) {
      setPosts([]);
      setAfterCursor(null);
      setLoading(false);
      setPullRefreshing(false);
      setError(null);
      return;
    }

    if (!isManualRefresh) {
      const needReddit = activeSubreddits.length > 0;
      const needX = hasXSources;
      const needYt = hasYtSources;
      const cachedReddit = needReddit
        ? getCachedFeed(activeSubreddits, sort, timeframe)
        : null;
      const cachedX = needX
        ? getCachedXFeed(activeXHandles, activeXTopics, sort, timeframe)
        : null;
      const cachedYt = needYt
        ? getCachedYoutubeFeed(
            activeYoutubeChannels,
            activeYoutubeTopics,
            sort,
            timeframe,
            hideYoutubeShorts
          )
        : null;

      if ((!needReddit || cachedReddit) && (!needX || cachedX) && (!needYt || cachedYt)) {
        const merged = mergeAndRankFeeds(
          cachedReddit?.posts ?? [],
          cachedX?.posts ?? [],
          sort,
          cachedYt?.posts ?? []
        );
        setPosts(merged);
        setAfterCursor(cachedReddit?.after ?? null);
        setLoading(false);
        setError(null);
        setFocusedIndex(-1);
        feedScrollRef.current?.scrollTo({ top: 0 });
        return;
      }
    }

    const controller = new AbortController();
    if (!isPullRefresh) {
      setLoading(true);
      setError(null);
    }
    setFocusedIndex(-1);

    const redditPromise =
      activeSubreddits.length > 0
        ? fetchFeed({
            subreddits: activeSubreddits,
            sort,
            timeframe,
            limit: 25,
            forceRefresh: isManualRefresh,
            signal: controller.signal,
          })
        : Promise.resolve({ posts: [] as RedditPost[], after: null as string | null });

    const xPromise = hasXSources
      ? fetchXFeed({
          handles: activeXHandles,
          topics: activeXTopics,
          sort,
          timeframe,
          limit: 25,
          forceRefresh: isManualRefresh,
          signal: controller.signal,
        })
      : Promise.resolve({
          posts: [] as RedditPost[],
          after: null as string | null,
          instance: null as string | null,
        });

    const youtubePromise = hasYtSources
      ? fetchYoutubeFeed({
          channels: activeYoutubeChannels,
          topics: activeYoutubeTopics,
          sort,
          timeframe,
          hideShorts: hideYoutubeShorts,
          limit: 25,
          forceRefresh: isManualRefresh,
          signal: controller.signal,
        })
      : Promise.resolve({ posts: [] as RedditPost[], after: null as string | null });

    Promise.allSettled([redditPromise, xPromise, youtubePromise])
      .then(([redditRes, xRes, ytRes]) => {
        if (controller.signal.aborted) return;

        const redditOk = redditRes.status === 'fulfilled';
        const xOk = xRes.status === 'fulfilled';
        const ytOk = ytRes.status === 'fulfilled';
        const xFailedReason = xRes.status === 'rejected' ? xRes.reason : null;
        const ytFailedReason = ytRes.status === 'rejected' ? ytRes.reason : null;
        const isXError =
          xFailedReason instanceof XFeedError ||
          activeView.type === 'x' ||
          activeView.type === 'topic' ||
          (activeView.type === 'all' && sourceFilter === 'x');

        if (!redditOk && !xOk && !ytOk) {
          const msg =
            (xFailedReason instanceof Error && xFailedReason.message) ||
            (ytFailedReason instanceof Error && ytFailedReason.message) ||
            (redditRes.reason instanceof Error && redditRes.reason.message) ||
            'Unable to load posts.';
          setError(msg);
          setErrorIsNitter(isXError);
          setPosts([]);
          setAfterCursor(null);
          return;
        }

        if (activeView.type === 'subreddit' && !redditOk) {
          setError(
            redditRes.reason instanceof Error
              ? redditRes.reason.message
              : 'Unable to load subreddit.'
          );
          setErrorIsNitter(false);
          setPosts([]);
          setAfterCursor(null);
          return;
        }
        if ((activeView.type === 'x' || activeView.type === 'topic') && !xOk) {
          setError(
            xFailedReason instanceof Error
              ? xFailedReason.message
              : activeView.type === 'topic'
                ? 'Unable to load X topic via Nitter.'
                : 'Unable to load X account via Nitter.'
          );
          setErrorIsNitter(true);
          setPosts([]);
          setAfterCursor(null);
          return;
        }
        if ((activeView.type === 'youtube' || activeView.type === 'yt-topic') && !ytOk) {
          setError(
            ytFailedReason instanceof Error
              ? ytFailedReason.message
              : activeView.type === 'yt-topic'
                ? 'Unable to load YouTube topic right now.'
                : 'Unable to load YouTube channel right now.'
          );
          setErrorIsNitter(false);
          setPosts([]);
          setAfterCursor(null);
          return;
        }

        if (xOk && xRes.value.instance) {
          setActiveNitterInstance(xRes.value.instance);
        }

        const redditPosts = redditOk ? redditRes.value.posts : [];
        const xPosts = xOk ? xRes.value.posts : [];
        const ytPosts = ytOk ? ytRes.value.posts : [];
        const merged = mergeAndRankFeeds(redditPosts, xPosts, sort, ytPosts);

        setError(null);
        setErrorIsNitter(false);
        setShowErrorInstances(false);
        setPosts(merged);
        setAfterCursor(redditOk ? redditRes.value.after : null);
        feedScrollRef.current?.scrollTo({ top: 0 });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setPullRefreshing(false);
        }
      });

    return () => controller.abort();
  }, [
    activeView,
    activeSubreddits,
    activeXHandles,
    activeXTopics,
    activeYoutubeChannels,
    activeYoutubeTopics,
    hideYoutubeShorts,
    sort,
    timeframe,
    refreshNonce,
    sourceFilter,
  ]);

  const loadNitterHealth = useCallback(async (forceRefresh = false) => {
    setCheckingNitterHealth(true);
    try {
      const snap = await fetchNitterInstances(forceRefresh);
      setNitterInstances(snap.instances);
      setActiveNitterInstance(snap.activeInstance);
    } catch {
      // Keep previous list if health endpoint temporarily fails
    } finally {
      setCheckingNitterHealth(false);
    }
  }, []);

  const handleSwitchNitterInstance = useCallback(
    async (targetUrl?: string) => {
      setSwitchingNitterInstance(true);
      try {
        const switched = await switchNitterInstance(targetUrl ?? null);
        setNitterInstances(switched.instances);
        setActiveNitterInstance(switched.activeInstance);
        setError(null);
        setErrorIsNitter(false);
        setShowErrorInstances(false);
        setRefreshNonce((n) => n + 1);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not switch Nitter instance. Please retry.'
        );
        setErrorIsNitter(true);
      } finally {
        setSwitchingNitterInstance(false);
      }
    },
    []
  );

  // Refresh Nitter instance health when opening Settings or entering a Nitter error state
  useEffect(() => {
    if (showSettings && nitterInstances.length === 0 && !checkingNitterHealth) {
      void loadNitterHealth(false);
    }
  }, [showSettings, nitterInstances.length, checkingNitterHealth, loadNitterHealth]);

  useEffect(() => {
    if (error && errorIsNitter) {
      void loadNitterHealth(false);
    }
  }, [error, errorIsNitter, loadNitterHealth]);

  const handlePullRefresh = useCallback(() => {
    pendingPullRefreshRef.current = true;
    setPullRefreshing(true);
    setRefreshNonce((n) => n + 1);
  }, []);

  const pullToRefreshDisabled =
    activeView.type === 'saved' ||
    (activeSubreddits.length === 0 &&
      activeXHandles.length === 0 &&
      activeXTopics.length === 0 &&
      activeYoutubeChannels.length === 0 &&
      activeYoutubeTopics.length === 0) ||
    Boolean(selectedPost) ||
    showSettings ||
    showProfile ||
    showShortcuts ||
    mobileSidebarOpen;

  const PULL_HOLD_HEIGHT = 48;
  const { pullDistance, progress, isPulling, isReady } = usePullToRefresh({
    containerRef: feedScrollRef,
    onRefresh: handlePullRefresh,
    isRefreshing: pullRefreshing || loading,
    disabled: pullToRefreshDisabled,
  });

  const feedTranslateY = pullRefreshing ? PULL_HOLD_HEIGHT : pullDistance;

  const handleLoadMore = useCallback(async () => {
    if (!afterCursor || loadingMore || activeSubreddits.length === 0) return;
    setLoadingMore(true);
    try {
      const res = await fetchFeed({
        subreddits: activeSubreddits,
        sort,
        timeframe,
        after: afterCursor,
        limit: 25,
      });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const next = res.posts.filter((p) => !seen.has(p.id));
        const merged = [...prev, ...next];
        const redditOnly = merged.filter((p) => p.source !== 'x' && p.source !== 'youtube');
        updateCachedFeed(activeSubreddits, sort, timeframe, {
          posts: redditOnly,
          after: res.after,
          source: res.source,
        });
        return merged;
      });
      setAfterCursor(res.after);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more posts.');
    } finally {
      setLoadingMore(false);
    }
  }, [afterCursor, loadingMore, activeSubreddits, sort, timeframe]);

  const visiblePosts = useMemo(() => {
    const base = activeView.type === 'saved' ? savedPosts : posts;
    const q = filterQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.subreddit.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        (p.authorName && p.authorName.toLowerCase().includes(q)) ||
        (p.channelTitle && p.channelTitle.toLowerCase().includes(q)) ||
        p.domain.toLowerCase().includes(q) ||
        (p.flair && p.flair.toLowerCase().includes(q))
    );
  }, [activeView.type, savedPosts, posts, filterQuery]);

  const handleAddSubreddit = useCallback((rawName: string) => {
    const clean = sanitizeSubredditName(rawName);
    if (!clean) return;
    setSubreddits((prev) => {
      if (prev.some((s) => s.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'subreddit', name: clean });
  }, []);

  const handleAddXAccount = useCallback((rawHandle: string) => {
    const clean = sanitizeXHandle(rawHandle);
    if (!clean) return;
    setXAccounts((prev) => {
      if (prev.some((h) => h.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'x', handle: clean });
  }, []);

  const handleAddXTopic = useCallback((rawTopic: string) => {
    const clean = sanitizeXTopic(rawTopic);
    if (!clean) return;
    setXTopics((prev) => {
      if (prev.some((t) => t.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'topic', topic: clean });
  }, []);

  const handleAddYoutubeChannel = useCallback((rawHandle: string) => {
    const clean = sanitizeYoutubeHandle(rawHandle);
    if (!clean) return;
    setYoutubeChannels((prev) => {
      if (prev.some((h) => h.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'youtube', handle: clean });
  }, []);

  const handleAddYoutubeTopic = useCallback((rawTopic: string) => {
    const clean = sanitizeYoutubeTopic(rawTopic);
    if (!clean) return;
    setYoutubeTopics((prev) => {
      if (prev.some((t) => t.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'yt-topic', topic: clean });
  }, []);

  const handleAddPack = useCallback((packSubs: string[]) => {
    setSubreddits((prev) => {
      const existing = new Set(prev.map((s) => s.toLowerCase()));
      const additions = packSubs.filter((s) => !existing.has(s.toLowerCase()));
      return [...prev, ...additions];
    });
    setActiveView({ type: 'all' });
  }, []);

  const handleRemoveSubreddit = useCallback(
    (name: string) => {
      setSubreddits((prev) =>
        prev.filter((s) => s.toLowerCase() !== name.toLowerCase())
      );
      if (
        activeView.type === 'subreddit' &&
        activeView.name.toLowerCase() === name.toLowerCase()
      ) {
        setActiveView({ type: 'all' });
      }
    },
    [activeView]
  );

  const handleRemoveXAccount = useCallback(
    (handle: string) => {
      setXAccounts((prev) =>
        prev.filter((h) => h.toLowerCase() !== handle.toLowerCase())
      );
      if (
        activeView.type === 'x' &&
        activeView.handle.toLowerCase() === handle.toLowerCase()
      ) {
        setActiveView({ type: 'all' });
      }
    },
    [activeView]
  );

  const handleRemoveXTopic = useCallback(
    (topic: string) => {
      setXTopics((prev) =>
        prev.filter((t) => t.toLowerCase() !== topic.toLowerCase())
      );
      if (
        activeView.type === 'topic' &&
        activeView.topic.toLowerCase() === topic.toLowerCase()
      ) {
        setActiveView({ type: 'all' });
      }
    },
    [activeView]
  );

  const handleRemoveYoutubeChannel = useCallback(
    (handle: string) => {
      setYoutubeChannels((prev) =>
        prev.filter((h) => h.toLowerCase() !== handle.toLowerCase())
      );
      if (
        activeView.type === 'youtube' &&
        activeView.handle.toLowerCase() === handle.toLowerCase()
      ) {
        setActiveView({ type: 'all' });
      }
    },
    [activeView]
  );

  const handleRemoveYoutubeTopic = useCallback(
    (topic: string) => {
      setYoutubeTopics((prev) =>
        prev.filter((t) => t.toLowerCase() !== topic.toLowerCase())
      );
      if (
        activeView.type === 'yt-topic' &&
        activeView.topic.toLowerCase() === topic.toLowerCase()
      ) {
        setActiveView({ type: 'all' });
      }
    },
    [activeView]
  );

  const handleMarkPostRead = useCallback(
    (postId: string) => {
      setReadPostIds((prev) => {
        if (prev[0] === postId) return prev;
        const filtered = prev.filter((id) => id !== postId);
        return [postId, ...filtered].slice(0, 250);
      });
      if (user && cloudReady) {
        void markPostReadOnServer(postId).catch((err) =>
          console.error('Failed to persist read post:', err)
        );
      }
    },
    [user, cloudReady]
  );

  const handleOpenPost = useCallback(
    (post: RedditPost, idx?: number) => {
      if (typeof idx === 'number') setFocusedIndex(idx);
      setSelectedPost(post);
      handleMarkPostRead(post.id);
    },
    [handleMarkPostRead]
  );

  const handleToggleSave = useCallback(
    (post: RedditPost) => {
      const exists = savedIdSet.has(post.id);
      setSavedPosts((prev) => {
        if (exists) return prev.filter((p) => p.id !== post.id);
        return [post, ...prev.filter((p) => p.id !== post.id)];
      });

      if (user && cloudReady) {
        if (exists) {
          void deleteSavedPostFromServer(post.id).catch((err) =>
            console.error('Failed to remove saved post:', err)
          );
        } else {
          void savePostToServer(post).catch((err) =>
            console.error('Failed to save post:', err)
          );
        }
      }
    },
    [savedIdSet, user, cloudReady]
  );

  const handleClearSaved = useCallback(() => {
    setSavedPosts([]);
    if (user && cloudReady) {
      void clearAllSavedPostsFromServer().catch((err) =>
        console.error('Failed to clear saved posts:', err)
      );
    }
  }, [user, cloudReady]);

  const handleClearReadHistory = useCallback(() => {
    setReadPostIds([]);
    if (user && cloudReady) {
      void clearReadHistoryOnServer().catch((err) =>
        console.error('Failed to clear read history:', err)
      );
    }
  }, [user, cloudReady]);

  const handleSelectSubredditFromPost = useCallback((name: string) => {
    setSubreddits((prev) => {
      if (prev.some((s) => s.toLowerCase() === name.toLowerCase())) return prev;
      return [...prev, name];
    });
    setActiveView({ type: 'subreddit', name });
  }, []);

  const handleSelectXAccountFromPost = useCallback((handle: string) => {
    const clean = sanitizeXHandle(handle);
    if (!clean) return;
    setXAccounts((prev) => {
      if (prev.some((h) => h.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'x', handle: clean });
  }, []);

  const handleSelectYoutubeChannelFromPost = useCallback((handle: string) => {
    const clean = sanitizeYoutubeHandle(handle);
    if (!clean) return;
    setYoutubeChannels((prev) => {
      if (prev.some((h) => h.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setActiveView({ type: 'youtube', handle: clean });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showProfile) {
          setShowProfile(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (selectedPost) {
          setSelectedPost(null);
          return;
        }
        if (mobileSidebarOpen) {
          setMobileSidebarOpen(false);
          return;
        }
        if (mobileSearchOpen) {
          setMobileSearchOpen(false);
          setFilterQuery('');
          return;
        }
      }

      if (isTyping) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowSettings(false);
        setShowProfile(false);
        setShowShortcuts((s) => !s);
      } else if (e.key === ',') {
        e.preventDefault();
        setShowShortcuts(false);
        setShowProfile(false);
        setShowSettings((s) => !s);
      } else if (e.key === 'b') {
        e.preventDefault();
        if (window.innerWidth >= 1024) {
          setDesktopSidebarOpen((prev) => !prev);
        } else {
          setMobileSidebarOpen((prev) => !prev);
        }
      } else if (e.key === '/') {
        e.preventDefault();
        if (window.innerWidth < 640) {
          setMobileSearchOpen(true);
          setTimeout(() => filterInputRef.current?.focus(), 0);
        } else {
          filterInputRef.current?.focus();
        }
      } else if (e.key === 'a') {
        e.preventDefault();
        if (window.innerWidth >= 1024 && !desktopSidebarOpen) {
          setDesktopSidebarOpen(true);
        } else if (window.innerWidth < 1024 && !mobileSidebarOpen) {
          setMobileSidebarOpen(true);
        }
        setTimeout(() => addInputRef.current?.focus(), 0);
      } else if (e.key === 'r') {
        e.preventDefault();
        setRefreshNonce((n) => n + 1);
      } else if (e.key === 'j' && !selectedPost && !showSettings && !showProfile) {
        e.preventDefault();
        setFocusedIndex((prev) =>
          visiblePosts.length === 0 ? -1 : Math.min(visiblePosts.length - 1, prev + 1)
        );
      } else if (e.key === 'k' && !selectedPost && !showSettings && !showProfile) {
        e.preventDefault();
        setFocusedIndex((prev) =>
          visiblePosts.length === 0 ? -1 : Math.max(0, prev - 1)
        );
      } else if (
        (e.key === 'Enter' || e.key === 'o') &&
        !selectedPost &&
        !showSettings &&
        !showProfile
      ) {
        if (focusedIndex >= 0 && visiblePosts[focusedIndex]) {
          e.preventDefault();
          handleOpenPost(visiblePosts[focusedIndex], focusedIndex);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    desktopSidebarOpen,
    focusedIndex,
    handleOpenPost,
    mobileSearchOpen,
    mobileSidebarOpen,
    selectedPost,
    showProfile,
    showSettings,
    showShortcuts,
    visiblePosts,
  ]);

  const headerTitle =
    activeView.type === 'all'
      ? 'All Feeds'
      : activeView.type === 'saved'
        ? 'Saved'
        : activeView.type === 'x'
          ? `@${activeView.handle}`
          : activeView.type === 'topic'
            ? `#${activeView.topic}`
            : activeView.type === 'youtube'
              ? `yt/@${activeView.handle}`
              : activeView.type === 'yt-topic'
                ? `yt#${activeView.topic}`
                : `r/${activeView.name}`;

  const totalFollowed =
    subreddits.length +
    xAccounts.length +
    xTopics.length +
    youtubeChannels.length +
    youtubeTopics.length;
  const userInitial = (user?.displayName || user?.email || 'M')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden flex bg-[var(--sf-bg)] glass:bg-transparent text-[var(--sf-text)]">
      {/* Ambient layered mesh backdrop for Glassmorphism */}
      {theme === 'glass' && <div className="sf-glass-backdrop" aria-hidden="true" />}

      <div className="relative z-10 flex w-full h-full min-w-0">
        {/* Left Navigation Sidebar */}
        <Sidebar
          subreddits={subreddits}
          xAccounts={xAccounts}
          xTopics={xTopics}
          youtubeChannels={youtubeChannels}
          youtubeTopics={youtubeTopics}
          activeView={activeView}
          savedCount={savedPosts.length}
          user={user}
          isOpenMobile={mobileSidebarOpen}
          isDesktopOpen={desktopSidebarOpen}
          addInputRef={addInputRef}
          onSelectView={(v) => {
            setActiveView(v);
            setFilterQuery('');
            setMobileSearchOpen(false);
          }}
          onAddSubreddit={handleAddSubreddit}
          onRemoveSubreddit={handleRemoveSubreddit}
          onAddXAccount={handleAddXAccount}
          onRemoveXAccount={handleRemoveXAccount}
          onAddXTopic={handleAddXTopic}
          onRemoveXTopic={handleRemoveXTopic}
          onAddYoutubeChannel={handleAddYoutubeChannel}
          onRemoveYoutubeChannel={handleRemoveYoutubeChannel}
          onAddYoutubeTopic={handleAddYoutubeTopic}
          onRemoveYoutubeTopic={handleRemoveYoutubeTopic}
          onOpenProfile={() => setShowProfile(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenShortcuts={() => setShowShortcuts(true)}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* Main Workspace */}
        <div className="flex-1 min-w-0 flex flex-col h-full">
          {/* Responsive Header: Feed Heading + Search + Profile */}
          <header className="h-14 px-3.5 sm:px-6 border-b border-[var(--sf-border)] flex items-center justify-between gap-2.5 sm:gap-4 shrink-0 bg-[var(--sf-header)] glass:backdrop-blur-2xl">
            {mobileSearchOpen ? (
              <div className="flex sm:hidden items-center gap-2 w-full">
                <div className="relative flex-1 flex items-center">
                  <Search className="w-3.5 h-3.5 text-[var(--sf-text-muted)] absolute left-2.5 pointer-events-none" />
                  <input
                    ref={filterInputRef}
                    type="text"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Search posts..."
                    aria-label="Search posts"
                    autoFocus
                    className="w-full pl-8 pr-8 py-1.5 text-[13px] bg-[var(--sf-surface)] border border-[var(--sf-border-strong)] rounded-md text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)]/75 focus:outline-none transition-colors glass:backdrop-blur-md"
                  />
                  {filterQuery && (
                    <button
                      type="button"
                      onClick={() => setFilterQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2 p-0.5 text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setFilterQuery('');
                  }}
                  aria-label="Close search"
                  className="p-2 text-[var(--sf-text)] bg-[var(--sf-surface)] border border-[var(--sf-border)] rounded-md shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                {/* Left: Sidebar Toggle + Brand Icon (when collapsed) + Active Feed Heading */}
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.innerWidth >= 1024) {
                        setDesktopSidebarOpen((prev) => !prev);
                      } else {
                        setMobileSidebarOpen((prev) => !prev);
                      }
                    }}
                    aria-label="Toggle sidebar"
                    title="Toggle sidebar (b)"
                    className="p-1.5 -ml-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] rounded-md transition-colors shrink-0"
                  >
                    <PanelLeft className="w-4 h-4" />
                  </button>

                  <SubfeedIcon
                    className={`w-[18px] h-[18px] shrink-0 ${
                      desktopSidebarOpen ? 'lg:hidden' : ''
                    }`}
                  />

                  <h1 className="text-[14px] font-semibold tracking-tight text-[var(--sf-text)] whitespace-nowrap truncate">
                    {headerTitle}
                  </h1>
                </div>

                {/* Right: Search + Profile Trigger */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Mobile Search Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      setMobileSearchOpen(true);
                      setTimeout(() => filterInputRef.current?.focus(), 0);
                    }}
                    aria-label="Search posts"
                    className="sm:hidden p-2 text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] rounded-md transition-colors"
                  >
                    <Search className="w-4 h-4" />
                  </button>

                  {/* Desktop Inline Search */}
                  <div className="hidden sm:flex relative items-center w-52 md:w-64">
                    <Search className="w-3.5 h-3.5 text-[var(--sf-text-muted)] absolute left-2.5 pointer-events-none" />
                    <input
                      ref={filterInputRef}
                      type="text"
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      placeholder="Search..."
                      aria-label="Search posts"
                      className="w-full pl-8 pr-7 py-1.5 text-[12px] bg-[var(--sf-surface)] border border-[var(--sf-border)] focus:border-[var(--sf-border-strong)] rounded-md text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)]/75 focus:outline-none transition-colors glass:backdrop-blur-md"
                    />
                    {filterQuery && (
                      <button
                        type="button"
                        onClick={() => setFilterQuery('')}
                        aria-label="Clear search"
                        className="absolute right-2 text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Profile Button */}
                  <button
                    type="button"
                    onClick={() => setShowProfile(true)}
                    aria-label={user ? 'Open profile' : 'Sign in with Google'}
                    title={user ? user.displayName || user.email || 'Profile' : 'Sign in with Google'}
                    className="inline-flex items-center gap-2 p-1 sm:px-2 sm:py-1 rounded-md border border-[var(--sf-border)] bg-[var(--sf-surface)] hover:border-[var(--sf-border-strong)] hover:bg-[var(--sf-hover)] transition-colors shrink-0 glass:backdrop-blur-md"
                  >
                    {user?.photoURL && !headerAvatarFailed ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'Profile'}
                        referrerPolicy="no-referrer"
                        onError={() => setHeaderAvatarFailed(true)}
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                      />
                    ) : user ? (
                      <span className="w-5 h-5 rounded-full bg-[var(--sf-active)] flex items-center justify-center text-[10.5px] font-semibold text-[var(--sf-text)] shrink-0">
                        {userInitial}
                      </span>
                    ) : (
                      <UserIcon className="w-4 h-4 text-[var(--sf-text-secondary)] shrink-0" />
                    )}
                    <span className="hidden md:inline text-[12px] font-medium text-[var(--sf-text-secondary)] max-w-[96px] truncate">
                      {user ? user.displayName?.split(' ')[0] || 'Profile' : 'Sign in'}
                    </span>
                  </button>
                </div>
              </>
            )}
          </header>

        {/* Scrollable Feed Viewport */}
        <main
          ref={feedScrollRef}
          className="relative flex-1 overflow-y-auto overscroll-y-contain"
        >
          <PullToRefreshIndicator
            pullDistance={pullDistance}
            progress={progress}
            isPulling={isPulling}
            isReady={isReady}
            isRefreshing={pullRefreshing}
            holdHeight={PULL_HOLD_HEIGHT}
          />
          <motion.div
            initial={false}
            animate={{ y: feedTranslateY }}
            transition={
              isPulling
                ? { duration: 0 }
                : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
            }
            className="max-w-[960px] mx-auto w-full"
          >
            {/* Empty Sources List State */}
            {activeView.type !== 'saved' && totalFollowed === 0 ? (
              <div className="px-6 py-20 max-w-lg mx-auto text-center">
                <h2 className="text-[16px] font-semibold text-[var(--sf-text)]">
                  Your feed list is empty
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--sf-text-muted)]">
                  Add any subreddit (r/...), X account (@...), X topic (#...), YouTube channel (yt/...), or YouTube topic (yt#...) from the sidebar, or load a starter collection below.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                  {STARTER_PACKS.map((pack) => (
                    <button
                      key={pack.label}
                      type="button"
                      onClick={() => handleAddPack(pack.subreddits)}
                      className="px-3.5 py-2 text-[12.5px] font-medium bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] text-[var(--sf-text)] rounded-md transition-colors whitespace-nowrap glass:backdrop-blur-md"
                    >
                      + {pack.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : loading ? (
              /* Geometry-matched Loading Skeleton */
              density === 'card' ? (
                <div className="max-w-[740px] mx-auto px-4 sm:px-6 py-5 space-y-4">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="p-5 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)] animate-pulse space-y-3 glass:backdrop-blur-xl"
                    >
                      <div className="h-3 w-48 bg-[var(--sf-surface-muted)] rounded" />
                      <div className="h-4 w-5/6 bg-[var(--sf-surface-muted)] rounded" />
                      <div className="h-40 w-full bg-[var(--sf-surface-muted)]/70 rounded-md" />
                      <div className="pt-2 flex items-center gap-4">
                        <div className="h-3 w-12 bg-[var(--sf-surface-muted)] rounded" />
                        <div className="h-3 w-12 bg-[var(--sf-surface-muted)] rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-[var(--sf-border-subtle)]">
                  {Array.from({ length: 10 }).map((_, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-4 px-5 sm:px-6 animate-pulse ${
                        density === 'compact' ? 'py-3' : 'py-4'
                      }`}
                    >
                      <div className="w-12 sm:w-14 flex justify-end pt-1 shrink-0">
                        <div className="h-3.5 w-9 bg-[var(--sf-surface-muted)] rounded" />
                      </div>
                      <div className="flex-1 space-y-2.5">
                        <div className="h-4 w-4/5 bg-[var(--sf-surface-muted)] rounded" />
                        {density === 'comfortable' && (
                          <div className="h-3 w-3/5 bg-[var(--sf-surface-muted)]/70 rounded" />
                        )}
                        <div className="h-3 w-56 bg-[var(--sf-surface-muted)]/60 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : error ? (
              /* Honest Actionable Error State with Nitter Instance Recovery */
              <div className="px-6 py-20 max-w-md mx-auto text-center">
                <p className="text-[14px] font-medium text-[var(--sf-text)]">
                  Could not load feed
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--sf-text-muted)]">
                  {error}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  {(errorIsNitter ||
                    activeView.type === 'x' ||
                    activeView.type === 'topic' ||
                    (activeView.type === 'all' && sourceFilter === 'x')) && (
                    <button
                      type="button"
                      disabled={switchingNitterInstance}
                      onClick={() => void handleSwitchNitterInstance()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-medium bg-[var(--sf-btn-active-bg)] text-[var(--sf-btn-active-text)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${switchingNitterInstance ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {switchingNitterInstance ? 'Switching...' : 'Switch instance'}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRefreshNonce((n) => n + 1)}
                    className={`px-4 py-2 text-[12.5px] font-medium rounded-md transition-colors ${
                      errorIsNitter ||
                      activeView.type === 'x' ||
                      activeView.type === 'topic' ||
                      (activeView.type === 'all' && sourceFilter === 'x')
                        ? 'text-[var(--sf-text-secondary)] border border-[var(--sf-border)] hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)]'
                        : 'bg-[var(--sf-btn-active-bg)] text-[var(--sf-btn-active-text)] hover:opacity-90'
                    }`}
                  >
                    Retry
                  </button>
                  {activeView.type === 'subreddit' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSubreddit(activeView.name)}
                      className="px-4 py-2 text-[12.5px] text-[var(--sf-text-secondary)] border border-[var(--sf-border)] rounded-md hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                    >
                      Remove r/{activeView.name}
                    </button>
                  )}
                  {activeView.type === 'x' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveXAccount(activeView.handle)}
                      className="px-4 py-2 text-[12.5px] text-[var(--sf-text-secondary)] border border-[var(--sf-border)] rounded-md hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                    >
                      Remove @{activeView.handle}
                    </button>
                  )}
                  {activeView.type === 'topic' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveXTopic(activeView.topic)}
                      className="px-4 py-2 text-[12.5px] text-[var(--sf-text-secondary)] border border-[var(--sf-border)] rounded-md hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                    >
                      Remove #{activeView.topic}
                    </button>
                  )}
                  {activeView.type === 'youtube' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveYoutubeChannel(activeView.handle)}
                      className="px-4 py-2 text-[12.5px] text-[var(--sf-text-secondary)] border border-[var(--sf-border)] rounded-md hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                    >
                      Remove yt/@{activeView.handle}
                    </button>
                  )}
                  {activeView.type === 'yt-topic' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveYoutubeTopic(activeView.topic)}
                      className="px-4 py-2 text-[12.5px] text-[var(--sf-text-secondary)] border border-[var(--sf-border)] rounded-md hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                    >
                      Remove yt#{activeView.topic}
                    </button>
                  )}
                </div>

                {(errorIsNitter ||
                  activeView.type === 'x' ||
                  activeView.type === 'topic' ||
                  (activeView.type === 'all' && sourceFilter === 'x')) && (
                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showErrorInstances;
                        setShowErrorInstances(next);
                        if (next) void loadNitterHealth(true);
                      }}
                      className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] transition-colors"
                    >
                      <Server className="w-3.5 h-3.5" />
                      <span>
                        {showErrorInstances
                          ? 'Hide Nitter instances'
                          : 'Choose a specific Nitter instance'}
                      </span>
                    </button>

                    {showErrorInstances && (
                      <div className="mt-3 text-left rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)] divide-y divide-[var(--sf-border-subtle)] overflow-hidden">
                        <div className="px-3 py-2 flex items-center justify-between text-[11px] text-[var(--sf-text-muted)]">
                          <span>Monitored instances</span>
                          <button
                            type="button"
                            onClick={() => void loadNitterHealth(true)}
                            disabled={checkingNitterHealth}
                            className="inline-flex items-center gap-1 hover:text-[var(--sf-text)] disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${checkingNitterHealth ? 'animate-spin' : ''}`}
                            />
                            <span>Re-check</span>
                          </button>
                        </div>
                        {nitterInstances.length === 0 ? (
                          <div className="px-3 py-3 text-[12px] text-[var(--sf-text-muted)] text-center">
                            {checkingNitterHealth
                              ? 'Probing Nitter instances...'
                              : 'No instances discovered yet.'}
                          </div>
                        ) : (
                          nitterInstances.map((inst) => {
                            const dotClass =
                              inst.status === 'healthy'
                                ? 'bg-emerald-500'
                                : inst.status === 'degraded'
                                  ? 'bg-amber-400'
                                  : inst.status === 'down'
                                    ? 'bg-red-500'
                                    : 'bg-zinc-400';
                            const isCurrent = inst.url === activeNitterInstance;
                            return (
                              <button
                                key={inst.url}
                                type="button"
                                disabled={switchingNitterInstance}
                                onClick={() => void handleSwitchNitterInstance(inst.url)}
                                className="w-full px-3 py-2 flex items-center justify-between gap-2 text-[12px] hover:bg-[var(--sf-hover)] transition-colors text-left disabled:opacity-50"
                              >
                                <span className="flex items-center gap-2 min-w-0 truncate">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate font-mono text-[11.5px] text-[var(--sf-text)]">
                                    {inst.host}
                                  </span>
                                </span>
                                <span className="flex items-center gap-2 shrink-0 text-[11px] tabular-nums">
                                  <span
                                    className={
                                      inst.status === 'down'
                                        ? 'text-red-500 dark:text-red-400 mocha:text-[#f38ba8]'
                                        : 'text-[var(--sf-text-muted)]'
                                    }
                                  >
                                    {inst.status === 'down'
                                      ? 'Down'
                                      : inst.latencyMs != null
                                        ? `${inst.latencyMs}ms`
                                        : inst.status}
                                  </span>
                                  {isCurrent && (
                                    <Check className="w-3.5 h-3.5 text-[var(--sf-accent)]" />
                                  )}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : visiblePosts.length === 0 ? (
              /* Empty Filter or Empty Saved State */
              <div className="px-6 py-20 max-w-md mx-auto text-center">
                <p className="text-[14px] font-medium text-[var(--sf-text)]">
                  {filterQuery
                    ? 'No matching posts'
                    : activeView.type === 'saved'
                      ? 'No saved posts yet'
                      : 'No posts found for this view'}
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--sf-text-muted)]">
                  {filterQuery
                    ? `Nothing matched "${filterQuery}" in the current feed.`
                    : activeView.type === 'saved'
                      ? 'Bookmark any post from your feed to keep it here for later reading.'
                      : activeView.type === 'x'
                        ? `Nitter returned no recent posts for @${activeView.handle}. Try switching instances or check that the account is public.`
                        : activeView.type === 'topic'
                          ? `Nitter returned no recent posts for #${activeView.topic}. Try switching instances or following a broader keyword.`
                          : activeView.type === 'youtube'
                            ? `No recent videos found for yt/@${activeView.handle}. Verify the handle or try showing Shorts in Settings.`
                            : activeView.type === 'yt-topic'
                              ? `No videos matched yt#${activeView.topic}. Try another keyword or adjust timeframe in Settings.`
                              : 'Try adjusting the sort order or timeframe in Settings.'}
                </p>
                {filterQuery ? (
                  <button
                    type="button"
                    onClick={() => setFilterQuery('')}
                    className="mt-4 px-3.5 py-1.5 text-[12px] font-medium border border-[var(--sf-border)] rounded-md text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                  >
                    Clear search
                  </button>
                ) : (activeView.type === 'x' || activeView.type === 'topic') && (
                  <div className="mt-5 flex items-center justify-center gap-2.5">
                    <button
                      type="button"
                      disabled={switchingNitterInstance}
                      onClick={() => void handleSwitchNitterInstance()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[var(--sf-btn-active-bg)] text-[var(--sf-btn-active-text)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${switchingNitterInstance ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {switchingNitterInstance ? 'Switching...' : 'Switch instance'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefreshNonce((n) => n + 1)}
                      className="px-3.5 py-1.5 text-[12px] font-medium border border-[var(--sf-border)] rounded-md text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Populated Editorial Ledger or Card Stream */
              <>
                {density === 'card' ? (
                  <div className="max-w-[740px] mx-auto px-3.5 sm:px-6 py-4 sm:py-5 space-y-3.5 sm:space-y-4">
                    {visiblePosts.map((post, idx) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        showSubreddit={activeView.type !== 'subreddit'}
                        isSelected={selectedPost?.id === post.id}
                        isFocused={focusedIndex === idx}
                        isSaved={savedIdSet.has(post.id)}
                        isRead={readIdSet.has(post.id)}
                        onOpen={(p) => handleOpenPost(p, idx)}
                        onSelectSubreddit={handleSelectSubredditFromPost}
                        onSelectXAccount={handleSelectXAccountFromPost}
                        onSelectYoutubeChannel={handleSelectYoutubeChannelFromPost}
                        onToggleSave={handleToggleSave}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--sf-border-subtle)] border-b border-[var(--sf-border-subtle)] glass:bg-[var(--sf-surface)] glass:backdrop-blur-xl glass:mx-3 glass:my-4 glass:rounded-xl glass:border glass:border-[var(--sf-border)] glass:overflow-hidden glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                    {visiblePosts.map((post, idx) => (
                      <PostRow
                        key={post.id}
                        post={post}
                        density={density}
                        showSubreddit={activeView.type !== 'subreddit'}
                        isSelected={selectedPost?.id === post.id}
                        isFocused={focusedIndex === idx}
                        isSaved={savedIdSet.has(post.id)}
                        isRead={readIdSet.has(post.id)}
                        onOpen={(p) => handleOpenPost(p, idx)}
                        onSelectSubreddit={handleSelectSubredditFromPost}
                        onSelectXAccount={handleSelectXAccountFromPost}
                        onSelectYoutubeChannel={handleSelectYoutubeChannelFromPost}
                        onToggleSave={handleToggleSave}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination Footer */}
                {activeView.type !== 'saved' &&
                  activeView.type !== 'x' &&
                  activeView.type !== 'topic' &&
                  activeView.type !== 'youtube' &&
                  activeView.type !== 'yt-topic' &&
                  afterCursor &&
                  !filterQuery && (
                    <div className="py-8 flex justify-center">
                      <button
                        type="button"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="px-5 py-2 text-[12.5px] font-medium text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] rounded-md transition-colors disabled:opacity-50 whitespace-nowrap glass:backdrop-blur-md"
                      >
                        {loadingMore ? 'Loading more...' : 'Load more posts'}
                      </button>
                    </div>
                  )}
              </>
            )}
          </motion.div>
        </main>
        </div>
      </div>

      {/* Thread Reader Bottom Sheet */}
      <ThreadDrawer
        post={selectedPost}
        isSaved={selectedPost ? savedIdSet.has(selectedPost.id) : false}
        switchingInstance={switchingNitterInstance}
        onClose={() => setSelectedPost(null)}
        onToggleSave={handleToggleSave}
        onSelectSubreddit={handleSelectSubredditFromPost}
        onSelectXAccount={handleSelectXAccountFromPost}
        onSelectYoutubeChannel={handleSelectYoutubeChannelFromPost}
        onSwitchNitterInstance={() => handleSwitchNitterInstance()}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        sort={sort}
        timeframe={timeframe}
        sourceFilter={sourceFilter}
        hideYoutubeShorts={hideYoutubeShorts}
        density={density}
        theme={theme}
        font={font}
        savedCount={savedPosts.length}
        loading={loading || pullRefreshing}
        activeNitterInstance={activeNitterInstance}
        nitterInstances={nitterInstances}
        checkingNitterHealth={checkingNitterHealth}
        switchingNitterInstance={switchingNitterInstance}
        onChangeSort={setSort}
        onChangeTimeframe={setTimeframe}
        onChangeSourceFilter={setSourceFilter}
        onChangeHideYoutubeShorts={setHideYoutubeShorts}
        onChangeDensity={setDensity}
        onChangeTheme={setTheme}
        onChangeFont={setFont}
        onRefreshNitterHealth={() => void loadNitterHealth(true)}
        onSelectNitterInstance={(url) => void handleSwitchNitterInstance(url)}
        onRefreshFeed={() => setRefreshNonce((n) => n + 1)}
        onClearCache={() => {
          cacheClearAll();
          setRefreshNonce((n) => n + 1);
        }}
        onClearSaved={handleClearSaved}
        onClose={() => setShowSettings(false)}
      />

      {/* Profile & Google Auth Modal */}
      <ProfileModal
        isOpen={showProfile}
        user={user}
        authLoading={!authReady}
        syncing={cloudSyncing}
        subredditCount={subreddits.length}
        xAccountCount={xAccounts.length}
        xTopicCount={xTopics.length}
        youtubeChannelCount={youtubeChannels.length}
        youtubeTopicCount={youtubeTopics.length}
        savedCount={savedPosts.length}
        readCount={readPostIds.length}
        onSignInGoogle={async () => {
          const signedInUser = await startGoogleSignInPopup();
          setUser(signedInUser);
          setHeaderAvatarFailed(false);
        }}
        onSignOut={async () => {
          await logoutAccount();
          setUser(null);
          setCloudReady(false);
        }}
        onClearReadHistory={handleClearReadHistory}
        onClose={() => setShowProfile(false)}
      />

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setShowShortcuts(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm bg-[var(--sf-modal)] border border-[var(--sf-border)] rounded-xl p-5 shadow-2xl glass:backdrop-blur-2xl glass:shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.16)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--sf-border)]">
              <h2 className="text-[13.5px] font-semibold text-[var(--sf-text)]">
                Keyboard Shortcuts
              </h2>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                aria-label="Close shortcuts"
                className="p-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="mt-3 space-y-2.5 text-[12.5px]">
              {[
                ['j / k', 'Move through posts'],
                ['Enter', 'Open selected thread'],
                ['Esc', 'Close thread or dialog'],
                ['b', 'Toggle sidebar'],
                [',', 'Open settings'],
                ['a', 'Add r/, @, #, yt/, or yt#'],
                ['/', 'Search current posts'],
                ['r', 'Refresh feed'],
                ['?', 'Toggle this menu'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--sf-text-secondary)]">{desc}</dt>
                  <dd className="px-1.5 py-0.5 text-[11.5px] font-mono bg-[var(--sf-surface-muted)] border border-[var(--sf-border)] rounded text-[var(--sf-text)]">
                    {key}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
