"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface DashboardUser {
  username: string;
  address: string;
  balance: string | null;
}

interface Props {
  user: DashboardUser;
  onLogout: () => void;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Dashboard({ user, onLogout }: Props) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string>("");

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

  const balanceDisplay =
    user.balance === null ? "—" : Number(user.balance).toFixed(4);

  return (
    <div className="screen">
      <div className="brand">
        <span className="brand-dot" />
        1 Minute
      </div>

      <div className="center-fill stack">
        <div>
          <div className="label-xs">Welcome</div>
          <h1 className="hero-title" style={{ fontSize: 28, margin: "4px 0 0" }}>
            @{user.username}
          </h1>
        </div>

        <div className="card">
          <div className="label-xs">Balance · Monad</div>
          <div className="balance">
            {balanceDisplay}
            <span className="unit">MON</span>
          </div>
          {user.balance === null && (
            <div className="muted">Balance unavailable — pull to refresh.</div>
          )}

          <div style={{ marginTop: 18 }}>
            <div className="label-xs">Your wallet address</div>
            <div className="addr-row">
              <span className="addr">{short(user.address)}</span>
              <button className="copy-btn" onClick={copy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {qr && (
            <div className="qr-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Wallet address QR" width={180} height={180} />
            </div>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center" }}>
          Your wallet is funded and ready. 1-minute rounds coming soon.
        </p>
      </div>

      <button className="btn btn-ghost" onClick={onLogout}>
        Log out
      </button>
      <div className="foot">Powered by Monad · Wallet by Privy</div>
    </div>
  );
}
