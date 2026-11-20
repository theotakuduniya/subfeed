import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  ChevronDown,
  Layers,
  Plus,
  Settings,
  User as UserIcon,
  X,
  Keyboard,
} from 'lucide-react';
import type {
  ActiveView,
  SubredditSuggestion,
  XProfilePreview,
} from '../types/reddit';
import type { AuthUser } from '../lib/account';
import {
  formatCompactNumber,
  sanitizeSubredditName,
  searchSubreddits,
} from '../lib/reddit';
import {
  POPULAR_X_TOPICS,
  lookupXProfile,
  sanitizeXHandle,
  sanitizeXTopic,
} from '../lib/x';
import { SubfeedIcon } from './SubfeedIcon';

interface SidebarProps {
  subreddits: string[];
  xAccounts: string[];
  xTopics: string[];
  activeView: ActiveView;
  savedCount: number;
  user: AuthUser | null;
  isOpenMobile: boolean;
  isDesktopOpen: boolean;
  addInputRef: React.RefObject<HTMLInputElement | null>;
  onSelectView: (view: ActiveView) => void;
  onAddSubreddit: (name: string) => void;
  onRemoveSubreddit: (name: string) => void;
  onAddXAccount: (handle: string) => void;
  onRemoveXAccount: (handle: string) => void;
  onAddXTopic: (topic: string) => void;
  onRemoveXTopic: (topic: string) => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onCloseMobile: () => void;
}

