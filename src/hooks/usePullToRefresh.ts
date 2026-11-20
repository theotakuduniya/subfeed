import { RefObject, useEffect, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  containerRef: RefObject<HTMLElement | null>;
  onRefresh: () => void;
  isRefreshing: boolean;
  disabled?: boolean;
  threshold?: number;
  maxPull?: number;
}

interface PullToRefreshState {
  pullDistance: number;
  progress: number;
  isPulling: boolean;
  isReady: boolean;
}

const DEAD_ZONE_PX = 8;

export function usePullToRefresh({
  containerRef,
  onRefresh,
  isRefreshing,
  disabled = false,
  threshold = 64,
  maxPull = 108,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const isRefreshingRef = useRef(isRefreshing);
  isRefreshingRef.current = isRefreshing;

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const pullDistanceRef = useRef(0);
  const trackingRef = useRef(false);
  const engagedRef = useRef(false);
  const crossedThresholdRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resetGesture = () => {
      trackingRef.current = false;
      engagedRef.current = false;
      crossedThresholdRef.current = false;
      pullDistanceRef.current = 0;
      setIsPulling(false);
      setPullDistance(0);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || isRefreshingRef.current) return;
      if (e.touches.length !== 1) return;
      if (el.scrollTop > 0) return;

      const touch = e.touches[0];
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      trackingRef.current = true;
      engagedRef.current = false;
      crossedThresholdRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!trackingRef.current) return;
      if (disabledRef.current || isRefreshingRef.current || e.touches.length !== 1) {
        resetGesture();
        return;
      }

      const touch = e.touches[0];
      const deltaX = touch.clientX - startXRef.current;
      const deltaY = touch.clientY - startYRef.current;

      if (!engagedRef.current) {
        if (el.scrollTop > 0) {
          trackingRef.current = false;
          return;
        }

        if (Math.abs(deltaY) < DEAD_ZONE_PX && Math.abs(deltaX) < DEAD_ZONE_PX) {
          return;
        }

        // Only engage if pulling cleanly downward rather than scrolling up or swiping sideways
        if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
          trackingRef.current = false;
          return;
        }

        engagedRef.current = true;
        setIsPulling(true);
      }

      if (deltaY <= DEAD_ZONE_PX) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      // Prevent native overscroll/rubber-band bounce while actively pulling
      if (e.cancelable) {
        e.preventDefault();
      }

      const effectiveDelta = deltaY - DEAD_ZONE_PX;
      // Smooth asymptotic resistance curve
      const damped = maxPull * (1 - Math.exp(-effectiveDelta / 150));
      const rounded = Math.round(damped * 10) / 10;

      pullDistanceRef.current = rounded;
      setPullDistance(rounded);

      const nowReady = rounded >= threshold;
      if (nowReady && !crossedThresholdRef.current) {
        crossedThresholdRef.current = true;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate(10);
          } catch {
            // Ignore vibration errors on unsupported contexts
          }
        }
      } else if (!nowReady && crossedThresholdRef.current) {
        crossedThresholdRef.current = false;
      }
    };

    const handleTouchEnd = () => {
      if (!trackingRef.current) return;

      const shouldRefresh =
        engagedRef.current &&
        pullDistanceRef.current >= threshold &&
        !disabledRef.current &&
        !isRefreshingRef.current;

      resetGesture();

      if (shouldRefresh) {
        onRefreshRef.current();
      }
    };

    const handleTouchCancel = () => {
      if (!trackingRef.current && !engagedRef.current) return;
      resetGesture();
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [containerRef, maxPull, threshold]);

  const progress = Math.min(1, pullDistance / threshold);
  const isReady = pullDistance >= threshold;

  return {
    pullDistance,
    progress,
    isPulling,
    isReady,
  };
}
