// PriceBetGame operator bot
// --------------------------
// Drives the betting game on a tight cycle with near-zero dead time:
//   startRound()  ->  wait the window  ->  resolveRound(bps)  ->  repeat
//
// Settlement is reconstructed from Coinbase 1-minute candles (candles.js):
//   open  = candle open at round.startTime   (== the chart's BASE line)
//   close = candle open at round.lockTime
// so the price players see and the price that settles are one and the same,
// and anyone can re-verify a round against Coinbase's public candles.
//
// This bot is the PRIMARY operator. The Vercel /api/operator/tick endpoint
// remains as a manual self-heal fallback (no cron) — run ONE operator.
//
// Config comes from the project root .env (loaded via `node --env-file=../.env`):
//   MONAD_RPC, PRICEBETGAME_ADDRESS, OPERATOR_PRIVATE_KEY
// Optional env: ASSET (default BTC), COINBASE_REST_HOST.
//
// Run:  cd operator-bot && npm install && npm start

import { createPublicClient, createWalletClient, http, defineChain, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { fetchCandles, pickOpenAt, roundPrices } from './candles.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz'
const CONTRACT = process.env.PRICEBETGAME_ADDRESS
const PK = process.env.OPERATOR_PRIVATE_KEY
const ASSET = (process.env.ASSET || 'BTC').toUpperCase()

if (!CONTRACT || !PK) {
  console.error('Missing PRICEBETGAME_ADDRESS or OPERATOR_PRIVATE_KEY in env. Run with `node --env-file=../.env index.js`.')
  process.exit(1)
}

const MAX_ABS_BPS = 300       // clamp extreme outliers to +/-3%
const LOCK_BUFFER_S = 3       // extra seconds past lockTime before resolving (block-timestamp safety)

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

const ABI = [
  { type: 'function', name: 'startRound', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'resolveRound', stateMutability: 'nonpayable', inputs: [{ name: 'priceChangeBps', type: 'int256' }], outputs: [] },
  { type: 'function', name: 'currentRoundId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bettingDuration', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'betAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bucketCount', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'uint8' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'rounds', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'startTime', type: 'uint64' }, { name: 'lockTime', type: 'uint64' },
      { name: 'resolved', type: 'bool' }, { name: 'winner', type: 'uint8' },
      { name: 'betCount', type: 'uint256' }, { name: 'winnerCount', type: 'uint256' },
      { name: 'payoutPerWinner', type: 'uint256' },
    ],
  },
]

const account = privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`)
const pub = createPublicClient({ chain: monad, transport: http(RPC), pollingInterval: 500 })
const wallet = createWalletClient({ account, chain: monad, transport: http(RPC) })

const BUCKETS = ['A (up >+0.1%)', 'B (+0.05..+0.1%)', 'C (0..+0.05%)', 'D (-0.05..0%)', 'E (-0.1..-0.05%)', 'F (down <-0.1%)']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fmt = (n) => (n == null ? 'n/a' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Convert open/close prices to clamped signed basis points.
function toBps(open, close) {
  if (!open || !close) return 0
  let bps = Math.round(((close - open) / open) * 10000)
  return Math.max(-MAX_ABS_BPS, Math.min(MAX_ABS_BPS, bps))
}

async function send(functionName, args = []) {
  const hash = await wallet.writeContract({ address: CONTRACT, abi: ABI, functionName, args })
  const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 400 })
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`)
  return receipt
}

async function readRound(id) {
  const r = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'rounds', args: [id] })
  return { startTime: r[0], lockTime: r[1], resolved: r[2], winner: r[3], betCount: r[4], winnerCount: r[5], payoutPerWinner: r[6] }
}

