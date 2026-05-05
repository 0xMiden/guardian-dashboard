# Guardian Dashboard

A monitoring dashboard for [OpenZeppelin Guardian](https://github.com/OpenZeppelin/guardian/) nodes.

Guardian is a key-management service for [Miden](https://miden.xyz) accounts — it holds Falcon-512 signing keys, validates state transitions, and cosigns transactions on behalf of accounts. This dashboard gives operators a real-time view of a running node: liveness, account inventory, and per-account details.

---

## Pages

| Page | Status | Data source |
|---|---|---|
| **Overview** — heartbeat latency, account totals, operator identity | ✅ Live | Guardian API + env vars |
| **Accounts** — full account list with status, signers, pending candidates | ✅ Live | Guardian API (`listAccounts` / `getAccount`) |
| **Account detail** — per-account fields, signers, freeze/unfreeze | ✅ Live | Guardian API |
| **Transactions** — aggregate signed/rejected stats and volume chart | 🔶 Mock | Needs Guardian `GET /delta/since` |
| **Compliance** — provider config, KYC/whitelist, policy rules | 🔶 Mock | Planned; no provider connected yet |

---

## Setup

### 1. Prerequisites

- Node.js 20+
- A running Guardian node (local or remote)
- A [Clerk](https://clerk.com) application (for authentication)
- The operator's **commitment** and **private key** (Falcon-512, hex-encoded) — used to authenticate with the Guardian server

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
# Clerk — from dashboard.clerk.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Guardian endpoints — JSON array, one entry per Guardian node
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

### 3. User access

Users are managed via Clerk. Set `publicMetadata` on each user in the Clerk dashboard:

```json
{
  "role": "admin",
  "endpointIds": ["testnet"]
}
```

- `role`: `"admin"` shows the User Management tab; `"viewer"` hides it
- `endpointIds`: which Guardian nodes the user can connect to

### 4. Run

```bash
npm install
npm run dev        # → http://localhost:3001
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

## Pending Guardian API features

Some dashboard sections are mocked because the required Guardian API endpoints do not yet exist:

| Feature | Missing endpoint |
|---|---|
| Per-account transaction history | `GET /accounts/:id/delta/since` |
| Aggregate transaction stats | `GET /delta/since` across all accounts |

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
