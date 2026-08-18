import { NotionFailure } from "@/lib/notion";
import { AlertTriangle } from "lucide-react";

type Guidance = { title: string; summary: string; steps: string[] };

function guidanceFor(failure: NotionFailure): Guidance {
  switch (failure.kind) {
    case "missing-config":
      return {
        title: "Not connected to Notion yet",
        summary: `Missing ${failure.missing.join(" and ")}.`,
        steps: [
          "Copy .env.example to .env.local in the project folder.",
          "Fill in NOTION_API_KEY with your Notion internal integration secret.",
          "Fill in NOTION_DATABASE_ID with your tracker database ID.",
          "Run npm run check:notion to confirm the wiring, then restart.",
        ],
      };
    case "unauthorized":
      return {
        title: "Notion rejected the API key",
        summary: "The key was received, but Notion would not accept it.",
        steps: [
          "Check NOTION_API_KEY in .env.local starts with ntn_ or secret_.",
          "Paste the secret on its own — do not add a Bearer prefix.",
          "Confirm the integration still exists at notion.so/my-integrations.",
          "Restart the server after any change.",
        ],
      };
    case "not-found":
      return {
        title: "Database not found",
        summary: "The credentials work, but that database is not reachable.",
        steps: [
          "Open your tracker database in Notion.",
          "Use the ••• menu → Connections → add your integration. This step is the usual culprit: a database stays invisible to an integration until it is shared with it.",
          "Check NOTION_DATABASE_ID matches the 32-character id in the database URL.",
          "Run npm run check:notion to confirm, then restart.",
        ],
      };
    case "api":
      return {
        title: `Notion returned an error (${failure.status})`,
        summary: "The request reached Notion but did not succeed.",
        steps: [
          "Wait a moment and reload — this is often temporary.",
          "Check status.notion.so if it keeps happening.",
        ],
      };
  }
}

export function SetupNotice({ failure }: { failure: NotionFailure }) {
  const { title, summary, steps } = guidanceFor(failure);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-gold-500" />
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-gold-500">
            Setup needed
          </span>
        </div>

        <h1 className="mt-4 text-xl font-semibold text-zinc-100">{title}</h1>
        <p className="mt-2 text-[13px] text-zinc-400">{summary}</p>

        <ol className="mt-6 space-y-3">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-[13px] text-zinc-400">
              <span className="mt-px font-mono text-[13px] tabular-nums text-gold-500/60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-8 border-t border-white/[0.04] pt-4 text-[11px] text-zinc-400">
          This screen replaces the dashboard until the connection succeeds. Full
          setup steps are in the Setup Manual.
        </p>
      </div>
    </div>
  );
}
