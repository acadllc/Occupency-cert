import type { SlotGeometry, StampItem } from './types';

/** Stamp centre/size in top-left page coordinates. */
export function stampBox(slot: SlotGeometry, item: StampItem) {
  const [x0, y0, x1, y1] = slot.rect;
  const s = item.stamp;
  if (s.anchor === 'marker') {
    return { cx: x1 + (s.dx ?? 0), cy: (slot.baseline ?? (y0 + y1) / 2) + (s.dy ?? 0), size: s.size };
  }
  return { cx: (x0 + x1) / 2 + (s.dx ?? 0), cy: (y0 + y1) / 2 + (s.dy ?? 0), size: s.size };
}

