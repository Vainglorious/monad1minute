// PriceBetGame operator bot
// --------------------------
// Drives the betting game on a fixed cycle:
//   startRound()  ->  wait out the betting window  ->  resolveRound(simulatedBps)  ->  repeat
//
// It SIMULATES a BTC/USD market with a random walk (no real price feed) and submits the
// per-round change in basis points. It resolves every round even if nobody bet.
//
// Config comes from the project root .env (loaded via `node --env-file=../.env`):
//   MONAD_RPC, PRICEBETGAME_ADDRESS, OPERATOR_PRIVATE_KEY
//
// Run:  cd operator-bot && npm install && npm start

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  formatEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz'
const CONTRACT = process.env.PRICEBETGAME_ADDRESS
const PK = process.env.OPERATOR_PRIVATE_KEY

if (!CONTRACT || !PK) {
  console.error('Missing PRICEBETGAME_ADDRESS or OPERATOR_PRIVATE_KEY in env. Run with `node --env-file=../.env index.js`.')
  process.exit(1)
}

// Market simulation tuning
let simPrice = 65000          // starting simulated BTC/USD price
const SIGMA_BPS = 12          // std-dev of per-round move in basis points (~0.12%); spreads across buckets
const MAX_ABS_BPS = 300       // clamp extreme outliers to +/-3%
const LOCK_BUFFER_S = 3       // extra seconds to wait past lockTime before resolving (block-timestamp safety)

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

// Minimal ABI — only what the operator needs.
const ABI = [
  { type: 'function', name: 'startRound', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'resolveRound', stateMutability: 'nonpayable', inputs: [{ name: 'priceChangeBps', type: 'int256' }], outputs: [] },
  { type: 'function', name: 'currentRoundId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bettingDuration', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function', name: 'rounds', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'startTime', type: 'uint64' },
      { name: 'lockTime', type: 'uint64' },
      { name: 'resolved', type: 'bool' },
      { name: 'winner', type: 'uint8' },
      { name: 'betCount', type: 'uint256' },
      { name: 'winnerCount', type: 'uint256' },
      { name: 'payoutPerWinner', type: 'uint256' },
    ],
  },
]

const account = privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`)
const pub = createPublicClient({ chain: monad, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: monad, transport: http(RPC) })

const BUCKETS = ['A (up >+0.1%)', 'B (+0.05..+0.1%)', 'C (0..+0.05%)', 'D (-0.05..0%)', 'E (-0.1..-0.05%)', 'F (down <-0.1%)']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Box-Muller standard normal
function gaussian() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Advance the simulated price one window and return the signed bps change.
function simulateMove() {
  let bps = Math.round(gaussian() * SIGMA_BPS)
  bps = Math.max(-MAX_ABS_BPS, Math.min(MAX_ABS_BPS, bps))
  const open = simPrice
  simPrice = open * (1 + bps / 10000)
  return { open, close: simPrice, bps }
}

async function send(functionName, args = []) {
  const hash = await wallet.writeContract({ address: CONTRACT, abi: ABI, functionName, args })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`)
  return receipt
}

async function readRound(id) {
  const r = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'rounds', args: [id] })
  return { startTime: r[0], lockTime: r[1], resolved: r[2], winner: r[3], betCount: r[4], winnerCount: r[5], payoutPerWinner: r[6] }
}

const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function resolveOpenRoundIfAny() {
  // On startup, if the last round is unresolved, settle it so we can start fresh.
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
  const { open, close, bps } = simulateMove()
  await send('resolveRound', [BigInt(bps)])
  console.log(`↺ recovered round ${id}: resolved ${bps} bps`)
}

async function runForever() {
  console.log('PriceBetGame operator bot')
  console.log('  operator :', account.address)
  console.log('  contract :', CONTRACT)
  console.log('  rpc      :', RPC)

  const duration = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'bettingDuration' })
  console.log('  window   :', Number(duration), 's (cycle ≈', Number(duration) + LOCK_BUFFER_S, 's )\n')

  await resolveOpenRoundIfAny()

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // 1) open a new round
      await send('startRound')
      const id = await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'currentRoundId' })
      console.log(`\n▶ Round ${id} OPEN — betting for ${Number(duration)}s (BTC ~ $${fmt(simPrice)})`)

      // 2) wait out the betting window (+ buffer so block.timestamp >= lockTime)
      await sleep((Number(duration) + LOCK_BUFFER_S) * 1000)

      // 3) simulate the market move and resolve
      const { open, close, bps } = simulateMove()
      await send('resolveRound', [BigInt(bps)])

      // 4) report
      const r = await readRound(id)
      const arrow = bps > 0 ? '▲' : bps < 0 ? '▼' : '▬'
      console.log(
        `■ Round ${id} RESOLVED — BTC $${fmt(open)} ${arrow} $${fmt(close)} (${bps >= 0 ? '+' : ''}${bps} bps) ` +
        `→ bucket ${BUCKETS[r.winner]} | ${r.betCount} bet(s), ${r.winnerCount} winner(s)` +
        (r.winnerCount > 0n ? `, payout ${formatEther(r.payoutPerWinner)} MON each` : '')
      )
    } catch (err) {
      console.error('⚠ cycle error:', err.shortMessage || err.message)
      await sleep(5000) // back off, then retry the loop
    }
  }
}

runForever().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
