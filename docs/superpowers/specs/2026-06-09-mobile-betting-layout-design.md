# Mobile Betting Layout — Chart + Bucket Rail with Base Line

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan

## Goal

Redesign the mobile betting UI so the **live chart is the centerpiece**. When a
round starts, the round's open price is recorded and drawn as a horizontal
**BASE** line across the chart. The six betting buckets move into a vertical
**rail on the right of the chart**, straddling the base line: three "up" buckets
above it (price rises) and three "down" buckets below it (price falls). The
player watches the live price climb or fall toward the bucket they bet on.

This replaces the current stacked layout (full-width chart card, then a separate
2×3 `bucket-grid` card below it).

## Current state

- `Dashboard.tsx` renders `<LiveMarketChart asset="btc" />` and `<Betting />` as
  separate sibling cards.
- `LiveMarketChart.tsx` wraps `LiveChartV2` + `useLivePriceFeed` (Coinbase). It
  already passes `frozen` and `targetPrice` props — both currently inert
  (`frozen={false}`, `targetPrice={null}`).
- `LiveChartV2.tsx` **already supports** a horizontal price line via
  `targetPrice` → `series.createPriceLine(...)` with a `targetLabel`, and a
  `frozen` mode that stops live updates and holds the final shape.
- `Betting.tsx` owns round-state polling (`/api/round` every 1.5s), the 60s
  countdown, `placeBet`, `claim`, and renders the six buckets as a grid.
- `BUCKETS` (in `lib/buckets.ts`): A–F, where A/F are the extreme ±0.1% buckets.

## Approach (chosen: "Right rail", Option A)

A single combined component owns the price feed **and** the round state, and
lays out the chart (~60% width) beside the six-bucket rail (~40%). The base line
and `frozen` state are shared between them, so the chart and the buckets always
agree on the same round.

Considered and rejected: **Option B (buckets overlaid on a full-width chart)** —
maximizes chart size but the bucket labels (band + multiplier + bet count) get
too cramped to read on a phone. The rail keeps labels legible.

### Bucket → price-band mapping (top to bottom)

| Position | Bucket | Band | Multiplier | Side |
|----------|--------|------|-----------|------|
| top | **A** | > +0.1% | 5× (extreme) | up |
| | **B** | +0.05…+0.1% | 3× | up |
| | **C** | 0…+0.05% | 1.5× | up |
| — | **BASE** | open price | — | divider |
| | **D** | −0.05…0% | 1.5× | down |
| | **E** | −0.1…−0.05% | 3× | down |
| bottom | **F** | < −0.1% | 5× (extreme) | down |

(Multipliers shown are illustrative; real values come from
`config.bucketMultipliers`.)

## Architecture

Introduce **`MarketGame.tsx`** — a client component that merges the
responsibilities currently split across `LiveMarketChart` and `Betting`:

- Owns `useLivePriceFeed` (live ticks → chart via the imperative handle).
- Owns the `/api/round` polling, derived `phase`, countdown, `placeBet`, `claim`
  (lifted from `Betting.tsx` largely unchanged).
- Renders `<LiveChartV2>` (left) + the bucket **rail** (right) in a flex row,
  plus the round header (round #, timer/phase badge) and status/claim footer.

`LiveChartV2` is kept as-is (low-level chart). `LiveMarketChart.tsx` and
`Betting.tsx` are absorbed into `MarketGame` and removed (or `Betting` is
renamed/refactored into it). `Dashboard.tsx` renders `<MarketGame asset="btc" />`
in place of the two old components.

Rationale: the chart's `targetPrice`/`frozen` and the rail's phase/winner state
derive from the **same** round, so one owner avoids prop-drilling and keeps the
two halves in sync.

## Base price (the BASE line)

The base line must equal the **exact price the operator settles against**. The
contract does not store the open price on-chain, so `/api/round` computes it
server-side and returns it:

- Add `basePrice: number | null` to the `/api/round` response.
- `basePrice` = **Coinbase 1-minute candle open at `round.startTime`** — the same
  value the **serverless** operator (parked design) will use as the round's open
  when computing `priceChangeBps`. Once that operator ships, the chart line and
  the settlement reference are identical and publicly verifiable against Coinbase.
  **Caveat:** the *current* standalone bot settles on live spot at `startRound`,
  so until the operator migrates, the BASE line may differ from actual settlement
  by a second or two of price movement. This is acceptable and self-corrects when
  the serverless operator lands.
- A small server helper `coinbaseOpenAt(unixSec)` (shared with the operator work)
  fetches candles and returns the open of the bucket containing the timestamp.
  On failure, `basePrice` is `null` and the chart simply omits the line (live
  feed still renders).

`MarketGame` passes `basePrice` to `LiveChartV2` as `targetPrice` with label
`"BASE"`, and sets `frozen` once `phase !== "open"`.

## Phase behavior (the four states)

Driven by the existing `derivePhase(round, now)`:

1. **open (betting)** — buckets tappable; tapping calls `placeBet(bucket)`.
   Timer counts down. Chart live, base line shown, price line moving.
2. **your bet placed** — your bucket highlighted (purple `mine` style); the other
   five dim (`opacity ~.32`); shows a `YOUR BET` tag. Betting disabled.
3. **locked** — chart `frozen` (holds final shape); `LOCKED` badge; all buckets
   disabled.
4. **resolved** — winning band glows green (`winner` style); if the player won,
   their bucket shows `WIN`/`Claim`; chart annotated with final `±x% → bucket`.
   Manual **Claim X MON** button remains (no auto-claim). Then the next round
   resets the layout.

## Styling / responsiveness

- New CSS in `globals.css`: `.market-game`, `.mg-row` (flex: chart `flex:1`, rail
  fixed ~96–110px), `.bucket-rail`, `.rail-bucket` (+ `.up`/`.dn`/`.mine`/
  `.winner`/`.extreme`/`.dim`), `.base-chip` divider. Remove the now-unused
  `.bucket-grid` rules.
- Chart height grows on mobile (the chart is the hero). Target a tall chart
  (~260–300px) so vertical bucket alignment reads against price levels.
- Single-column phone-first; the chart+rail row stays side-by-side even on narrow
  screens (rail is intentionally compact). Verify down to ~360px width.
- Dark theme only, reusing existing tokens (`#836ef9` purple, green/red for
  up/down).

## Testing

- Keep/extend `buckets.test.ts` for any band/multiplier label changes.
- Unit-test `coinbaseOpenAt(unixSec)` bucket selection with mocked candle data.
- Component-level: given a round in each phase, the correct bucket states render
  (tappable / dim / mine / locked / winner). Mock `/api/round` and the feed.
- Manual: `rm -rf .next && npm run build`, then verify the four phases on a
  ~390px viewport.

## Out of scope

- The serverless operator migration (separate, parked design). This UI only
  *consumes* `basePrice`; computing it server-side reuses the same Coinbase
  candle helper that work introduces, but the UI ships independently using the
  existing operator.
- Desktop-specific layout polish (mobile-first; desktop just centers the column).

## One-time / follow-up notes

- `coinbaseOpenAt` lives in a shared `lib/coinbase.ts` so both `/api/round` and
  the future operator tick use one implementation.
