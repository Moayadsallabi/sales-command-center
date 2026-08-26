import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Sales Command Center",
  description: "Sales call analytics dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
          async
        />
      </body>
    </html>
  );
}