// Resolve `id` from candle-reconstructed prices. Settles 0 bps only as a last
// resort (candles down after retries) so a stuck round never blocks the game.
async function resolveFromCandles(id, round) {
  const prices = await roundPrices(round.startTime, round.lockTime, ASSET)
  const bps = prices ? toBps(prices.open, prices.close) : 0
  if (!prices) console.error(`⚠ candles unavailable after retries — settling round ${id} neutral (0 bps)`)
  await send('resolveRound', [BigInt(bps)])
  return { bps, prices }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function resolveOpenRoundIfAny() {
  const id = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentRoundId' })
  if (id === 0n) return
  const r = await readRound(id)
  if (r.resolved) return
  const nowS = BigInt(Math.floor(Date.now() / 1000))
  if (nowS < r.lockTime) {
    const waitMs = Number(r.lockTime - nowS + BigInt(LOCK_BUFFER_S)) * 1000
    console.log(`↺ recovering: round ${id} still open, waiting ${waitMs / 1000}s to resolve…`)
    await sleep(waitMs)
  }
  const { bps } = await resolveFromCandles(id, r)
  console.log(`↺ recovered round ${id}: resolved ${bps >= 0 ? '+' : ''}${bps} bps`)
}

async function runForever() {
  console.log('PriceBetGame operator bot (Coinbase candle settlement)')
  console.log('  operator :', account.address)
  console.log('  contract :', CONTRACT)
  console.log('  rpc      :', RPC)
  console.log('  asset    :', `${ASSET}/USD (Coinbase 1m candles)`)

  const duration = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bettingDuration' })
  const betAmount = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'betAmount' })
  console.log('  stake    :', formatEther(betAmount), 'MON/bet')
  console.log('  window   :', Number(duration), 's (cycle ≈', Number(duration) + LOCK_BUFFER_S, 's )\n')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // 0) self-heal: never call startRound while a round is still active.
      await resolveOpenRoundIfAny()

      // 1) open the round; its BASE price is the candle open at startTime
      //    (the exact line the frontend chart draws).
      await send('startRound')
      const id = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentRoundId' })
      const round = await readRound(id)
      const candles = await fetchCandles(ASSET)
      const base = candles ? pickOpenAt(candles, Number(round.startTime)) : null
      console.log(`\n▶ Round ${id} OPEN — base ${base != null ? `$${fmt(base)}` : 'n/a'} — betting for ${Number(duration)}s`)

      // 2) wait out the betting window (+ buffer so block.timestamp >= lockTime)
      await sleep((Number(duration) + LOCK_BUFFER_S) * 1000)

      // 3) settle from candles: open@startTime -> close(open)@lockTime
      const { bps, prices } = await resolveFromCandles(id, round)

      // 4) report
      const r = await readRound(id)
      const arrow = bps > 0 ? '▲' : bps < 0 ? '▼' : '▬'
      console.log(
        `■ Round ${id} RESOLVED — ${prices ? `$${fmt(prices.open)} ${arrow} $${fmt(prices.close)}` : 'candles n/a'} (${bps >= 0 ? '+' : ''}${bps} bps) ` +
        `→ bucket ${BUCKETS[r.winner]} | ${r.betCount} bet(s), ${r.winnerCount} winner(s)` +
        (r.winnerCount > 0n ? `, payout ${formatEther(r.payoutPerWinner)} MON each` : '')
      )

      // per-bucket breakdown of bets collected
      if (r.betCount > 0n) {
        const labels = ['A', 'B', 'C', 'D', 'E', 'F']
        const counts = await Promise.all(
          labels.map((_, b) => pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bucketCount', args: [id, b] }))
        )
        const breakdown = labels.map((l, i) => `${l}:${counts[i]}`).join(' ')
        const pool = formatEther(r.betCount * betAmount)
        const winners = counts[r.winner]
        const paidOut = formatEther(winners * r.payoutPerWinner)
        console.log(`    bets collected → ${breakdown}  (${r.betCount} total, pool ${pool} MON) | paid out ${paidOut} MON`)
      }
    } catch (err) {
      console.error('⚠ cycle error:', err.shortMessage || err.message)
      await sleep(5000) // back off, then retry the loop
    }
  }
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

runForever().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
