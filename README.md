# Guardian Dashboard

A monitoring dashboard for [OpenZeppelin Guardian](https://github.com/OpenZeppelin/guardian/) servers.

Guardian is a key-management service for [Miden](https://miden.xyz) accounts — it holds Falcon-512 signing keys, validates state transitions, and acknowledges transactions on behalf of accounts. This dashboard gives operators a real-time view of a running Guardian: liveness, account inventory, and per-account details.

---

## Pages

| Page | Status | Data source |
|---|---|---|
| **Overview**: Guardian status and ping, accounts / assets / activity cards, active / released / frozen counts, last activity | ✅ Live | Guardian API (`getDashboardInfo`, `getDashboardStats`) + env vars |
| **Accounts**: scroll-paged table with status and type chips, search, sort, column and density controls, CSV export | ✅ Live | Guardian API (`listAccounts`, `getDashboardStats`) |
| **Account details**: status, signers, vault with token names and USD, freeze / unfreeze | ✅ Live | Guardian API (`getAccount`, `getAccountSnapshot`, `pauseAccount`, `unpauseAccount`) |
| **Account activity**: one account's transactions and proposals, scroll-paged | ✅ Live | Guardian API (`listAccountDeltas`, `listAccountProposals`) |
| **Transaction details**: balance changes, notes, storage diffs, proposal metadata | ✅ Live | Guardian API (`getAccountDeltaDetail`) |
| **Activity**: every account's transactions and proposals, status chips, search, sort, CSV export, scroll-paged | ✅ Live | Guardian API (`listGlobalDeltas`, `listGlobalProposals`) |
| **Compliance**: provider config, KYC/whitelist, policy rules | 🔶 Mock | Planned; no provider connected yet |

Account ids are shown in bech32 everywhere, converted server-side from the hex the feeds return. Token symbols, decimals and USD prices come from the verified token list and Binance, the way the Miden wallet prices them (`lib/prices.ts`).

---

## Setup

### 1. Prerequisites

- Node.js 20+
- A running Guardian (local or remote)
- A [Clerk](https://clerk.com) application (for authentication)
- The operator's **commitment** and **private key** (Falcon-512, hex-encoded) — used to authenticate with the Guardian server

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
# Clerk — from dashboard.clerk.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Guardian endpoints — JSON array, one entry per Guardian
# Each user's allowed endpoint IDs and role are set in Clerk user public metadata
GUARDIAN_ENDPOINTS=[{
  "id": "testnet",
  "label": "Guardian Testnet",
  "url": "https://guardian.example.com",
  "network": "MidenTestnet",
  "commitment": "0x...",
  "privateKey": "..."
}]

# PostHog analytics (optional)
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Optional extras:

- `GUARDIAN_PRIVATE_KEY_{ID}` (e.g. `GUARDIAN_PRIVATE_KEY_TESTNET`) — supply an endpoint's `privateKey` separately to keep `GUARDIAN_ENDPOINTS` under Vercel's 4KB env var limit

Dollar values follow the Miden wallet (see `lib/prices.ts`): Binance spot prices for the faucets named by `0xMiden/token-list` and `0xMiden/wallet-config`, the network's native asset read from chain (fixed at $1 when it is USDCX), and no figure for anything else. Nothing about tokens is configured here.

### 3. User access

Users are managed via Clerk. Set `publicMetadata` on each user in the Clerk dashboard:

```json
{
  "role": "admin",
  "endpointIds": ["testnet"]
}
```

- `role`: `"admin"` shows the User Management tab; `"viewer"` hides it
- `endpointIds`: which Guardian servers the user can connect to

### 4. Run

```bash
npm install
npm run dev        # → http://localhost:3000
```

---

## Authentication flow

The dashboard authenticates to the Guardian server using a **challenge-response protocol**:

1. Dashboard calls `GET /challenge` with the operator commitment
2. Guardian returns a signing digest
3. Dashboard signs the digest with the operator's Falcon-512 private key (via Miden WASM)
4. Dashboard calls `POST /verify` with the commitment and signature
5. Guardian returns a session cookie used for all subsequent API calls

The private key never leaves the server process.

---

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS v4**
- **Clerk** — authentication and user management
- **SWR** — data fetching with polling
- **Recharts** — charts
- **PostHog** — product analytics
- **Miden SDK** (`@miden-sdk/miden-sdk`) — Falcon-512 signing via WASM
- **`@openzeppelin/guardian-operator-client`** — typed Guardian API client
