// Shared VOSS presentational primitives (docs/VOSS.org_design.md §11.4). No data access here.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

/** "Vshow" wordmark. */
export function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-3" aria-label="Vshow home">
      <span className="wordmark" aria-hidden="true">
        VShow
      </span>
    </Link>
  );
}

const SunIcon = () => (
  <svg
    className="theme-icon-dark"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const MoonIcon = () => (
  <svg
    className="theme-icon-light"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

/** Persists the choice in localStorage (defensively) under the same key as vosslabs.org. Icons swap with CSS, so SSR matches. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("voss-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable: the theme still applies for this page view */
    }
  }
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-pressed={dark} aria-label="Dark theme">
      <SunIcon />
      <MoonIcon />
    </button>
  );
}

/** Page heading block: optional breadcrumb, eyebrow, H1, description, and a primary action. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  breadcrumb,
  badge,
  back,
}: {
  title: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  badge?: ReactNode;
  /** Parent page: shows a back arrow above the title. */
  back?: { to: string; label: string };
}) {
  return (
    <header className="mb-10">
      {(back || breadcrumb) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {back && (
            <Link
              to={back.to}
              className="link-quiet inline-flex items-center gap-2 text-sm"
              aria-label={`Back to ${back.label}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
          )}
          {breadcrumb && <div className="mono text-xs text-dim">{breadcrumb}</div>}
        </div>
      )}
      {eyebrow && <p className="eyebrow eyebrow-brand mb-3">{eyebrow}</p>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="page-title break-words">{title}</h1>
            {badge}
          </div>
          {description && <div className="mt-3 max-w-170 text-dim">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled section with the eyebrow-and-rule rhythm used across detail pages. */
export function Section({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="rule-top pt-8">
      <h2 id={headingId} className="section-title">
        {title}
      </h2>
      {description && <p className="mt-2 max-w-170 text-dim">{description}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

const TONE_ICON: Record<Tone, string> = { ok: "✓", warn: "!", danger: "✕", info: "i", neutral: "·" };

/** Inline status/feedback message. Tone is carried by an icon and a left rule as well as color. */
export function Notice({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className="notice" data-tone={tone} role={role ?? (tone === "danger" ? "alert" : "status")}>
      <span
        aria-hidden="true"
        className="mono mt-0.5 w-4 shrink-0 text-center font-semibold"
        style={{ color: `var(--color-${tone === "neutral" ? "dim" : tone})` }}
      >
        {TONE_ICON[tone]}
      </span>
      <div className="min-w-0">
        {title && <p className="notice-title">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

/** No data vs. no results: say which, offer one relevant next action. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rule-top border-b border-line py-14">
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      {children && <p className="mt-2 max-w-130 text-dim">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Two-up description list with shared separators (hero-metadata pattern, labels kept readable). */
export function MetadataList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="m-0 grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 border-b border-line py-4 pr-4 sm:[&:not(:last-child)]:border-r sm:pl-4 first:pl-0"
        >
          <dt className="meta-label">{item.label}</dt>
          <dd className="meta-value m-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function SiteFooter() {
  return (
    <footer className="rule-top mt-24 py-12">
      <div className="container-voss flex flex-wrap items-center justify-between gap-6">
        <span className="wordmark" role="img" aria-label="Vshow">
          Vshow
        </span>
        <p className="mono text-xs tracking-wider text-dim uppercase">Vshow · Campus screen media approval</p>
      </div>
    </footer>
  );
}
