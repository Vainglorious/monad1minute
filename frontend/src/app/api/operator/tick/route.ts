/**
 * Operator tick — drives the betting cycle from a Vercel Cron schedule.
 *
 * Triggered every ~60s (see frontend/vercel.json). Vercel attaches
 * `Authorization: Bearer ${CRON_SECRET}` to cron requests; we reject anything
 * else so the public URL can't be abused to spend operator gas.
 */
import { NextRequest, NextResponse } from "next/server";
import { runTick, type TickResult } from "@/lib/operator";
import { scrubError } from "@/lib/funding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One readable line per tick so the cron run is visible in Vercel function logs.
function summarize(r: TickResult): string {
  switch (r.action) {
    case "waiting":
      return `waiting on round ${r.roundId} (${r.secondsLeft}s left)`;
    case "started":
      return `started round ${r.newRound}`;
    case "resolved-and-started":
      return `resolved round ${r.resolvedRound} (${r.bps >= 0 ? "+" : ""}${r.bps} bps) → started ${r.newRound}`;
    case "skip":
      return `skip: ${r.reason}`;
  }
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[operator] CRON_SECRET not configured");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    console.warn("[operator] unauthorized tick request rejected");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await runTick();
    console.log(`[operator] ${summarize(result)} (${Date.now() - startedAt}ms)`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[operator] tick failed:", scrubError(err));
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST is allowed for manual/secret-gated triggering.
export const GET = handle;
export const POST = handle;
