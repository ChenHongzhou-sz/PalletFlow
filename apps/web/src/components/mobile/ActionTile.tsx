import { Link } from "react-router-dom";

interface ActionTileProps {
  to: string;
  title: string;
  subtitle: string;
  tone?: "primary" | "dark" | "soft";
}

export function ActionTile({ to, title, subtitle, tone = "soft" }: ActionTileProps) {
  const toneClass =
    tone === "primary"
      ? "bg-ember text-ink"
      : tone === "dark"
        ? "bg-ink text-white"
        : "bg-white/[0.86] text-ink";

  return (
    <Link
      to={to}
      className={`block rounded-[1.8rem] p-5 shadow-card transition hover:-translate-y-1 ${toneClass}`}
    >
      <p className="font-display text-2xl font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{subtitle}</p>
    </Link>
  );
}
