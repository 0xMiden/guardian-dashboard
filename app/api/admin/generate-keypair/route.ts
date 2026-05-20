import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if ((user.publicMetadata as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { AuthSecretKey } = await sdk();
  const key = AuthSecretKey.rpoFalconWithRNG();
  const pub = key.publicKey();
  // pub.serialize() has a miden type-tag prefix byte (0x02) before the raw Falcon bytes (0x09...).
  // Guardian server's PublicKey::from_hex expects the raw Falcon format without the prefix.
  const publicKeyHex = "0x" + bytesToHex(pub.serialize().slice(1));
  const commitment = pub.toCommitment().toHex();
  const privateKey = bytesToHex(key.serialize());

  return NextResponse.json({ publicKeyHex, commitment, privateKey });
}
