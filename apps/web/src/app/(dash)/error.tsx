"use client";

/**
 * Route-level error boundary. Catches throws from the dash server components
 * (Torn API down, DB unreachable, bad data) and shows a friendly retry instead
 * of the raw Next.js error overlay / blank crash.
 */
import { useEffect } from "react";

export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dash] render error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-surface p-8 text-center"
    >
      <div className="text-2xl" aria-hidden="true">
        ⚠️
      </div>
      <div className="text-sm font-semibold">Something went wrong loading this page.</div>
      <p className="text-xs text-muted">
        The data source may be briefly unavailable. This usually clears on its own.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-[#22c48a] px-4 py-2 text-sm font-semibold text-[#0f0f0f]"
      >
        Try again
      </button>
    </div>
  );
}
