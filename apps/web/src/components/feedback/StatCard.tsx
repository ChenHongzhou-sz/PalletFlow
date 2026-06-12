interface StatCardProps {
  label: string;
  value: string;
  tone?: "default" | "accent" | "dark";
}

export function StatCard({ label, value, tone = "default" }: StatCardProps) {
  const toneClass =
    tone === "accent"
      ? "bg-ember/[0.15] text-ink"
      : tone === "dark"
        ? "bg-ink text-white"
        : "bg-slate-100/90 text-ink";

  return (
    <div className={`rounded-[1.6rem] px-4 py-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}
