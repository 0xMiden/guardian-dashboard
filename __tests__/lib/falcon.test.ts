import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes, getPublicKey, signDigest } from "@/lib/falcon";

// Test key (dev/staging only — never used on mainnet)
const TEST_PRIVATE_KEY = "02590bfffff800c7eb8fc6f7d182f010fcf3ef08d87fc2f40f01f7df0707df7604314313b0810fcf7fec417f03d080080103039fc0ffb103083f40e8104107f243001fc2100f4003af43ebe0fe0410411000c4234004e8ad81f830fffc600203f146e82fc007e2000bdf440020f9206eff10527dfbe001ffef7f0be0c2f3cf0003d087108080eff148f3f07afc0137f7c0c0f3dfc413de7d03f181085e7d047efcf40f821bf1ff182fc2f4017dec5ffdeb71c11000c5080ec214404a079fbdf4403c07bffbffaf01e4107d0be07e049f80005046084044000101fc1f0318523d081106d42181000f81ec014617c0c01f9003040e00106f3c144f830c800307be0910607f009081046fbd0790c20042befffffef460bdf7d08608413b13a042e0804303febbec2e8010007df00f42fbf0390c20fe0c31c6ffff7f043fbb0bf1870c20c007cd85f75002e420bcfff0c3f83fff24127cf0003c0052430fe1bafbd002f450fb084102fc413c278efbfc60c2fc813e27d0fe2060fffc017ae88f430c414003bf06eb707f03cfbdf7f23cf3f03e000fc7041142f7f07df3bfbffcb105041cc2f41f7f003e3f0c9182043140f450ff0fe10813f002ffc07ff0217e04504113b0c4f39076f402be0c018407cf7af06200002f41f82f84000103f3cfbdfc513c082e800840be1bbfc2fc6042ec023f1010fe0fbffef820bff7ae80f800fbf7e23b17df81f3e0c0f0014923cf33002049f3df41fc4f7b0c513f1f9139039f7cefff40fc80fcfb713f2be103080f4213f03827fe43f4507de8000314403d0c4e02ffe03bfc300d07f040efe1c3f430fbfc40c120207e13ffbbfc3fc01050c0ffefc300103c07fe890820bfebd03dfbeffd18020527b001f7ae81046101f0100408407c0fd07cebe077202105ffff7bfbbffe1c40c3e7d045e7c180ffd03d03ef83f840c0fc307affdf02f41ec6ffff810031c0ec4140ec7044206080f8003d047ffafff0baf800bf081040ec017ddfb1fdf07f04fbff83f4107e04513fef8fc1fba0830bb0bf0bb1481bc03f104ec603f143102ec1f3fffcebe080e03fbfec3f83db17eb1ffee204fd111aeafeeae9fff602fef1e735d712ea0d30e5dd0af7060d03e5daf700dd08090112f50a24d618f4f90318fe1fc3281cfd2bf8141dc4fce218f0dd0afd211bed20fbd7120309f7080c0120ffcef538130df4141c080b112cf4fb1b21011213ef12ec1e20ca01f5f5fef1143c04400301120746370b1c0d301ae4ddf0450f12031014f0bb2b1c08e8f12ef4e00710112e091228dd0913f61ded08082710050937e524192506f5fd26ebfe20df15040404e10ee91149c503fdf40818ef1def1c00e847dbf7ca2c1ce7f0fbe4f4f501271ffe2bedf60ff51a05c112e41cf7e81ef7f514f2200c9d09e924e2e3eb1307013512e8fbf52304ff0fed04ddda013af914011528e40dfd01e7dc0b07ead7f81514fffbfafef41509edf1ef4e1d0308ea341ce218ede70ed90b13d10a070afddefb35ef02f707f71cf2f42006ed0e05170114d431fefc0a240104ee0beee214f12b2c1923f80ad60508c8f350fb06e5eff913bc080c28ec06e4f422010cf6f80fe00bd71ae6ecfc1b0af40fd8f6de1fd704e92e19ebeef504fbfe051cf4fde5f8d7fc142efedcf139f0d80c140319f600eae8feefd6f8e8080eea14f60d02d30b03cbe9f4d9001fef3b0109d9ef03f72708fddd1315f702eaf7ec0e0d19c816f8f4120004f3f933d217e1120037e7fffbf00605fce3fffdfb02fb1814e0c123cffef5e5ffe9e400e01c";
const TEST_PUBLIC_KEY  = "0x0912dc291712d7df67d08f2ae10ecd381d102889ac833b647961b76381040d768a44e4cbb655a8fae01667751d79586053088f66c7c549e95f2adedb5ab6ef0d6236d248d8dc616ee50cda89681ba2857069d029ab40d0dca9e44c0d649e53e4c94e2f071e21a86f882611a6c875038a6e401992a9916ed472a2b26813533426e298161680773ebc072a09202623b174723e882154905231a602a8a7356b56670f5d1a1d8a2a3aa7c2762cee0109aa7e597897aa8d1a005935e7bb3b6b0b192af65091279fa2e800d609959c0970161971544d4d3245a7acc1507435046acfd194bd202eca49d7c03b62fff28641cb18797c2929555d0a263ef9c114da76e8e687a6dd737f5a87d49ceed554b14cea5f009416cac4c270694f8b5057c3bbac7f40345726e4d2d065c8556968ea6f1a685b604f287b24e90313a7e05a0db096b2156d619d7a8546a3e86a62d908900bad47327a941498e304162ad093d3662c0076dc9bba67f5615e2f968e29ca7e245eb06e56025061d38b702987196dba55aa203cb2d967e5a7e1c749286219436ae57a656b45b6c2a68d06ffea051b0665fa65858e9afc8ed460f7d4ed7a9f093237c82d7926a93d5091c1e38a9cfa081d93799ce17bba0fa9317536bc74cd5fd9bf39ce74f7d7008895b0834bd52f2f462215a491dc79f5a6422604449aac7442f7c83a10b8c7663f45b9a3b9e027fac7a25b995c062247c4ab3c2a71e44b582a9e62a49f09e084c83291145877504c8aa2a785b82b4241e928cdde5be27ad4a3ceab8b100dd6aece72828cbec8ed81eb209c9be7bb216aac6ea2ebaf906e987923654d57a7a94a43c7e3e95d4d622133a996086ce894127fcfdb1f1176964dc56a84cc3853eda7ea6eed037110db7a921c78b07cd1a1a7d83637710eac2715a900aec6f0561edef99dc475b2ac035a1421370ae4c8802859de30924b44659758915d50c6a81ac62f0a02c22a9c8fa454b8c6d4aa69658a908b2ee5f40cf48d842198df3b863b202f2057a57ae8c2ddaf8755ce72998816278a349bb8f923306044d0e110c94500ceeab8418d957efaf51069ef745afedc79dccd2f45adba734adda2b28270245488796dbaac403c82e79b72be993ca3f82f353d31689649933ef8e5605d933304a6401f47db3620ca5a8fa7805f66122bf5cad1a1ca3bdb12101d19fea911181e521ffa11a8abd0f52a7dfce10a984b5aa1b6106410a59f6dda4b5e5e9589464e43fea54538adadb972ccbb";
const TEST_DIGEST      = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("bytesToHex", () => {
  it("converts bytes to hex string", () => {
    expect(bytesToHex(new Uint8Array([0, 255, 128]))).toBe("00ff80");
  });

  it("pads single-digit hex values", () => {
    expect(bytesToHex(new Uint8Array([1, 2, 15]))).toBe("01020f");
  });

  it("returns empty string for empty array", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });
});

