# PriceBetGame Operator Bot

An operator/settler bot for the `PriceBetGame` contract. It runs rounds on a fixed cycle, reads a
**real BTC/USD price feed** (exchange WebSocket + REST fallback), and resolves every round — even
when nobody bet.

## What it does each cycle

1. Snapshots the **open** BTC/USD price.
2. `startRound()` — opens betting; the contract sets `lockTime = now + bettingDuration`.
3. Waits out the betting window (+ a few seconds of buffer for block timestamps).
4. Snapshots the **close** price, computes `bps = round((close-open)/open*10000)`, calls `resolveRound(bps)`.
5. Logs the round result (open/close price, bps, winning bucket, bets, winners, payout) and repeats.

The window length is read from the contract (`bettingDuration`, currently **30s**), so the cycle is
~33s. `bps` is the single value a real operator submits (see `FRONTEND_INTEGRATION.md` §6).

## Price feed (`pricefeed.js`)

Live ticks come from an exchange WebSocket; a REST endpoint seeds the first price and is the fallback
when the socket is stale/disconnected. Choose the provider with the `PRICE_SOURCE` env var:

| `PRICE_SOURCE` | Live WS | Notes |
|---|---|---|
| `binance` (default) | `stream.binance.com` `@trade` | Matches the FE, deep liquidity. **Geo-blocked (HTTP 451) from US servers.** |
| `binanceus` | `stream.binance.us` `@trade` | Same protocol, works from the US, but **thin BTC liquidity** — on short (≤30s) windows the price often doesn't move, giving `0 bps`. Avoid for short windows. |
| `coinbase` | `ws-feed.exchange.coinbase.com` | Real BTC-USD, works from the US, **deep liquidity**. Best US-reachable choice for short windows. |

> Pick based on where the **bot runs** (your server), not where the FE runs.
> - Non-US server → `binance` (deep + matches FE).
> - US server → `coinbase` (deep). Avoid `binanceus` on short windows (thin liquidity → flat `0 bps` rounds).
>
> Set `ASSET` (default `BTC`) to change the pair.

## Config

Reads from the **project root `.env`** (loaded with Node's `--env-file`):

- `MONAD_RPC` — `https://rpc.monad.xyz`
- `PRICEBETGAME_ADDRESS` — deployed contract
- `OPERATOR_PRIVATE_KEY` — must be the contract's `operator` (it pays gas for start/resolve)
- `PRICE_SOURCE` *(optional)* — `binance` | `binanceus` | `coinbase` (default `binance`)
- `ASSET` *(optional)* — default `BTC`

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

Pick `binanceus` or `coinbase` if the default Binance global endpoint is geo-blocked from your machine:

```sh
PRICE_SOURCE=binanceus ./operator.sh start      # or: PRICE_SOURCE=binanceus npm start
```

## Tuning (top of `index.js`)

- `MAX_ABS_BPS` (default 300) — clamp on outliers (±3%).
- `LOCK_BUFFER_S` (default 3) — seconds to wait past `lockTime` before resolving.

To add another exchange, add an entry to `SOURCES` in `pricefeed.js` (a `binance`-style `@trade`
socket needs no extra code; a different protocol needs a small handler like the `coinbase` branch).
