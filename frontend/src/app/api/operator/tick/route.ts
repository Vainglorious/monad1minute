/**
 * Operator tick — drives the betting cycle from a Vercel Cron schedule.
 *
 * Triggered every ~60s (see frontend/vercel.json). Vercel attaches
 * `Authorization: Bearer ${CRON_SECRET}` to cron requests; we reject anything
 * else so the public URL can't be abused to spend operator gas.
 */
import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/operator";
import { scrubError } from "@/lib/funding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("operator tick failed:", scrubError(err));
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST is allowed for manual/secret-gated triggering.
export const GET = handle;
export const POST = handle;
