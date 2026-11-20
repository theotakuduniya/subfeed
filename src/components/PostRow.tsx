import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, Bookmark, Heart, Play } from 'lucide-react';
import type { FeedDensity, RedditPost } from '../types/reddit';
import { formatCompactNumber, formatRelativeTime } from '../lib/reddit';
import { formatVideoDuration } from '../lib/youtube';

interface PostRowProps {
  post: RedditPost;
  density: FeedDensity;
  showSubreddit: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isSaved: boolean;
  isRead: boolean;
  onOpen: (post: RedditPost) => void;
  onSelectSubreddit: (name: string) => void;
  onSelectXAccount: (handle: string) => void;
  onSelectYoutubeChannel: (handle: string) => void;
  onToggleSave: (post: RedditPost) => void;
}

export function PostRow({
  post,
  density,
  showSubreddit,
  isSelected,
  isFocused,
  isSaved,
  isRead,
  onOpen,
  onSelectSubreddit,
  onSelectXAccount,
  onSelectYoutubeChannel,
  onToggleSave,
}: PostRowProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const isX = post.source === 'x';
  const isYouTube = post.source === 'youtube';
  const durationLabel = isYouTube ? formatVideoDuration(post.durationSeconds) : null;
  const showThumb = Boolean(post.thumbnail && !thumbFailed && !post.over18 && !post.spoiler);
  const cleanExcerpt =
    density === 'comfortable' && post.selftext
      ? post.selftext
          .replace(/[#>*_`~[\]]/g, '')
          .replace(/\(https?:\/\/[^)]+\)/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';

  const isExternalLink = !isX && !isYouTube && !post.isSelf && !post.domain.startsWith('self.');
  const mutedRead = isRead && !isSelected;
  const metricValue = isYouTube
    ? (post.views ?? 0) > 0
      ? post.views!
      : post.score
    : post.score;

  return (
    <motion.article
      onClick={() => onOpen(post)}
      whileHover={shouldReduceMotion ? undefined : { y: -1, scale: 1.004 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.998 }}
      transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.55 }}
      className={`group relative flex items-start gap-3 sm:gap-4 px-3.5 sm:px-6 cursor-pointer transition-[background-color,box-shadow,opacity,filter] duration-200 will-change-transform hover:z-10 hover:shadow-[0_4px_16px_-10px_rgba(0,0,0,0.18)] dark:hover:shadow-[0_6px_18px_-10px_rgba(0,0,0,0.55)] ${
        density === 'compact' ? 'py-3' : 'py-4'
      } ${
        isSelected
          ? 'bg-[var(--sf-active)]'
          : isFocused
            ? 'bg-[var(--sf-hover)]'
            : mutedRead
              ? 'bg-[var(--sf-surface-muted)]/40 opacity-65 hover:opacity-90 saturate-[0.3] hover:saturate-[0.75] hover:bg-[var(--sf-hover)]'
              : 'hover:bg-[var(--sf-hover)]'
      }`}
    >
      {/* Score / Likes / Views Column */}
      <div className="w-10 sm:w-14 pt-0.5 shrink-0 flex flex-col items-end text-right tabular-nums select-none">
        <span
          className={`inline-flex items-center gap-1 text-[12px] sm:text-[12.5px] font-medium ${
            mutedRead
              ? 'text-[var(--sf-text-muted)]'
              : (isYouTube ? metricValue >= 50_000 : metricValue >= 500)
                ? 'text-[var(--sf-accent)]'
                : 'text-[var(--sf-text-secondary)]'
          }`}
        >
          {isYouTube ? (
            <Play className="w-2.5 h-2.5 shrink-0 fill-current opacity-75" />
          ) : isX ? (
            <Heart className="w-2.5 h-2.5 shrink-0 opacity-75" />
          ) : (
            <ArrowUp className="w-3 h-3 shrink-0 opacity-75" />
          )}
          {formatCompactNumber(metricValue)}
        </span>
      </div>

      {/* Main Content Column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h2
            className={`${
              density === 'compact' ? 'text-[13.5px]' : 'text-[14.5px]'
            } font-medium leading-snug transition-colors break-words ${
              mutedRead ? 'text-[var(--sf-text-muted)]' : 'text-[var(--sf-text)]'
            }`}
          >
            {post.title}
          </h2>
        </div>

        {cleanExcerpt && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--sf-text-secondary)] line-clamp-2 max-w-[68ch]">
            {cleanExcerpt}
          </p>
        )}

        {/* Zero-Pill Clean Metadata Line */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--sf-text-muted)]">
          {isYouTube ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectYoutubeChannel(post.subreddit || post.author);
                }}
                className="text-[var(--sf-text-secondary)] hover:text-[var(--sf-accent)] transition-colors truncate max-w-[180px]"
              >
                yt/@{post.author}
              </button>
              {post.channelTitle &&
                post.channelTitle.toLowerCase() !== post.author.toLowerCase() && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate max-w-[160px]">{post.channelTitle}</span>
                  </>
                )}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatRelativeTime(post.createdUtc)}</span>
              {(post.views ?? 0) > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCompactNumber(post.views!)} views
                  </span>
                </>
              )}
              {post.score > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCompactNumber(post.score)} likes
                  </span>
                </>
              )}
              {post.numComments > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCompactNumber(post.numComments)} comments
                  </span>
                </>
              )}
              {durationLabel && (
                <>
                  <span aria-hidden="true" className="sm:hidden">·</span>
                  <span className="sm:hidden tabular-nums">{durationLabel}</span>
                </>
              )}
              {post.isShort && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[var(--sf-text-secondary)]">Short</span>
                </>
              )}
              {post.flair && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-zinc-400 dark:text-zinc-500 truncate max-w-[160px]">
                    {post.flair}
                  </span>
                </>
              )}
            </>
          ) : isX ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectXAccount(post.subreddit || post.author);
                }}
                className="text-[var(--sf-text-secondary)] hover:text-[var(--sf-accent)] transition-colors"
              >
                @{post.author}
              </button>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatRelativeTime(post.createdUtc)}</span>
              {post.numComments > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCompactNumber(post.numComments)}{' '}
                    {post.numComments === 1 ? 'reply' : 'replies'}
                  </span>
                </>
              )}
              {(post.reposts ?? 0) > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCompactNumber(post.reposts!)} reposts
                  </span>
                </>
              )}
              {(post.views ?? 0) > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {formatCompactNumber(post.views!)} views
                  </span>
                </>
              )}
              {post.flair && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-zinc-400 dark:text-zinc-500 truncate max-w-[180px]">
                    {post.flair}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              {showSubreddit && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSubreddit(post.subreddit);
                    }}
                    className="text-[var(--sf-text-secondary)] hover:text-[var(--sf-accent)] transition-colors"
                  >
                    r/{post.subreddit}
                  </button>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="truncate max-w-[140px]">u/{post.author}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatRelativeTime(post.createdUtc)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {formatCompactNumber(post.numComments)}{' '}
                {post.numComments === 1 ? 'comment' : 'comments'}
              </span>
              {isExternalLink && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-[var(--sf-text)] transition-colors truncate max-w-[180px]"
                  >
                    {post.domain}
                  </a>
                </>
              )}
              {post.flair && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-zinc-400 dark:text-zinc-500 truncate max-w-[160px]">
                    {post.flair}
                  </span>
                </>
              )}
              {post.stickied && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 dark:text-emerald-500">Pinned</span>
                </>
              )}
              {post.over18 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-red-600 dark:text-red-400 font-medium">NSFW</span>
                </>
              )}
              {post.spoiler && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-700 dark:text-amber-400">Spoiler</span>
                </>
              )}
            </>
          )}
          {isRead && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[var(--sf-text-muted)]">Read</span>
            </>
          )}
        </div>
      </div>

      {/* Right Thumbnail & Subtle Actions */}
      <div className="shrink-0 flex items-center gap-2 sm:gap-3 self-center">
        {showThumb && (
          <div
            className={`hidden sm:block relative rounded overflow-hidden bg-[var(--sf-surface-muted)] border border-[var(--sf-border)] shrink-0 ${
              isYouTube ? 'w-[88px] h-[50px]' : 'w-[68px] h-[50px]'
            }`}
          >
            <img
              src={post.thumbnail!}
              alt={`Preview for ${post.title}`}
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setThumbFailed(true)}
              className={`w-full h-full object-cover transition-[filter,opacity] duration-200 ${
                mutedRead
                  ? 'grayscale-[85%] opacity-75 group-hover:grayscale-[25%] group-hover:opacity-100'
                  : ''
              }`}
            />
            {isYouTube && (
              <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[9.5px] leading-none font-medium tabular-nums bg-black/80 text-zinc-100 rounded-sm">
                {durationLabel || (post.isShort ? 'Short' : 'YT')}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave(post);
            }}
            aria-label={isSaved ? 'Remove from saved' : 'Save post'}
            title={isSaved ? 'Remove from saved' : 'Save post'}
            className={`p-1.5 rounded transition-opacity transition-colors ${
              isSaved
                ? 'text-[var(--sf-accent)] opacity-100'
                : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] opacity-80 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
          </button>

          {(isExternalLink || isX || isYouTube) && (
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={
                isYouTube
                  ? 'Open video on YouTube'
                  : isX
                    ? 'Open post on X'
                    : `Open external link (${post.domain})`
              }
              title={
                isYouTube
                  ? 'Open on YouTube'
                  : isX
                    ? 'Open on X'
                    : `Open ${post.domain}`
              }
              className="p-1.5 rounded text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] opacity-80 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity transition-colors"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </motion.article>
  );
}
