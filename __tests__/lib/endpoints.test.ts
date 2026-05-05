import { describe, it, expect, beforeEach, vi } from "vitest";

const BASE_ENDPOINT = {
  id: "testnet",
  label: "Guardian Testnet",
  url: "https://guardian.example.com",
  network: "MidenTestnet",
  commitment: "0xabc123",
  privateKey: "deadbeef",
};

// Reset module cache between tests so the cached variable is cleared
beforeEach(() => {
  vi.resetModules();
});

async function importEndpoints() {
  return import("@/lib/endpoints");
}

describe("getEndpoints", () => {
  it("parses a valid GUARDIAN_ENDPOINTS JSON array", async () => {
    process.env.GUARDIAN_ENDPOINTS = JSON.stringify([BASE_ENDPOINT]);
    const { getEndpoints } = await importEndpoints();
    expect(getEndpoints()).toEqual([BASE_ENDPOINT]);
  });

  it("returns empty array when GUARDIAN_ENDPOINTS is not set", async () => {
    delete process.env.GUARDIAN_ENDPOINTS;
    delete process.env.GUARDIAN_URL;
    const { getEndpoints } = await importEndpoints();
    expect(getEndpoints()).toEqual([]);
  });

  it("falls back to legacy single-endpoint env vars", async () => {
    delete process.env.GUARDIAN_ENDPOINTS;
    process.env.GUARDIAN_URL = "https://legacy.example.com";
    process.env.GUARDIAN_OPERATOR_COMMITMENT = "0xlegacy";
    process.env.GUARDIAN_OPERATOR_PRIVATE_KEY = "legacykey";
    process.env.GUARDIAN_NETWORK = "MidenLocal";
    const { getEndpoints } = await importEndpoints();
    const result = getEndpoints();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("__legacy__");
    expect(result[0].url).toBe("https://legacy.example.com");
    // cleanup
    delete process.env.GUARDIAN_URL;
    delete process.env.GUARDIAN_OPERATOR_COMMITMENT;
    delete process.env.GUARDIAN_OPERATOR_PRIVATE_KEY;
  });

  it("returns empty array for malformed JSON", async () => {
    process.env.GUARDIAN_ENDPOINTS = "not-valid-json";
    const { getEndpoints } = await importEndpoints();
    expect(() => getEndpoints()).toThrow();
    process.env.GUARDIAN_ENDPOINTS = JSON.stringify([BASE_ENDPOINT]);
  });
});

describe("getEndpoint", () => {
  it("returns the matching endpoint by id", async () => {
    process.env.GUARDIAN_ENDPOINTS = JSON.stringify([BASE_ENDPOINT]);
    const { getEndpoint } = await importEndpoints();
    expect(getEndpoint("testnet")).toEqual(BASE_ENDPOINT);
  });

  it("returns undefined for unknown id", async () => {
    process.env.GUARDIAN_ENDPOINTS = JSON.stringify([BASE_ENDPOINT]);
    const { getEndpoint } = await importEndpoints();
    expect(getEndpoint("unknown")).toBeUndefined();
  });
});

describe("getPublicEndpoints", () => {
  it("strips privateKey and commitment", async () => {
    process.env.GUARDIAN_ENDPOINTS = JSON.stringify([BASE_ENDPOINT]);
    const { getPublicEndpoints } = await importEndpoints();
    const result = getPublicEndpoints();
    expect(result).toEqual([{ id: "testnet", label: "Guardian Testnet" }]);
    expect(result[0]).not.toHaveProperty("privateKey");
    expect(result[0]).not.toHaveProperty("commitment");
  });
});
