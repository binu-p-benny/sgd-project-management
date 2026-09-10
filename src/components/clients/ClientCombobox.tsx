"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

export interface SelectedClient {
  id: string;
  name: string;
  phone: string;
  address: string;
}

const inputClass =
  "h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-sm font-medium text-fg-muted";

/**
 * Search-and-select client picker for the New Project / New Service forms (and the project
 * edit form, for reassigning to a different client) — type to search existing clients by name
 * or phone, pick one, or add a brand new one inline without leaving the form.
 */
export function ClientCombobox({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: SelectedClient | null;
  onChange: (client: SelectedClient | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SelectedClient[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || creating) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}`);
        if (res.ok) setResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open, creating]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectClient(client: SelectedClient) {
    onChange(client);
    setOpen(false);
    setCreating(false);
    setQuery("");
  }

  function startCreating() {
    setCreating(true);
    setNewPhone("");
    setNewAddress("");
    setCreateError(null);
  }

  async function saveNewClient() {
    const name = query.trim();
    if (!name || !newPhone.trim() || !newAddress.trim()) {
      setCreateError("Name, phone, and address are all required");
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone: newPhone.trim(), address: newAddress.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCreateError(typeof body.error === "string" ? body.error : "Could not add client");
        setSaving(false);
        return;
      }
      const client = await res.json();
      selectClient(client);
    } catch {
      setCreateError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function clearSelection() {
    onChange(null);
    setQuery("");
    setOpen(true);
  }

  if (value && !open) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Client</span>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-edge bg-bg px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-base font-medium text-fg">{value.name}</div>
            <div className="truncate text-sm text-fg-muted">{value.phone}</div>
            <div className="truncate text-sm text-fg-muted">{value.address}</div>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="shrink-0 rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:text-fg"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        Client
      </label>
      <input
        id={id}
        autoComplete="off"
        placeholder="Search by client name or phone…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCreating(false);
        }}
        onFocus={() => setOpen(true)}
        className={inputClass}
      />

      {open && (
        <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-lg border border-edge bg-surface shadow-[var(--shadow-md)]">
          {creating ? (
            <div className="flex flex-col gap-2 p-3">
              <div className="text-sm font-medium text-fg">Add &quot;{query.trim()}&quot; as a new client</div>
              {createError && (
                <div className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
                  {createError}
                </div>
              )}
              <input
                type="tel"
                placeholder="Phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="h-10 w-full rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              <textarea
                placeholder="Address"
                rows={2}
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="flex h-9 flex-1 items-center justify-center rounded-lg border border-edge text-sm font-medium text-fg-muted hover:text-fg"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={saveNewClient}
                  disabled={saving}
                  className="flex h-9 flex-1 items-center justify-center rounded-lg bg-accent text-sm font-medium text-white hover:bg-accent-2 disabled:opacity-50"
                >
                  {saving ? <Spinner className="h-3.5 w-3.5" /> : "Save client"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto">
                {searching && <div className="px-3 py-2 text-sm text-fg-muted">Searching…</div>}
                {!searching && query.trim() && results.length === 0 && (
                  <div className="px-3 py-2 text-sm text-fg-muted">No matching clients.</div>
                )}
                {results.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => selectClient(client)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-overlay"
                  >
                    <span className="text-sm font-medium text-fg">{client.name}</span>
                    <span className="text-xs text-fg-muted">{client.phone}</span>
                  </button>
                ))}
              </div>
              {query.trim() && (
                <button
                  type="button"
                  onClick={startCreating}
                  className="flex w-full items-center gap-1.5 border-t border-edge px-3 py-2 text-left text-sm font-medium text-accent transition-colors hover:bg-overlay"
                >
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} className="h-4 w-4 shrink-0 stroke-current">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  Add &quot;{query.trim()}&quot; as a new client
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
