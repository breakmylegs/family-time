/**
 * Pins a sheet or panel where it is on screen right now, before Radix starts its exit. The exit
 * keyframes only have a `to`, so they start from the element's own transform: without this, closing
 * mid-entrance or at the end of a swipe would jump to fully open first, then slide out.
 */
export function pinInPlace(el: HTMLElement | null): void {
  if (!el) return;
  const now = getComputedStyle(el);
  el.style.transform = now.transform === 'none' ? '' : now.transform;
  el.style.opacity = now.opacity;
}
