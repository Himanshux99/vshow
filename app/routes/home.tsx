import { Link, redirect } from "react-router";
import type { Route } from "./+types/home";
import { resolveAccess } from "../auth/authorize.server";
import { landingPath } from "../auth/landing";
import { PublicHeader } from "../components/app-header";
import { SiteFooter } from "../components/ui";
import { getRequestScope } from "../server/request-scope.server";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Vshow · Campus screen media approval" },
    {
      name: "description",
      content:
        "Committees submit media, Corporate Communication reviews the exact version, and approved media is handed to the Server Room Manager.",
    },
  ];
}

// Signed-in people skip the landing page. Any failure to resolve a session just shows the page (and is logged):
// the landing page must stay reachable when auth or the database is down.
export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  try {
    const access = await resolveAccess(scope, request.headers);
    if (access.status === "ok") throw redirect(landingPath(access.user.roles));
    if (access.status === "unassigned") throw redirect("/unclaimed");
  } catch (err) {
    if (err instanceof Response) throw err;
    scope.logger.warn("landing page could not resolve the session", { err });
  }
  return null;
}

const STEPS = [
  {
    title: "Draft and upload",
    body: "A committee convener creates a request, uploads one media file, and picks the screens and display windows they would like.",
  },
  {
    title: "Review the exact version",
    body: "Corporate Communication approves, rejects, or asks for changes. Every decision is tied to the version that was reviewed.",
  },
  {
    title: "Revise without losing history",
    body: "Replacing the file creates a new version. Earlier approvals stay in the record but never cover the new file.",
  },
  {
    title: "Hand off for scheduling",
    body: "The Server Room Manager schedules approved media in the existing signage software. Requested windows are preferences, not bookings.",
  },
];

const RULES = [
  [
    "01",
    "Version-bound approval",
    "A decision applies to one immutable revision. Change the file, title, or windows and it is reviewed again.",
  ],
  [
    "02",
    "Server-side access",
    "Roles and committee membership are checked on the server for every read and write, not only in the interface.",
  ],
  [
    "03",
    "Full history",
    "Media versions, decisions, and audit events are append-only, so what was approved and by whom is always visible.",
  ],
  [
    "04",
    "Direct, private uploads",
    "Files go straight to private storage with short-lived links and are checked by type, size, and file signature.",
  ],
];

const LIFECYCLE = [
  ["DRAFT", "Convener is preparing media and windows"],
  ["PENDING_REVIEW", "Waiting for Corporate Communication"],
  ["CHANGES_REQUESTED", "Convener uploads a new version"],
  ["APPROVED", "Exact version cleared for handoff"],
  ["REJECTED", "Closed; a resubmission starts fresh"],
];

export default function Home() {
  return (
    <>
      <PublicHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <section className="container-voss grid items-center gap-12 py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-20 lg:py-28">
          <div>
            <p className="eyebrow eyebrow-brand mb-6">Campus screens · Phase 1</p>
            <h1 className="hero-title">
              Screen media, approved properly<span className="text-brand">.</span>
            </h1>
            <p className="lede mt-8">
              One place for committees to submit media, Corporate Communication to review it, and the Server Room
              Manager to pick up what is approved. No email threads.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link to="/login" className="btn btn-lg">
                Sign in with VOSS <span aria-hidden="true">→</span>
              </Link>
              <a href="#how-it-works" className="btn btn-ghost btn-lg">
                How it works
              </a>
            </div>
          </div>

          {/* The documented status model as a flat bordered panel. */}
          <div className="panel p-0">
            <div className="mono flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-dim">
              <span>submission.status</span>
              <span>VS-2026-000123</span>
            </div>
            <ol className="m-0 list-none p-0" aria-label="Submission lifecycle">
              {LIFECYCLE.map(([status, note], i) => (
                <li
                  key={status}
                  className={`grid grid-cols-[28px_1fr] gap-3 px-4 py-3.5 ${i < LIFECYCLE.length - 1 ? "border-b border-line" : ""}`}
                >
                  <span className="mono tabular text-xs text-dim">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="mono text-sm font-medium">{status}</span>
                    <span className="block text-sm text-dim">{note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="how-it-works" className="rule-top py-20" aria-labelledby="how-heading">
          <div className="container-voss">
            <p className="eyebrow eyebrow-brand mb-4">How it works</p>
            <h2
              id="how-heading"
              className="mb-12 max-w-3xl text-[clamp(1.9rem,5.5vw,4rem)] leading-[1.05] font-semibold tracking-[-0.04em]"
            >
              From draft to the screen, with every step on record
            </h2>
            <ol className="rows m-0 list-none p-0">
              {STEPS.map((step, i) => (
                <li key={step.title} className="row-item">
                  <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-[clamp(1.4rem,2.2vw,1.85rem)] leading-[1.15] tracking-[-0.025em]">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-170 text-dim">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="rule-top py-20" aria-labelledby="rules-heading">
          <div className="container-voss">
            <p className="eyebrow eyebrow-brand mb-4">Ground rules</p>
            <h2
              id="rules-heading"
              className="mb-12 max-w-3xl text-[clamp(1.9rem,3.6vw,2.8rem)] leading-[1.05] font-semibold tracking-[-0.04em]"
            >
              Built so an approval can be trusted
            </h2>
            <div className="bordered-grid">
              {RULES.map(([num, title, body]) => (
                <div key={num}>
                  <div className="flex items-baseline gap-3.5">
                    <span className="mono text-xs text-dim">{num}</span>
                    <h3 className="text-[1.2rem] tracking-[-0.02em]">{title}</h3>
                  </div>
                  <p className="mt-3 text-[0.95rem] text-dim">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rule-top py-20">
          <div className="container-voss flex flex-wrap items-center justify-between gap-6">
            <p className="max-w-xl text-2xl font-semibold tracking-tight">
              Sign in with your VOSS account to see your submissions or the review queue.
            </p>
            <Link to="/login" className="btn btn-lg">
              Sign in <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
