"use client";

import { useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import QRCode from "qrcode";
import History from "@/components/History";
import Leaderboard from "@/components/Leaderboard";
import MarketGame from "@/components/MarketGame";

export interface DashboardUser {
  username: string;
  address: string;
  balance: string | null;
}

interface Props {
  user: DashboardUser;
  onLogout: () => void;
  onToast: (msg: string) => void;
  onRefresh: () => void;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Dashboard({ user, onLogout, onToast, onRefresh }: Props) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string>("");
  const [showReceive, setShowReceive] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    QRCode.toDataURL(user.address, { margin: 1, width: 180 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [user.address]);

  // Catch-up sweep: claim past wins that were never claimed (e.g. the tab was
  // closed before the round resolved). The current round's win is auto-claimed
  // by MarketGame; a duplicate here just gets a harmless 409.
  const sweptRef = useRef(false);
  useEffect(() => {
    if (sweptRef.current) return;
    sweptRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/history", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const unclaimed: { roundId: string }[] = (json.bets ?? []).filter(
          (b: { won: boolean | null; claimed: boolean }) => b.won && !b.claimed,
        );
        let claimedCount = 0;
        let totalWei = 0n;
        for (const b of unclaimed) {
          const r = await fetch("/api/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roundId: b.roundId }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok) {
            claimedCount++;
            totalWei += BigInt(j.payout ?? 0);
          }
        }
        if (claimedCount > 0) {
          const mon = Number(formatEther(totalWei)).toFixed(2);
          onToast(
            `Claimed ${mon} MON from ${claimedCount} past win${claimedCount === 1 ? "" : "s"} 🏆`,
          );
          setVersion((v) => v + 1);
          onRefresh();
        }
      } catch {
        /* best-effort; wins stay claimable on-chain */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(user.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  const balanceDisplay = user.balance === null ? "—" : Number(user.balance).toFixed(3);

  const afterAction = () => {
    setVersion((v) => v + 1);
    onRefresh();
  };

  return (
    <div className="screen">
      <div className="bar">
        <div className="brand">
          <span className="brand-dot" />
          1 Minute
        </div>
        <div className="bar-right">
          <span className="bal-pill">
            {balanceDisplay} <span className="unit">MON</span>
          </span>
          <span className="handle">@{user.username}</span>
        </div>
      </div>

      <div className="stack" style={{ flex: 1 }}>
        <MarketGame asset="btc" onToast={onToast} onBalanceChange={afterAction} />

        <History refreshKey={version} />

        <Leaderboard refreshKey={version} />

        <div className="card">
          <div className="receive-head" onClick={() => setShowReceive((s) => !s)}>
            <div>
              <div className="label-xs">Your wallet</div>
              <span className="addr">{short(user.address)}</span>
            </div>
            <div className="addr-row">
              <button
                className="copy-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  copy();
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button className="copy-btn">{showReceive ? "Hide" : "Receive"}</button>
            </div>
          </div>
          {showReceive && qr && (
            <div className="qr-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Wallet address QR" width={180} height={180} />
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-ghost" onClick={onLogout}>
        Log out
      </button>
      <div className="foot">Powered by Monad · Wallet by Privy</div>
    </div>
  );
}
