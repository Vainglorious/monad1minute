"use client";

import { useState } from "react";

interface Props {
  onCreated: (funded?: string) => void;
}

export default function Onboarding({ onCreated }: Props) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        <span className="brand-dot" />
        1 Minute
      </div>

      <div className="center-fill">
        <h1 className="hero-title">
          Predict crypto.
          <br />
          <span className="gradient-text">Every minute.</span>
        </h1>
        <p className="hero-sub">
          Pick a handle to get started. We&apos;ll spin up your Monad wallet
          instantly — no seed phrases, no passwords.
        </p>

        <form onSubmit={submit}>
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
