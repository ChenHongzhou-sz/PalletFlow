interface StepStripProps {
  current: 1 | 2 | 3;
  labels: [string, string, string];
}

export function StepStrip({ current, labels }: StepStripProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {labels.map((label, index) => {
        const isActive = current >= index + 1;

        return (
          <div
            key={label}
            className={`rounded-2xl px-3 py-3 text-center text-sm font-semibold ${
              isActive ? "bg-ember text-ink" : "bg-white/[0.75] text-slate-500"
            }`}
          >
            {index + 1}. {label}
          </div>
        );
      })}
    </div>
  );
}
