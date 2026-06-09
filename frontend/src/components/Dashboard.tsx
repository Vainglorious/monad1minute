"use client";

import { useEffect, useState } from "react";
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
