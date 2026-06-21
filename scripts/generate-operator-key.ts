import { readFileSync } from "fs";
import { join } from "path";

type SDK = typeof import("@miden-sdk/miden-sdk") & {
  initSync: (opts: { module: BufferSource | WebAssembly.Module }) => void;
};

async function main() {
  const mod = (await import("@miden-sdk/miden-sdk/lazy")) as SDK;
  const wasmPath = join(
    process.cwd(),
    "node_modules/@miden-sdk/miden-sdk/dist/assets/miden_client_web.wasm"
  );
  mod.initSync({ module: readFileSync(wasmPath) });

  function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const secretKey = mod.AuthSecretKey.rpoFalconWithRNG();
  const publicKey = secretKey.publicKey();

  const privateKeyHex = bytesToHex(secretKey.serialize());
  const publicKeyHex = "0x" + bytesToHex(publicKey.serialize().slice(1));
  const commitment = publicKey.toCommitment().toHex();

  console.log("# ── Paste into dashboard .env.local ──────────────────────────");
  console.log(`GUARDIAN_OPERATOR_PRIVATE_KEY=${privateKeyHex}`);
  console.log(`GUARDIAN_OPERATOR_COMMITMENT=${commitment}`);
  console.log("");
  console.log("# ── Add to Guardian operator-public-keys.json ────────────────");
  console.log(`["${publicKeyHex}"]`);
}

main().catch(console.error);
