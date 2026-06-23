import { readFileSync } from "fs";
import { join } from "path";

type SDK = typeof import("@miden-sdk/miden-sdk") & {
  initSync: (opts: { module: BufferSource | WebAssembly.Module }) => void;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

async function main() {
  const mod = (await import("@miden-sdk/miden-sdk/lazy")) as SDK;
  const wasmPath = join(
    process.cwd(),
    "node_modules/@miden-sdk/miden-sdk/dist/st/assets/miden_client_web.wasm"
  );
  mod.initSync({ module: readFileSync(wasmPath) });

  const env = loadEnv(join(process.cwd(), ".env.local"));

  const endpoints = [
    { id: "openzeppelin", label: "OpenZeppelin Guardian", url: "https://guardian.openzeppelin.com", network: "MidenTestnet" },
    { id: "openzeppelin_devnet", label: "OpenZeppelin Guardian (Devnet)", url: "https://guardian-stg.openzeppelin.com", network: "MidenDevnet" },
    { id: "gateway", label: "Gateway", url: "https://miden-guardian.dev.eu-north-3.gateway.fm/", network: "MidenTestnet" },
    { id: "lambda", label: "Lambda", url: "https://miden-guardian.lambdaclass.com/", network: "MidenTestnet" },
  ];

  const result = endpoints.map((ep) => {
    const envKey = `GUARDIAN_PRIVATE_KEY_${ep.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const privateKeyHex = env[envKey];
    if (!privateKeyHex) {
      console.error(`Missing ${envKey} in .env.local`);
      process.exit(1);
    }
    const secretKey = mod.AuthSecretKey.deserialize(hexToBytes(privateKeyHex));
    const publicKey = secretKey.publicKey();
    const commitment = publicKey.toCommitment().toHex();
    return { id: ep.id, label: ep.label, url: ep.url, network: ep.network, commitment };
  });

  console.log(JSON.stringify(result));
}

main().catch(console.error);
