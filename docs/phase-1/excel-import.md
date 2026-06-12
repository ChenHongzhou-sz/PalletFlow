# Excel Import Specification

## Scope

V1 supports Excel import for master data only.

Supported import targets:

- material master data
- barcode alias data

Not supported in this template:

- batch inventory opening balances
- operation logs
- cycle count history
- direct stock overwrite

## Supported File Types

Recommended:

- `.xlsx`
- `.csv`

Best practice for production:

- use the provided `.xlsx` template for daily business use
- use `.csv` only for quick bulk editing or system-to-system conversion

## Workbook Structure

The standard workbook contains these sheets:

1. `instructions`
2. `materials`
3. `barcode_aliases`

In V1, the importer also supports:

- a single-sheet workbook such as `Sheet1`
- Chinese header names, as long as the required columns can be recognized

## Materials Sheet

### Purpose

Import or update material master data.

### Unique Key

`material_code`

### Columns

| Column | Required | Rule |
| -- | -- | -- |
| `material_code` | Yes | Full material code, unique, no blank |
| `short_code` | No | Short alias used by warehouse staff |
| `description` | No | Human-readable material description |
| `category` | No | Such as 电容 / 电阻 / 磁珠 / IC / 连接器 |
| `specification` | No | Such as 35V 100UF / 1005 / SOP-8 |
| `image_url` | No | Optional material image link |

Accepted header aliases in V1:

- `material_code`: `物料型号`, `料号`, `完整料号`
- `short_code`: `物料代码`, `物料编码`, `简称`
- `description`: `物料描述`, `描述`

### Import Behavior

- If `material_code` does not exist, insert a new material.
- If `material_code` already exists, update the existing material.
- Non-empty incoming values overwrite current values.
- Empty incoming values do not clear existing values in V1.
- If the same `material_code` appears more than once in one file, reject the file and return the duplicate list.

## Barcode Aliases Sheet

### Purpose

Import barcode-to-material mapping.

### Unique Key

`barcode`

### Columns

| Column | Required | Rule |
| -- | -- | -- |
| `barcode` | Yes | Unique barcode, no blank |
| `material_code` | Yes | Must match an existing material or a material in the same workbook import |
| `remark` | No | Optional source or packaging note |

Accepted header aliases in V1:

- `barcode`: `条码`, `外箱条码`, `箱条码`
- `material_code`: `物料型号`, `料号`, `完整料号`
- `remark`: `备注`

### Import Behavior

- If `barcode` does not exist, insert a new barcode alias.
- If `barcode` already exists and maps to the same `material_code`, update the remark only.
- If `barcode` already exists but maps to a different `material_code`, reject that row.
- One material may have multiple barcodes.
- If the same `barcode` appears more than once in one file, reject the file and return the duplicate list.

## Validation Rules

### File-Level Rules

- First row must be the header row.
- Sheet names do not have to match the template if the header row is recognizable.
- Do not merge cells.
- Do not add subtotal rows.
- Do not put formulas in data cells.
- Hidden rows should be treated as normal rows, so do not use hidden rows to disable data.

### Value Rules

- Trim leading and trailing spaces.
- Treat empty strings as null.
- `material_code` comparison is case-insensitive for duplicate checks, but stored value should preserve the uploaded text.
- `barcode` must be treated as text, not number, to avoid losing leading zeroes.
- The import preview should flag suspicious whitespace, duplicate values, and missing required keys.

## Recommended Import Workflow

1. Upload workbook or CSV.
2. Parse and validate file structure.
3. Show preview:
   - insert count
   - update count
   - reject count
   - duplicate list
   - missing material references
4. User confirms import.
5. System writes data and records an import operation log.

## Error Handling Policy

For production safety, the default policy should be conservative:

- structural errors: reject the whole file
- duplicate keys in the same file: reject the whole file
- barcode conflict with another material: reject the conflicting row
- missing required column: reject the whole file

## What You Can Upload To Me

You can upload any of these to me later for cleanup or mapping:

- current material master Excel
- supplier barcode mapping Excel
- mixed raw warehouse lists that need to be normalized

I can help you:

- align columns to the PalletFlow template
- detect duplicates
- normalize material names and short codes
- split one messy sheet into `materials` and `barcode_aliases`