export function Sidebar({
  subreddits,
  xAccounts,
  xTopics,
  activeView,
  savedCount,
  user,
  isOpenMobile,
  isDesktopOpen,
  addInputRef,
  onSelectView,
  onAddSubreddit,
  onRemoveSubreddit,
  onAddXAccount,
  onRemoveXAccount,
  onAddXTopic,
  onRemoveXTopic,
  onOpenProfile,
  onOpenSettings,
  onOpenShortcuts,
  onCloseMobile,
}: SidebarProps) {
  const [addMode, setAddMode] = useState<'reddit' | 'x' | 'topic'>('reddit');
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<SubredditSuggestion[]>([]);
  const [xPreview, setXPreview] = useState<XProfilePreview | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [subredditsOpen, setSubredditsOpen] = useState(true);
  const [xAccountsOpen, setXAccountsOpen] = useState(true);
  const [xTopicsOpen, setXTopicsOpen] = useState(true);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.photoURL]);

  useEffect(() => {
    const controller = new AbortController();

    if (addMode === 'reddit') {
      setXPreview(null);
      const clean = sanitizeSubredditName(inputValue);
      if (clean.length < 2) {
        setSuggestions([]);
        setIsSearching(false);
        setHighlightedIdx(-1);
        return () => controller.abort();
      }

      setIsSearching(true);
      const timer = setTimeout(async () => {
        try {
          const res = await searchSubreddits(clean, controller.signal);
          if (!controller.signal.aborted) {
            setSuggestions(res);
            setHighlightedIdx(-1);
          }
        } finally {
          if (!controller.signal.aborted) setIsSearching(false);
        }
      }, 240);

      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    } else if (addMode === 'x') {
      setSuggestions([]);
      const clean = sanitizeXHandle(inputValue);
      if (clean.length < 2) {
        setXPreview(null);
        setIsSearching(false);
        return () => controller.abort();
      }

      setIsSearching(true);
      const timer = setTimeout(async () => {
        try {
          const profile = await lookupXProfile(clean, controller.signal);
          if (!controller.signal.aborted) {
            setXPreview(profile);
          }
        } finally {
          if (!controller.signal.aborted) setIsSearching(false);
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    } else {
      setSuggestions([]);
      setXPreview(null);
      setIsSearching(false);
      return () => controller.abort();
    }
  }, [inputValue, addMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (raw: string) => {
    // Auto-detect #topic, @handle / x.com URLs, or r/ / reddit.com URLs
    if (raw.startsWith('#')) {
      if (addMode !== 'topic') setAddMode('topic');
      setInputValue(raw.slice(1));
    } else if (
      raw.startsWith('@') ||
      /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i.test(raw)
    ) {
      if (addMode !== 'x') setAddMode('x');
      setInputValue(raw.startsWith('@') ? raw.slice(1) : raw);
    } else if (
      /^\/?r\//i.test(raw) ||
      /^https?:\/\/(www\.|old\.)?reddit\.com\/r\//i.test(raw)
    ) {
      if (addMode !== 'reddit') setAddMode('reddit');
      setInputValue(raw);
    } else {
      setInputValue(raw);
    }
    setShowDropdown(true);
    if (feedback) setFeedback(null);
  };

  const commitSubreddit = (rawName: string) => {
    const clean = sanitizeSubredditName(rawName);
    if (!clean) {
      setFeedback('Enter a valid subreddit name');
      return;
    }
    const existing = subreddits.find(
      (s) => s.toLowerCase() === clean.toLowerCase()
    );
    if (existing) {
      setFeedback(`r/${existing} is already in your list`);
      onSelectView({ type: 'subreddit', name: existing });
      setInputValue('');
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    onAddSubreddit(clean);
    setSubredditsOpen(true);
    setInputValue('');
    setSuggestions([]);
    setShowDropdown(false);
    setFeedback(null);
  };

  const commitXAccount = (rawHandle: string) => {
    const clean = sanitizeXHandle(rawHandle);
    if (!clean) {
      setFeedback('Enter a valid X handle');
      return;
    }
    const existing = xAccounts.find(
      (h) => h.toLowerCase() === clean.toLowerCase()
    );
    if (existing) {
      setFeedback(`@${existing} is already in your list`);
      onSelectView({ type: 'x', handle: existing });
      setInputValue('');
      setXPreview(null);
      setShowDropdown(false);
      return;
    }
    onAddXAccount(clean);
    setXAccountsOpen(true);
    setInputValue('');
    setXPreview(null);
    setShowDropdown(false);
    setFeedback(null);
  };

  const commitXTopic = (rawTopic: string) => {
    const clean = sanitizeXTopic(rawTopic);
    if (!clean) {
      setFeedback('Enter a valid topic or keyword');
      return;
    }
    const existing = xTopics.find(
      (t) => t.toLowerCase() === clean.toLowerCase()
    );
    if (existing) {
      setFeedback(`#${existing} is already in your list`);
      onSelectView({ type: 'topic', topic: existing });
      setInputValue('');
      setShowDropdown(false);
      return;
    }
    onAddXTopic(clean);
    setXTopicsOpen(true);
    setInputValue('');
    setShowDropdown(false);
    setFeedback(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (addMode === 'topic') {
      commitXTopic(inputValue);
      return;
    }
    if (addMode === 'x') {
      commitXAccount(xPreview?.handle || inputValue);
      return;
    }
    if (highlightedIdx >= 0 && suggestions[highlightedIdx]) {
      commitSubreddit(suggestions[highlightedIdx].name);
      return;
    }
    commitSubreddit(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (addMode === 'reddit') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (suggestions.length > 0) {
          setShowDropdown(true);
          setHighlightedIdx((prev) => (prev + 1) % suggestions.length);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (suggestions.length > 0) {
          setHighlightedIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        }
      }
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightedIdx(-1);
      addInputRef.current?.blur();
    }
  };

  const totalSources = subreddits.length + xAccounts.length + xTopics.length;
  const cleanXQuery = sanitizeXHandle(inputValue);
  const cleanRedditQuery = sanitizeSubredditName(inputValue);
  const cleanTopicQuery = sanitizeXTopic(inputValue);
  const matchingPopularTopics = POPULAR_X_TOPICS.filter((t) =>
    cleanTopicQuery ? t.toLowerCase().includes(cleanTopicQuery.toLowerCase()) : true
  ).slice(0, 6);
  const userInitial = (user?.displayName || user?.email || 'M')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  const content = (
    <aside className="flex flex-col h-full w-[min(86vw,286px)] lg:w-[264px] shrink-0 bg-[var(--sf-sidebar)] border-r border-[var(--sf-border)] select-none glass:backdrop-blur-2xl">
      {/* Brand Header */}
      <div className="h-14 px-4 sm:px-5 flex items-center justify-between border-b border-[var(--sf-border)] shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectView({ type: 'all' });
            onCloseMobile();
          }}
          className="inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-[var(--sf-text)] hover:text-[var(--sf-accent)] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--sf-accent)] rounded-sm"
        >
          <SubfeedIcon className="w-[18px] h-[18px] shrink-0" />
          <span>minisocial</span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close sidebar"
          className="lg:hidden p-1.5 text-[var(--sf-text)] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:bg-[var(--sf-hover)] rounded-md transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Primary Views */}
      <div className="p-3 space-y-1 border-b border-[var(--sf-border)]">
        <button
          type="button"
          onClick={() => {
            onSelectView({ type: 'all' });
            onCloseMobile();
          }}
          className={`w-full flex items-center justify-between px-3 py-2 text-[13px] rounded-md transition-colors whitespace-nowrap ${
            activeView.type === 'all'
              ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
              : 'text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)]'
          }`}
        >
          <span className="flex items-center gap-2.5 truncate">
            <Layers
              className={`w-3.5 h-3.5 shrink-0 ${
                activeView.type === 'all' ? 'text-[var(--sf-accent)]' : ''
              }`}
            />
            <span>All Feeds</span>
          </span>
          <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)]">
            {totalSources}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onSelectView({ type: 'saved' });
            onCloseMobile();
          }}
          className={`w-full flex items-center justify-between px-3 py-2 text-[13px] rounded-md transition-colors whitespace-nowrap ${
            activeView.type === 'saved'
              ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
              : 'text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)]'
          }`}
        >
          <span className="flex items-center gap-2.5 truncate">
            <Bookmark
              className={`w-3.5 h-3.5 shrink-0 ${
                activeView.type === 'saved' ? 'text-[var(--sf-accent)]' : ''
              }`}
            />
            <span>Saved</span>
          </span>
          <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)]">
            {savedCount}
          </span>
        </button>
      </div>

      {/* Unified Add Subreddit / X Handle / Topic Control */}
      <div className="p-3 border-b border-[var(--sf-border)]" ref={dropdownRef}>
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex items-center bg-[var(--sf-surface)] border border-[var(--sf-border)] focus-within:border-[var(--sf-border-strong)] rounded-md transition-colors glass:backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setAddMode((m) =>
                  m === 'reddit' ? 'x' : m === 'x' ? 'topic' : 'reddit'
                );
                setFeedback(null);
                addInputRef.current?.focus();
              }}
              title="Switch between Subreddit (r/), X Account (@), and Topic (#)"
              aria-label={`Switch add mode (currently ${
                addMode === 'reddit' ? 'Subreddit' : addMode === 'x' ? 'X Account' : 'X Topic'
              })`}
              className="pl-2.5 pr-1.5 py-2 text-[12px] font-medium text-[var(--sf-text-muted)] hover:text-[var(--sf-accent)] transition-colors shrink-0 border-r border-[var(--sf-border-subtle)] min-w-[34px] text-center"
            >
              {addMode === 'reddit' ? 'r/' : addMode === 'x' ? '@' : '#'}
            </button>
            <input
              ref={addInputRef}
              type="text"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              onKeyDown={handleKeyDown}
              placeholder={
                addMode === 'reddit'
                  ? 'add subreddit'
                  : addMode === 'x'
                    ? 'add x handle'
                    : 'follow x topic'
              }
              aria-label={
                addMode === 'reddit'
                  ? 'Add subreddit to your list'
                  : addMode === 'x'
                    ? 'Add X account to your list'
                    : 'Follow X topic'
              }
              autoComplete="off"
              spellCheck={false}
              className="w-full py-2 px-2 text-[12.5px] bg-transparent text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)]/70 focus:outline-none"
            />
            <button
              type="submit"
              aria-label={
                addMode === 'reddit'
                  ? 'Add subreddit'
                  : addMode === 'x'
                    ? 'Add X account'
                    : 'Follow topic'
              }
              className="px-2.5 py-2 text-[var(--sf-text-muted)] hover:text-[var(--sf-accent)] transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {feedback && (
            <p className="mt-1.5 px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {feedback}
            </p>
          )}

          {/* Reddit Autocomplete Dropdown */}
          {showDropdown && addMode === 'reddit' && cleanRedditQuery.length >= 2 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[var(--sf-surface-elevated)] border border-[var(--sf-border)] rounded-md shadow-xl overflow-hidden glass:backdrop-blur-2xl">
              {isSearching && suggestions.length === 0 ? (
                <div className="px-3 py-2.5 text-[11.5px] text-[var(--sf-text-muted)]">
                  Searching subreddits...
                </div>
              ) : suggestions.length > 0 ? (
                <ul className="divide-y divide-[var(--sf-border-subtle)] max-h-64 overflow-y-auto">
                  {suggestions.map((item, idx) => {
                    const isAdded = subreddits.some(
                      (s) => s.toLowerCase() === item.name.toLowerCase()
                    );
                    return (
                      <li key={item.name}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commitSubreddit(item.name);
                          }}
                          className={`w-full text-left px-3 py-2 transition-colors ${
                            idx === highlightedIdx
                              ? 'bg-[var(--sf-active)]'
                              : 'hover:bg-[var(--sf-hover)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12.5px] font-medium text-[var(--sf-text)] truncate">
                              r/{item.name}
                            </span>
                            <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)] shrink-0">
                              {isAdded
                                ? 'added'
                                : item.subscribers > 0
                                  ? formatCompactNumber(item.subscribers)
                                  : ''}
                            </span>
                          </div>
                          {item.description && (
                            <p className="mt-0.5 text-[11px] text-[var(--sf-text-muted)] line-clamp-1">
                              {item.description}
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitSubreddit(inputValue);
                  }}
                  className="w-full text-left px-3 py-2.5 text-[12px] text-[var(--sf-text-secondary)] hover:bg-[var(--sf-hover)] transition-colors"
                >
                  Add <span className="font-medium text-[var(--sf-text)]">r/{cleanRedditQuery}</span>
                </button>
              )}
            </div>
          )}

          {/* X Handle Lookup Dropdown */}
          {showDropdown && addMode === 'x' && cleanXQuery.length >= 2 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[var(--sf-surface-elevated)] border border-[var(--sf-border)] rounded-md shadow-xl overflow-hidden glass:backdrop-blur-2xl">
              {isSearching && !xPreview ? (
                <div className="px-3 py-2.5 text-[11.5px] text-[var(--sf-text-muted)]">
                  Looking up @{cleanXQuery}...
                </div>
              ) : xPreview ? (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitXAccount(xPreview.handle);
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-[var(--sf-hover)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-[var(--sf-text)] truncate">
                      @{xPreview.handle}
                    </span>
                    <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)] shrink-0">
                      {xAccounts.some((h) => h.toLowerCase() === xPreview.handle.toLowerCase())
                        ? 'added'
                        : xPreview.followers > 0
                          ? formatCompactNumber(xPreview.followers)
                          : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--sf-text-muted)] truncate">
                    {xPreview.name}
                    {xPreview.description ? ` · ${xPreview.description}` : ''}
                  </p>
                </button>
              ) : (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitXAccount(cleanXQuery);
                  }}
                  className="w-full text-left px-3 py-2.5 text-[12px] text-[var(--sf-text-secondary)] hover:bg-[var(--sf-hover)] transition-colors"
                >
                  Add <span className="font-medium text-[var(--sf-text)]">@{cleanXQuery}</span>
                </button>
              )}
            </div>
          )}

          {/* X Topic Suggestions Dropdown */}
          {showDropdown && addMode === 'topic' && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[var(--sf-surface-elevated)] border border-[var(--sf-border)] rounded-md shadow-xl overflow-hidden glass:backdrop-blur-2xl">
              {cleanTopicQuery.length >= 1 && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitXTopic(cleanTopicQuery);
                  }}
                  className="w-full text-left px-3 py-2.5 text-[12px] text-[var(--sf-text-secondary)] hover:bg-[var(--sf-hover)] border-b border-[var(--sf-border-subtle)] transition-colors"
                >
                  Follow topic{' '}
                  <span className="font-medium text-[var(--sf-text)]">#{cleanTopicQuery}</span>
                </button>
              )}
              {matchingPopularTopics.length > 0 && (
                <ul className="divide-y divide-[var(--sf-border-subtle)] max-h-56 overflow-y-auto">
                  {matchingPopularTopics.map((topic) => {
                    const isAdded = xTopics.some(
                      (t) => t.toLowerCase() === topic.toLowerCase()
                    );
                    return (
                      <li key={topic}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commitXTopic(topic);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--sf-hover)] transition-colors"
                        >
                          <span className="text-[12.5px] font-medium text-[var(--sf-text)] truncate">
                            #{topic}
                          </span>
                          <span className="text-[11px] text-[var(--sf-text-muted)] shrink-0">
                            {isAdded ? 'added' : 'topic'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </form>
      </div>

      {/* Scrollable Accordions: Subreddits + X Accounts */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Subreddits Accordion */}
        <section>
          <button
            type="button"
            onClick={() => setSubredditsOpen((prev) => !prev)}
            aria-expanded={subredditsOpen}
            className="w-full px-3 py-1.5 flex items-center justify-between rounded-md text-[11.5px] font-medium text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  subredditsOpen ? 'rotate-0' : '-rotate-90'
                }`}
              />
              <span>Subreddits</span>
            </span>
            <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)]/75">
              {subreddits.length}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {subredditsOpen && (
              <motion.div
                key="subreddits-accordion"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                {subreddits.length === 0 ? (
                  <p className="px-3 py-2 text-[11.5px] leading-relaxed text-[var(--sf-text-muted)]">
                    No subreddits yet.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {subreddits.map((sub) => {
                      const isActive =
                        activeView.type === 'subreddit' &&
                        activeView.name.toLowerCase() === sub.toLowerCase();

                      return (
                        <li key={sub} className="group relative flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectView({ type: 'subreddit', name: sub });
                              onCloseMobile();
                            }}
                            className={`w-full text-left pl-3 pr-9 py-1.5 text-[13px] rounded-md transition-colors truncate ${
                              isActive
                                ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                                : 'text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)]'
                            }`}
                          >
                            <span
                              className={
                                isActive
                                  ? 'text-[var(--sf-accent)]'
                                  : 'text-[var(--sf-text-muted)]/75'
                              }
                            >
                              r/
                            </span>
                            {sub}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveSubreddit(sub);
                            }}
                            aria-label={`Remove r/${sub}`}
                            title={`Remove r/${sub}`}
                            className="absolute right-1.5 p-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* X Accounts Accordion */}
        <section>
          <button
            type="button"
            onClick={() => setXAccountsOpen((prev) => !prev)}
            aria-expanded={xAccountsOpen}
            className="w-full px-3 py-1.5 flex items-center justify-between rounded-md text-[11.5px] font-medium text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  xAccountsOpen ? 'rotate-0' : '-rotate-90'
                }`}
              />
              <span>X Accounts</span>
            </span>
            <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)]/75">
              {xAccounts.length}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {xAccountsOpen && (
              <motion.div
                key="x-accounts-accordion"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                {xAccounts.length === 0 ? (
                  <p className="px-3 py-2 text-[11.5px] leading-relaxed text-[var(--sf-text-muted)]">
                    Type @handle above to follow X accounts.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {xAccounts.map((handle) => {
                      const isActive =
                        activeView.type === 'x' &&
                        activeView.handle.toLowerCase() === handle.toLowerCase();

                      return (
                        <li key={handle} className="group relative flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectView({ type: 'x', handle });
                              onCloseMobile();
                            }}
                            className={`w-full text-left pl-3 pr-9 py-1.5 text-[13px] rounded-md transition-colors truncate ${
                              isActive
                                ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                                : 'text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)]'
                            }`}
                          >
                            <span
                              className={
                                isActive
                                  ? 'text-[var(--sf-accent)]'
                                  : 'text-[var(--sf-text-muted)]/75'
                              }
                            >
                              @
                            </span>
                            {handle}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveXAccount(handle);
                            }}
                            aria-label={`Remove @${handle}`}
                            title={`Remove @${handle}`}
                            className="absolute right-1.5 p-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* X Topics Accordion */}
        <section>
          <button
            type="button"
            onClick={() => setXTopicsOpen((prev) => !prev)}
            aria-expanded={xTopicsOpen}
            className="w-full px-3 py-1.5 flex items-center justify-between rounded-md text-[11.5px] font-medium text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  xTopicsOpen ? 'rotate-0' : '-rotate-90'
                }`}
              />
              <span>X Topics</span>
            </span>
            <span className="text-[11px] tabular-nums text-[var(--sf-text-muted)]/75">
              {xTopics.length}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {xTopicsOpen && (
              <motion.div
                key="x-topics-accordion"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                {xTopics.length === 0 ? (
                  <p className="px-3 py-2 text-[11.5px] leading-relaxed text-[var(--sf-text-muted)]">
                    Type #topic above to follow Nitter search topics.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {xTopics.map((topic) => {
                      const isActive =
                        activeView.type === 'topic' &&
                        activeView.topic.toLowerCase() === topic.toLowerCase();

                      return (
                        <li key={topic} className="group relative flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectView({ type: 'topic', topic });
                              onCloseMobile();
                            }}
                            className={`w-full text-left pl-3 pr-9 py-1.5 text-[13px] rounded-md transition-colors truncate ${
                              isActive
                                ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                                : 'text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)]'
                            }`}
                          >
                            <span
                              className={
                                isActive
                                  ? 'text-[var(--sf-accent)]'
                                  : 'text-[var(--sf-text-muted)]/75'
                              }
                            >
                              #
                            </span>
                            {topic}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveXTopic(topic);
                            }}
                            aria-label={`Remove #${topic}`}
                            title={`Remove #${topic}`}
                            className="absolute right-1.5 p-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Profile Account Row */}
      <div className="px-3 py-2.5 border-t border-[var(--sf-border)] shrink-0">
        <button
          type="button"
          onClick={() => {
            onOpenProfile();
            onCloseMobile();
          }}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-[var(--sf-hover)] transition-colors"
          aria-label={user ? 'Open profile' : 'Sign in with Google'}
        >
          {user?.photoURL && !avatarFailed ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'Profile'}
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="w-6 h-6 rounded-full object-cover border border-[var(--sf-border)] shrink-0"
            />
          ) : user ? (
            <span className="w-6 h-6 rounded-full bg-[var(--sf-active)] border border-[var(--sf-border)] flex items-center justify-center text-[11px] font-semibold text-[var(--sf-text)] shrink-0">
              {userInitial}
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full bg-[var(--sf-surface)] border border-[var(--sf-border)] flex items-center justify-center text-[var(--sf-text-muted)] shrink-0">
              <UserIcon className="w-3.5 h-3.5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-medium text-[var(--sf-text)] truncate">
              {user ? user.displayName || user.email || 'Account' : 'Profile'}
            </span>
            <span className="block text-[10.5px] text-[var(--sf-text-muted)] truncate">
              {user ? 'Synced with Google' : 'Sign in with Google'}
            </span>
          </span>
        </button>
      </div>

      {/* Quiet Footer Utilities */}
      <div className="px-4 py-2.5 border-t border-[var(--sf-border)] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            onOpenSettings();
            onCloseMobile();
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] rounded-md hover:bg-[var(--sf-hover)] transition-colors whitespace-nowrap"
          aria-label="Open settings"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onOpenShortcuts();
            onCloseMobile();
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] rounded-md hover:bg-[var(--sf-hover)] transition-colors whitespace-nowrap"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="w-3.5 h-3.5" />
          <span>Keys</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Permanent / Collapsible Rail */}
      {isDesktopOpen && (
        <div className="hidden lg:block h-full shrink-0">{content}</div>
      )}

      {/* Mobile Slide-Over Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
