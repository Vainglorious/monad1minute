# PriceBetGame — Mainnet Test Report

**Date:** 2026-06-09
**Network:** Monad mainnet (chain ID 143, RPC `https://rpc.monad.xyz`)
**Contract:** [`0x0f6Cce5f0A07aA77e6E36E407a72e83A4503C383`](https://monadvision.com/address/0x0f6Cce5f0A07aA77e6E36E407a72e83A4503C383)

## Summary

A fixed-odds BTC price-bucket betting contract was deployed to Monad mainnet, exercised end-to-end
with a live 3-wallet betting round, then run under an automated operator bot for ~12 simulated-market
rounds. All behavior matched the local test suite (23/23 passing). **Total cost of the entire
exercise: ~0.614 MON in gas.** No funds were lost — the 30 MON house bankroll remains in the contract
and is fully withdrawable by the owner.

## What was tested

| Area | Result |
|---|---|
| Local test suite (`forge test`) | ✅ 23/23 passing (classification, payouts, guards, solvency, config) |
| Deployment to mainnet | ✅ deployed, owner/operator set correctly |
| House funding (`fundHouse`) | ✅ |
| Live betting round (3 wallets, different buckets) | ✅ |
| Operator resolution (`resolveRound`) | ✅ winning bucket + payout computed on-chain |
| Winner claim / loser rejection | ✅ winner paid 5 MON; losers reverted `"not a winner"` |
| Owner withdrawal + solvency guard | ✅ withdrew free balance; reverted on over-withdraw |
| Operator bot (12 automated rounds, 0 bettors) | ✅ resolves every round, self-recovers open rounds |

### Representative live round (round 1)

| Wallet | Bucket | Outcome |
|---|---|---|
| W1 | A (extreme up) | **won** → claimed 5 MON (5× on 1 MON) |
| W2 | C (middle) | lost → claim reverted |
| W3 | F (extreme down) | lost → claim reverted |

Operator submitted **+15 bps**; contract classified it as bucket A, paid the single winner 5 MON.

## Gas accounting

Measured by conservation of MON (200 MON start across deployer + operator; only gas leaves the system).

| Category | Txs | Gas |
|---|---|---|
| Deploy (one-time) | 1 | 0.169 MON |
| Operator — running the market (start + resolve) | 24 (~12 rounds) | 0.349 MON |
| Setup/admin — config, 2× fundHouse, fund 3 wallets, withdraw | 8 | ~0.03 MON |
| Players — 3 bets + 1 claim | ~4 | ~0.06 MON |
| **Total** | **~37** | **~0.614 MON** |

- Average per tx: **~0.0186 MON** at ~102 gwei.
- Deploy: gasUsed 1,658,851 × effectiveGasPrice 102 gwei = **0.169 MON**.

### Operating-cost projection

The operator spends **~0.029 MON per round** (2 txs). At the tested 30s cycle:

| Cadence | Cost/round | ~Cost/hour | ~Cost/day |
|---|---|---|---|
| 60s window | 0.029 MON | 1.6 MON | 38 MON |
| **30s window (tested)** | 0.029 MON | **3.2 MON** | **76 MON** |
| 5s window | 0.029 MON | 19 MON | 458 MON |

With no bettors the **house bankroll never moves** — the only standing cost is operator gas. Gas price
varies, so these scale with network conditions.

## Final on-chain state

| | |
|---|---|
| Contract bankroll | 30 MON (withdrawable via `withdraw()`) |
| Rounds | 12, all resolved |
| Config | betAmount 1 MON, window 30s *(demo settings — set to 10 MON / 60s for production)* |
| Deployer | 69.72 MON · Operator | 99.65 MON |

## Artifacts

- Contract: `smartcontract/src/PriceBetGame.sol`
- Tests: `smartcontract/test/PriceBetGame.t.sol`
- ABI: `smartcontract/abi/PriceBetGame.json`
- Deploy script: `smartcontract/script/Deploy.s.sol`
- Operator bot + control script: `operator-bot/` (`./operator.sh start|stop|status|logs`)
- Frontend integration guide: `FRONTEND_INTEGRATION.md`

## Recommended next steps

1. Run `/security-review` (or an external audit) before real funds — the contract custodies a bankroll.
2. Restore production config: `setBetAmount(10 ether)`, `setBettingDuration(60)`.
3. Replace the bot's simulated price with a real BTC/USD feed (see `operator-bot/README.md`).
4. Rotate any non-wallet secrets that were placed in `.env` (DB password, Privy keys, session secret)
   and move them into a secrets manager.
