from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


BASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_PATHS = [
    BASE_DIR / "templates" / "PalletFlow-master-data-import-template.xlsx",
    BASE_DIR / "templates" / "PalletFlow-master-data-import-template-v2.xlsx",
    BASE_DIR / "apps" / "web" / "public" / "templates" / "PalletFlow-master-data-import-template.xlsx",
    BASE_DIR / "apps" / "web" / "public" / "templates" / "PalletFlow-master-data-import-template-v2.xlsx",
]

MATERIAL_HEADERS = [
    "material_code",
    "short_code",
    "description",
    "category",
    "specification",
    "specification_raw",
    "brand",
    "series",
    "manufacturer_part_no",
    "internal_part_no",
    "voltage_v",
    "capacitance_value",
    "capacitance_unit",
    "diameter_mm",
    "height_mm",
    "lifetime_h",
    "temperature_c",
    "standard_box_qty",
    "moq",
    "mpq",
    "search_aliases",
    "alias_type",
    "alias_value",
    "customer_name",
    "supplier_name",
    "remark",
    "image_url",
]

BARCODE_HEADERS = ["barcode", "material_code", "remark"]

MATERIAL_COLUMN_WIDTHS = [
    24,
    18,
    24,
    18,
    34,
    34,
    14,
    12,
    20,
    18,
    12,
    16,
    16,
    12,
    12,
    12,
    14,
    16,
    12,
    12,
    28,
    18,
    22,
    16,
    16,
    26,
    28,
]

BARCODE_COLUMN_WIDTHS = [22, 24, 34]


def col_name(index: int) -> str:
    result = ""
    current = index
    while current:
        current, remainder = divmod(current - 1, 26)
        result = chr(65 + remainder) + result
    return result


def inline_cell(ref: str, value: str, style: int = 0) -> str:
    safe_value = escape(value)
    return (
        f'<c r="{ref}" t="inlineStr" s="{style}">'
        f"<is><t>{safe_value}</t></is></c>"
    )


def row_xml(row_number: int, values: list[str], header: bool = False) -> str:
    style = 1 if header else 0
    cells = []
    for idx, value in enumerate(values, start=1):
        if value is None or value == "":
            continue
        ref = f"{col_name(idx)}{row_number}"
        cells.append(inline_cell(ref, str(value), style))
    return f'<row r="{row_number}">{"".join(cells)}</row>'


def cols_xml(widths: list[int]) -> str:
    return "<cols>" + "".join(
        f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>'
        for idx, width in enumerate(widths, start=1)
    ) + "</cols>"


def worksheet_xml(sheet_name: str, rows: list[list[str]], freeze_header: bool = True) -> str:
    max_row = max(len(rows), 1)
    max_col = max((len(r) for r in rows), default=1)
    dimension = f"A1:{col_name(max_col)}{max_row}"

    sheet_views = (
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
        "</sheetView></sheetViews>"
        if freeze_header
        else '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    )

    if sheet_name == "materials":
        columns = cols_xml(MATERIAL_COLUMN_WIDTHS)
    elif sheet_name == "barcode_aliases":
        columns = cols_xml(BARCODE_COLUMN_WIDTHS)
    else:
        columns = cols_xml([90])

    xml_rows = []
    for row_number, values in enumerate(rows, start=1):
        xml_rows.append(row_xml(row_number, values, header=(row_number == 1)))

    auto_filter = ""
    if freeze_header and rows:
        auto_filter = f'<autoFilter ref="A1:{col_name(max_col)}{max_row}"/>'

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension}"/>'
        f"{sheet_views}"
        f"{columns}"
        f"<sheetData>{''.join(xml_rows)}</sheetData>"
        f"{auto_filter}"
        "</worksheet>"
    )


