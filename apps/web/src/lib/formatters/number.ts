const quantityFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 3,
});

export function formatQuantity(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return quantityFormatter.format(value);
}

