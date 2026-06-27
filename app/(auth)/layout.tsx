import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4">
        <Link href="/" className="inline-flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-[var(--brand)] to-[var(--accent)] text-white font-bold text-xs">
            IQ
          </div>
          <span className="font-semibold">Invoq</span>
        </Link>
      </header>
      <div className="flex-1 grid place-items-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
