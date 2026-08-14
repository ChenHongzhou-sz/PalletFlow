import type { CycleCountInputRow, PalletInventoryRow } from "@/types/domain";

export interface InventoryQuantityAllocation {
  batchId: string;
  quantity: number;
  row: PalletInventoryRow;
}

function sortRowsForAllocation(rows: PalletInventoryRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const receivedCompare = (left.row.receivedAt ?? "").localeCompare(right.row.receivedAt ?? "");
      if (receivedCompare !== 0) {
        return receivedCompare;
      }

      const batchCompare = left.row.batchId.localeCompare(right.row.batchId);
      if (batchCompare !== 0) {
        return batchCompare;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function allocateTransferQuantity(rows: PalletInventoryRow[], requestedQuantity: number) {
  if (!rows.length || requestedQuantity <= 0) {
    return [] as InventoryQuantityAllocation[];
  }

  const orderedRows = sortRowsForAllocation(rows);
  const allocations: InventoryQuantityAllocation[] = [];
  let remaining = requestedQuantity;

  for (const row of orderedRows) {
    if (remaining <= 0) {
      break;
    }

    const quantity = Math.min(row.quantity, remaining);
    if (quantity <= 0) {
      continue;
    }

    allocations.push({
      batchId: row.batchId,
      quantity,
      row,
    });
    remaining -= quantity;
  }

  if (remaining > 0) {
    throw new Error(`可分配数量不足，仍有 ${remaining} PCS 未能匹配到底层批次。`);
  }

  return allocations;
}

export function distributeCountedQuantityAcrossRows(rows: PalletInventoryRow[], countedQuantity: number) {
  if (!rows.length) {
    return [] as CycleCountInputRow[];
  }

  const orderedRows = sortRowsForAllocation(rows);
  const normalizedCount = Math.max(0, countedQuantity);
  let remaining = normalizedCount;

  const items = orderedRows.map((row) => {
    const matchedQuantity = Math.min(row.quantity, Math.max(remaining, 0));
    remaining -= matchedQuantity;

    return {
      batchId: row.batchId,
      countedQuantity: matchedQuantity,
    } satisfies CycleCountInputRow;
  });

  if (remaining > 0) {
    items[0] = {
      ...items[0],
      countedQuantity: items[0].countedQuantity + remaining,
    };
  }

  return items;
}
