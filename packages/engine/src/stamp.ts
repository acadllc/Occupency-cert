import type { SlotGeometry, StampItem } from './types';

/** Stamp centre/size in top-left page coordinates (size = image width). */
export function stampBox(slot: SlotGeometry, item: StampItem) {
  const [x0, y0, x1, y1] = slot.rect;
  const s = item.stamp;
  if (s.anchor === 'right') {
    // beside the slot text (e.g. to the right of the word "الاستشاري"), vertically centred on it
    return { cx: x1 + s.size / 2 + (s.dx ?? 0), cy: (y0 + y1) / 2 + (s.dy ?? 0), size: s.size };
  }
  if (s.anchor === 'below') {
    // under the slot text (e.g. under the word "الاستشاري"); the stamp & signature image is about as tall as wide
    return { cx: (x0 + x1) / 2 + (s.dx ?? 0), cy: y1 + s.size * 0.52 + (s.dy ?? 0), size: s.size };
  }
  if (s.anchor === 'marker') {
    return { cx: x1 + (s.dx ?? 0), cy: (slot.baseline ?? (y0 + y1) / 2) + (s.dy ?? 0), size: s.size };
  }
  return { cx: (x0 + x1) / 2 + (s.dx ?? 0), cy: (y0 + y1) / 2 + (s.dy ?? 0), size: s.size };
}

