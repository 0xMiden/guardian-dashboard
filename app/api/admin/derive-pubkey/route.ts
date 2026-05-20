import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getEndpoint } from "@/lib/endpoints";
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

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if ((user.publicMetadata as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const endpointId = searchParams.get("endpointId");
  if (!endpointId) return NextResponse.json({ error: "Missing endpointId query param" }, { status: 400 });

  const ep = getEndpoint(endpointId);
  if (!ep) return NextResponse.json({ error: `Unknown endpoint: ${endpointId}` }, { status: 404 });

  const { AuthSecretKey } = await sdk();
  const key = AuthSecretKey.deserialize(hexToBytes(ep.privateKey));
  const pub = key.publicKey();
  // Strip the miden type-tag prefix byte; Guardian expects raw Falcon format starting with 0x09
  const publicKeyHex = "0x" + bytesToHex(pub.serialize().slice(1));
  const commitment = pub.toCommitment().toHex();

  return NextResponse.json({ endpointId, publicKeyHex, commitment });
}