describe("hexToBytes", () => {
  it("converts hex string to bytes", () => {
    expect(hexToBytes("00ff80")).toEqual(new Uint8Array([0, 255, 128]));
  });

  it("strips 0x prefix", () => {
    expect(hexToBytes("0x00ff80")).toEqual(new Uint8Array([0, 255, 128]));
  });

  it("roundtrips correctly", () => {
    const original = new Uint8Array([10, 20, 30, 40, 50]);
    expect(hexToBytes(bytesToHex(original))).toEqual(original);
  });
});

describe("getPublicKey", () => {
  it("derives the correct public key from a known private key", async () => {
    const pubKey = await getPublicKey(TEST_PRIVATE_KEY);
    expect(pubKey).toBe(TEST_PUBLIC_KEY);
  });

  it("returns a 0x-prefixed hex string", async () => {
    const pubKey = await getPublicKey(TEST_PRIVATE_KEY);
    expect(pubKey).toMatch(/^0x[0-9a-f]+$/);
  });

  it("throws on an invalid private key", async () => {
    await expect(getPublicKey("deadbeef")).rejects.toThrow();
  });
});

describe("signDigest", () => {
  it("returns a 0x-prefixed hex string", async () => {
    const sig = await signDigest(TEST_PRIVATE_KEY, TEST_DIGEST);
    expect(sig).toMatch(/^0x[0-9a-f]+$/);
  });

  it("produces a Falcon-512 sized signature (1524 bytes)", async () => {
    const sig = await signDigest(TEST_PRIVATE_KEY, TEST_DIGEST);
    expect((sig.length - 2) / 2).toBe(1524);
  });

  it("is deterministic for the same key and digest", async () => {
    const [a, b] = await Promise.all([
      signDigest(TEST_PRIVATE_KEY, TEST_DIGEST),
      signDigest(TEST_PRIVATE_KEY, TEST_DIGEST),
    ]);
    expect(a).toBe(b);
  });

  it("produces different signatures for different digests", async () => {
    const other = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const [a, b] = await Promise.all([
      signDigest(TEST_PRIVATE_KEY, TEST_DIGEST),
      signDigest(TEST_PRIVATE_KEY, other),
    ]);
    expect(a).not.toBe(b);
  });

  it("throws on an invalid private key", async () => {
    await expect(signDigest("notakey", TEST_DIGEST)).rejects.toThrow();
  });
});
