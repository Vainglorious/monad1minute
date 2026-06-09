"use client";

import { useCallback, useEffect, useState } from "react";
import Onboarding from "@/components/Onboarding";
import Dashboard, { DashboardUser } from "@/components/Dashboard";
import Toast from "@/components/Toast";
import PriceTicker from "@/components/PriceTicker";

type State =
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "ready"; user: DashboardUser };

export default function Home() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [toast, setToast] = useState<string | null>(null);

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

  const onCreated = useCallback(
    async (funded?: string) => {
      if (funded) setToast(`Received ${Number(funded)} MON 🎉`);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" });
    setToast(null);
    setState({ status: "onboarding" });
  }, []);

  return (
    <>
      <PriceTicker />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {state.status === "loading" && (
        <div className="screen">
          <div className="center-fill">
            <div className="spinner" />
          </div>
        </div>
      )}

      {state.status === "onboarding" && <Onboarding onCreated={onCreated} />}

      {state.status === "ready" && (
        <Dashboard
          user={state.user}
          onLogout={logout}
          onToast={setToast}
          onRefresh={refresh}
        />
      )}
    </>
  );
}
