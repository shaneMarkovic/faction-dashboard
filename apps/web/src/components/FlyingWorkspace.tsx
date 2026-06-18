"use client";

import { type ReactNode, useState } from "react";
import { CoPilotDock } from "./CoPilotDock";
import type { AiChatSummary } from "@/lib/ai/chat-store";

/**
 * Layout shell for the Flying page: main content on the left, co-pilot on the
 * right. Owns the desktop collapse state so retracting the co-pilot gives the
 * table full width (the grid drops to a single column). On mobile the co-pilot
 * is always a drawer (handled inside CoPilotDock), so collapse is desktop-only.
 */
export function FlyingWorkspace({
  main,
  settings,
  configured,
  initialChats,
}: {
  main: ReactNode;
  settings: ReactNode;
  configured: boolean;
  initialChats: AiChatSummary[];
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <div
        className={`grid gap-5 lg:items-start ${
          collapsed ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_360px]"
        }`}
      >
        <div className="min-w-0 space-y-4">{main}</div>
        <CoPilotDock
          settings={settings}
          configured={configured}
          initialChats={initialChats}
          collapsed={collapsed}
          onCollapse={() => setCollapsed(true)}
        />
      </div>

      {/* Desktop launcher to bring the co-pilot back. */}
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="fixed bottom-4 right-4 z-30 hidden rounded-full bg-[#22c48a] px-4 py-3 text-sm font-semibold text-[#0f0f0f] shadow-lg lg:block"
        >
          🤖 Co-pilot
        </button>
      )}
    </>
  );
}
