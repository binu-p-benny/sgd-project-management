"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { PortalWordmark } from "@/components/portal/PortalHeader";

const WORK_IN_HAND_HEADING = "Projects under way across South India";

/**
 * What SGD currently has on site, shown above the sign-in form. Hard-coded on purpose and in one
 * place on purpose: these are the office's own figures, not anything this app measures — its
 * database only starts at the system's rollout (42 live projects today), so deriving them from
 * it would understate the business badly. Change them here when the office does.
 */
const PORTAL_STATS = [
  { value: "130", label: "Projects ongoing" },
  { value: "62", label: "Kerala" },
  { value: "57", label: "Tamil Nadu" },
  { value: "46", label: "Karnataka" },
];

/**
 * The figures above, sitting at the top of the sign-in column — so the first thing a visitor
 * reads is the scale of the work, and the form follows it. Bottom border rather than top: it
 * leads the column rather than closing it.
 */
function WorkInHand({ className = "" }: { className?: string }) {
  return (
    <div className={`border-b border-edge pb-6 ${className}`}>
      <p className="text-[10px] uppercase tracking-[0.22em] text-fg-subtle">{WORK_IN_HAND_HEADING}</p>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
        {PORTAL_STATS.map((stat) => (
          <div key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-[22px] leading-none text-fg sm:text-[26px]">{stat.value}</dd>
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-fg-muted">{stat.label}</p>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function PortalLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Sign in failed");
        setLoading(false);
        return;
      }

      router.push("/portal");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Ink panel — the site's dark hero, carried over as the left half on a wide screen and a
          slim band on a phone. */}
      <div className="portal-ink flex flex-col justify-between px-6 py-6 sm:px-10 sm:py-8 lg:w-[46%] lg:py-14">
        <PortalWordmark tone="light" />
        <div className="mt-8 lg:mt-0">
          <h1 className="max-w-md text-[30px] leading-[1.12] text-[#eae8e3] sm:text-[40px] lg:text-[46px]">
            Follow your installation, stage by stage.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-[rgba(245,244,239,0.6)]">
            Sign in to see exactly where your project stands — what is finished, what is under way
            and what comes next.
          </p>
        </div>
        <p className="mt-10 hidden text-[10px] uppercase tracking-[0.22em] text-[rgba(245,244,239,0.45)] lg:block">
          Expert glass &amp; window solutions
        </p>
      </div>

      {/* Paper panel — the form. */}
      <div className="flex flex-1 items-center justify-center px-6 py-8 sm:px-10 sm:py-12">
        <div className="w-full max-w-sm">
          <WorkInHand className="mb-6 sm:mb-8" />
          <h2 className="text-[26px] text-fg">Sign in</h2>
          <p className="mt-2 text-sm text-fg-muted">Use the phone number you gave us for this project.</p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            {error && (
              <div className="border-l-2 border-[#9a2f2f] bg-[rgba(154,47,47,0.07)] px-3 py-2 text-sm text-[#9a2f2f]">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="phone" className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 00002"
                className="border-b border-edge-2 bg-transparent pb-2 text-base text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-fg"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="7 characters"
                className="border-b border-edge-2 bg-transparent pb-2 text-base text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-fg"
              />
              <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
                Your password is the first 3 letters of your name followed by the first 4 digits of
                your phone number — 7 characters in all.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex items-center justify-center gap-2 bg-[#111111] px-6 py-3.5 text-[11px] uppercase tracking-[0.2em] text-[#eae8e3] transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {loading && <Spinner className="h-3.5 w-3.5" />}
              Sign in
            </button>
          </form>

          <p className="mt-10 text-xs leading-relaxed text-fg-subtle">
            Can&apos;t get in? Call the SGD office and we&apos;ll check the number we have on file.
          </p>
        </div>
      </div>
    </div>
  );
}
