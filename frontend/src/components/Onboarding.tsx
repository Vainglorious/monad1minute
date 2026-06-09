"use client";

import { useCallback, useRef, useState } from "react";
import { LiveChartV2, type LiveChartV2Handle } from "@/components/charts/LiveChartV2";
import { useLivePriceFeed } from "@/hooks/useLivePriceFeed";

interface Props {
  onCreated: (funded?: string) => void;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Onboarding({ onCreated }: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Real live BTC feed — same chart as the trading page, no auth needed.
  const chartRef = useRef<LiveChartV2Handle | null>(null);
  const handleLiveTick = useCallback((timeSec: number, value: number) => {
    chartRef.current?.pushTick(timeSec, value);
  }, []);
  const { history, livePrice, dir } = useLivePriceFeed("btc", handleLiveTick);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      onCreated(typeof data.funded === "string" ? data.funded : undefined);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/polymarketanalyticstopmodal.png"
          alt="Polymarket Analytics"
          className="brand-logo"
        />
        1 Minute
      </div>

      <div className="center-fill">
        {/* Live market preview — the game, before you even sign up */}
        <div className="onb-stage onb-in onb-d1">
          <div className="card onb-chart">
            <div className="chart-head">
              <div className="label-xs">
                <span className="chart-live-dot" />
                BTC/USD · LIVE
              </div>
              <div className={`chart-price ${dir}`} key={livePrice ?? "na"}>
                {livePrice != null ? fmtUsd(livePrice) : "—"}
                {livePrice != null && dir !== "flat" && (
                  <span className="chart-price-arrow">{dir === "up" ? "▲" : "▼"}</span>
                )}
              </div>
            </div>
            <LiveChartV2
              ref={chartRef}
              data={history}
              height={150}
              lineColor="#2e5cff"
              areaTopColor="rgba(46, 92, 255, 0.25)"
              areaBottomColor="rgba(46, 92, 255, 0)"
              asset="btc"
              frozen={false}
              targetPrice={null}
            />
          </div>
        </div>

        {/* The payout ladder, as a teaser */}
        <div className="onb-chips onb-in onb-d2">
          <span className="chip up">▲ +0.1% · 20×</span>
          <span className="chip up">10×</span>
          <span className="chip up">2.8×</span>
          <span className="chip base">BASE</span>
          <span className="chip dn">2.8×</span>
          <span className="chip dn">10×</span>
          <span className="chip dn">▼ -0.1% · 20×</span>
        </div>

        <h1 className="hero-title onb-in onb-d3">
          Predict crypto.
          <br />
          <span className="gradient-text">Every minute.</span>
        </h1>
        <p className="hero-sub onb-in onb-d4">
          Call the next 60 seconds of BTC and win up to 20×. We&apos;ll spin up
          your Monad wallet instantly — no seed phrases, no passwords.
        </p>

        <form onSubmit={submit} className="onb-in onb-d5">
          <div className="field">
            <label htmlFor="username">Choose a username</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="satoshi"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              maxLength={20}
              inputMode="text"
            />
          </div>
          <div className="error">{error}</div>
          <button className="btn" type="submit" disabled={loading || username.trim().length < 3}>
            {loading ? "Creating your wallet…" : "Enter"}
          </button>
        </form>
      </div>

      <div className="foot">Powered by Monad · Wallet by Privy</div>
    </div>
  );
}
