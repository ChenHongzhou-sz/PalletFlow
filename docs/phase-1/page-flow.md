# PalletFlow Page Flow

## Navigation Principle

The application should feel like a field tool, not a management backend.

- Search material and search pallet must be visually strongest on the home screen.
- Inbound and outbound must finish within three steps.
- Count and logs remain accessible, but should not overshadow the two primary lookup tasks.

## Global Navigation Flow

```mermaid
flowchart TD
    HOME[Home]

    HOME --> FIND_MATERIAL[Search Material]
    HOME --> FIND_PALLET[Search Pallet]
    HOME --> INBOUND[Inbound to Pallet]
    HOME --> OUTBOUND[Outbound by FIFO]
    HOME --> COUNT[Cycle Count]
    HOME --> LOGS[Operation Logs]

    FIND_MATERIAL --> MATERIAL_DETAIL[Material Detail + Stock Distribution]
    FIND_PALLET --> PALLET_DETAIL[Pallet Detail + Clear Pallet]

    INBOUND --> IN_1[Step 1 Select Pallet]
    IN_1 --> IN_2[Step 2 Search / Scan Material]
    IN_2 --> IN_3[Step 3 Enter Qty + Month + Save]
    IN_3 --> MATERIAL_DETAIL

    OUTBOUND --> OUT_1[Step 1 Search / Scan Material]
    OUT_1 --> OUT_2[Step 2 Enter Required Qty]
    OUT_2 --> OUT_3[Step 3 Confirm FIFO Suggestion]
    OUT_3 --> MATERIAL_DETAIL

    COUNT --> COUNT_1[Select Pallet]
    COUNT_1 --> COUNT_2[Review System Stock]
    COUNT_2 --> COUNT_3[Enter Actual Qty + Save Difference]
    COUNT_3 --> LOGS

    LOGS --> LOG_DETAIL[Operation Detail]
```

## Home Screen Information Hierarchy

```mermaid
flowchart TD
    H1[Header: PalletFlow]
    H2[Primary Search Area]
    H3[Action Area]
    H4[Secondary Area]

    H2 --> M1[Search Material]
    H2 --> M2[Search Pallet]

    H3 --> A1[Inbound]
    H3 --> A2[Outbound]

    H4 --> S1[Cycle Count]
    H4 --> S2[Operation Logs]
```

## Inbound Flow Rules

1. Step 1: choose pallet from recent list or search by code.
2. Step 2: search material by code, short code, description, or barcode scan.
3. Step 3: enter quantity, production month, optional lot, optional box barcode, then save.

## Outbound Flow Rules

1. Step 1: search material by text or barcode.
2. Step 2: input required quantity.
3. Step 3: system returns FIFO suggestions grouped by pallet and batch; user confirms once.

## Search Material Screen Rules

- Search box is fixed at the top
- Scan button is always visible
- Result card must show exact code, short code, description
- Stock distribution list sorts by production month ascending
- Summary block shows total stock, pallet count, earliest month, latest month

## Search Pallet Screen Rules

- Enter pallet code directly from keypad
- Show only active stock rows by default
- Support in-list keyword filter for material
- Clear pallet action stays at the bottom and requires double confirmation

## Cycle Count Rules

- Count is always started from pallet level in V1
- System stock is loaded before editing
- Difference rows must be visible before save
- Saving a count must also create traceable stock operation lines when adjustments are applied
