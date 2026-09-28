import type { Cell, Sheet } from './spreadsheetExport';

const encoder = new TextEncoder();
const xml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
function column(index: number): string {
  let name = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function cell(value: Cell | undefined, address: string, style = 0): string {
  if (value == null || value === '') return '';
  const attr = ` r="${address}"${style ? ` s="${style}"` : ''}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c${attr}><v>${value}</v></c>`;
  const source = String(value);
  if (source.length > 32767)
    throw new Error(`单元格 ${address} 超过 Excel 的字符上限，请减少该客户的历史验配记录后再导出`);
  // inlineStr forces user-entered values, including =, + and @, to stay text.
  return `<c${attr} t="inlineStr"><is><t xml:space="preserve">${xml(source)}</t></is></c>`;
}
function worksheet(sheet: Sheet): string {
  if (sheet.rows.length >= 1048576) throw new Error(`“${sheet.name}”超过 Excel 的行数上限`);
  if (sheet.headers.length > 16384) throw new Error('工作表列数超过 Excel 的上限');
  const lastColumn = column(sheet.headers.length);
  const widths = sheet.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join('');
  const header = `<row r="1" ht="30" customHeight="1">${sheet.headers.map((value, index) => cell(value, `${column(index + 1)}1`, 1)).join('')}</row>`;
  const rows = sheet.rows
    .map((values, index) => {
      const rowNumber = index + 2;
      const hasLines = values.some(
        (value, col) =>
          sheet.wrapColumns?.includes(col + 1) && typeof value === 'string' && value.includes('\n'),
      );
      const height = hasLines
        ? Math.min(
            400,
            Math.max(
              34,
              Math.max(
                ...values.map((value) =>
                  typeof value === 'string' ? value.split('\n').length : 1,
                ),
              ) * 20,
            ),
          )
        : 23;
      return `<row r="${rowNumber}" ht="${height}" customHeight="1">${values.map((value, col) => cell(value, `${column(col + 1)}${rowNumber}`, sheet.wrapColumns?.includes(col + 1) ? 2 : 0)).join('')}</row>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastColumn}${sheet.rows.length + 1}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="23"/><cols>${widths}</cols><sheetData>${header}${rows}</sheetData>` +
    `<autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/>` +
    `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

// XLSX is a ZIP package. Stored entries avoid adding a browser dependency and
// keep the workbook usable in Excel, WPS and other OOXML readers.
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let j = 0; j < 8; j++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[i] = value >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries: Record<string, string>): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const write16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const write32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);
  for (const [path, content] of Object.entries(entries)) {
    const name = encoder.encode(path),
      body = encoder.encode(content),
      checksum = crc32(body);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    write32(lv, 0, 0x04034b50);
    write16(lv, 4, 20);
    write16(lv, 6, 0x0800);
    write16(lv, 12, 0x0021);
    write32(lv, 14, checksum);
    write32(lv, 18, body.length);
    write32(lv, 22, body.length);
    write16(lv, 26, name.length);
    local.set(name, 30);
    chunks.push(local, body);
    const directory = new Uint8Array(46 + name.length);
    const dv = new DataView(directory.buffer);
    write32(dv, 0, 0x02014b50);
    write16(dv, 4, 20);
    write16(dv, 6, 20);
    write16(dv, 8, 0x0800);
    write16(dv, 14, 0x0021);
    write32(dv, 16, checksum);
    write32(dv, 20, body.length);
    write32(dv, 24, body.length);
    write16(dv, 28, name.length);
    write32(dv, 42, offset);
    directory.set(name, 46);
    central.push(directory);
    offset += local.length + body.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  write32(ev, 0, 0x06054b50);
  write16(ev, 8, central.length);
  write16(ev, 10, central.length);
  write32(ev, 12, centralSize);
  write32(ev, 16, offset);
  const result = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, end]) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}
export function buildXlsx(sheets: Sheet[]): Uint8Array<ArrayBuffer> {
  if (!sheets.length || sheets.length > 255) throw new Error('工作表数量不正确');
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `</Types>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const relations =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2">` +
    `<font><sz val="11"/><name val="Arial"/><color rgb="FF262B33"/></font>` +
    `<font><b/><sz val="11"/><name val="Arial"/><color rgb="FF242C37"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': relations,
    'xl/styles.xml': styles,
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = worksheet(sheet);
  });
  return zip(files);
}
