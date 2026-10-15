import { loadSdk, getPublicKey } from "../lib/falcon";

async function main() {
  const { AuthSecretKey } = await loadSdk();
  const secretKey = AuthSecretKey.rpoFalconWithRNG();
  const privateKeyHex = Buffer.from(secretKey.serialize()).toString("hex");
  const commitment = secretKey.publicKey().toCommitment().toHex();

  console.log("# ── Paste into dashboard .env.local (and Vercel) ──────────────");
  console.log("# <ID> is the endpoint's id, upper-cased, non-alphanumerics as _");
  console.log(`GUARDIAN_PRIVATE_KEY_<ID>=${privateKeyHex}`);
  console.log(`# "commitment" in its GUARDIAN_ENDPOINTS entry: ${commitment}`);
  console.log("");
  console.log("# ── Add to Guardian operator-public-keys.json ────────────────");
  console.log(`["${await getPublicKey(privateKeyHex)}"]`);
}

main().catch(console.error);
