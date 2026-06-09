"use client";

/**
 * LiveChartV2 — ported from polymarket-analytics into monad1minute.
 * Motion mechanics are unchanged (WS ticks set an ease target; a 50 Hz filler
 * timer pans the right edge; rolling 30s window). Adapted for this project:
 * fixed dark palette (no ThemeContext), local-time axis (no ET), inline-styled
 * tooltip/indicator (no Tailwind), inline chevron (no lucide-react).
 */

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  createChart,
  ColorType,
  AreaSeries,
  LineStyle,
  LineType,
  LastPriceAnimationMode,
  createSeriesMarkers,
  CrosshairMode,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { priceDecimalsForAsset } from "@/lib/cryptoPriceFormat";

export interface LiveChartV2Handle {
  pushTick: (timeSec: number, value: number) => void;
}

export interface LiveChartV2DataPoint {
  time: number | string;
  value: number;
}

interface LiveChartV2Props {
  data: LiveChartV2DataPoint[];
  height?: number;
  lineColor: string;
  areaTopColor: string;
  areaBottomColor: string;
  targetPrice?: number | null;
  targetLabel?: string;
  frozen?: boolean;
  asset?: string | null;
}

const VISIBLE_WINDOW_SEC = 30;
const FILLER_INTERVAL_MS = 20;
const EASE_DURATION_MS = 500;
const RIGHT_OFFSET_BARS = 175;
const VISIBLE_BARS = VISIBLE_WINDOW_SEC * (1000 / FILLER_INTERVAL_MS) + RIGHT_OFFSET_BARS;

// Fixed dark palette (this app is dark-only).
const PALETTE = {
  text: "#9a9ab0",
  grid: "#1E293B",
  border: "#262636",
  crosshair: "#29374E",
};

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function cleanTime(t: number | string): number {
  if (typeof t === "number") return t;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms / 1000 : 0;
}

