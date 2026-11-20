import React, { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from 'motion/react';
import {
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  X,
} from 'lucide-react';
import type {
  CommentSortOption,
  RedditComment,
  RedditPost,
} from '../types/reddit';
import {
  fetchPostComments,
  formatCompactNumber,
  formatRelativeTime,
} from '../lib/reddit';
import { fetchXTweet } from '../lib/x';
import {
  fetchYoutubeVideo,
  formatVideoDuration,
  sanitizeYoutubeVideoId,
} from '../lib/youtube';
import { MarkdownText } from './MarkdownText';

interface ThreadDrawerProps {
  post: RedditPost | null;
  isSaved: boolean;
  switchingInstance?: boolean;
  onClose: () => void;
  onToggleSave: (post: RedditPost) => void;
  onSelectSubreddit: (name: string) => void;
  onSelectXAccount: (handle: string) => void;
  onSelectYoutubeChannel: (handle: string) => void;
  onSwitchNitterInstance?: () => Promise<void>;
}

const COMMENT_SORTS: { value: CommentSortOption; label: string }[] = [
  { value: 'best', label: 'Best' },
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'New' },
  { value: 'controversial', label: 'Controversial' },
];

const YOUTUBE_COMMENT_SORTS: { value: CommentSortOption; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'Newest' },
];

