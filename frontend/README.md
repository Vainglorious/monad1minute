# monad1minute

A crypto **1-minute up/down** prediction market on [Monad](https://monad.xyz).
Mobile-first web app: scan a QR → pick a username → get a wallet → play.

**Milestone 1 (this repo): seamless onboarding.** A user enters a username and the
backend creates a custodial [Privy](https://privy.io) server wallet, then shows their
Monad address and MON balance. Betting / 1-minute rounds come in later milestones.

See the design spec: [`docs/superpowers/specs/2026-06-09-onboarding-design.md`](docs/superpowers/specs/2026-06-09-onboarding-design.md).

## Stack

- **Next.js** (App Router) — frontend + API routes
- **Privy server SDK** — custodial EVM wallet creation
- **Postgres + Prisma** — user persistence
- **viem** — Monad mainnet balance reads + deployer-funded signups
- **jose** — signed, device-bound session cookies

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Configure env** — copy `.env.example` to `.env.local` and fill in:

   - `PRIVY_APP_ID`, `PRIVY_APP_SECRET` — from the [Privy dashboard](https://dashboard.privy.io).
   - `PRIVY_AUTHORIZATION_KEY` — optional now; needed when the backend signs txns later.
   - `DATABASE_URL` — a Postgres connection string (Supabase / Neon / local).
   - `SESSION_SECRET` — `openssl rand -base64 32`.
   - `MONAD_RPC`, `MONAD_CHAIN_ID` — default to Monad mainnet (`https://rpc.monad.xyz`, `143`).
   - `DEPLOYER_PRIVATE_KEY` (+ optional `DEPLOYER_ADDRESS`) — funds each new wallet at signup.
   - `SIGNUP_FUNDING_MON` — amount sent to each new wallet (default `0.1`). On mainnet this is
     **real money** sent to anyone who signs up — add anti-abuse before a public launch.

3. **Create the database schema**

   ```bash
   npm run db:push
   ```

4. **Run**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. To test the QR flow on a phone, expose localhost
   (e.g. `ngrok http 3000`) and point the QR at the public URL.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build (also typechecks)
- `npm test` — run unit tests (username validation, session signing)
- `npm run db:push` — sync the Prisma schema to Postgres