function normalizePoints(data: LiveChartV2DataPoint[]): { time: number; value: number }[] {
  const cleaned: { time: number; value: number }[] = [];
  for (const d of data) {
    if (!d) continue;
    const t = cleanTime(d.time);
    const v = d.value;
    if (Number.isFinite(t) && Number.isFinite(v)) {
      cleaned.push({ time: t, value: v });
    }
  }
  cleaned.sort((a, b) => a.time - b.time);
  const out: { time: number; value: number }[] = [];
  for (const p of cleaned) {
    const last = out.length ? out[out.length - 1] : null;
    if (last && last.time === p.time) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

function makePriceFormatters(asset?: string | null) {
  const decimals = priceDecimalsForAsset(asset);
  const assetPriceFormatter = (price: number) => {
    if (price >= 1000) {
      const hasCents = Math.abs(price - Math.round(price)) > 1e-9;
      if (hasCents) {
        return `$${price.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
      }
      return `$${Math.round(price).toLocaleString()}`;
    }
    return `$${price.toFixed(decimals)}`;
  };
  const fullAssetPriceFormatter = (price: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(price);
  return { assetPriceFormatter, fullAssetPriceFormatter };
}

// Local-time axis + tooltip formatters.
const TIME_HMS = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const TIME_HM = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DATE_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_FULL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
function formatTickMark(time: Time, tickMarkType: TickMarkType): string {
  if (typeof time !== "number") return String(time);
  const d = new Date(time * 1000);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
    case TickMarkType.DayOfMonth:
      return DATE_SHORT.format(d);
    case TickMarkType.Time:
      return TIME_HM.format(d);
    case TickMarkType.TimeWithSeconds:
    default:
      return TIME_HMS.format(d);
  }
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  value: string;
  date: string;
}

export const LiveChartV2 = forwardRef<LiveChartV2Handle, LiveChartV2Props>(
  function LiveChartV2(
    { data, height = 320, lineColor, areaTopColor, areaBottomColor, targetPrice, targetLabel, frozen = false, asset },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
    const { assetPriceFormatter, fullAssetPriceFormatter } = makePriceFormatters(asset);

    const prevValueRef = useRef<number | null>(null);
    const targetValueRef = useRef<number | null>(null);
    const easeStartMsRef = useRef<number | null>(null);
    const lastPushedTimeRef = useRef<number>(0);
    const frozenRef = useRef(frozen);

    const computeCurrentValue = useCallback((): number | null => {
      const prev = prevValueRef.current;
      const target = targetValueRef.current;
      const easeStart = easeStartMsRef.current;
      if (prev == null) return null;
      if (target == null || easeStart == null) return prev;
      const elapsed = Date.now() - easeStart;
      const alpha = Math.min(elapsed / EASE_DURATION_MS, 1);
      const eased = easeInOutCubic(alpha);
      return prev + (target - prev) * eased;
    }, []);

    useEffect(() => {
      frozenRef.current = frozen;
      if (!frozen) return;
      try {
        chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
        const ts = chartRef.current?.timeScale();
        const fullRange = ts?.getVisibleLogicalRange();
        if (ts && fullRange) {
          const lastBarIdx = fullRange.to - RIGHT_OFFSET_BARS;
          const totalBars = lastBarIdx - fullRange.from;
          if (totalBars > 0) {
            const visibleSpan = totalBars * 0.3;
            const from = lastBarIdx - visibleSpan;
            const rightBuffer = visibleSpan * 0.05;
            ts.setVisibleLogicalRange({ from: from as never, to: (lastBarIdx + rightBuffer) as never });
          }
        }
      } catch {
        /* chart may have unmounted */
      }
    }, [frozen]);

    const [tooltip, setTooltip] = useState<TooltipState>({
      visible: false,
      x: 0,
      y: 0,
      value: "",
      date: "",
    });
    const [strikeEdge, setStrikeEdge] = useState<"above" | "below" | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        pushTick: (_timeSec: number, value: number) => {
          if (!Number.isFinite(value)) return;
          if (frozenRef.current) return;
          const currentValue = computeCurrentValue();
          prevValueRef.current = currentValue ?? value;
          targetValueRef.current = value;
          easeStartMsRef.current = Date.now();
        },
      }),
      [computeCurrentValue],
    );

    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: PALETTE.text,
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: PALETTE.grid, style: LineStyle.Dotted },
        },
        width: containerRef.current.clientWidth,
        height,
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.2, bottom: 0.2 } },
        timeScale: {
          borderColor: PALETTE.border,
          timeVisible: true,
          secondsVisible: true,
          fixLeftEdge: false,
          fixRightEdge: false,
          shiftVisibleRangeOnNewBar: true,
          rightOffset: RIGHT_OFFSET_BARS,
          tickMarkFormatter: formatTickMark,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
        handleScroll: false,
        handleScale: false,
        trackingMode: { exitMode: 1 },
      });

      const series = chart.addSeries(AreaSeries, {
        lineColor,
        topColor: areaTopColor,
        bottomColor: areaBottomColor,
        lineWidth: 2,
        lineType: LineType.Curved,
        lastValueVisible: false,
        priceLineVisible: false,
        lastPriceAnimation: LastPriceAnimationMode.Continuous,
        priceFormat: { type: "custom" as const, formatter: assetPriceFormatter, minMove: 0.01 },
      });

      const normalized = normalizePoints(data);
      series.setData(normalized as never);
      if (normalized.length > 0) {
        const tail = normalized[normalized.length - 1];
        lastPushedTimeRef.current = tail.time;
        prevValueRef.current = tail.value;
        targetValueRef.current = null;
        easeStartMsRef.current = null;
      } else {
        lastPushedTimeRef.current = 0;
        prevValueRef.current = null;
        targetValueRef.current = null;
        easeStartMsRef.current = null;
      }

      if (normalized.length > 0) {
        try {
          createSeriesMarkers(series, [
            { time: normalized[0].time as never, position: "inBar", color: lineColor, shape: "circle", size: 1 },
          ]);
        } catch {
          /* API mismatch — skip */
        }
      }

      if (targetPrice != null && Number.isFinite(targetPrice)) {
        series.createPriceLine({
          price: targetPrice,
          color: "#9CA3AF",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: targetLabel || "Target",
        });
      }

      chartRef.current = chart;
      seriesRef.current = series;

      chart.subscribeCrosshairMove((param) => {
        if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) {
          setTooltip((prev) => ({ ...prev, visible: false }));
          return;
        }
        const seriesData = param.seriesData.get(series);
        if (seriesData && "value" in seriesData) {
          const value = (seriesData as { value: number }).value;
          const ts = param.time as number;
          setTooltip({
            visible: true,
            x: param.point.x,
            y: param.point.y,
            value: fullAssetPriceFormatter(value),
            date: `${DATE_FULL.format(new Date(ts * 1000))}, ${TIME_HMS.format(new Date(ts * 1000))}`,
          });
        }
      });

      const applyBarSpacing = () => {
        const cw = containerRef.current?.clientWidth ?? 0;
        if (cw <= 0) return;
        try {
          chart.timeScale().applyOptions({ barSpacing: cw / VISIBLE_BARS });
        } catch {
          /* ignore */
        }
      };
      applyBarSpacing();

      if (frozen && normalized.length > 0) {
        chart.applyOptions({ handleScroll: false, handleScale: false });
        const lastBarIdx = normalized.length - 1;
        const visibleSpan = Math.max(1, Math.floor(normalized.length * 0.3));
        const from = Math.max(0, lastBarIdx - visibleSpan);
        const rightBuffer = visibleSpan * 0.05;
        try {
          chart.timeScale().setVisibleLogicalRange({ from: from as never, to: (lastBarIdx + rightBuffer) as never });
        } catch {
          /* ignore */
        }
      }

      const onResize = () => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth });
          applyBarSpacing();
        }
      };
      window.addEventListener("resize", onResize);

      let fillerTimer: ReturnType<typeof setTimeout> | null = null;
      let strikeEdgeProbeCounter = 0;
      let lastStrikeEdge: "above" | "below" | null = null;
      const STRIKE_EDGE_PROBE_EVERY = 10;
      const fillerStep = () => {
        if (!frozenRef.current) {
          const c = chartRef.current;
          const s = seriesRef.current;
          if (c && s) {
            const value = computeCurrentValue();
            const t = Date.now() / 1000;
            if (value != null && t > lastPushedTimeRef.current) {
              lastPushedTimeRef.current = t;
              try {
                s.update({ time: t as never, value });
              } catch {
                /* sub-second tie; drop */
              }
            }
            strikeEdgeProbeCounter += 1;
            if (
              targetPrice != null &&
              Number.isFinite(targetPrice) &&
              strikeEdgeProbeCounter % STRIKE_EDGE_PROBE_EVERY === 0
            ) {
              try {
                const y = s.priceToCoordinate(targetPrice);
                const chartHeight = containerRef.current?.clientHeight ?? height;
                let next: "above" | "below" | null = null;
                if (typeof y === "number") {
                  if (y < 0) next = "above";
                  else if (y > chartHeight) next = "below";
                }
                if (next !== lastStrikeEdge) {
                  lastStrikeEdge = next;
                  setStrikeEdge(next);
                }
              } catch {
                /* skip */
              }
            }
          }
        }
        fillerTimer = setTimeout(fillerStep, FILLER_INTERVAL_MS);
      };
      fillerTimer = setTimeout(fillerStep, FILLER_INTERVAL_MS);

      return () => {
        window.removeEventListener("resize", onResize);
        if (fillerTimer) clearTimeout(fillerTimer);
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        lastPushedTimeRef.current = 0;
        prevValueRef.current = null;
        targetValueRef.current = null;
        easeStartMsRef.current = null;
      };
    }, [height, lineColor, areaTopColor, areaBottomColor, targetPrice, targetLabel, computeCurrentValue]);

    const lastSeedFirstRef = useRef<number | null>(null);
    const lastSeedLastRef = useRef<number | null>(null);
    useEffect(() => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;
      const normalized = normalizePoints(data);
      if (normalized.length === 0) {
        lastSeedFirstRef.current = null;
        lastSeedLastRef.current = null;
        try {
          series.setData([]);
        } catch {
          /* ignore */
        }
        lastPushedTimeRef.current = 0;
        prevValueRef.current = null;
        targetValueRef.current = null;
        easeStartMsRef.current = null;
        return;
      }
      const firstTime = normalized[0].time;
      const lastTime = normalized[normalized.length - 1].time;
      if (firstTime === lastSeedFirstRef.current && lastTime === lastSeedLastRef.current) {
        return;
      }
      lastSeedFirstRef.current = firstTime;
      lastSeedLastRef.current = lastTime;
      try {
        series.setData(normalized as never);
        if (frozenRef.current) {
          chart.timeScale().fitContent();
        } else {
          const cw = containerRef.current?.clientWidth ?? 0;
          if (cw > 0) chart.timeScale().applyOptions({ barSpacing: cw / VISIBLE_BARS });
        }
      } catch {
        return;
      }
      const tail = normalized[normalized.length - 1];
      lastPushedTimeRef.current = tail.time;
      prevValueRef.current = tail.value;
      targetValueRef.current = null;
      easeStartMsRef.current = null;
    }, [data]);

    return (
      <div ref={containerRef} style={{ width: "100%", position: "relative" }}>
        {strikeEdge != null && (
          <div
            className="chart-pill"
            style={strikeEdge === "above" ? { top: 4 } : { bottom: 24 }}
          >
            <span>{targetLabel || "Target"}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={strikeEdge === "above" ? { transform: "rotate(180deg)" } : undefined}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        )}
        {tooltip.visible &&
          (() => {
            const EST_WIDTH = 160;
            const OFFSET = 12;
            const containerWidth = containerRef.current?.clientWidth || 300;
            const overflowsRight = tooltip.x + OFFSET + EST_WIDTH > containerWidth;
            const left = overflowsRight
              ? Math.max(tooltip.x - OFFSET - EST_WIDTH, 0)
              : tooltip.x + OFFSET;
            return (
              <div className="chart-tooltip" style={{ left, top: Math.max(tooltip.y - 60, 10) }}>
                <div className="chart-tooltip-date">{tooltip.date}</div>
                <div className="chart-tooltip-value">{tooltip.value}</div>
              </div>
            );
          })()}
      </div>
    );
  },
);