function CommentNode({
  comment,
  isX,
  isYouTube,
}: {
  comment: RedditComment;
  isX: boolean;
  isYouTube: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={comment.depth > 0 ? 'pl-4 sm:pl-5 mt-3' : 'py-4'}>
      <div className="flex items-center gap-2 text-[11.5px] text-[var(--sf-text-muted)]">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand comment' : 'Collapse comment'}
          className="p-0.5 -ml-1 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] rounded transition-colors"
        >
          {collapsed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
        </button>

        <span
          className={`font-medium ${
            comment.isSubmitter
              ? 'text-[var(--sf-accent)]'
              : 'text-[var(--sf-text)]'
          }`}
        >
          {isX || isYouTube ? `@${comment.author}` : `u/${comment.author}`}
        </span>
        {comment.isSubmitter && (
          <span className="text-[11px] text-[var(--sf-accent)]">
            {isYouTube ? 'Creator' : 'OP'}
          </span>
        )}
        {comment.distinguished === 'moderator' && (
          <span className="text-[11px] text-emerald-700 dark:text-emerald-500 mocha:text-[#a6e3a1]">MOD</span>
        )}
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">
          {formatCompactNumber(comment.score)} {isX || isYouTube ? 'likes' : 'pts'}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatRelativeTime(comment.createdUtc)}</span>
      </div>

      {!collapsed && (
        <div className="mt-1.5 pl-4 border-l border-[var(--sf-border-subtle)]">
          <MarkdownText content={comment.body} className="text-[13px] leading-[1.65]" />
          {comment.replies.length > 0 && (
            <div className="mt-2">
              {comment.replies.map((reply) => (
                <CommentNode
                  key={reply.id}
                  comment={reply}
                  isX={isX}
                  isYouTube={isYouTube}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ThreadDrawer({
  post,
  isSaved,
  switchingInstance = false,
  onClose,
  onToggleSave,
  onSelectSubreddit,
  onSelectXAccount,
  onSelectYoutubeChannel,
  onSwitchNitterInstance,
}: ThreadDrawerProps) {
  const [commentSort, setCommentSort] = useState<CommentSortOption>('best');
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [resolvedPost, setResolvedPost] = useState<RedditPost | null>(post);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ytCommentsDisabled, setYtCommentsDisabled] = useState(false);
  const [ytApiKeyConfigured, setYtApiKeyConfigured] = useState(true);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Smooth GPU-accelerated drag offset for mobile pull-down-to-close
  const sheetY = useMotionValue(0);
  const backdropOpacity = useTransform(sheetY, [0, 320], [1, 0.25]);

  useEffect(() => {
    if (post) {
      setResolvedPost(post);
      setGalleryIndex(0);
      setImageError(false);
      setError(null);
      setYtCommentsDisabled(false);
      setYtApiKeyConfigured(true);
      setDescriptionExpanded(false);
      if (post.source === 'youtube' && commentSort !== 'new' && commentSort !== 'top') {
        setCommentSort('top');
      }
      sheetY.set(0);
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    }
  }, [post, sheetY]);

  // Small-screen pull-down gesture on the open post sheet to dismiss it
  useEffect(() => {
    if (!post) return;
    const sheetEl = sheetRef.current;
    if (!sheetEl) return;

    let startY = 0;
    let startX = 0;
    let startTime = 0;
    let eligible = false;
    let dragging = false;
    let currentDragY = 0;

    const isSmallScreen = () => window.innerWidth < 768;

    const handleTouchStart = (e: TouchEvent) => {
      if (!isSmallScreen() || e.touches.length !== 1) {
        eligible = false;
        return;
      }
      const touch = e.touches[0];
      const target = e.target as Node | null;
      const inHeader = Boolean(headerRef.current && target && headerRef.current.contains(target));
      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;

      // Eligible if grabbing top handle/header, or when scrolled to top of post
      if (inHeader || scrollTop <= 1) {
        startY = touch.clientY;
        startX = touch.clientX;
        startTime = Date.now();
        eligible = true;
        dragging = false;
        currentDragY = 0;
      } else {
        eligible = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!eligible || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaY = touch.clientY - startY;
      const deltaX = touch.clientX - startX;

      if (!dragging) {
        // Cancel gesture if swiping horizontally (e.g. gallery) or scrolling down into content
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
          eligible = false;
          return;
        }
        if (deltaY < -4) {
          eligible = false;
          return;
        }
        if (deltaY > 8) {
          const target = e.target as Node | null;
          const inHeader = Boolean(
            headerRef.current && target && headerRef.current.contains(target)
          );
          const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
          if (!inHeader && scrollTop > 1) {
            eligible = false;
            return;
          }
          dragging = true;
        } else {
          return;
        }
      }

      if (dragging) {
        e.preventDefault();
        currentDragY = Math.max(0, deltaY);
        sheetY.set(currentDragY);
      }
    };

    const finishDrag = () => {
      if (!dragging) {
        eligible = false;
        return;
      }
      dragging = false;
      eligible = false;

      const elapsed = Math.max(1, Date.now() - startTime);
      const velocity = currentDragY / elapsed; // px per ms
      const shouldClose = currentDragY > 110 || (currentDragY > 45 && velocity > 0.45);

      if (shouldClose) {
        onCloseRef.current();
      } else {
        animate(sheetY, 0, {
          type: 'spring',
          stiffness: 480,
          damping: 38,
        });
      }
      currentDragY = 0;
    };

    sheetEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    sheetEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    sheetEl.addEventListener('touchend', finishDrag, { passive: true });
    sheetEl.addEventListener('touchcancel', finishDrag, { passive: true });

    return () => {
      sheetEl.removeEventListener('touchstart', handleTouchStart);
      sheetEl.removeEventListener('touchmove', handleTouchMove);
      sheetEl.removeEventListener('touchend', finishDrag);
      sheetEl.removeEventListener('touchcancel', finishDrag);
    };
  }, [post, sheetY]);

  useEffect(() => {
    if (!post) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [post]);

  useEffect(() => {
    if (!post) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    if (post.source === 'youtube') {
      const videoId = sanitizeYoutubeVideoId(post.videoId || post.id);
      fetchYoutubeVideo({
        videoId,
        sort: commentSort === 'new' ? 'new' : 'top',
        forceRefresh: reloadNonce > 0,
        signal: controller.signal,
      })
        .then((res) => {
          if (controller.signal.aborted) return;
          setComments(res.comments);
          setYtCommentsDisabled(Boolean(res.commentsDisabled));
          setYtApiKeyConfigured(res.apiKeyConfigured !== false);
          const fetchedPost = res.post;
          if (fetchedPost) {
            setResolvedPost((prev) =>
              prev
                ? {
                    ...prev,
                    ...fetchedPost,
                    // Keep original handle if channel lookup already resolved it nicely
                    author: prev.author || fetchedPost.author,
                    subreddit: prev.subreddit || fetchedPost.subreddit,
                    flair: prev.flair ?? fetchedPost.flair,
                  }
                : fetchedPost
            );
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : 'Unable to load YouTube comments.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });

      return () => controller.abort();
    }

    const request =
      post.source === 'x'
        ? fetchXTweet({
            handle: post.author,
            postId: post.id,
            forceRefresh: reloadNonce > 0,
            signal: controller.signal,
          })
        : fetchPostComments({
            permalink: post.permalink,
            postId: post.id,
            sort: commentSort,
            signal: controller.signal,
          });

    request
      .then((res) => {
        if (controller.signal.aborted) return;
        setComments(res.comments);
        if (res.post) {
          setResolvedPost((prev) => (prev ? { ...prev, ...res.post } : res.post!));
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load replies.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [post?.id, post?.permalink, post?.source, post?.author, post?.videoId, commentSort, reloadNonce]);

  const activePost = post ? resolvedPost || post : null;
  const isX = activePost?.source === 'x';
  const isYouTube = activePost?.source === 'youtube';
  const youtubeVideoId = isYouTube
    ? sanitizeYoutubeVideoId(activePost?.videoId || activePost?.id)
    : '';
  const youtubeDurationLabel = isYouTube
    ? formatVideoDuration(activePost?.durationSeconds)
    : null;
  const externalPostUrl = activePost
    ? isYouTube
      ? activePost.url || (youtubeVideoId ? `https://www.youtube.com/watch?v=${youtubeVideoId}` : '')
      : isX
        ? activePost.url
        : `https://www.reddit.com${activePost.permalink}`
    : '';
  const isExternalLink = Boolean(
    activePost &&
      !isX &&
      !isYouTube &&
      !activePost.isSelf &&
      !activePost.domain.startsWith('self.')
  );
  const mediaImages = activePost
    ? activePost.galleryImages.length > 0
      ? activePost.galleryImages
      : activePost.previewImage
        ? [activePost.previewImage]
        : []
    : [];
  const currentImage = mediaImages[galleryIndex] || null;

  return (
    <AnimatePresence>
      {activePost && (
        <motion.div
          key="thread-bottom-sheet"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-end justify-center pt-6 sm:pt-10 px-0 sm:px-4"
          role="dialog"
          aria-modal="true"
          aria-label={activePost.title}
        >
          {/* Backdrop */}
          <motion.div
            style={{ opacity: backdropOpacity }}
            className="fixed inset-0 bg-black/55 dark:bg-black/75 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Dribbble-style Bottom Slide-Up Sheet with Mobile Pull-Down Dismiss */}
          <motion.div
            ref={sheetRef}
            style={{ y: sheetY }}
            className="relative z-10 w-full max-w-[940px] h-full flex flex-col"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="w-full h-full bg-[var(--sf-sheet)] border-t border-x border-[var(--sf-border)] rounded-t-2xl flex flex-col shadow-2xl overflow-hidden glass:backdrop-blur-2xl glass:shadow-[0_-16px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.16)]"
            >
              {/* Sticky Sheet Header & Mobile Pull Handle */}
              <div
                ref={headerRef}
                className="border-b border-[var(--sf-border)] shrink-0 touch-none md:touch-auto"
              >
                {/* Mobile Pull-Down Grab Handle */}
                <div
                  className="md:hidden pt-2.5 pb-1 flex justify-center"
                  aria-hidden="true"
                >
                  <span className="w-10 h-1 rounded-full bg-[var(--sf-border-strong)] opacity-75" />
                </div>

                <div className="h-12 md:h-14 px-3.5 sm:px-7 flex items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-center gap-1.5 sm:gap-2 text-[12px] sm:text-[12.5px] text-[var(--sf-text-muted)] min-w-0">
                {isYouTube ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectYoutubeChannel(activePost.subreddit || activePost.author);
                        onClose();
                      }}
                      className="font-medium text-[var(--sf-text)] hover:text-[var(--sf-accent)] transition-colors whitespace-nowrap shrink-0"
                    >
                      yt/@{activePost.author}
                    </button>
                    {activePost.channelTitle &&
                      activePost.channelTitle.toLowerCase() !==
                        activePost.author.toLowerCase() && (
                        <>
                          <span aria-hidden="true" className="hidden sm:inline">·</span>
                          <span className="hidden sm:inline truncate">
                            {activePost.channelTitle}
                          </span>
                        </>
                      )}
                  </>
                ) : isX ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectXAccount(activePost.subreddit || activePost.author);
                        onClose();
                      }}
                      className="font-medium text-[var(--sf-text)] hover:text-[var(--sf-accent)] transition-colors whitespace-nowrap shrink-0"
                    >
                      @{activePost.author}
                    </button>
                    {activePost.authorName &&
                      activePost.authorName.toLowerCase() !==
                        activePost.author.toLowerCase() && (
                        <>
                          <span aria-hidden="true" className="hidden sm:inline">·</span>
                          <span className="hidden sm:inline truncate">{activePost.authorName}</span>
                        </>
                      )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectSubreddit(activePost.subreddit);
                        onClose();
                      }}
                      className="font-medium text-[var(--sf-text)] hover:text-[var(--sf-accent)] transition-colors whitespace-nowrap shrink-0"
                    >
                      r/{activePost.subreddit}
                    </button>
                    <span aria-hidden="true" className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline truncate">u/{activePost.author}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="tabular-nums whitespace-nowrap shrink-0">
                  {formatRelativeTime(activePost.createdUtc)}
                </span>
              </div>

              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onToggleSave(activePost)}
                  aria-label={isSaved ? 'Remove from saved' : 'Save post'}
                  className={`inline-flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 text-[12px] rounded-md transition-colors whitespace-nowrap ${
                    isSaved
                      ? 'text-[var(--sf-accent)] bg-[var(--sf-accent-soft)]'
                      : 'text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)]'
                  }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
                  <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
                </button>

                <a
                  href={externalPostUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={
                    isYouTube
                      ? 'Open on YouTube'
                      : isX
                        ? 'Open on X'
                        : 'Open on Reddit'
                  }
                  className="inline-flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 text-[12px] text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] rounded-md hover:bg-[var(--sf-hover)] transition-colors whitespace-nowrap"
                >
                  <span className="hidden sm:inline">
                    {isYouTube ? 'YouTube' : isX ? 'X' : 'Reddit'}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                </a>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close thread"
                  className="p-2 sm:p-1.5 text-[var(--sf-text)] sm:text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] bg-[var(--sf-surface)] sm:bg-transparent border border-[var(--sf-border)] sm:border-transparent rounded-md hover:bg-[var(--sf-hover)] transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
                </div>
              </div>

              {/* Scrollable Thread Body */}
              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto overscroll-y-contain px-4 sm:px-8 py-6 sm:py-7"
              >
              <div className="max-w-[740px] mx-auto w-full">
                {/* Inline YouTube Player at top of drawer */}
                {isYouTube && youtubeVideoId && (
                  <div className="mb-5 aspect-video w-full rounded-lg overflow-hidden border border-[var(--sf-border)] bg-black shadow-lg">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}?rel=0&modestbranding=1`}
                      title={activePost.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                      className="w-full h-full border-0"
                    />
                  </div>
                )}

                {/* Post Title & Stats */}
                <header className="pb-5 border-b border-[var(--sf-border)]">
                  <h1 className="text-[19px] sm:text-[22px] font-semibold leading-snug text-[var(--sf-text)] [text-wrap:balance]">
                    {activePost.title}
                  </h1>

                  <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[var(--sf-text-muted)] tabular-nums">
                    {isYouTube ? (
                      <>
                        {(activePost.views ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-[var(--sf-text)] font-medium">
                            <Play className="w-3 h-3 fill-current text-[var(--sf-accent)]" />
                            {formatCompactNumber(activePost.views!)} views
                          </span>
                        )}
                        {activePost.score > 0 && (
                          <>
                            {(activePost.views ?? 0) > 0 && <span aria-hidden="true">·</span>}
                            <span className="inline-flex items-center gap-1">
                              <Heart className="w-3.5 h-3.5 text-[var(--sf-accent)]" />
                              {formatCompactNumber(activePost.score)} likes
                            </span>
                          </>
                        )}
                        {activePost.numComments > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatCompactNumber(activePost.numComments)} comments</span>
                          </>
                        )}
                        {youtubeDurationLabel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{youtubeDurationLabel}</span>
                          </>
                        )}
                        {activePost.isShort && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Short</span>
                          </>
                        )}
                        {activePost.flair && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{activePost.flair}</span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 text-[var(--sf-text)] font-medium">
                          {isX ? (
                            <Heart className="w-3.5 h-3.5 text-[var(--sf-accent)]" />
                          ) : (
                            <ArrowUp className="w-3.5 h-3.5 text-[var(--sf-accent)]" />
                          )}
                          {formatCompactNumber(activePost.score)} {isX ? 'likes' : 'points'}
                        </span>

                        {isX && (activePost.reposts ?? 0) > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Repeat2 className="w-3.5 h-3.5 opacity-75" />
                              {formatCompactNumber(activePost.reposts!)} reposts
                            </span>
                          </>
                        )}

                        {!isX && activePost.upvoteRatio !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{Math.round(activePost.upvoteRatio * 100)}% upvoted</span>
                          </>
                        )}

                        <span aria-hidden="true">·</span>
                        <span>
                          {formatCompactNumber(activePost.numComments)}{' '}
                          {isX ? 'replies' : 'comments'}
                        </span>

                        {isX && (activePost.views ?? 0) > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatCompactNumber(activePost.views!)} views</span>
                          </>
                        )}

                        {activePost.flair && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{activePost.flair}</span>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {isExternalLink && (
                    <div className="mt-4">
                      <a
                        href={activePost.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-[12.5px] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] rounded-md text-[var(--sf-text)] transition-colors max-w-full"
                      >
                        <span className="truncate">{activePost.domain}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-[var(--sf-accent)]" />
                      </a>
                    </div>
                  )}
                </header>

                {/* Media Section (Reddit / X) */}
                {!isYouTube && activePost.isVideo && activePost.videoUrl ? (
                  <div className="mt-5 rounded-md overflow-hidden border border-[var(--sf-border)] bg-black">
                    <video
                      src={activePost.videoUrl}
                      controls
                      playsInline
                      className="w-full max-h-[540px] object-contain mx-auto"
                    />
                  </div>
                ) : !isYouTube && currentImage && !imageError ? (
                  <div className="mt-5">
                    <div className="rounded-md overflow-hidden border border-[var(--sf-border)] bg-[var(--sf-surface-muted)]">
                      <img
                        src={currentImage}
                        alt={activePost.title}
                        referrerPolicy="no-referrer"
                        onError={() => setImageError(true)}
                        className="w-full max-h-[580px] object-contain mx-auto"
                      />
                    </div>

                    {mediaImages.length > 1 && (
                      <div className="mt-2.5 flex items-center justify-between text-[12px] text-[var(--sf-text-muted)]">
                        <button
                          type="button"
                          disabled={galleryIndex === 0}
                          onClick={() => setGalleryIndex((i) => Math.max(0, i - 1))}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--sf-border)] disabled:opacity-35 hover:text-[var(--sf-text)] transition-colors"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Prev</span>
                        </button>
                        <span className="tabular-nums">
                          {galleryIndex + 1} / {mediaImages.length}
                        </span>
                        <button
                          type="button"
                          disabled={galleryIndex === mediaImages.length - 1}
                          onClick={() =>
                            setGalleryIndex((i) => Math.min(mediaImages.length - 1, i + 1))
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--sf-border)] disabled:opacity-35 hover:text-[var(--sf-text)] transition-colors"
                        >
                          <span>Next</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Quoted X Post */}
                {activePost.quotedPost && (
                  <a
                    href={activePost.quotedPost.url || externalPostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-5 p-4 rounded-md border border-[var(--sf-border)] bg-[var(--sf-surface)] hover:border-[var(--sf-border-strong)] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--sf-text-muted)]">
                      <span>
                        <span className="font-medium text-[var(--sf-text)]">
                          @{activePost.quotedPost.author}
                        </span>
                        {activePost.quotedPost.authorName && (
                          <span> · {activePost.quotedPost.authorName}</span>
                        )}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--sf-text-secondary)] whitespace-pre-line">
                      {activePost.quotedPost.text}
                    </p>
                  </a>
                )}

                {/* Self Text / YouTube Description */}
                {activePost.selftext && (
                  <div className="mt-5 pb-6 border-b border-[var(--sf-border)]">
                    {isYouTube && activePost.selftext.length > 260 && !descriptionExpanded ? (
                      <>
                        <p className="text-[13px] leading-[1.65] text-[var(--sf-text-secondary)] whitespace-pre-line line-clamp-4">
                          {activePost.selftext}
                        </p>
                        <button
                          type="button"
                          onClick={() => setDescriptionExpanded(true)}
                          className="mt-2 text-[12px] font-medium text-[var(--sf-accent)] hover:underline underline-offset-4"
                        >
                          Show full description
                        </button>
                      </>
                    ) : (
                      <>
                        <MarkdownText content={activePost.selftext} />
                        {isYouTube && activePost.selftext.length > 260 && (
                          <button
                            type="button"
                            onClick={() => setDescriptionExpanded(false)}
                            className="mt-2 text-[12px] font-medium text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"
                          >
                            Collapse description
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

          {/* Comments / Replies Section */}
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--sf-border)]">
              <h2 className="text-[13px] font-medium text-[var(--sf-text)]">
                {isYouTube ? 'Top Comments' : isX ? 'Replies' : 'Discussion'}
              </h2>

              {!isX && (
                <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Sort comments">
                  {(isYouTube ? YOUTUBE_COMMENT_SORTS : COMMENT_SORTS).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="tab"
                      aria-selected={commentSort === opt.value}
                      onClick={() => setCommentSort(opt.value)}
                      className={`px-2 py-1 text-[11.5px] rounded transition-colors whitespace-nowrap ${
                        commentSort === opt.value
                          ? 'bg-[var(--sf-active)] text-[var(--sf-text)] font-medium'
                          : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loading ? (
              <div className="py-6 space-y-5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2 animate-pulse">
                    <div className="h-3 w-40 bg-[var(--sf-surface-muted)] rounded" />
                    <div className="h-3 w-full bg-[var(--sf-surface-muted)]/75 rounded" />
                    <div className="h-3 w-4/5 bg-[var(--sf-surface-muted)]/75 rounded" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="py-8 text-center">
                <p className="text-[13px] text-[var(--sf-text-muted)]">{error}</p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  {isX && onSwitchNitterInstance && (
                    <button
                      type="button"
                      disabled={switchingInstance}
                      onClick={async () => {
                        await onSwitchNitterInstance();
                        setReloadNonce((n) => n + 1);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[var(--sf-btn-active-bg)] text-[var(--sf-btn-active-text)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${switchingInstance ? 'animate-spin' : ''}`} />
                      <span>{switchingInstance ? 'Switching...' : 'Switch instance'}</span>
                    </button>
                  )}
                  <a
                    href={externalPostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--sf-accent)] hover:underline underline-offset-4"
                  >
                    <span>
                      Read discussion on {isYouTube ? 'YouTube' : isX ? 'X' : 'Reddit'}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ) : comments.length === 0 ? (
              <div className="py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[12.5px] text-[var(--sf-text-muted)]">
                <span>
                  {isYouTube
                    ? ytCommentsDisabled
                      ? 'Comments are disabled for this video.'
                      : !ytApiKeyConfigured
                        ? 'Add YOUTUBE_API_KEY in server environment variables to load YouTube comments inline.'
                        : 'No comments loaded yet.'
                    : isX
                      ? 'No public replies loaded via Nitter for this post.'
                      : 'No comments yet.'}
                </span>
                {(isX || isYouTube) && (
                  <a
                    href={externalPostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--sf-accent)] hover:underline underline-offset-4 whitespace-nowrap"
                  >
                    <span>{isYouTube ? 'View comments on YouTube' : 'View thread on X'}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <div className="divide-y divide-[var(--sf-border-subtle)]">
                {comments.map((comment) => (
                  <CommentNode
                    key={comment.id}
                    comment={comment}
                    isX={isX}
                    isYouTube={isYouTube}
                  />
                ))}
              </div>
            )}
          </section>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
