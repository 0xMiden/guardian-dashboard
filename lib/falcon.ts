import { readFileSync } from "fs";
import { join } from "path";

// miden-sdk uses top-level await in its default (eager) entry which blocks
// Next.js SSR. The "/lazy" entry defers WASM init so we can call initSync
// ourselves with readFileSync — avoiding the fetch() that fails in Node.js.
type SDK = typeof import("@miden-sdk/miden-sdk") & {
  initSync: (opts: { module: BufferSource | WebAssembly.Module }) => void;
};

let _sdk: Promise<SDK> | null = null;

function sdk(): Promise<SDK> {
  if (!_sdk) {
    _sdk = (async () => {
      const mod = (await import("@miden-sdk/miden-sdk/lazy")) as SDK;
      const wasmPath = join(
        process.cwd(),
        "node_modules/@miden-sdk/miden-sdk/dist/assets/miden_client_web.wasm"
      );
      mod.initSync({ module: readFileSync(wasmPath) });
      return mod;
    })();
  }
  return _sdk;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function signDigest(privateKeyHex: string, digestHex: string): Promise<string> {
  const { AuthSecretKey, Word } = await sdk();
  const secretKey = AuthSecretKey.deserialize(hexToBytes(privateKeyHex));
  const signature = secretKey.sign(Word.fromHex(digestHex));
  return "0x" + bytesToHex(signature.serialize().slice(1));
}
