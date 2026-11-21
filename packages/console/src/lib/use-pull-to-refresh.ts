"use client";

import type { TouchEvent } from "react";
import { useCallback, useRef, useState } from "react";

const THRESHOLD = 56;

export function usePullToRefresh(onRefresh: () => Promise<unknown> | unknown) {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const pulling = useRef(false);

  const setPull = useCallback((value: number) => {
    distanceRef.current = value;
    setDistance(value);
  }, []);

  const onTouchStart = useCallback(
    (event: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) return;
      startY.current = event.touches[0]?.clientY ?? null;
      pulling.current = false;
    },
    [refreshing],
  );

  const onTouchMove = useCallback(
    (event: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = (event.touches[0]?.clientY ?? 0) - startY.current;
      if (delta <= 0 || window.scrollY > 0) {
        pulling.current = false;
        setPull(0);
        return;
      }
      pulling.current = true;
      setPull(Math.min(88, delta * 0.45));
    },
    [refreshing, setPull],
  );

  const onTouchEnd = useCallback(async () => {
    const shouldRefresh = pulling.current && distanceRef.current >= THRESHOLD;
    startY.current = null;
    pulling.current = false;
    if (!shouldRefresh) {
      setPull(0);
      return;
    }
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The caller owns error presentation; reset the indicator regardless.
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, [onRefresh, setPull]);

  return {
    distance,
    refreshing,
    pullHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
