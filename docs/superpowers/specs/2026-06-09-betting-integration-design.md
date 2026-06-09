# monad1minute — Milestone 2: PriceBetGame Integration (Design)

Date: 2026-06-09
Status: Approved

## Context

Wire the onboarding app to the **live** `PriceBetGame` contract on Monad mainnet so a
custodial user can watch the current 1-minute round, place a bet, see the result, and claim
winnings. The operator bot (separate, already running) drives `startRound`/`resolveRound`.

Contract: `0x0f6Cce5f0A07aA77e6E36E407a72e83A4503C383` (Monad mainnet, chain 143).
Live params read dynamically: `betAmount` (currently 0.2 MON), `bettingDuration` (30s),
`extremeMultiplier` (5×), `middleMultiplier` (2×).

## Decisions (from brainstorming)

- **Signing:** custodial. Users have no browser wallet; the backend builds a viem account
  from each user's Privy wallet (`createViemAccount`) and signs `placeBet`/`claim` server-side.
- **Stake vs funding:** raise `SIGNUP_FUNDING_MON` to **0.3** (covers a 0.2 stake + gas).
- **Claim:** manual "Claim" button → backend signs `claim(roundId)`.
- **Target:** live mainnet contract, address from `PRICEBETGAME_ADDRESS` env.
- **Scope:** live round + place bet, result + claim, my bet history, live pool feed.

## Architecture

- **lib/contract.ts** — ABI (copied to `frontend/src/lib/abi/PriceBetGame.json`), address from
  env, typed read helpers (currentRoundId, rounds, betAmount, multipliers, bettingDuration,
  bets, bucketCount, classify) on the existing `publicClient`, and `getUserWalletClient(user)`
  that returns a viem wallet client backed by the user's Privy wallet for writes.
- **API routes** (all require the session cookie → resolve user → address):
  - `GET  /api/round` — snapshot: round state + derived phase, betAmount, multipliers, duration,
    per-bucket counts (`bucketCount`), the user's bet for this round, and the user's MON balance.
  - `POST /api/bet` `{ bucket }` — guard (round open, not already bet, balance ≥ stake+gas),
    sign `placeBet(bucket)` with `value = betAmount`, wait for receipt, record a `Bet` row.
  - `POST /api/claim` `{ roundId }` — guard (resolved, user won, unclaimed), sign `claim(roundId)`,
    wait for receipt, mark the `Bet` row claimed.
  - `GET  /api/history` — the user's last N `Bet` rows joined with on-chain round outcomes.
- **Frontend** — betting view on the dashboard:
  - Round panel: phase + countdown to `lockTime`, six bucket cards (label + payout), place-bet,
    highlight the user's chosen bucket, disable when `now >= lockTime` or already bet.
  - Pool feed: live per-bucket counts.
  - Result + claim: on resolved rounds show winner bucket, win/lose, and a Claim button if owed.
  - History: list of past bets with outcomes.
  - Polls `GET /api/round` every ~1.5s (simplest reliable live UI; events are a later optimization).

## Data model (add to Prisma)

```
model Bet {
  id        String   @id @default(cuid())
  userId    String
  roundId   String   // uint256 as decimal string
  bucket    Int      // 0..5
  amount    String   // wei as string
  txHash    String
  claimed   Boolean  @default(false)
  claimTx   String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@index([userId])
  @@unique([userId, roundId])  // one bet per user per round (mirrors the contract)
}
```
(Add `bets Bet[]` back-relation to `User`.)

## Phase derivation (from `rounds(id)`, `now`)

- Betting open ⇔ `!resolved && now < lockTime`
- Locked, awaiting result ⇔ `!resolved && now >= lockTime`
- Resolved ⇔ `resolved === true` → winner = `winner`, payout = `payoutPerWinner`
- User won ⇔ user's `bets(id,addr).placed && bucket === winner`
- Claimable ⇔ won && `!claimed`

## Config / env (frontend)

- `PRICEBETGAME_ADDRESS` (default `0x0f6Cce5f0A07aA77e6E36E407a72e83A4503C383`)
- `SIGNUP_FUNDING_MON` raised to `0.3`

## Error handling

- Bet guards return clear 4xx ("round closed", "already bet", "insufficient balance").
- On-chain reverts (e.g. "betting closed" if the tx lands after lockTime) surfaced as a friendly
  message; the recorded `Bet` row is only written after a successful receipt.
- Claim guards mirror contract reverts ("not resolved", "not a winner", "already claimed").
- All reads/writes scrub RPC errors before logging (reuse `scrubError`).

## Security notes

- Stakes are real mainnet MON. Bets/claims are signed only for the authenticated session user,
  only from that user's own Privy wallet. Bucket is validated `0..5`. Value is forced to the
  live `betAmount` (never client-supplied).
- The unauthenticated-faucet caveat from M1 still applies (anti-abuse before public launch).

## Testing

- Unit: phase derivation, payout preview, bucket validation.
- Integration: `/api/bet` and `/api/claim` guard logic with the chain/Privy layers mocked.

## Out of scope

Operator/admin UI (handled by the bot), on-chain oracle, websocket event indexing
(polling for v1), cross-device portability.
