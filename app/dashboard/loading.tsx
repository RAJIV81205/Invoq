export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-label="Loading dashboard" aria-live="polite">
      <div className="surface overflow-hidden rounded-[1.25rem] p-6 sm:p-8">
        <div className="h-2 w-28 animate-pulse rounded-full bg-white/10" />
        <div className="mt-5 h-10 w-full max-w-md animate-pulse rounded-lg bg-white/[0.07]" />
        <div className="mt-4 h-3 w-full max-w-xl animate-pulse rounded-full bg-white/[0.05]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="surface h-28 animate-pulse rounded-[1.15rem] bg-white/[0.025]" />
        ))}
      </div>
      <div className="surface h-72 animate-pulse rounded-[1.25rem] bg-white/[0.025]" />
    </div>
  );
}
