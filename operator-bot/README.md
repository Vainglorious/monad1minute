# PriceBetGame Operator Bot

A minimal operator/settler bot for the `PriceBetGame` contract. It runs rounds on a fixed cycle,
**simulates** a BTC/USD market with a random walk (no real price feed), and resolves every round —
even when nobody bet.

## What it does each cycle

1. `startRound()` — opens betting; the contract sets `lockTime = now + bettingDuration`.
2. Waits out the betting window (+ a few seconds of buffer for block timestamps).
3. Simulates the BTC move (random walk → signed basis points) and calls `resolveRound(bps)`.
4. Logs the round result (winning bucket, bet count, winners, payout) and repeats.

The window length is read from the contract (`bettingDuration`, currently **30s**), so the cycle is
~33s. Each round it advances a fake BTC price and submits the percentage change in basis points —
exactly the single value a real operator would submit (see `FRONTEND_INTEGRATION.md` §6).

## Config

Reads from the **project root `.env`** (loaded with Node's `--env-file`):

- `MONAD_RPC` — `https://rpc.monad.xyz`
- `PRICEBETGAME_ADDRESS` — deployed contract
- `OPERATOR_PRIVATE_KEY` — must be the contract's `operator` (it pays gas for start/resolve)

> The operator wallet only needs gas. The **house bankroll** (used to pay winners) is funded
> separately by the owner via `fundHouse()`.

## Run

### Foreground (simplest — runs until you Ctrl-C)

```sh
cd operator-bot
npm install
npm start          # = node --env-file=../.env index.js
```

### Background, with on/off control (recommended)

Use `operator.sh` to run it detached so it keeps going after you close the terminal:

```sh
cd operator-bot
./operator.sh start      # start in background
./operator.sh status     # RUNNING/STOPPED + last log lines
./operator.sh logs       # live tail (Ctrl-C exits the tail, bot keeps running)
./operator.sh stop       # turn it off
./operator.sh restart    # stop + start
```

State/logs: PID in `.operator.pid`, output in `operator.log` (both gitignored).

> ⚠️ Run only **one** operator at a time. Two instances will collide — both try `startRound()`
> and one reverts with `"round active"`.

If a round is left open when you stop/restart, the bot detects it on the next start and resolves it
before opening a new one.

## Tuning (top of `index.js`)

- `SIGMA_BPS` (default 12) — volatility of the simulated move; higher → more extreme-bucket hits.
- `MAX_ABS_BPS` (default 300) — clamp on outliers.
- `LOCK_BUFFER_S` (default 3) — seconds to wait past `lockTime` before resolving.

To swap the simulation for a **real** price feed, replace `simulateMove()` with a call that reads
BTC/USD at round open and at lock from your source, and returns `round((close-open)/open*10000)`.
