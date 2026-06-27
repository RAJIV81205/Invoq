import { requireSession } from "@/app/lib/auth-cookie";
import Sidebar from "@/app/components/Sidebar";
import Topbar from "@/app/components/Topbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          stellarAddress={session.developer.stellarAddress}
          email={session.developer.email}
        />
        <div className="flex-1 px-6 md:px-8 py-6 max-w-7xl w-full mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
