interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="pf-panel border-dashed border-slate-300 bg-white/[0.66] p-6 text-center">
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
