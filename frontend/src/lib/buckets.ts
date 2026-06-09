export const BUCKETS = [
  { id: 0, key: "A", label: "Up > +0.1%", tier: "extreme" },
  { id: 1, key: "B", label: "+0.05% to +0.1%", tier: "middle" },
  { id: 2, key: "C", label: "0% to +0.05%", tier: "middle" },
  { id: 3, key: "D", label: "-0.05% to 0%", tier: "middle" },
  { id: 4, key: "E", label: "-0.1% to -0.05%", tier: "middle" },
  { id: 5, key: "F", label: "Down > -0.1%", tier: "extreme" },
] as const;

export function isExtreme(bucket: number): boolean {
  return bucket === 0 || bucket === 5;
}

export function isValidBucket(b: unknown): b is number {
  return typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 5;
}

export type Phase = "none" | "open" | "locked" | "resolved";

export function derivePhase(
  round: { resolved: boolean; lockTime: number } | null,
  nowSeconds: number,
): Phase {
  if (!round) return "none";
  if (round.resolved) return "resolved";
  return nowSeconds < round.lockTime ? "open" : "locked";
}

/**
 * Total returned to a winner (includes stake): stake × bucketMultiplier / scale.
 * Multipliers are per-bucket and scaled on-chain by `multiplierScale`.
 */
export function potentialPayoutWei(
  bucket: number,
  stakeWei: bigint,
  bucketMultipliers: bigint[],
  multiplierScale: bigint,
): bigint {
  const m = bucketMultipliers[bucket] ?? 0n;
  if (multiplierScale === 0n) return 0n;
  return (stakeWei * m) / multiplierScale;
}

/** Human label for a scaled multiplier, e.g. 2000/100 → "20×", 280/100 → "2.8×". */
export function multiplierLabel(scaledMultiplier: bigint, multiplierScale: bigint): string {
  if (multiplierScale === 0n) return "—";
  const v = Number(scaledMultiplier) / Number(multiplierScale);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
  return `${s}×`;
}
