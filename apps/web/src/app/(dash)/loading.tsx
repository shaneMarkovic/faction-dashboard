/**
 * Route-level loading UI. Renders instantly on navigation while the async
 * server component fetches data — so clicking a nav item swaps the page right
 * away instead of hanging on the previous screen until data resolves.
 */
export default function DashLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-48 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-surface" />
    </div>
  );
}
