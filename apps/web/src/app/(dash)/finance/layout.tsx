import { redirect } from "next/navigation";
import { ConnectFinanceKey } from "@/components/ConnectFinanceKey";
import { FinanceTabs } from "@/components/FinanceTabs";
import { loadFinanceConnection } from "@/lib/finance";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FinanceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/gate");

  const { connected } = await loadFinanceConnection(session.tornId);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Finance</h1>
      </div>
      {connected ? (
        <>
          <FinanceTabs />
          {children}
        </>
      ) : (
        <ConnectFinanceKey />
      )}
    </div>
  );
}
