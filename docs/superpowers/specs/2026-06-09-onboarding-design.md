# monad1minute — Milestone 1: Seamless Onboarding (Design)

Date: 2026-06-09
Status: Approved

## Context

A crypto "1-minute up/down" prediction market on Monad. Mobile-first web app that a
user reaches by scanning a QR code. The long-term product is on-chain betting in 1-minute
rounds, but this spec covers **only the first milestone: seamless onboarding**.

Goal: a user scans a QR → lands on the app → types a username → backend creates a custodial
Privy server wallet → user lands on a wallet dashboard showing their Monad address and MON
balance. No betting in this milestone.

## Decisions (from brainstorming)

- **Market mechanic (future):** on-chain betting contract. Not built in this milestone.
- **First milestone:** onboarding only.
- **Stack:** Next.js (App Router) full-stack — frontend + API routes in one codebase.
- **Database:** Postgres (Supabase/Neon) via Prisma.
- **Return auth:** device-bound signed session cookie (seamless). New device = new account.
- **Wallet ownership:** custodial — backend holds a P-256 authorization key; it is the wallet `owner`.
- **Network:** Monad testnet.

## Architecture

Single Next.js app, one deploy.

- **Frontend (App Router, client components):**
  - Onboarding screen: username input + "Create" button (mobile-first).
  - Dashboard: display handle, Monad address (copy + QR), live MON balance, logout.
- **API routes:**
  - `POST /api/signup` — create wallet + user, set session cookie.
  - `GET /api/me` — return current user from session cookie (or 401).
  - `POST /api/logout` — clear session cookie.
- **External services:**
  - Privy server SDK (`@privy-io/server-auth`) — server wallet creation.
  - Postgres + Prisma — user persistence.
  - Monad testnet RPC via `viem` — balance reads.

## Onboarding flow

1. User scans QR → app loads → client calls `GET /api/me`.
2. No session → show username screen.
3. User submits username → `POST /api/signup`:
   a. Validate username (length/charset) and uniqueness.
   b. Privy `createWallet({ chainType: 'ethereum', owner: <authorization key> })`.
   c. Persist `User { username, privyWalletId, address }`.
   d. Issue signed httpOnly session cookie bound to this user/device.
   e. Return user payload.
4. Frontend shows dashboard with address + live MON balance (Monad testnet RPC).
5. Returning visit: cookie present → `GET /api/me` restores session → dashboard.

## Data model (Prisma / Postgres)

```
model User {
  id            String   @id @default(cuid())
  username      String   @unique
  privyWalletId String   @unique
  address       String   @unique
  createdAt     DateTime @default(now())
}
```

Sessions are stateless: a signed token (HMAC/JWT with `SESSION_SECRET`) stored in an
httpOnly cookie. No session table for v1.

## Configuration / secrets (env)

`.env.local` (never committed; provide `.env.example`):

- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `PRIVY_AUTHORIZATION_KEY` — P-256 private key; backend is the wallet owner.
- `DATABASE_URL` — Postgres connection string.
- `SESSION_SECRET` — signs session cookies.
- `MONAD_RPC_URL` — Monad testnet RPC endpoint.
- `MONAD_CHAIN_ID` — Monad testnet chain id.

Setup step (documented in README): create a Privy app, generate app id/secret, generate
the authorization key, provision a Postgres DB.

## Security notes

- Wallet creation and the authorization key are strictly server-side.
- Session cookie: `httpOnly`, `secure`, `sameSite=lax`, signed.
- Username treated as a public display handle; enforced unique (409 if taken).

## Error handling

- Privy failure → 502, surface a friendly error; do not persist a partial user
  (create wallet first, then persist; failed persist is reported).
- Duplicate username → 409 "handle taken".
- Balance RPC failure → dashboard renders with address and a non-blocking
  "balance unavailable — retry" state.

## Testing

- Unit: username validation; session sign/verify round-trip.
- Integration: `/api/signup` happy path, duplicate username, Privy failure (Privy mocked);
  `/api/me` with and without cookie.

## Explicitly out of scope (later milestones)

Betting, 1-minute rounds, price feeds/oracles, smart contracts, payouts, faucet,
cross-device account portability.
