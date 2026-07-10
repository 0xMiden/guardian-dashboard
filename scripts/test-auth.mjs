/**
 * Standalone auth flow test — run with:
 *   node scripts/test-auth.mjs
 *
 * Loads the devnet endpoint from GUARDIAN_ENDPOINTS, derives pubkey from
 * the stored private key, prints the public key we'd send the engineer,
 * then does the full challenge→sign→verify flow and logs every byte count.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ---------- load env ----------
function loadEnv() {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

// ---------- helpers ----------
function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- load SDK ----------
async function loadSdk() {
  const mod = await import("@miden-sdk/miden-sdk/lazy");
  const wasmPath = join(
    root,
    "node_modules/@miden-sdk/miden-sdk/dist/assets/miden_client_web.wasm"
  );
  mod.initSync({ module: readFileSync(wasmPath) });
  return mod;
}

// ---------- main ----------
async function main() {
  const env = loadEnv();
  const endpoints = JSON.parse(env.GUARDIAN_ENDPOINTS ?? "[]");

  // Test both devnet and testnet
  for (const ep of endpoints) {
    // test all endpoints including localhost

    console.log("\n" + "=".repeat(70));
    console.log(`Endpoint: ${ep.id} (${ep.label})`);
    console.log(`URL:      ${ep.url}`);
    console.log(`Network:  ${ep.network}`);
    console.log(`Stored commitment: ${ep.commitment}`);

    const { AuthSecretKey, Word } = await loadSdk();

    // 1. Re-derive public key and commitment from stored private key
    const privBytes = hexToBytes(ep.privateKey);
    console.log(`\nPrivate key bytes: ${privBytes.length}`);

    let secretKey, pub, derivedCommitment, pubBytesWithTag, pubBytesRaw;
    try {
      secretKey = AuthSecretKey.deserialize(privBytes);
      pub = secretKey.publicKey();
      pubBytesWithTag = pub.serialize(); // 898 bytes (1 tag + 897 raw)
      pubBytesRaw = pubBytesWithTag.slice(1); // 897 bytes — what we send engineer
      derivedCommitment = pub.toCommitment().toHex();
    } catch (e) {
      console.log(`ERROR deriving keys: ${e.message}`);
      continue;
    }

    console.log(`Public key tag byte: 0x${pubBytesWithTag[0].toString(16).padStart(2, "0")} (should be 0x02 miden-sdk tag)`);
    console.log(`Public key first raw byte: 0x${pubBytesRaw[0].toString(16).padStart(2, "0")} (should be 0x09 LOG_N)`);
    console.log(`Public key bytes (no tag): ${pubBytesRaw.length} (should be 897)`);
    console.log(`Public key hex (what to send engineer): 0x${bytesToHex(pubBytesRaw).slice(0, 40)}...`);
    console.log(`Derived commitment:  ${derivedCommitment}`);
    console.log(`Stored  commitment:  ${ep.commitment}`);

    const commitmentMatch = derivedCommitment === ep.commitment;
    console.log(`Commitment matches stored: ${commitmentMatch ? "YES ✓" : "NO ✗ <-- MISMATCH!"}`);

    if (!commitmentMatch) {
      console.log("  !! The stored commitment doesn't match the stored private key.");
      console.log("  !! Use derived commitment for auth, not the stored one.");
    }

    const useCommitment = derivedCommitment; // always use derived

    // 2. Health check
    console.log(`\n--- Health check ---`);
    try {
      const health = await fetch(`${ep.url}/pubkey`, { signal: AbortSignal.timeout(3000) });
      console.log(`/pubkey status: ${health.status}`);
      if (health.ok) {
        const body = await health.text();
        console.log(`/pubkey body: ${body.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`/pubkey error: ${e.message}`);
    }

    // 3. Challenge
    console.log(`\n--- Challenge ---`);
    const challengeUrl = new URL("auth/challenge", ep.url.endsWith("/") ? ep.url : ep.url + "/");
    challengeUrl.searchParams.set("commitment", useCommitment);
    console.log(`GET ${challengeUrl}`);

    let signingDigest;
    try {
      const challengeRes = await fetch(challengeUrl.toString());
      console.log(`Challenge status: ${challengeRes.status}`);
      const challengeBody = await challengeRes.text();
      console.log(`Challenge body: ${challengeBody.slice(0, 500)}`);
      if (!challengeRes.ok) continue;
      const challengeJson = JSON.parse(challengeBody);
      signingDigest = challengeJson?.challenge?.signing_digest;
      console.log(`signing_digest: ${signingDigest}`);
    } catch (e) {
      console.log(`Challenge error: ${e.message}`);
      continue;
    }

    if (!signingDigest) {
      console.log("No signing_digest in response");
      continue;
    }

    // 4. Sign
    console.log(`\n--- Sign ---`);
    let signature;
    try {
      const wordDigest = Word.fromHex(signingDigest);
      console.log(`Word.fromHex succeeded`);
      const sigObj = secretKey.sign(wordDigest);
      const sigBytesWithTag = sigObj.serialize();
      const sigBytesRaw = sigBytesWithTag.slice(1);
      console.log(`Signature bytes with tag: ${sigBytesWithTag.length} (should be 1525)`);
      console.log(`Signature bytes without tag: ${sigBytesRaw.length} (should be 1524)`);
      console.log(`Signature tag byte: 0x${sigBytesWithTag[0].toString(16).padStart(2, "0")} (should be 0x02)`);
      console.log(`Signature first byte (after slice): 0x${sigBytesRaw[0].toString(16).padStart(2, "0")}`);
      signature = "0x" + bytesToHex(sigBytesRaw);
    } catch (e) {
      console.log(`Sign error: ${e.message}`);
      continue;
    }

    // 5. Verify
    console.log(`\n--- Verify ---`);
    const verifyUrl = new URL("auth/verify", ep.url.endsWith("/") ? ep.url : ep.url + "/");
    const verifyBody = { commitment: useCommitment, signature };
    console.log(`POST ${verifyUrl}`);
    console.log(`Body commitment: ${useCommitment}`);
    console.log(`Body signature length: ${signature.length} chars (should be 3050 = "0x" + 3048)`);
    try {
      const verifyRes = await fetch(verifyUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      console.log(`Verify status: ${verifyRes.status}`);
      const verifyText = await verifyRes.text();
      console.log(`Verify body: ${verifyText}`);
      const setCookie = verifyRes.headers.get("set-cookie");
      console.log(`set-cookie: ${setCookie}`);
      if (verifyRes.ok) {
        console.log("\n*** AUTH SUCCESS ***");
      }
    } catch (e) {
      console.log(`Verify error: ${e.message}`);
    }
  }
}

main().catch(console.error);
