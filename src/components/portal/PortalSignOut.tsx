"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

export function PortalSignOut() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      await fetch("/api/portal/logout", { method: "POST" });
      router.push("/portal/login");
      router.refresh();
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={loading}
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[rgba(245,244,239,0.65)] transition-colors hover:text-[#eae8e3] disabled:opacity-50"
    >
      {loading && <Spinner className="h-3 w-3" />}
      Sign out
    </button>
  );
}
