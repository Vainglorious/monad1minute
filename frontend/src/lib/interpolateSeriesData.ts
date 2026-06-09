/**
 * Cubic-eased interpolation of a sparse time-series.
 *
 * Reverse-engineered from polymarket.com's `interpolateSeriesData` helper —
 * the trick that makes their crypto up/down chart line read as a smooth
 * dense curve instead of a connect-the-dots polyline. Chainlink only emits
 * ~one price every 1-2 seconds, so the raw history is a handful of widely
 * spaced points. By inserting cubic-eased sub-samples between every adjacent
 * pair before `series.setData(...)`, the AreaSeries renders the historical
 * curve as a fine parabolic line (combined with `LineType.Curved`).
 *
 * Live ticks pushed after setData still arrive at WS cadence, but the
 * pre-interpolated base curve dominates the visual: one extra raw point per
 * second doesn't break the smoothness once the line is already dense.
 *
 * Constants match polymarket's bundle:
 *   - `MAX_UPDATES_PER_SECOND = 60` — 60 sub-samples per gap.
 *   - Easing: `easeInOutCubic` (t < 0.5 ? 4t³ : 1 - (-2t+2)³/2).
 */

export interface SeriesPoint {
  /** Unix seconds — matches lightweight-charts' `UTCTimestamp`. */
  time: number;
  value: number;
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const DEFAULT_SAMPLES_PER_GAP = 60;

export function interpolateSeriesData(
  points: SeriesPoint[],
  samplesPerGap = DEFAULT_SAMPLES_PER_GAP
): SeriesPoint[] {
  if (!Array.isArray(points) || points.length < 2 || samplesPerGap < 2) {
    return Array.isArray(points) ? points.slice() : [];
  }
  const out: SeriesPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    // Guard against bad data — skip the gap if it's malformed.
    if (
      !Number.isFinite(a?.time) ||
      !Number.isFinite(a?.value) ||
      !Number.isFinite(b?.time) ||
      !Number.isFinite(b?.value) ||
      b.time <= a.time
    ) {
      out.push(a);
      continue;
    }
    for (let s = 0; s < samplesPerGap; s++) {
      const t = s / samplesPerGap;
      const eased = easeInOutCubic(t);
      out.push({
        time: a.time + (b.time - a.time) * t,
        value: a.value + (b.value - a.value) * eased
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
