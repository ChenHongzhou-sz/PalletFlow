from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


BASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_PATHS = [
    BASE_DIR / "templates" / "PalletFlow-master-data-import-template.xlsx",
    BASE_DIR / "apps" / "web" / "public" / "templates" / "PalletFlow-master-data-import-template.xlsx",
]


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

    xml_rows = []
    for row_number, values in enumerate(rows, start=1):
        xml_rows.append(row_xml(row_number, values, header=(row_number == 1)))

    if sheet_name == "materials":
        cols_xml = (
            "<cols>"
            '<col min="1" max="1" width="24" customWidth="1"/>'
            '<col min="2" max="2" width="20" customWidth="1"/>'
            '<col min="3" max="3" width="34" customWidth="1"/>'
            '<col min="4" max="4" width="18" customWidth="1"/>'
            '<col min="5" max="5" width="22" customWidth="1"/>'
            '<col min="6" max="6" width="34" customWidth="1"/>'
            "</cols>"
        )
    elif sheet_name == "barcode_aliases":
        cols_xml = (
            "<cols>"
            '<col min="1" max="1" width="24" customWidth="1"/>'
            '<col min="2" max="2" width="24" customWidth="1"/>'
            '<col min="3" max="3" width="34" customWidth="1"/>'
            "</cols>"
        )
    else:
        cols_xml = (
            "<cols>"
            '<col min="1" max="1" width="90" customWidth="1"/>'
            "</cols>"
        )

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension}"/>'
        f"{sheet_views}"
        f"{cols_xml}"
        f"<sheetData>{''.join(xml_rows)}</sheetData>"
        "</worksheet>"
    )


def build_workbook_files() -> dict[str, str]:
    created = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    instructions_rows = [
        ["Read me before import"],
        ["1. Use the materials sheet for material master data only."],
        ["2. Use the barcode_aliases sheet for barcode mapping only."],
        ["3. Do not rename headers or merge cells."],
        ["4. material_code is the unique key for materials."],
        ["5. barcode is the unique key for barcode aliases."],
        ["6. Duplicate keys in one upload should be rejected."],
        ["7. Barcode must be stored as text to preserve leading zeroes."],
        ["8. Empty incoming cells do not clear existing values in V1."],
        ["9. Upload preview should show inserts, updates, and rejected rows."],
    ]

    materials_rows = [
        ["material_code", "short_code", "description", "category", "specification", "image_url"],
        ["SZ1005G121TF", "SZ121", "磁珠 120R 1005", "磁珠", "1005", ""],
        ["CAP-35V-100UF", "35V100UF", "电解电容 100UF 35V", "电容", "35V 100UF", ""],
    ]

    barcode_rows = [
        ["barcode", "material_code", "remark"],
        ["6901234567890", "SZ1005G121TF", "外箱条码示例"],
        ["6901234567891", "CAP-35V-100UF", "供应商标签条码示例"],
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

    for output_path in OUTPUT_PATHS:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as workbook_zip:
            for archive_name, content in workbook_files.items():
                workbook_zip.writestr(archive_name, content)
        print(f"Created: {output_path}")


if __name__ == "__main__":
    main()
