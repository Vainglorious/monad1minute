// ──────────────────────────────────────────────────────────────────────
// Per-asset price-display precision.
//
// Crypto Up/Down rounds run on a handful of assets; the right number of
// decimal places for the chart axis / header price differs per asset:
//
//   - BTC, ETH, SOL, BNB     → 2 dp (they trade above ~$70, sub-cent
//                                    movement is noise on this UI)
//   - XRP, DOGE, HYPE, SHIB  → 4 dp (sub-cent ticks matter — a 2-dp
//                                    display would flatten the chart)
//
// Driven by the asset symbol — NOT by absolute price magnitude — so an
// asset that temporarily flips price ranges (e.g. SOL dropping to $9)
// still gets the precision the operator chose for that asset.
// ──────────────────────────────────────────────────────────────────────

/** Assets that render in 4-decimal mode. Everything not in this set
 *  defaults to 2 dp. Adding a new asset is one line. */
const FOUR_DECIMAL_ASSETS = new Set([
  'xrp',
  'doge',
  'hype',
  'shib',
  'pepe'
]);

/** Decimals to render the asset price at. Asset is matched case-
 *  insensitively against the slug-form ticker ('btc', 'xrp', 'doge',
 *  'hype', …) or the full-name form ('bitcoin', 'ripple', 'solana',
 *  …) — both shapes Polymarket uses in slugs. Returns 2 for unknown
 *  assets so a typo doesn't accidentally show fewer significant digits
 *  than the operator wants. */
export function priceDecimalsForAsset(
  asset: string | null | undefined
): number {
  if (!asset) return 2;
  const lower = asset.toLowerCase();
  if (FOUR_DECIMAL_ASSETS.has(lower)) return 4;
  // Map full-name slug heads (`dogecoin`, `ripple`, `hyperliquid`)
  // to their tickers so the operator-facing config stays compact.
  if (lower === 'dogecoin' || lower === 'ripple' || lower === 'hyperliquid')
    return 4;
  return 2;
}
