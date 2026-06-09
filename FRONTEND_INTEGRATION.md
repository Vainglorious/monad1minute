# Frontend Integration — PriceBetGame (Monad mainnet)

Everything the FE needs to integrate the BTC 1-minute price-bucket betting game.

- **Machine-readable ABI:** [`smartcontract/abi/PriceBetGame.json`](smartcontract/abi/PriceBetGame.json)
- **Source:** [`smartcontract/src/PriceBetGame.sol`](smartcontract/src/PriceBetGame.sol)

---

## 1. Network & contract

| | |
|---|---|
| Network | **Monad mainnet** |
| RPC URL | `https://rpc.monad.xyz` |
| Chain ID | `143` (`0x8f`) |
| Native currency | **MON** (18 decimals) |
| Contract address | `0x0f6Cce5f0A07aA77e6E36E407a72e83A4503C383` |

> ⚠️ This is the same contract used for the live test. If you redeploy for production, swap the address.

```ts
// viem chain config
import { defineChain } from 'viem'
export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
})
export const PRICE_BET_GAME = '0x0f6Cce5f0A07aA77e6E36E407a72e83A4503C383'
```

---

## 2. The game in one paragraph

A round runs for a fixed window (default 60s; currently 1 MON / 30s on the test deployment).
While the window is open, each wallet may place **one** bet of exactly `betAmount` MON on **one of six
buckets** describing how much BTC/USD will move over the window. After the window closes, a trusted
**operator** submits the actual price change and the contract pays winners **fixed odds** (extreme
buckets pay more). Winners must **`claim()`** their payout; losers get nothing.

### Buckets

Price change is a **signed integer in basis points (bps)**: `0.1% = 10 bps`, `0.01% = 1 bp`.

| Enum value | Name | Condition (bps) | Meaning | Tier | Payout |
|---|---|---|---|---|---|
| `0` | A | `bps > 10`        | up > +0.1%        | extreme | 5× |
| `1` | B | `5 < bps <= 10`   | +0.05% to +0.1% up| middle  | 2× |
| `2` | C | `0 <= bps <= 5`   | 0% to +0.05% up   | middle  | 2× |
| `3` | D | `-5 <= bps < 0`   | -0.05% to 0% down | middle  | 2× |
| `4` | E | `-10 <= bps < -5` | -0.1% to -0.05% dn| middle  | 2× |
| `5` | F | `bps < -10`       | down > 0.1%       | extreme | 5× |

`placeBet` takes the enum value (`uint8` `0..5`). Exactly `0%` → bucket **C**.

```ts
export const BUCKETS = [
  { id: 0, key: 'A', label: 'Up > +0.1%',        tier: 'extreme' },
  { id: 1, key: 'B', label: '+0.05% to +0.1%',   tier: 'middle'  },
  { id: 2, key: 'C', label: '0% to +0.05%',      tier: 'middle'  },
  { id: 3, key: 'D', label: '-0.05% to 0%',      tier: 'middle'  },
  { id: 4, key: 'E', label: '-0.1% to -0.05%',   tier: 'middle'  },
  { id: 5, key: 'F', label: 'Down > -0.1%',      tier: 'extreme' },
] as const
```

---

## 3. Functions the FE calls

### Reads (no gas)

| Function | Returns | Use |
|---|---|---|
| `currentRoundId() → uint256` | active/last round id (0 = none yet) | which round to show |
| `rounds(uint256) → (uint64 startTime, uint64 lockTime, bool resolved, uint8 winner, uint256 betCount, uint256 winnerCount, uint256 payoutPerWinner)` | round struct | round state, countdown, result |
| `bets(uint256 roundId, address player) → (uint8 bucket, bool placed, bool claimed)` | this user's bet | has the user bet? claimed? |
| `betAmount() → uint256` | stake in wei | **read dynamically — don't hardcode** (10 MON prod, 1 MON on test) |
| `extremeMultiplier() / middleMultiplier() → uint256` | odds | show potential payout |
| `bettingDuration() → uint64` | window seconds | countdown length |
| `reserved() / freeBalance() → uint256` | house accounting | optional admin UI |
| `owner() / operator() → address` | roles | gate admin/operator UI |
| `classify(int256 bps) → uint8` | bucket | preview which bucket a given move maps to |

**Deriving UI state from `rounds(id)`** (let `now = current unix time`):
- **Betting open** ⇔ `!resolved && now < lockTime`
- **Locked, awaiting result** ⇔ `!resolved && now >= lockTime`
- **Resolved** ⇔ `resolved === true` → winning bucket = `winner`, each winner gets `payoutPerWinner` wei
- **Did this user win?** user's `bets(id, addr).bucket === winner` (and `placed === true`)
- **Claimable?** won && `bets(id, addr).claimed === false`

### Writes (player)

| Function | Args | Value (msg.value) | Notes |
|---|---|---|---|
| `placeBet(uint8 bucket)` | bucket `0..5` | **exactly `betAmount`** | reverts: `"wrong stake"`, `"betting closed"`, `"already bet"`, `"no active round"`, `"house underfunded"` |
| `claim(uint256 roundId)` | round id | 0 | reverts: `"not resolved"`, `"no bet"`, `"already claimed"`, `"not a winner"` |

> The FE must send `value === betAmount()`. Read it live; never assume 10 MON.

### Writes (operator only — usually a backend, not the FE)

| Function | Args | Notes |
|---|---|---|
| `startRound()` | — | opens a new round, sets `lockTime = now + bettingDuration` |
| `resolveRound(int256 priceChangeBps)` | signed bps | only after `lockTime`; see §6 |

### Writes (owner only — admin)

