import type { Metadata } from "next";
import { Inter } from "next/font/google";

/**
 * The client portal runs inside the same app as the staff console but looks nothing like it:
 * this layout swaps in Inter (the public site's typeface) and the `.portal` palette, which
 * redeclares the shared theme variables so every existing utility class renders in bone and ink
 * for these routes only. See the `.portal` block in globals.css.
 */
const inter = Inter({ variable: "--font-portal-sans", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "SGD Connect",
  description: "Track the progress of your window and glass installation with SGD.",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className={`portal ${inter.variable} flex min-h-screen flex-1 flex-col`}>{children}</div>;
}
