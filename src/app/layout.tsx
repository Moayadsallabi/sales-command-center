import type { Metadata } from "next";
import { cookies } from "next/headers";
import { VIEWING_COOKIE } from "@/lib/client-config";
import { currentViewing } from "@/lib/viewing-request";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

/**
 * Where the shared bar and the session live. Same default as lib/client-config,
 * and stated in one place so a moved identity service does not leave the bar
 * pointing at the old address while the credentials follow the new one.
 */
function identityBase(): string {
  return process.env.IDENTITY_URL ?? "https://kpi.perceptionismlab.com";
}

/**
 * The name the bar should show, which must be the name the PAGE is showing.
 *
 * Demo mode is answered from the demo roster rather than from the registry,
 * because that is what the page itself renders there — and a rehearsal in which
 * the bar and the page disagree rehearses nothing. Every other path goes
 * through the same resolution the page uses, deduplicated per request, so the
 * two cannot come apart.
 */
async function whoThisPageIsAbout(): Promise<string | null> {
  if (process.env.DASHBOARD_DEMO_DATA === "1") {
    const { DEMO_CLIENTS } = await import("@/lib/demo-data");
    const chosen = (await cookies()).get(VIEWING_COOKIE)?.value ?? null;
    return DEMO_CLIENTS.find((c) => c.id === chosen)?.name ?? "Funded Blueprint";
  }
  const viewing = await currentViewing();
  // A refused pin renders no client at all, so the bar is told nobody — naming
  // the deployment's own client here would put its name over a refusal screen.
  if (!viewing.config) return null;
  return viewing.config.brandName ?? process.env.NEXT_PUBLIC_BRAND_NAME?.trim() ?? null;
}

export const metadata: Metadata = {
  title: "Sales Command Center",
  description: "Sales call analytics dashboard",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* WHOSE FIGURES THIS PAGE IS ABOUT TO RENDER, told to the bar so it can name
     them. The bar cannot work it out: with nothing pinned, this app falls back
     to whoever its deployment is named after while the KPI dashboard falls back
     to the first client on the roster, so a bar naming the PINNED client would
     sit above another client's numbers and say nothing. Resolved through the
     same call the page itself uses, so the two cannot disagree. */
  const showing = await whoThisPageIsAbout();

  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-dot-grid">
        {children}
        {/* THE BAR ACROSS THE TOP OF EVERY SYSTEM.
            Served by the identity service and included here with one tag,
            rather than built a second time in this repo: a shape duplicated
            across repositories that deploy independently is the drift this
            workspace has already paid for with sales-rules.json and with the
            credential format. It draws nothing at all when nobody is signed in
            through the shared login, so the password-only path is unchanged.
            See public/shell.js in perceptionismlabkpis. */}
        <script
          src={`${identityBase()}/shell.js`}
          data-system="sales"
          data-base={identityBase()}
          {...(showing ? { "data-client-name": showing } : {})}
          async
        />
      </body>
    </html>
  );
}
