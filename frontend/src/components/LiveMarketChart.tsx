"use client";

import { useCallback, useRef } from "react";
import { LiveChartV2, type LiveChartV2Handle } from "@/components/charts/LiveChartV2";
import { useLivePriceFeed } from "@/hooks/useLivePriceFeed";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface Props {
  asset?: string;
  height?: number;
}

export default function LiveMarketChart({ asset = "btc", height = 200 }: Props) {
  const chartRef = useRef<LiveChartV2Handle | null>(null);

  // Every WS tick flows straight into the chart via the imperative handle,
  // bypassing React state so the line updates at native WS frequency.
  const handleLiveTick = useCallback((timeSec: number, value: number) => {
    chartRef.current?.pushTick(timeSec, value);
  }, []);

  const { history, livePrice } = useLivePriceFeed(asset, handleLiveTick);

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div className="label-xs">{asset.toUpperCase()}/USD · live</div>
        <div className="chart-price">{livePrice != null ? fmtUsd(livePrice) : "—"}</div>
      </div>
      <LiveChartV2
        ref={chartRef}
        data={history}
        height={height}
        lineColor="#836ef9"
        areaTopColor="rgba(131, 110, 249, 0.25)"
        areaBottomColor="rgba(131, 110, 249, 0)"
        asset={asset}
        frozen={false}
        targetPrice={null}
      />
    </div>
  );
}
