import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import type { WaveformTrack } from './baSignal';
import type { EmgColor } from './emgPalette';
import type { PoseClock, PoseTick } from './pose/poseClock';
import { extremaIndices } from './waveReduction';

type Props = {
  tracks: readonly { geometry: WaveformTrack | null; color: EmgColor }[];
  traceStart: number;
  traceWidth: number;
  clock: PoseClock;
  revealAt: (tick: PoseTick) => number;
};

function drawTrack(
  context: CanvasRenderingContext2D, track: WaveformTrack, color: EmgColor,
  x: number, y: number, width: number, height: number, density: number, styles: CSSStyleDeclaration,
) {
  const { raw, rms, peak, threshold } = track;
  const atX = (index: number) => x + index * width / raw.length;
  const baseline = y + height / 2;
  const sampleHeight = (value: number) => value / peak * height * 26 / 56;
  const atY = (value: number) => baseline - sampleHeight(value);
  const rawPath = new Path2D();
  const upper = new Path2D();
  const lower = new Path2D();
  const fill = new Path2D();

  let begun = false;
  for (const index of extremaIndices(raw, width * density)) {
    if (index < 0) { begun = false; continue; }
    const px = atX(index);
    const py = atY(raw[index]);
    if (begun) rawPath.lineTo(px, py);
    else rawPath.moveTo(px, py);
    begun = true;
  }

  const segment: number[] = [];
  function finishEnvelope() {
    if (!segment.length) return;
    const start = segment[0];
    upper.moveTo(atX(start), atY(rms[start]));
    lower.moveTo(atX(start), atY(-rms[start]));
    fill.moveTo(atX(start), atY(rms[start]));
    for (const index of segment.slice(1)) {
      upper.lineTo(atX(index), atY(rms[index]));
      lower.lineTo(atX(index), atY(-rms[index]));
      fill.lineTo(atX(index), atY(rms[index]));
    }
    for (let i = segment.length - 1; i >= 0; i--) {
      const index = segment[i];
      fill.lineTo(atX(index), atY(-rms[index]));
    }
    fill.closePath();
    segment.length = 0;
  }
  for (const index of extremaIndices(rms, width * density)) {
    if (index < 0) finishEnvelope();
    else segment.push(index);
  }
  finishEnvelope();

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  if (threshold !== null) {
    context.fillStyle = color.raw;
    context.globalAlpha = .10;
    let start: number | null = null;
    for (let index = 0; index <= rms.length; index++) {
      if (index < rms.length && Number.isFinite(rms[index]) && rms[index] > threshold) start ??= index;
      else if (start !== null) {
        context.fillRect(atX(start), y, atX(index) - atX(start), height);
        start = null;
      }
    }
    context.globalAlpha = 1;
  }

  context.fillStyle = color.raw;
  context.globalAlpha = .11;
  context.fill(fill);
  context.globalAlpha = 1;
  context.lineWidth = 1.5;
  context.strokeStyle = color.envelope;
  context.stroke(upper);
  context.stroke(lower);
  context.lineWidth = 1;
  context.globalAlpha = .78;
  context.strokeStyle = color.raw;
  context.stroke(rawPath);

  if (threshold !== null) {
    context.globalAlpha = .72;
    context.strokeStyle = styles.getPropertyValue('--plot-threshold').trim() || '#475569';
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x, atY(threshold));
    context.lineTo(x + width, atY(threshold));
    context.stroke();
  }
  context.restore();
}

export const BaWaveCanvas = memo(function BaWaveCanvas({ tracks, traceStart, traceWidth, clock, revealAt }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const paintedWidth = useRef(0);

  const paint = useCallback(() => {
    const target = canvas.current;
    const buffer = source.current;
    const context = target?.getContext('2d');
    if (!target || !buffer || !context) return;
    const { width, height } = target;
    const visible = Math.round(width * revealAt(clock.current()) / 100);
    const oldWidth = paintedWidth.current;
    if (visible < oldWidth) context.clearRect(visible, 0, oldWidth - visible, height);
    if (visible > oldWidth && height > 0) {
      const strip = visible - oldWidth;
      context.drawImage(buffer, oldWidth, 0, strip, height, oldWidth, 0, strip, height);
    }
    paintedWidth.current = visible;
  }, [clock, revealAt]);

  const paintRef = useRef(paint);
  useLayoutEffect(() => {
    paintRef.current = paint;
    paint();
    return clock.subscribe(paint);
  }, [clock, paint]);

  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const buffer = document.createElement('canvas');
    source.current = buffer;

    function rasterize(canvas: HTMLCanvasElement) {
      const { width, height, top } = canvas.getBoundingClientRect();
      const density = window.devicePixelRatio;
      const nextWidth = Math.round(width * density);
      const nextHeight = Math.round(height * density);
      if (!nextWidth || !nextHeight || traceWidth <= 0) return;
      canvas.width = buffer.width = nextWidth;
      canvas.height = buffer.height = nextHeight;
      paintedWidth.current = 0;
      const context = buffer.getContext('2d');
      if (!context) return;
      context.scale(nextWidth / width, nextHeight / height);
      const styles = getComputedStyle(canvas);
      const rows = canvas.parentElement?.querySelectorAll<HTMLElement>('.ba-trace-row');
      tracks.forEach(({ geometry, color }, index) => {
        const row = rows?.[index];
        if (!geometry || !row) return;
        const bounds = row.getBoundingClientRect();
        drawTrack(context, geometry, color, width * traceStart / 100, bounds.top - top,
          width * traceWidth / 100, bounds.height, density, styles);
      });
      paintRef.current();
    }

    rasterize(target);
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const density = window.devicePixelRatio;
      if (target.width !== Math.round(width * density) || target.height !== Math.round(height * density)) rasterize(target);
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
      source.current = null;
    };
  }, [tracks, traceStart, traceWidth]);

  return <canvas ref={canvas} className="ba-wave-canvas" aria-hidden="true" />;
});
