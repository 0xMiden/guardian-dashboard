# Guardian Dashboard — Access Control Options

## Background

The Guardian Dashboard is a Next.js web app that lets an operator monitor and manage a Guardian (accounts, transactions, compliance rules, logs). It talks to a Guardian server using the operator's **Falcon-512 keypair** (a post-quantum signature scheme used by the Miden protocol).

Currently the dashboard has a login page and a middleware guard, but since no password variable is set in the environment, **auth is completely bypassed** — anyone who can reach the URL can use the dashboard.

This document lays out four options to properly gate access, from simplest to most Miden-native.

---

## What we already have

- **`GUARDIAN_OPERATOR_PRIVATE_KEY`** — the operator's Falcon private key (hex-encoded), stored in `.env.local`
- **`GUARDIAN_OPERATOR_COMMITMENT`** — the hash of the operator's public key, also in `.env.local`. This is what the Guardian server uses to identify the operator.
- **`lib/falcon.ts`** — a helper that uses the Miden WASM module to sign a digest with a Falcon private key. Already used for authenticating the backend to the Guardian server.
- **`lib/guardian-client.ts`** — wraps the Guardian operator API, including a `challenge(commitment)` / `verify(commitment, signature)` flow that Guardian uses to authenticate the operator.

The key insight: the Miden ecosystem already has a cryptographic auth protocol built in. The question is whether and how we expose it to gate the dashboard UI.

---

## Option A — Password list *(simplest, works today)*

**How it works:** Add a list of `username:password` pairs to a config file or environment variable. Each user logs in with a username and password. The server validates against the list and issues a session cookie.

**Implementation effort:** ~2 hours. No new dependencies — can use built-in `crypto.subtle` for password hashing (PBKDF2).

| Criterion | |
|---|---|
| Multi-user | ✅ |
| Roles (admin / viewer) | ✅ easy — add a role flag per entry |
| Miden identity | ❌ — no link to Miden accounts or keys |
| External dependencies | ❌ none |
| Works if Guardian is down | ✅ |
| UX | Username + password form, familiar to everyone |

**Downside:** Passwords have to be distributed and rotated manually. No cryptographic proof of identity — anyone who gets the password can log in.

---

## Option B — OAuth / OIDC (Clerk, Auth0, GitHub login)

**How it works:** Integrate a standard identity provider. Users log in with Google, GitHub, or email/password via the provider. The provider handles session management, MFA, and user invites. The dashboard maps provider user IDs to access roles.

**Implementation effort:** ~3 hours. Clerk has a Next.js SDK (`@clerk/nextjs`) that can be wired up quickly; free tier covers thousands of users.

| Criterion | |
|---|---|
| Multi-user | ✅ |
| Roles (admin / viewer) | ✅ built-in |
| Miden identity | ❌ — identity is Google/GitHub, not a Miden account |
| External dependencies | ⚠️ depends on a third-party SaaS (Clerk, Auth0, etc.) |
| Works if Guardian is down | ✅ |
| UX | Familiar OAuth flow, supports SSO, MFA out of the box |

**Downside:** External dependency — if the identity provider has an outage, login breaks. Identity is not tied to the Miden ecosystem.

---

## Option C — Falcon keypair + dashboard whitelist *(Miden-native, recommended medium term)*

**How it works:** Each authorized user has a Miden account with a Falcon keypair. The dashboard maintains a whitelist of authorized commitments (a commitment is the hash of a Falcon public key — think of it as a Miden "address"). Login flow:

1. User enters their commitment (their Miden account address)
2. Dashboard generates a random challenge nonce and sends it back
3. User signs the nonce with their Falcon private key — either by pasting their private key hex directly in the browser (the Miden WASM signs client-side, key never leaves the browser) or by using a CLI tool and pasting the resulting signature
4. Dashboard verifies the Falcon signature against the commitment — confirming the user controls the private key behind that commitment
5. Session cookie issued; the commitment is the user's identity

The whitelist (`ALLOWED_COMMITMENTS` env var or a JSON config file) maps each commitment to a role (admin / viewer).

**Implementation effort:** ~1 day. The signing half already exists (`lib/falcon.ts`). Need to add a `falcon.verify()` function using the same Miden WASM.

| Criterion | |
|---|---|
| Multi-user | ✅ via whitelist config |
| Roles (admin / viewer) | ✅ per-commitment role in config |
| Miden identity | ✅ cryptographically tied to Miden account |
| External dependencies | ❌ none — Miden WASM already in repo |
| Works if Guardian is down | ✅ — auth is entirely local to dashboard |
| UX | User enters commitment + signs challenge (paste key or CLI) |

**Downside:** No browser Miden wallet exists yet, so the signing step requires the user to either paste their private key hex into the browser or use the Miden CLI. This is a usability gap that improves once a browser Miden wallet ships.

---

## Option D — Guardian as the auth server *(most integrated, future state)*

**How it works:** Use Guardian's built-in `challenge` / `verify` protocol directly as the dashboard login gate. The Guardian server already implements challenge-response authentication with Falcon keys, and it maintains its own whitelist of authorized commitments. If Guardian accepts your signature, you're in.

Login flow:
1. User enters their commitment
2. Dashboard calls `guardian.challenge(commitment)` — Guardian returns a signing digest
3. User signs the digest with their Falcon key (same UX as Option C)
4. Dashboard calls `guardian.verify(commitment, signature)` — Guardian validates and returns a session
5. Dashboard issues its own session cookie

**Implementation effort:** ~4 hours (the `challenge`/`verify` calls are already wrapped in `lib/guardian-client.ts`).

| Criterion | |
|---|---|
| Multi-user | ⚠️ Guardian currently whitelists only one operator commitment. Supporting multiple users requires the Guardian team to implement viewer/multi-operator roles. |
| Roles (admin / viewer) | ❌ not yet — Guardian has no viewer role today |
| Miden identity | ✅ perfectly aligned |
| External dependencies | ❌ none new |
| Works if Guardian is down | ❌ — if Guardian is unreachable, login is blocked |
| UX | Same as Option C |

**Downside:** Blocked on the Guardian team shipping multi-operator support. Until then, only the single registered operator commitment can log in.

---

## Recommendation

| Timeframe | Option | Why |
|---|---|---|
| **Now** | A (password list) | Fastest path to closing the current open-door. No Miden dependency. |
| **Medium term** | C (Falcon + whitelist) | Ties identity to Miden accounts; everything needed is already in the repo. |
| **Long term** | D (Guardian as auth server) | Once Guardian ships multi-operator support, Option C collapses into D naturally — the whitelist just moves from the dashboard config to the Guardian server. |

Option B (OAuth) is worth considering if the team wants enterprise features — audit logs, MFA, SSO — without building them in-house.

---

## Questions to decide

1. **Who needs access?** Just the operator (single user), or a team of viewers as well?
2. **Urgency?** Is the open dashboard a problem right now, or is access already network-restricted (e.g., only accessible on a private network or VPN)?
3. **Miden wallet roadmap?** If a browser Miden wallet with a signing API ships soon, Option C/D UX improves significantly. Is that on the near-term roadmap?
