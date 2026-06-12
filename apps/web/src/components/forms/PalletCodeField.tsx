import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { listPalletLookupItems } from "@/services/search/search-service";
import type { PalletLookupItem } from "@/types/domain";

interface PalletCodeFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  allowCustom?: boolean;
  helperText?: string;
}

export function PalletCodeField({
  label,
  value,
  placeholder,
  onChange,
  allowCustom = false,
  helperText,
}: PalletCodeFieldProps) {
  const deferredValue = useDeferredValue(value.trim().toUpperCase());
  const [options, setOptions] = useState<PalletLookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!deferredValue) {
      setOptions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    listPalletLookupItems(deferredValue)
      .then((items) => {
        if (!cancelled) {
          setOptions(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredValue]);

  const exactMatch = useMemo(
    () => options.some((item) => item.palletCode.toUpperCase() === deferredValue),
    [deferredValue, options],
  );

  const showDropdown = focused && Boolean(deferredValue) && (loading || options.length > 0);

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-600">{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder={placeholder}
          className="pf-input"
          autoComplete="off"
        />

        {showDropdown ? (
          <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-[1.4rem] border border-slate-200 bg-white p-2 shadow-card">
            {loading ? (
              <p className="px-3 py-2 text-sm text-slate-500">正在匹配现有卡板...</p>
            ) : null}

            {!loading && options.length > 0 ? (
              <div className="space-y-2">
                {options.map((item) => (
                  <button
                    key={item.palletId}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onChange(item.palletCode);
                      setFocused(false);
                    }}
                    className={`block w-full rounded-[1.1rem] px-3 py-3 text-left transition ${
                      item.palletCode.toUpperCase() === deferredValue ? "bg-ember/[0.18]" : "bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-ink">{item.palletCode}</p>
                      <span className="text-xs text-slate-500">{item.activeBatchCount} 个在库批次</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.palletArea ? `位置 ${item.palletArea}` : "未设置位置"} · 状态 {item.status}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}

            {!loading && !options.length && deferredValue ? (
              <p className="px-3 py-2 text-sm text-slate-500">
                {allowCustom ? `未找到现有卡板 ${deferredValue}，可以继续按新卡板保存。` : "没有匹配的现有卡板。"}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {helperText ? <p className="mt-2 text-xs leading-5 text-slate-500">{helperText}</p> : null}
      {!helperText && allowCustom && deferredValue && !exactMatch ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">如果这是一个新卡板，直接继续保存，系统会在入库时自动建立。</p>
      ) : null}
    </label>
  );
}
