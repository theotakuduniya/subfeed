import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { PanelLeft, Search, X } from 'lucide-react';
import type {
  ActiveView,
  FeedDensity,
  FontOption,
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
  fetchXFeed,
  getCachedXFeed,
  mergeAndRankFeeds,
  sanitizeXHandle,
} from './lib/x';
import { cacheClearAll } from './lib/cache';
import { Sidebar } from './components/Sidebar';
import { PostRow } from './components/PostRow';
import { PostCard } from './components/PostCard';
import { ThreadDrawer } from './components/ThreadDrawer';
import { SettingsModal } from './components/SettingsModal';
import { SubfeedIcon } from './components/SubfeedIcon';
import { PullToRefreshIndicator } from './components/PullToRefreshIndicator';
import { usePullToRefresh } from './hooks/usePullToRefresh';

const STORAGE_KEYS = {
  subreddits: 'subfeed:subreddits',
  xAccounts: 'subfeed:xAccounts',
  saved: 'subfeed:saved',
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
const VALID_SOURCES: SourceFilter[] = ['all', 'reddit', 'x'];
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
  const [savedPosts, setSavedPosts] = useState<RedditPost[]>(readStoredSavedPosts);
  const [theme, setTheme] = useState<ThemeOption>(readStoredTheme);
  const [font, setFont] = useState<FontOption>(readStoredFont);
  const [density, setDensity] = useState<FeedDensity>(readStoredDensity);

  const [activeView, setActiveView] = useState<ActiveView>({ type: 'all' });
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(readStoredSourceFilter);
  const [sort, setSort] = useState<SortOption>(readStoredSort);
  const [timeframe, setTimeframe] = useState<TimeframeOption>(readStoredTimeframe);
  const [filterQuery, setFilterQuery] = useState('');

  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [afterCursor, setAfterCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [selectedPost, setSelectedPost] = useState<RedditPost | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(readStoredSidebarOpen);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const addInputRef = useRef<HTMLInputElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const feedScrollRef = useRef<HTMLElement | null>(null);
  const lastRefreshNonceRef = useRef<number>(0);
  const pendingPullRefreshRef = useRef<boolean>(false);

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
      localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(savedPosts));
    } catch {
      // Ignore
    }
  }, [savedPosts]);

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

  const savedIdSet = useMemo(() => new Set(savedPosts.map((p) => p.id)), [savedPosts]);

  const activeSubreddits = useMemo(() => {
    if (activeView.type === 'subreddit') return [activeView.name];
    if (activeView.type === 'all' && sourceFilter !== 'x') return subreddits;
    return [];
  }, [activeView, sourceFilter, subreddits]);

  const activeXHandles = useMemo(() => {
    if (activeView.type === 'x') return [activeView.handle];
    if (activeView.type === 'all' && sourceFilter !== 'reddit') return xAccounts;
    return [];
  }, [activeView, sourceFilter, xAccounts]);

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

    if (activeSubreddits.length === 0 && activeXHandles.length === 0) {
      setPosts([]);
      setAfterCursor(null);
      setLoading(false);
      setPullRefreshing(false);
      setError(null);
      return;
    }

    if (!isManualRefresh) {
      const needReddit = activeSubreddits.length > 0;
      const needX = activeXHandles.length > 0;
      const cachedReddit = needReddit
        ? getCachedFeed(activeSubreddits, sort, timeframe)
        : null;
      const cachedX = needX
        ? getCachedXFeed(activeXHandles, sort, timeframe)
        : null;

      if ((!needReddit || cachedReddit) && (!needX || cachedX)) {
        const merged = mergeAndRankFeeds(
          cachedReddit?.posts ?? [],
          cachedX?.posts ?? [],
          sort
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
        : Promise.resolve({ posts: [], after: null });

    const xPromise =
      activeXHandles.length > 0
        ? fetchXFeed({
            handles: activeXHandles,
            sort,
            timeframe,
            limit: 25,
            forceRefresh: isManualRefresh,
            signal: controller.signal,
          })
        : Promise.resolve({ posts: [], after: null });

    Promise.allSettled([redditPromise, xPromise])
      .then(([redditRes, xRes]) => {
        if (controller.signal.aborted) return;

        const redditOk = redditRes.status === 'fulfilled';
        const xOk = xRes.status === 'fulfilled';

        if (!redditOk && !xOk) {
          const msg =
            (redditRes.reason instanceof Error && redditRes.reason.message) ||
            (xRes.reason instanceof Error && xRes.reason.message) ||
            'Unable to load posts.';
          setError(msg);
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
          setPosts([]);
          setAfterCursor(null);
          return;
        }
        if (activeView.type === 'x' && !xOk) {
          setError(
            xRes.reason instanceof Error
              ? xRes.reason.message
              : 'Unable to load X account via Nitter.'
          );
          setPosts([]);
          setAfterCursor(null);
          return;
        }

        const redditPosts = redditOk ? redditRes.value.posts : [];
        const xPosts = xOk ? xRes.value.posts : [];
        const merged = mergeAndRankFeeds(redditPosts, xPosts, sort);

        setError(null);
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
  }, [activeView, activeSubreddits, activeXHandles, sort, timeframe, refreshNonce]);

  const handlePullRefresh = useCallback(() => {
    pendingPullRefreshRef.current = true;
    setPullRefreshing(true);
    setRefreshNonce((n) => n + 1);
  }, []);

  const pullToRefreshDisabled =
    activeView.type === 'saved' ||
    (activeSubreddits.length === 0 && activeXHandles.length === 0) ||
    Boolean(selectedPost) ||
    showSettings ||
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
        const redditOnly = merged.filter((p) => p.source !== 'x');
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

  const handleToggleSave = useCallback((post: RedditPost) => {
    setSavedPosts((prev) => {
      const exists = prev.some((p) => p.id === post.id);
      if (exists) return prev.filter((p) => p.id !== post.id);
      return [post, ...prev];
    });
  }, []);

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
      }

      if (isTyping) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowSettings(false);
        setShowShortcuts((s) => !s);
      } else if (e.key === ',') {
        e.preventDefault();
        setShowShortcuts(false);
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
        filterInputRef.current?.focus();
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
      } else if (e.key === 'j' && !selectedPost && !showSettings) {
        e.preventDefault();
        setFocusedIndex((prev) =>
          visiblePosts.length === 0 ? -1 : Math.min(visiblePosts.length - 1, prev + 1)
        );
      } else if (e.key === 'k' && !selectedPost && !showSettings) {
        e.preventDefault();
        setFocusedIndex((prev) =>
          visiblePosts.length === 0 ? -1 : Math.max(0, prev - 1)
        );
      } else if ((e.key === 'Enter' || e.key === 'o') && !selectedPost && !showSettings) {
        if (focusedIndex >= 0 && visiblePosts[focusedIndex]) {
          e.preventDefault();
          setSelectedPost(visiblePosts[focusedIndex]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    desktopSidebarOpen,
    focusedIndex,
    mobileSidebarOpen,
    selectedPost,
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
          : `r/${activeView.name}`;

  const totalFollowed = subreddits.length + xAccounts.length;

  return (
    <div className="relative h-screen w-screen overflow-hidden flex bg-[var(--sf-bg)] glass:bg-transparent text-[var(--sf-text)]">
      {/* Ambient layered mesh backdrop for Glassmorphism */}
      {theme === 'glass' && <div className="sf-glass-backdrop" aria-hidden="true" />}

      <div className="relative z-10 flex w-full h-full min-w-0">
        {/* Left Navigation Sidebar */}
        <Sidebar
          subreddits={subreddits}
          xAccounts={xAccounts}
          activeView={activeView}
          savedCount={savedPosts.length}
          isOpenMobile={mobileSidebarOpen}
          isDesktopOpen={desktopSidebarOpen}
          addInputRef={addInputRef}
          onSelectView={(v) => {
            setActiveView(v);
            setFilterQuery('');
          }}
          onAddSubreddit={handleAddSubreddit}
          onRemoveSubreddit={handleRemoveSubreddit}
          onAddXAccount={handleAddXAccount}
          onRemoveXAccount={handleRemoveXAccount}
          onOpenSettings={() => setShowSettings(true)}
          onOpenShortcuts={() => setShowShortcuts(true)}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* Main Workspace */}
        <div className="flex-1 min-w-0 flex flex-col h-full">
          {/* Ultra-Minimal Header: Feed Heading + Search Only */}
          <header className="h-14 px-4 sm:px-6 border-b border-[var(--sf-border)] flex items-center justify-between gap-4 shrink-0 bg-[var(--sf-header)] glass:backdrop-blur-2xl">
            {/* Left: Sidebar Toggle + Brand Icon (when collapsed) + Active Feed Heading */}
            <div className="flex items-center gap-3 min-w-0 shrink-0">
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
                className="p-1.5 -ml-1.5 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] rounded-md transition-colors shrink-0"
              >
                <PanelLeft className="w-4 h-4" />
              </button>

              <SubfeedIcon
                className={`w-[18px] h-[18px] shrink-0 ${
                  desktopSidebarOpen ? 'lg:hidden' : ''
                }`}
              />

              <h1 className="text-[14px] font-semibold tracking-tight text-[var(--sf-text)] whitespace-nowrap truncate max-w-[160px] sm:max-w-[280px]">
                {headerTitle}
              </h1>
            </div>

            {/* Right: Search Only */}
            <div className="relative flex items-center w-44 sm:w-64">
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
                  className="absolute right-2 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
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
                  Add any subreddit (r/...) or X account (@...) from the sidebar, or load a starter collection below.
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
              /* Honest Actionable Error State */
              <div className="px-6 py-20 max-w-md mx-auto text-center">
                <p className="text-[14px] font-medium text-[var(--sf-text)]">
                  Could not load feed
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--sf-text-muted)]">
                  {error}
                </p>
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRefreshNonce((n) => n + 1)}
                    className="px-4 py-2 text-[12.5px] font-medium bg-[var(--sf-btn-active-bg)] text-[var(--sf-btn-active-text)] rounded-md hover:opacity-90 transition-opacity"
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
                </div>
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
                        ? `Nitter returned no recent posts for @${activeView.handle}. Try refreshing or check that the account is public.`
                        : 'Try adjusting the sort order or timeframe in Settings.'}
                </p>
                {filterQuery && (
                  <button
                    type="button"
                    onClick={() => setFilterQuery('')}
                    className="mt-4 px-3.5 py-1.5 text-[12px] font-medium border border-[var(--sf-border)] rounded-md text-[var(--sf-text)] hover:border-[var(--sf-border-strong)] transition-colors"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              /* Populated Editorial Ledger or Card Stream */
              <>
                {density === 'card' ? (
                  <div className="max-w-[740px] mx-auto px-4 sm:px-6 py-5 space-y-4">
                    {visiblePosts.map((post, idx) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        showSubreddit={activeView.type !== 'subreddit'}
                        isSelected={selectedPost?.id === post.id}
                        isFocused={focusedIndex === idx}
                        isSaved={savedIdSet.has(post.id)}
                        onOpen={(p) => {
                          setFocusedIndex(idx);
                          setSelectedPost(p);
                        }}
                        onSelectSubreddit={handleSelectSubredditFromPost}
                        onSelectXAccount={handleSelectXAccountFromPost}
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
                        onOpen={(p) => {
                          setFocusedIndex(idx);
                          setSelectedPost(p);
                        }}
                        onSelectSubreddit={handleSelectSubredditFromPost}
                        onSelectXAccount={handleSelectXAccountFromPost}
                        onToggleSave={handleToggleSave}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination Footer */}
                {activeView.type !== 'saved' &&
                  activeView.type !== 'x' &&
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
        onClose={() => setSelectedPost(null)}
        onToggleSave={handleToggleSave}
        onSelectSubreddit={handleSelectSubredditFromPost}
        onSelectXAccount={handleSelectXAccountFromPost}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        sort={sort}
        timeframe={timeframe}
        sourceFilter={sourceFilter}
        density={density}
        theme={theme}
        font={font}
        savedCount={savedPosts.length}
        loading={loading || pullRefreshing}
        onChangeSort={setSort}
        onChangeTimeframe={setTimeframe}
        onChangeSourceFilter={setSourceFilter}
        onChangeDensity={setDensity}
        onChangeTheme={setTheme}
        onChangeFont={setFont}
        onRefreshFeed={() => setRefreshNonce((n) => n + 1)}
        onClearCache={() => {
          cacheClearAll();
          setRefreshNonce((n) => n + 1);
        }}
        onClearSaved={() => setSavedPosts([])}
        onClose={() => setShowSettings(false)}
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
                ['a', 'Add subreddit or @handle'],
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
