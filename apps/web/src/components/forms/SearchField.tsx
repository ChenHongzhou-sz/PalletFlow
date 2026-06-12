import type { ReactNode } from "react";

interface SearchFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  action?: ReactNode;
}

export function SearchField({ label, value, placeholder, onChange, action }: SearchFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-600">{label}</span>
      <div className="flex items-center gap-3">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="pf-input"
        />
        {action}
      </div>
    </label>
  );
}

