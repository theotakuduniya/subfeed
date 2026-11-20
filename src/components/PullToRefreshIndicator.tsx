import React from 'react';
import { motion } from 'motion/react';
import { ArrowDown, Loader2 } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  progress: number;
  isPulling: boolean;
  isReady: boolean;
  isRefreshing: boolean;
  holdHeight?: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  progress,
  isPulling,
  isReady,
  isRefreshing,
  holdHeight = 48,
}: PullToRefreshIndicatorProps) {
  const activeOffset = isRefreshing ? holdHeight : pullDistance;
  const isVisible = activeOffset > 1;
  const indicatorY = Math.max(-holdHeight, (activeOffset - holdHeight) / 2);
  const opacity = isRefreshing ? 1 : Math.min(1, progress * 1.2);

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 right-0 z-10 overflow-hidden"
      aria-live="polite"
      aria-hidden={!isVisible}
    >
      {/* Top 1px hairline progress rule */}
      <motion.div
        initial={false}
        animate={{
          scaleX: isRefreshing ? 1 : progress,
          opacity: isVisible ? 1 : 0,
        }}
        transition={
          isPulling
            ? { duration: 0 }
            : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }
        }
        className={`h-[1.5px] w-full origin-center ${
          isReady || isRefreshing
            ? 'bg-[var(--sf-accent)]'
            : 'bg-[var(--sf-border-strong)]'
        }`}
      />

      {/* Centered minimal status cue */}
      <motion.div
        initial={false}
        animate={{
          y: isVisible ? indicatorY : -holdHeight,
          opacity: isVisible ? opacity : 0,
        }}
        transition={
          isPulling
            ? { duration: 0 }
            : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
        }
        className="h-12 flex items-center justify-center gap-2 text-[11.5px] tracking-tight"
      >
        {isRefreshing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--sf-accent)]" />
            <span className="text-[var(--sf-text-secondary)]">Refreshing feed...</span>
          </>
        ) : (
          <>
            <motion.span
              initial={false}
              animate={{ rotate: isReady ? 180 : 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className={`inline-flex ${
                isReady
                  ? 'text-[var(--sf-accent)]'
                  : 'text-[var(--sf-text-muted)]'
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </motion.span>
            <span
              className={
                isReady
                  ? 'text-[var(--sf-text)] font-medium'
                  : 'text-[var(--sf-text-muted)]'
              }
            >
              {isReady ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </>
        )}
      </motion.div>
    </div>
  );
}
