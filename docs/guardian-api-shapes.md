# Guardian Operator Dashboard API — Raw Response Shapes

All examples are live responses from `guardian-stg.openzeppelin.com` (devnet, v0.1.0).
Raw JSON files are in `docs/api-shapes/`.
All requests require a session cookie obtained via the auth flow (`GET /auth/challenge` → `POST /auth/verify`).

---

## Authentication

```
GET  /auth/challenge?commitment=<hex>
POST /auth/verify   { commitment: string, signature: string }
```

`/auth/verify` sets `guardian_operator_session` cookie (HttpOnly, 8h TTL).

---

## GET /dashboard/info → [`dashboard-info.json`](api-shapes/dashboard-info.json)

Node-level aggregate summary. Single object, no pagination.

**Notes:**
- `accounts_by_auth_method`: currently `miden_ecdsa` and `miden_falcon`; `evm` key absent when count is 0
- `in_flight_proposal_count`: proposals in `pending` state (awaiting cosigners) — 48 on devnet, meaning most accounts are multisig
- `delta_status_counts.candidate`: deltas submitted to Miden but not yet canonicalized
- `degraded_aggregates`: list of account IDs where aggregate data may be stale (empty = healthy)

---

## GET /dashboard/accounts → [`dashboard-accounts.json`](api-shapes/dashboard-accounts.json)

Paginated account list, sorted **newest-first by `updated_at`**.

Query params: `limit` (default 50), `cursor` (opaque string from `next_cursor`)

**Notes:**
- `state_status`: `"available"` | `"frozen"` | `"unavailable"`
- `auth_scheme`: `"falcon"` | `"ecdsa"` — lowercase, no `miden_` prefix (differs from `/dashboard/info`)
- `has_pending_candidate`: true when a delta is in `candidate` state (submitted to Miden, awaiting canonicalization)
- `current_commitment`: Poseidon2 hash of the account's current public key polynomial; changes on every state update
- `next_cursor`: `null` when on the last page

---

## GET /dashboard/accounts/{id} → [`dashboard-account-detail.json`](api-shapes/dashboard-account-detail.json)

Single account detail — superset of the list item.

**Notes:**
- `authorized_signer_ids`: Falcon public key commitments of all authorized cosigners
- `state_created_at` / `state_updated_at`: timestamps of the on-chain Miden state (vs Guardian metadata timestamps)

---

## GET /dashboard/accounts/{id}/snapshot → [`dashboard-account-snapshot.json`](api-shapes/dashboard-account-snapshot.json)

Current vault state at the account's latest commitment.

**Notes:**
- `amount`: **string** (not number) to preserve full `u64` precision. `"100000000"` = 1 token with 8 decimals (Miden default)
- `faucet_id`: the Miden account ID of the token faucet — no human name or ticker available from Guardian
- `has_pending_candidate`: if true, snapshot may be stale (a new state update is in flight)
- Guardian does **not** expose historical snapshots — only the current state

---

## GET /dashboard/accounts/{id}/deltas → [`dashboard-account-deltas.json`](api-shapes/dashboard-account-deltas.json)

Per-account state-change history, sorted **newest-first by nonce**.

Query params: `limit`, `cursor`

**Notes:**
- `nonce`: per-account monotonic counter — effectively the transaction sequence number
- `status`: `"canonical"` | `"candidate"` | `"discarded"` (never `"pending"` — those live in `/proposals`)
- `status_timestamp`: time of the most recent status transition
- `new_commitment`: `null` for discarded deltas (state did not advance)
- `proposal_type`: absent for single-key accounts; present for multisig deltas: `"add_signer"` | `"remove_signer"` | `"change_threshold"` | `"update_procedure_threshold"` | `"p2id"` | `"consume_notes"` | `"switch_guardian"`
- `retry_count`: absent on canonical/discarded, present on `candidate` (number of canonicalization retry attempts)
- The raw `delta_payload` (full Miden transaction blob) is stored server-side but **not exposed** in this endpoint

---

## GET /dashboard/accounts/{id}/proposals → [`dashboard-account-proposals.json`](api-shapes/dashboard-account-proposals.json)

In-flight multisig proposals for one account (awaiting cosigner signatures).

Query params: `limit`, `cursor`

**Notes:**
- `commitment`: the proposal's own commitment (not the account's current state commitment)
- `proposer_id`: Falcon public key commitment of the signer who initiated the proposal
- `new_commitment`: `null` until the proposal is fully signed and executed
- `signatures_collected` / `signatures_required`: e.g. `1/1` for a 1-of-1 multisig, `3/3` for a 3-of-3
- Proposals only exist for multisig accounts. Single-key accounts use `push_delta` directly → no proposal phase
- Once executed, a proposal disappears from this endpoint and a new delta appears in `/deltas`

---

## GET /dashboard/deltas → [`dashboard-global-deltas.json`](api-shapes/dashboard-global-deltas.json)

Global delta feed across all accounts, sorted **newest-first by status_timestamp**.

Query params: `limit`, `cursor`, `status` (filter: `canonical` | `candidate` | `discarded`)

**Notes:**
- Same shape as per-account `/deltas` plus `account_id`
- The very large nonce (`1777995815713`) is normal — Miden nonces are not sequential integers but derive from the block number

---

## GET /dashboard/proposals → [`dashboard-global-proposals.json`](api-shapes/dashboard-global-proposals.json)

Global in-flight proposal feed across all accounts, sorted **newest-first by originating_timestamp**.

Query params: `limit`, `cursor`

**Notes:**
- Same shape as per-account `/proposals` plus `account_id`
- On devnet: **48 proposals in flight**, all fit on one page (`next_cursor: null`)
- `signatures_required > 1` indicates a genuine multisig threshold

---

## Snapshot of devnet state (2026-05-20)

| Metric | Value |
|---|---|
| Total accounts | 88 |
| Falcon accounts | 67 |
| ECDSA accounts | 21 |
| Canonical deltas | 44 |
| Candidate deltas | 0 |
| In-flight proposals | 48 |
| Last activity | 2026-05-14 |

The 48 in-flight proposals against 88 total accounts confirms most accounts are multisig setups.

---

## What Guardian does NOT expose

- **Token metadata**: no ticker symbol, name, or decimals for `faucet_id` values — Guardian is token-agnostic
- **Asset change per delta**: the raw `delta_payload` (Miden transaction blob with vault diff) is stored server-side but stripped from all dashboard API responses
- **Historical snapshots**: only the current vault state is available via `/snapshot`
- **Transaction value (USD)**: no price oracle; any USD display is dashboard-computed
