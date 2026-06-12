# PalletFlow Database ER Design

## ER Diagram

```mermaid
erDiagram
    warehouses ||--o{ pallets : contains
    warehouses ||--o{ inventory_batches : scopes
    warehouses ||--o{ stock_operations : records
    warehouses ||--o{ inventory_counts : groups

    materials ||--o{ barcode_aliases : maps
    materials ||--o{ inventory_batches : stored_as
    materials ||--o{ stock_operation_lines : changes
    materials ||--o{ inventory_count_items : counted_as

    pallets ||--o{ inventory_batches : holds
    pallets ||--o{ stock_operation_lines : affects
    pallets ||--o{ inventory_counts : counted
    pallets ||--o{ inventory_count_items : snapshot_rows

    stock_operations ||--o{ stock_operation_lines : has
    inventory_batches ||--o{ stock_operation_lines : references

    inventory_counts ||--o{ inventory_count_items : has
    inventory_batches ||--o{ inventory_count_items : snapshots

    warehouses {
        uuid id PK
        text warehouse_code UK
        text warehouse_name
        boolean is_active
        timestamptz created_at
    }

    pallets {
        uuid id PK
        uuid warehouse_id FK
        text pallet_code UK
        text area
        text status
        text remark
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    materials {
        uuid id PK
        text material_code UK
        text short_code
        text description
        text category
        text specification
        text image_url
        boolean is_active
        text search_text
        jsonb metadata
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    barcode_aliases {
        uuid id PK
        uuid material_id FK
        text barcode
        text remark
        boolean is_active
        timestamptz created_at
        timestamptz deleted_at
    }

    inventory_batches {
        uuid id PK
        uuid warehouse_id FK
        uuid pallet_id FK
        uuid material_id FK
        numeric initial_quantity
        numeric quantity
        date production_date
        text lot_no
        text box_barcode
        text batch_status
        text remark
        jsonb metadata
        uuid created_by
        uuid updated_by
        timestamptz created_at
        timestamptz updated_at
        timestamptz closed_at
        timestamptz deleted_at
    }

    stock_operations {
        uuid id PK
        uuid warehouse_id FK
        text operation_type
        text source
        uuid requested_material_id FK
        numeric requested_quantity
        text operator_name
        text note
        uuid created_by
        timestamptz created_at
    }

    stock_operation_lines {
        uuid id PK
        uuid operation_id FK
        integer line_no
        uuid batch_id FK
        uuid pallet_id FK
        uuid material_id FK
        numeric quantity_change
        numeric quantity_before
        numeric quantity_after
        date production_date
        text lot_no
        text box_barcode
        text remark
        timestamptz created_at
    }

    inventory_counts {
        uuid id PK
        uuid warehouse_id FK
        uuid pallet_id FK
        text count_status
        text operator_name
        text note
        timestamptz snapshot_at
        timestamptz completed_at
        uuid created_by
        timestamptz created_at
    }

    inventory_count_items {
        uuid id PK
        uuid count_id FK
        integer line_no
        uuid batch_id FK
        uuid pallet_id FK
        uuid material_id FK
        date production_date
        text lot_no
        numeric system_quantity
        numeric counted_quantity
        numeric variance_quantity
        text note
        timestamptz created_at
    }
```

## Design Notes

### Core Inventory Rule

`inventory_batches` is the source of truth for available stock. Rows stay in history even when `quantity = 0`.

### FIFO Rule

Outbound suggestions sort by:

1. `production_date` ascending
2. `created_at` ascending
3. `id` ascending as the final stable tie-breaker

### Production Month Storage

The PRD uses year-month granularity. The database stores it as a `date` pinned to the first day of the month.

Examples:

- `2024-12-01`
- `2025-03-01`

The UI always renders it as `YYYY-MM`.

### Why Logs Are Split Into Header + Lines

One outbound request can consume multiple pallets and multiple batches. A header-line model avoids losing traceability when one action spans many rows.

### V2 Reserved Fields

The schema already reserves expansion points for:

- `warehouse_id`
- `created_by`
- `updated_by`
- `metadata`

That allows later growth into multi-warehouse, OCR enrichment, AI parsing hints, and role-based access without redesigning the main inventory tables.
