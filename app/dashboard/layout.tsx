import { requireSession } from "@/app/lib/auth-cookie";
import Sidebar from "@/app/components/Sidebar";
import Topbar from "@/app/components/Topbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          stellarAddress={session.developer.stellarAddress}
          email={session.developer.email}
        />
        <div className="flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">
          {children}
          </div>
        </div>
      </div>
    </div>
  );
}
