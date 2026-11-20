import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Heart,
  MessageSquare,
  Play,
  Repeat2,
} from 'lucide-react';
import type { RedditPost } from '../types/reddit';
import { formatCompactNumber, formatRelativeTime } from '../lib/reddit';

interface PostCardProps {
  post: RedditPost;
  showSubreddit: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isSaved: boolean;
  isRead: boolean;
  onOpen: (post: RedditPost) => void;
  onSelectSubreddit: (name: string) => void;
  onSelectXAccount: (handle: string) => void;
  onToggleSave: (post: RedditPost) => void;
}

export function PostCard({
  post,
  showSubreddit,
  isSelected,
  isFocused,
  isSaved,
  isRead,
  onOpen,
  onSelectSubreddit,
  onSelectXAccount,
  onToggleSave,
}: PostCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const isX = post.source === 'x';
  const heroImage =
    !imageFailed && !post.over18 && !post.spoiler
      ? post.previewImage || post.galleryImages[0] || post.thumbnail
      : null;

  const cleanExcerpt = post.selftext
    ? post.selftext
        .replace(/[#>*_`~[\]]/g, '')
        .replace(/\(https?:\/\/[^)]+\)/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const isExternalLink = !isX && !post.isSelf && !post.domain.startsWith('self.');
  const galleryCount = post.galleryImages.length;
  const mutedRead = isRead && !isSelected;

  return (
    <motion.article
      onClick={() => onOpen(post)}
      whileHover={shouldReduceMotion ? undefined : { y: -2, scale: 1.008 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.996 }}
      transition={{ type: 'spring', stiffness: 460, damping: 32, mass: 0.6 }}
      className={`group rounded-lg border transition-[background-color,border-color,box-shadow,opacity,filter] duration-200 cursor-pointer overflow-hidden will-change-transform hover:shadow-[0_10px_28px_-14px_rgba(0,0,0,0.22)] dark:hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.65)] glass:backdrop-blur-xl glass:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] glass:hover:shadow-[0_14px_34px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.2)] ${
        isSelected
          ? 'bg-[var(--sf-active)] border-[var(--sf-border-strong)]'
          : isFocused
            ? 'bg-[var(--sf-surface)] border-[var(--sf-border-strong)]'
            : mutedRead
              ? 'bg-[var(--sf-surface-muted)]/70 border-[var(--sf-border-subtle)] opacity-65 hover:opacity-90 saturate-[0.3] hover:saturate-[0.75] hover:border-[var(--sf-border)]'
              : 'bg-[var(--sf-surface)] border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] glass:hover:bg-white/[0.085]'
      }`}
    >
      <div className="p-4 sm:p-5">
        {/* Top Metadata Line (Zero-Pill) */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--sf-text-muted)]">
          {isX ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectXAccount(post.subreddit || post.author);
                }}
                className="font-medium text-[var(--sf-text)] hover:text-[var(--sf-accent)] transition-colors"
              >
                @{post.author}
              </button>
              {post.authorName &&
                post.authorName.toLowerCase() !== post.author.toLowerCase() && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate max-w-[160px]">{post.authorName}</span>
                  </>
                )}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatRelativeTime(post.createdUtc)}</span>
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
                    className="font-medium text-[var(--sf-text)] hover:text-[var(--sf-accent)] transition-colors"
                  >
                    r/{post.subreddit}
                  </button>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="truncate max-w-[160px]">u/{post.author}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{formatRelativeTime(post.createdUtc)}</span>
              {post.flair && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-zinc-400 dark:text-zinc-500 truncate max-w-[180px]">
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

        {/* Title */}
        <h2
          className={`mt-2.5 text-[15.5px] font-semibold leading-snug transition-colors [text-wrap:balance] break-words ${
            mutedRead ? 'text-[var(--sf-text-muted)]' : 'text-[var(--sf-text)]'
          }`}
        >
          {post.title}
        </h2>

        {/* Text Excerpt */}
        {cleanExcerpt && (
          <p className="mt-2 text-[13px] leading-[1.65] text-[var(--sf-text-secondary)] line-clamp-3 max-w-[68ch]">
            {cleanExcerpt}
          </p>
        )}

        {/* Quoted X Post */}
        {post.quotedPost && (
          <div className="mt-3 p-3.5 rounded-md border border-[var(--sf-border)] bg-[var(--sf-surface-muted)]">
            <div className="text-[11.5px] text-[var(--sf-text-muted)]">
              <span className="font-medium text-[var(--sf-text)]">
                @{post.quotedPost.author}
              </span>
              {post.quotedPost.authorName && (
                <span> · {post.quotedPost.authorName}</span>
              )}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--sf-text-secondary)] line-clamp-3">
              {post.quotedPost.text}
            </p>
          </div>
        )}

        {/* Media Preview */}
        {heroImage && (
          <div className="relative mt-4 rounded-md overflow-hidden border border-[var(--sf-border-subtle)] bg-[var(--sf-surface-muted)]">
            <img
              src={heroImage}
              alt={post.title}
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setImageFailed(true)}
              className={`w-full max-h-[420px] object-contain mx-auto transition-[filter,opacity] duration-200 ${
                mutedRead
                  ? 'grayscale-[80%] opacity-80 group-hover:grayscale-[30%] group-hover:opacity-100'
                  : ''
              }`}
            />
            {(post.isVideo || galleryCount > 1) && (
              <div className="absolute bottom-2.5 right-2.5 px-2 py-1 text-[11px] font-medium bg-black/75 text-zinc-100 rounded tabular-nums flex items-center gap-1.5">
                {post.isVideo ? (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Video</span>
                  </>
                ) : (
                  <span>1 / {galleryCount}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer Metrics & Actions */}
        <div className="mt-4 pt-3 border-t border-[var(--sf-border-subtle)] flex items-center justify-between gap-4 text-[12px] text-[var(--sf-text-muted)]">
          <div className="flex items-center gap-4 tabular-nums min-w-0">
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                mutedRead
                  ? 'text-[var(--sf-text-muted)]'
                  : post.score >= 500
                    ? 'text-[var(--sf-accent)]'
                    : 'text-[var(--sf-text-secondary)]'
              }`}
            >
              {isX ? (
                <Heart className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ArrowUp className="w-3.5 h-3.5 shrink-0" />
              )}
              {formatCompactNumber(post.score)}
            </span>

            {isX && (post.reposts ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Repeat2 className="w-3.5 h-3.5 shrink-0 opacity-75" />
                {formatCompactNumber(post.reposts!)}
              </span>
            )}

            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-75" />
              {formatCompactNumber(post.numComments)}
            </span>

            {isX && (post.views ?? 0) > 0 && (
              <span className="hidden sm:inline text-[var(--sf-text-muted)]">
                {formatCompactNumber(post.views!)} views
              </span>
            )}

            {isExternalLink && (
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] transition-colors truncate max-w-[200px]"
              >
                <span className="truncate">{post.domain}</span>
                <ArrowUpRight className="w-3 h-3 shrink-0" />
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave(post);
            }}
            aria-label={isSaved ? 'Remove from saved' : 'Save post'}
            title={isSaved ? 'Remove from saved' : 'Save post'}
            className={`inline-flex items-center gap-1.5 px-2 py-1 -mr-1.5 rounded transition-colors shrink-0 ${
              isSaved
                ? 'text-[var(--sf-accent)]'
                : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
            <span className="text-[11.5px]">{isSaved ? 'Saved' : 'Save'}</span>
          </button>
        </div>
      </div>
    </motion.article>
  );
}
