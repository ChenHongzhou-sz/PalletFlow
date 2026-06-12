interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="space-y-3">
      <span className="pf-pill bg-ink text-white">{eyebrow}</span>
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </header>
  );
}

