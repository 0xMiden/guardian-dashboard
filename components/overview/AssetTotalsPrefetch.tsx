"use client";
import { useEffect } from "react";

// Kicks off the background asset-totals computation as soon as Overview is visited,
// so the result is ready (or closer to ready) by the time the user navigates to Accounts.
export function AssetTotalsPrefetch() {
  useEffect(() => {
    fetch("/api/accounts/asset-totals").catch(() => {});
  }, []);
  return null;
}