def build_workbook_files() -> dict[str, str]:
    created = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    instructions_rows = [
        ["PalletFlow 主数据导入模板说明"],
        ["1. materials 工作表用于物料主数据导入或更新。"],
        ["2. barcode_aliases 工作表用于条码到 material_code 的映射。"],
        ["3. 不要修改表头，不要合并单元格，也不要插入小计行。"],
        ["4. materials 必填列：material_code。"],
        ["5. barcode_aliases 必填列：barcode、material_code。"],
        ["6. 同一文件内重复的 material_code 或 barcode 会被拒绝。"],
        ["7. 空白单元格不会清空数据库已有值，只会跳过该字段。"],
        ["8. barcode 请按文本处理，保留前导零。"],
        ["9. search_aliases 用 | 分隔多个搜索别名，例如：100v|330uf|12.5x25|gt。"],
        ["10. capacitance_value 支持直接写 330uF / 5F；voltage_v 支持写 100V。"],
        ["11. 如果有客户料号，可在 materials 里填写 alias_type、alias_value、customer_name。"],
        ["12. 示例行仅用于演示，正式导入前可删除。"],
    ]

    materials_rows = [
        MATERIAL_HEADERS,
        [
            "EGT337M2AI25RR",
            "GT10033012525",
            "铝电解电容 330uF 100V",
            "铝电解电容",
            "100V/330uF,Φ12.5x25,GT系列10000H",
            "100V/330uF,Φ12.5x25,GT系列10000H",
            "万裕",
            "GT",
            "",
            "",
            "100V",
            "330uF",
            "uF",
            "12.5",
            "25",
            "10000",
            "105",
            "500",
            "500",
            "100",
            "100v|330uf|12.5x25|gt",
            "",
            "",
            "",
            "万裕",
            "示例：基础物料主数据",
            "",
        ],
        [
            "DDL505S05G3CRR",
            "DDL550033",
            "超级电容 5F 5.5V",
            "超级电容",
            "5.5V/5F,Φ11x33,DDL系列1000H",
            "5.5V/5F,Φ11x33,DDL系列1000H",
            "万裕",
            "DDL",
            "",
            "",
            "5.5V",
            "5F",
            "uF",
            "11",
            "33",
            "1000",
            "70",
            "300",
            "300",
            "50",
            "5.5v|5f|11x33|ddl|2x11c335055r5",
            "CUSTOMER_PART_NO",
            "2X11C335055R5",
            "德方",
            "万裕",
            "示例：包含客户料号别名",
            "",
        ],
    ]

    barcode_rows = [
        BARCODE_HEADERS,
        ["6901234567890", "EGT337M2AI25RR", "外箱条码示例"],
        ["6901234567891", "DDL505S05G3CRR", "供应商标签条码示例"],
    ]

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<fileVersion appName="xl"/>'
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>'
        "<sheets>"
        '<sheet name="instructions" sheetId="1" r:id="rId1"/>'
        '<sheet name="materials" sheetId="2" r:id="rId2"/>'
        '<sheet name="barcode_aliases" sheetId="3" r:id="rId3"/>'
        "</sheets>"
        "</workbook>"
    )

    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>'
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/><color rgb="FFFFFFFF"/></font>'
        "</fonts>"
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF18212B"/><bgColor indexed="64"/></patternFill></fill>'
        "</fills>"
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        "</cellXfs>"
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        "</Types>"
    )

    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:creator>Codex</dc:creator>"
        "<cp:lastModifiedBy>Codex</cp:lastModifiedBy>"
        "<dc:title>PalletFlow Master Data Import Template</dc:title>"
        "<dc:description>Material and barcode alias import template</dc:description>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>'
        "</cp:coreProperties>"
    )

    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>Microsoft Excel</Application>"
        "<DocSecurity>0</DocSecurity>"
        "<ScaleCrop>false</ScaleCrop>"
        '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>3</vt:i4></vt:variant></vt:vector></HeadingPairs>'
        '<TitlesOfParts><vt:vector size="3" baseType="lpstr"><vt:lpstr>instructions</vt:lpstr><vt:lpstr>materials</vt:lpstr><vt:lpstr>barcode_aliases</vt:lpstr></vt:vector></TitlesOfParts>'
        "<Company></Company>"
        "<LinksUpToDate>false</LinksUpToDate>"
        "<SharedDoc>false</SharedDoc>"
        "<HyperlinksChanged>false</HyperlinksChanged>"
        "<AppVersion>16.0300</AppVersion>"
        "</Properties>"
    )

    return {
        "[Content_Types].xml": content_types,
        "_rels/.rels": root_rels,
        "docProps/core.xml": core_xml,
        "docProps/app.xml": app_xml,
        "xl/workbook.xml": workbook_xml,
        "xl/_rels/workbook.xml.rels": workbook_rels,
        "xl/styles.xml": styles_xml,
        "xl/worksheets/sheet1.xml": worksheet_xml("instructions", instructions_rows, freeze_header=False),
        "xl/worksheets/sheet2.xml": worksheet_xml("materials", materials_rows),
        "xl/worksheets/sheet3.xml": worksheet_xml("barcode_aliases", barcode_rows),
    }


def main() -> None:
    workbook_files = build_workbook_files()
    created_any = False

    for output_path in OUTPUT_PATHS:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as workbook_zip:
                for archive_name, content in workbook_files.items():
                    workbook_zip.writestr(archive_name, content)
            created_any = True
            print(f"Created: {output_path}")
        except PermissionError:
            print(f"Skipped (file is locked): {output_path}")

    if not created_any:
        raise PermissionError("No template files could be written because every target is locked.")


if __name__ == "__main__":
    main()
