/**
 * The ink band at the top of every portal page — the public site's header, reduced to the
 * wordmark and (once signed in) a sign-out control. The wordmark is set in type rather than
 * loaded as the site's logo file, so the portal has no cross-origin dependency for its own
 * chrome and stays crisp at any size.
 */
export function PortalWordmark({ tone = "light" }: { tone?: "light" | "dark" }) {
  const color = tone === "light" ? "text-[#eae8e3]" : "text-[#111111]";
  const rule = tone === "light" ? "border-[rgba(234,232,227,0.45)]" : "border-[rgba(17,17,17,0.35)]";
  return (
    <span className={`inline-flex flex-col leading-none ${color}`}>
      <span className="text-[22px] font-semibold tracking-[0.18em]">SGD</span>
      <span className={`mt-1 border-t pt-1 text-[8px] font-medium uppercase tracking-[0.3em] ${rule}`}>
        Group of Companies
      </span>
    </span>
  );
}

export function PortalHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="portal-ink">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 sm:px-8">
        <PortalWordmark />
        {children}
      </div>
    </header>
  );
}
