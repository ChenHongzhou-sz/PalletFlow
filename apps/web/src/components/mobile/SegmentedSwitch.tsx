interface SegmentedSwitchOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedSwitchProps<T extends string> {
  label?: string;
  options: Array<SegmentedSwitchOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedSwitch<T extends string>({ label, options, value, onChange }: SegmentedSwitchProps<T>) {
  return (
    <div className="space-y-2">
      {label ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p> : null}
      <div className="grid grid-cols-2 gap-2 rounded-[1.6rem] bg-slate-100/90 p-2">
        {options.map((option) => {
          const active = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded-[1.1rem] px-4 py-3 text-sm font-semibold transition ${
                active ? "bg-ink text-white shadow-card" : "bg-transparent text-slate-600"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
