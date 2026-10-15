import { readFileSync } from "fs";
import { join } from "path";

// miden-sdk uses top-level await in its default (eager) entry which blocks
// Next.js SSR. The "/lazy" entry defers WASM init so we can call initSync
// ourselves with readFileSync — avoiding the fetch() that fails in Node.js.
type SDK = typeof import("@miden-sdk/miden-sdk") & {
  initSync: (opts: { module: BufferSource | WebAssembly.Module }) => void;
};

let _sdk: Promise<SDK> | null = null;

/** The SDK with its WASM initialised, shared by everything server-side that needs it. */
export function loadSdk(): Promise<SDK> {
  if (!_sdk) {
    _sdk = (async () => {
      const mod = (await import("@miden-sdk/miden-sdk/lazy")) as SDK;
      const wasmPath = join(
        process.cwd(),
        "node_modules/@miden-sdk/miden-sdk/dist/st/assets/miden_client_web.wasm"
      );
      mod.initSync({ module: readFileSync(wasmPath) });
      return mod;
    })();
  }
  return _sdk;
}

const fromHex = (hex: string) => Buffer.from(hex.replace(/^0x/, ""), "hex");
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

export async function getPublicKey(privateKeyHex: string): Promise<string> {
  const { AuthSecretKey } = await loadSdk();
  const secretKey = AuthSecretKey.deserialize(fromHex(privateKeyHex));
  return "0x" + toHex(secretKey.publicKey().serialize().slice(1));
}

export async function signDigest(privateKeyHex: string, digestHex: string): Promise<string> {
  const { AuthSecretKey, Word } = await loadSdk();
  const secretKey = AuthSecretKey.deserialize(fromHex(privateKeyHex));
  const signature = secretKey.sign(Word.fromHex(digestHex));
  return "0x" + toHex(signature.serialize().slice(1));
}