`setOperator(address)`, `transferOwnership(address)`, `setBetAmount(uint256)`,
`setMultipliers(uint256 extreme, uint256 middle)`, `setBettingDuration(uint64)`,
`fundHouse() payable`, `withdraw(uint256)`. Config setters revert with `"round active"` mid-round.

---

## 4. Events (for indexing / live UI)

```solidity
event RoundStarted(uint256 indexed roundId, uint64 startTime, uint64 lockTime);
event BetPlaced(uint256 indexed roundId, address indexed player, uint8 bucket, uint256 amount);
event RoundResolved(uint256 indexed roundId, int256 priceChangeBps, uint8 winner, uint256 winnerCount, uint256 payoutPerWinner);
event Claimed(uint256 indexed roundId, address indexed player, uint256 amount);
event HouseFunded(address indexed from, uint256 amount);
event Withdrawn(address indexed to, uint256 amount);
```

Subscribe to `RoundStarted` (start countdown), `BetPlaced` (live pool/feed), `RoundResolved`
(reveal result + enable claims), `Claimed` (update balances).

---

## 5. Example flows (viem)

```ts
import { createPublicClient, createWalletClient, custom, http, parseAbi } from 'viem'
import abi from './smartcontract/abi/PriceBetGame.json'

const pub = createPublicClient({ chain: monad, transport: http() })
const wallet = createWalletClient({ chain: monad, transport: custom(window.ethereum) })

// --- read current round + my bet ---
const roundId = await pub.readContract({ address: PRICE_BET_GAME, abi, functionName: 'currentRoundId' })
const r = await pub.readContract({ address: PRICE_BET_GAME, abi, functionName: 'rounds', args: [roundId] })
// r = [startTime, lockTime, resolved, winner, betCount, winnerCount, payoutPerWinner]
const stake = await pub.readContract({ address: PRICE_BET_GAME, abi, functionName: 'betAmount' })

// --- place a bet on bucket A (extreme up) ---
const [account] = await wallet.getAddresses()
await wallet.writeContract({
  account, address: PRICE_BET_GAME, abi,
  functionName: 'placeBet', args: [0], value: stake, // MUST equal betAmount()
})

// --- after resolution, claim if winner ---
await wallet.writeContract({
  account, address: PRICE_BET_GAME, abi,
  functionName: 'claim', args: [roundId],
})

// --- live updates ---
pub.watchContractEvent({ address: PRICE_BET_GAME, abi, eventName: 'RoundResolved',
  onLogs: (logs) => { /* show winner bucket + enable claim */ } })
```

ethers v6 is equivalent: `new ethers.Contract(PRICE_BET_GAME, abi, signerOrProvider)` then
`contract.placeBet(0, { value: stake })`, `contract.claim(roundId)`, `contract.on('RoundResolved', ...)`.

### Payout preview helper

```ts
function potentialPayout(bucketId: number, stakeWei: bigint, extreme: bigint, middle: bigint) {
  const isExtreme = bucketId === 0 || bucketId === 5
  return stakeWei * (isExtreme ? extreme : middle) // total returned, includes stake
}
// e.g. 1 MON on bucket A → 5 MON; 1 MON on bucket C → 2 MON
```

---

## 6. How the operator wallet works (answering "what data does it submit?")

The **operator** is the trusted settler — a single wallet (currently `0xCc07740AeC7Cb664ce6F3de6f260062497a8Bd44`)
that drives every round. It is normally an **off-chain backend/bot**, not the user-facing FE. Its loop:

1. **`startRound()`** — opens betting; the contract stamps `lockTime = now + bettingDuration`.
2. **Off-chain, it measures BTC/USD** over the window: record the price at (or near) `startTime` and again
   at `lockTime`, from whatever source you trust (an exchange API like Binance/Coinbase, or a Pyth feed).
   Compute the percentage change and convert it to **signed basis points**:
   `bps = round((priceClose - priceOpen) / priceOpen * 10000)`.
   Examples: +0.153% → `15`; −0.04% → `-4`; +1.2% → `120`; no change → `0`.
3. **`resolveRound(int256 priceChangeBps)`** — submits **that single signed integer**. That's the *only*
   data the operator submits. It does **not** submit the raw prices — just the net change in bps.

The contract then does the rest on-chain: `classify(bps)` picks the winning bucket, sets
`payoutPerWinner = betAmount × (extreme ? 5 : 2)`, and lets winners `claim()`.

**Notes for whoever builds the operator bot:**
- `resolveRound` reverts if called before `lockTime` (`"betting open"`) or twice (`"already resolved"`),
  and only the operator address may call it (`"not operator"`).
- Rounds are strictly sequential: you can't `startRound()` again until the current one is resolved.
- Choose a consistent rounding rule for bps (recommend **round to nearest** integer bp) — it determines
  edge cases between adjacent buckets, so document it and apply it the same way every round.
- Trust assumption: players trust the operator to report BTC's move honestly. (A future upgrade could
  replace this with an on-chain oracle so resolution is trustless.)

---

## 7. Gotchas checklist

- [ ] Always send `value === betAmount()` (read live; prod 10 MON, test deployment 1 MON).
- [ ] One bet per wallet per round — check `bets(id, addr).placed` before showing the bet form.
- [ ] Betting closes at `lockTime` even if the operator is slow — disable the form when `now >= lockTime`.
- [ ] Winnings are **pull-based**: surface a "Claim" button after `RoundResolved`; nothing auto-pays.
- [ ] `winner` / `payoutPerWinner` are only meaningful when `resolved === true`.
- [ ] All amounts are wei (18 decimals) — format with `formatEther` / `parseEther`.
```
