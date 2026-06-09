"use client";

import { useCallback, useEffect, useState } from "react";
import Onboarding from "@/components/Onboarding";
import Dashboard, { DashboardUser } from "@/components/Dashboard";

type State =
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "ready"; user: DashboardUser };

export default function Home() {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setState({ status: "ready", user: data.user });
      } else {
        setState({ status: "onboarding" });
      }
    } catch {
      setState({ status: "onboarding" });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" });
    setState({ status: "onboarding" });
  }, []);

  if (state.status === "loading") {
    return (
      <div className="screen">
        <div className="center-fill">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (state.status === "onboarding") {
    return <Onboarding onCreated={refresh} />;
  }

  return <Dashboard user={state.user} onLogout={logout} />;
}
