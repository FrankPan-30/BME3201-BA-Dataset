import { useEffect, useRef } from 'react';

const selector = 'button:not(:disabled), .glass:not(.glass--plot), [data-spotlight-surface]';

export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let current: HTMLElement | null = null;
    let bounds: DOMRect | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;

    function clear() {
      cancelAnimationFrame(frame);
      frame = 0;
      current?.removeAttribute('data-spotlight');
      current = null;
      bounds = null;
    }

    function refreshBounds() {
      bounds = current ? current.getBoundingClientRect() : null;
    }

    function move(event: PointerEvent) {
      if (reducedMotion.matches || event.pointerType === 'touch') return;
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(selector)
        : null;
      if (target !== current) {
        clear();
        current = target;
        if (current) bounds = current.getBoundingClientRect();
      }
      if (!current) return;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (!current) return;
        const rect = bounds ?? (bounds = current.getBoundingClientRect());
        current.style.setProperty('--mx', (x - rect.left) + 'px');
        current.style.setProperty('--my', (y - rect.top) + 'px');
        if (!current.hasAttribute('data-spotlight')) current.setAttribute('data-spotlight', '');
      });
    }

    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', clear);
    window.addEventListener('scroll', refreshBounds, { passive: true, capture: true });
    window.addEventListener('resize', refreshBounds, { passive: true });
    reducedMotion.addEventListener('change', clear);
    return () => {
      clear();
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', clear);
      window.removeEventListener('scroll', refreshBounds, true);
      window.removeEventListener('resize', refreshBounds);
      reducedMotion.removeEventListener('change', clear);
    };
  }, []);

  return ref;
}
