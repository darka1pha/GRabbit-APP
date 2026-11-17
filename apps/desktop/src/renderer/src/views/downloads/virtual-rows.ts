// Windowed rendering: only the rows in view (plus overscan) are mounted.

import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { ROW_HEIGHT_COMFORTABLE, OVERSCAN_ROWS } from './model';

export function lowerBoundRow(offsets: number[], target: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function useVirtualVariableRows(
  container: RefObject<HTMLElement | null>,
  heights: number[]
): { start: number; end: number; topHeight: number; bottomHeight: number } {
  const offsets = useMemo(() => {
    const acc = new Array<number>(heights.length + 1);
    acc[0] = 0;
    for (let i = 0; i < heights.length; i++) {
      acc[i + 1] = acc[i] + heights[i];
    }
    return acc;
  }, [heights]);

  const count = heights.length;
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });

  useLayoutEffect(() => {
    const el = container.current;
    if (!el || count === 0) {
      setRange({ start: 0, end: 0 });
      return;
    }
    const update = () => {
      const top = el.scrollTop;
      const bottom = top + el.clientHeight;
      const start = Math.max(0, lowerBoundRow(offsets, top) - OVERSCAN_ROWS);
      const end = Math.min(count, lowerBoundRow(offsets, bottom) + 1 + OVERSCAN_ROWS);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [container, count, offsets]);

  const start = Math.min(range.start, count);
  const end = Math.min(Math.max(range.end, start), count);
  return {
    start,
    end,
    topHeight: offsets[start] ?? 0,
    bottomHeight: (offsets[count] ?? 0) - (offsets[end] ?? 0),
  };
}

/**
 * Which rows of a fixed-row-height list are in (or near) view. Only those are rendered; the
 * rest of the list is represented by two spacers of the right height.
 */
export function useVirtualRows(
  container: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number = ROW_HEIGHT_COMFORTABLE
): { start: number; end: number } {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const update = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - OVERSCAN_ROWS);
      const end = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + OVERSCAN_ROWS);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [container, count, rowHeight]);
  return { start: Math.min(range.start, count), end: Math.min(range.end, count) };
}
