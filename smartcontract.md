# 1minmonad — BTC 1-Minute Price-Bucket Betting Contract

A hackathon betting game on **Monad mainnet**. Players bet a flat **10 MON** on how much
**BTC/USD** moves over a short window (default 1 minute, configurable). There are **6 outcome
buckets**; winners are paid **fixed odds** from a house bankroll. The two **extreme buckets pay
more** than the four middle buckets. A trusted **operator** settles each round by submitting the
actual percentage change.

## How a round works

```
operator: startRound()         -> opens betting, sets an on-chain deadline (lockTime = now + bettingDuration)
players:  placeBet(bucket){10 MON}   -> until lockTime; one bet, one bucket, per wallet per round
operator: resolveRound(bps)    -> after lockTime; records winning bucket + payout per winner
winners:  claim(roundId)       -> pull their payout (loser stakes stay as house funds)
```

## Outcome buckets

Price change is expressed in **basis points (bps)**: `0.1% = 10 bps`. Boundaries are gap-free and
non-overlapping; exactly `0%` falls in bucket **C**.

| Bucket | Condition (signed bps) | Meaning            | Tier    | Payout |
|--------|------------------------|--------------------|---------|--------|
| A      | `bps > 10`             | up more than +0.1% | extreme | **5x** |
| B      | `5 < bps <= 10`        | +0.05% to +0.1% up | middle  | 2x     |
| C      | `0 <= bps <= 5`        | 0% to +0.05% up    | middle  | 2x     |
| D      | `-5 <= bps < 0`        | -0.05% to 0% down  | middle  | 2x     |
| E      | `-10 <= bps < -5`      | -0.1% to -0.05% dn | middle  | 2x     |
| F      | `bps < -10`            | down more than 0.1%| extreme | **5x** |

Payout is the **total returned** per 10 MON stake: extreme win → 50 MON, middle win → 20 MON,
loss → 0. All multipliers, the bet amount, and the window are **owner-adjustable on-chain**.

## Economics & safety

- **Fixed-odds, house-funded.** The contract holds a bankroll. The owner funds it via `fundHouse()`
  (or a plain transfer) and may withdraw only *free* (unreserved) funds.
- **Solvency is structural.** Each bet reserves its worst-case payout (`10 * extremeMultiplier`).
  Betting reverts unless the contract balance covers all reservations, so the house can never owe
  more than it holds. On resolve, the over-reservation is released and only real winner liability
  is re-held for claims.
- **Pull payments + reentrancy guard** on `claim()`.
- **Roles:** `owner` (deployer; config + withdrawals) and `operator` (runs rounds). They may be the
  same address. Config setters only work while no round is live.

## Network

- **Monad mainnet** — RPC `https://rpc.monad.xyz`, **chain ID 143**.
- Testnet (unused here) — `https://testnet-rpc.monad.xyz`, chain ID 10143.

## Repo layout

```
smartcontract/
  foundry.toml              # mainnet profile (rpc.monad.xyz, chain 143)
  src/PriceBetGame.sol      # the contract (self-contained, no external deps)
  test/PriceBetGame.t.sol   # full local test suite (forge test — no MON needed)
  script/Deploy.s.sol       # deploy + optional initial bankroll fund
  lib/forge-std/            # test framework (installed via forge/git)
../.env                     # PUBLIC addresses + RPC only — NO private keys
```

## Build, test, deploy

```sh
# 1. Local tests — free, no network, no MON:
cd smartcontract && forge build && forge test -vvv

# 2. Deploy to Monad mainnet (needs a funded wallet for gas + bankroll):
cast wallet import monad-deployer --interactive          # import your private key into a keystore
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.monad.xyz --account monad-deployer --broadcast

# 3. Cheap live smoke test (set a tiny bet first), then restore:
#    setBetAmount(0.1 ether) -> fundHouse -> startRound -> placeBet -> resolveRound -> claim
#    setBetAmount(10 ether)  -> production
```

> Private keys live only in the `cast` keystore, never in `.env` or source.
