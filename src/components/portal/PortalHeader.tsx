import Image from "next/image";

/**
 * The portal's chrome. Two tones because the portal has two backgrounds: the login page keeps
 * the dark panel from the public site (white logo), while /portal itself is all paper (colour
 * logo). Both files ship in /public at 230x90 and are rendered at a third of that, so they stay
 * crisp on a retina screen.
 */
export function PortalWordmark({ tone = "dark" }: { tone?: "light" | "dark" }) {
  const light = tone === "light";
  return (
    <span className="inline-flex items-center gap-3">
      <Image
        src={light ? "/logo-wt.png" : "/logo-cl.png"}
        alt="SGD Group of Companies"
        width={230}
        height={90}
        priority
        className="h-9 w-auto sm:h-10"
      />
      <span
        className={`border-l pl-3 text-[11px] uppercase tracking-[0.22em] ${
          light ? "border-[rgba(234,232,227,0.35)] text-[rgba(234,232,227,0.75)]" : "border-edge-2 text-fg-muted"
        }`}
      >
        Connect
      </span>
    </span>
  );
}

/**
 * /portal's own header — paper, not ink: the page carries one continuous background now, with
 * only a hairline separating the header from the content under it.
 */
export function PortalHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-edge">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 sm:px-8">
        <PortalWordmark />
        {children}
      </div>
    </header>
  );
}
