export function formatLocationType(value: string | null | undefined) {
  switch (value) {
    case "FIXED_PALLET":
      return "固定卡板";
    case "MOBILE_PALLET":
      return "机动卡板";
    case "OPEN_STOCK_SHELF":
      return "散料货架";
    case "OPEN_STOCK_BIN":
      return "散料格";
    case "RECEIVING":
      return "收货暂存";
    case "SHIPPING":
      return "出货暂存";
    case "OTHER":
      return "其他库位";
    default:
      return value ?? "未分类";
  }
}
