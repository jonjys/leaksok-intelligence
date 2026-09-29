/* Minimal, dependency-free XLSX (Office Open XML) writer for field work lists:
   styles, Excel tables with filters, frozen panes, list validation, conditional
   row colour and print setup. Text is always written as inline strings with
   quotePrefix when it starts like a formula, so nothing becomes executable. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakXlsx = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const DAY = 86400000;

  // Style registry: name → cellXfs index (order below).
  const FILLS = {
    header: "FF1F4E5F", editable: "FFFFFBEA", red: "FFFBE4E4", amber: "FFFFF1D6", blue: "FFE3EEFB",
    cyan: "FFDDF3F6", green: "FFDFF3E4", gray: "FFEEF1F4", purple: "FFEFE7FA",
  };
  const XF = [
    ["default", {}],
    ["header", { font: 1, fill: "header", wrap: true, vcenter: true, border: 1 }],
    ["text", { wrap: true, border: 1 }],
    ["textQuote", { wrap: true, border: 1, quote: true }],
    ["nowrap", { border: 1 }],
    ["bold", { font: 2, wrap: true, border: 1 }],
    ["boldQuote", { font: 2, wrap: true, border: 1, quote: true }],
    ["editable", { wrap: true, fill: "editable", border: 2, locked: false }],
    ["editableQuote", { wrap: true, fill: "editable", border: 2, locked: false, quote: true }],
    ["int", { numFmt: 1, border: 1 }],
    ["num", { numFmt: 166, border: 1 }],
    ["signed", { numFmt: 168, border: 1 }],
    ["signedInt", { numFmt: 169, border: 1 }],
    ["percent", { numFmt: 167, border: 1 }],
    ["date", { numFmt: 164, border: 1 }],
    ["datetime", { numFmt: 165, border: 1 }],
    ...["red", "amber", "blue", "cyan", "green", "gray", "purple"].map((c) => [`status_${c}`, { font: 2, fill: c, wrap: true, border: 1 }]),
    ["choice", { fill: "editable", border: 2, locked: false, center: true }],
  ];
  const XF_INDEX = Object.fromEntries(XF.map(([name], i) => [name, i]));
  const FILL_INDEX = {};

  function esc(value) {
    return String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function colName(index) {
    let name = "", n = index + 1;
    while (n > 0) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); }
    return name;
  }
  // Wall-clock date to Excel serial without time zone shifts.
  function excelSerial(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / DAY + 25569;
  }
  const looksLikeFormula = (text) => /^[=+\-@\t\r]/.test(text);

  function stylesXml() {
    const fillNames = Object.keys(FILLS);
    fillNames.forEach((name, i) => { FILL_INDEX[name] = i + 2; });
    const fills = [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>',
      ...fillNames.map((name) => `<fill><patternFill patternType="solid"><fgColor rgb="${FILLS[name]}"/><bgColor indexed="64"/></patternFill></fill>`),
    ];
    const xfs = XF.map(([, s]) => {
      const attrs = [`numFmtId="${s.numFmt || 0}"`, `fontId="${s.font || 0}"`, `fillId="${s.fill ? FILL_INDEX[s.fill] : 0}"`, `borderId="${s.border || 0}"`, 'xfId="0"'];
      if (s.numFmt) attrs.push('applyNumberFormat="1"');
      if (s.font) attrs.push('applyFont="1"');
      if (s.fill) attrs.push('applyFill="1"');
      if (s.border) attrs.push('applyBorder="1"');
      if (s.quote) attrs.push('quotePrefix="1"');
      const align = [];
      if (s.wrap) align.push('wrapText="1"');
      align.push(`vertical="${s.vcenter ? "center" : "top"}"`);
      if (s.center) align.push('horizontal="center"');
      attrs.push('applyAlignment="1"');
      if (s.locked === false) attrs.push('applyProtection="1"');
      return `<xf ${attrs.join(" ")}><alignment ${align.join(" ")}/>${s.locked === false ? '<protection locked="0"/>' : ""}</xf>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="6"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="0.0"/><numFmt numFmtId="167" formatCode="+0%;-0%;0%"/><numFmt numFmtId="168" formatCode="+0.0;-0.0;0.0"/><numFmt numFmtId="169" formatCode="+0;-0;0"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="10"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="${fills.length}">${fills.join("")}</fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD5DCE3"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FFE0C97A"/></left><right style="thin"><color rgb="FFE0C97A"/></right><top style="thin"><color rgb="FFE0C97A"/></top><bottom style="thin"><color rgb="FFE0C97A"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="1"><dxf><font><color rgb="FF1E5B2F"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFD7F0DD"/><bgColor rgb="FFD7F0DD"/></patternFill></fill></dxf></dxfs>
<tableStyles count="0" defaultTableStyle="TableStyleLight1" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function cellXml(ref, value, type, styleName) {
    if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) {
      return styleName ? `<c r="${ref}" s="${XF_INDEX[styleName]}"/>` : "";
    }
    if (type === "date" || type === "datetime") {
      const serial = excelSerial(value);
      if (serial == null) return `<c r="${ref}" s="${XF_INDEX[styleName]}"/>`;
      return `<c r="${ref}" s="${XF_INDEX[styleName]}"><v>${serial}</v></c>`;
    }
    if (type === "number" || type === "int" || type === "percent" || type === "signed") {
      return `<c r="${ref}" s="${XF_INDEX[styleName]}"><v>${Number(value)}</v></c>`;
    }
    const text = String(value);
    let style = styleName;
    if (looksLikeFormula(text) && XF_INDEX[`${styleName}Quote`] != null) style = `${styleName}Quote`;
    else if (looksLikeFormula(text) && !/Quote$/.test(styleName)) style = "textQuote";
    const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
    return `<c r="${ref}" s="${XF_INDEX[style]}" t="inlineStr"><is><t${preserve}>${esc(text)}</t></is></c>`;
  }

  function defaultStyle(col, value) {
    if (col.style) return col.style;
    // Whole numbers without decimals, others with one decimal.
    if (col.type === "number") return Number.isInteger(Number(value)) ? "int" : "num";
    if (col.type === "signed") return Number.isInteger(Number(value)) ? "signedInt" : "signed";
    return { int: "int", percent: "percent", date: "date", datetime: "datetime" }[col.type] || (col.wrap === false ? "nowrap" : "text");
  }

  function sheetXml(sheet, index) {
    const cols = sheet.columns;
    const print = sheet.print || {};
    const lastCol = colName(cols.length - 1);
    const lastRow = Math.max(2, sheet.rows.length + 1);
    const freezeRows = sheet.freeze?.rows ?? 1;
    const freezeCols = sheet.freeze?.cols ?? 0;
    const topLeft = `${colName(freezeCols)}${freezeRows + 1}`;
    const pane = freezeCols
      ? `<pane xSplit="${freezeCols}" ySplit="${freezeRows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`
      : `<pane ySplit="${freezeRows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;
    const header = `<row r="1" ht="${sheet.headerHeight || 42}" customHeight="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.header, "text", "header")).join("")}</row>`;
    const body = sheet.rows.map((row, r) => {
      const cells = cols.map((c, i) => {
        const value = typeof c.value === "function" ? c.value(row) : row[c.key];
        const style = (typeof c.cellStyle === "function" && c.cellStyle(row)) || defaultStyle(c, value);
        return cellXml(`${colName(i)}${r + 2}`, value, c.type, style);
      }).join("");
      return `<row r="${r + 2}">${cells}</row>`;
    }).join("");
    const validations = cols.map((c, i) => c.choices
      ? `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Välj värde" error="Välj ${esc(c.choices.join(" eller "))}." sqref="${colName(i)}2:${colName(i)}${lastRow}"><formula1>"${esc(c.choices.join(","))}"</formula1></dataValidation>`
      : "").filter(Boolean);
    const rule = sheet.rowRule
      ? (() => {
        const ci = cols.findIndex((c) => c.key === sheet.rowRule.key);
        return `<conditionalFormatting sqref="A2:${lastCol}${lastRow}"><cfRule type="expression" dxfId="0" priority="1"><formula>$${colName(ci)}2="${esc(sheet.rowRule.equals)}"</formula></cfRule></conditionalFormatting>`;
      })() : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">
<sheetPr><pageSetUpPr fitToPage="${print.fitWidth === false ? 0 : 1}"/></sheetPr>
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ""} zoomScale="${sheet.zoom || 100}">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join("")}</cols>
<sheetData>${header}${body}</sheetData>
${rule}
${validations.length ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>` : ""}
<printOptions horizontalCentered="0"/>
<pageMargins left="0.35" right="0.35" top="0.55" bottom="0.55" header="0.25" footer="0.25"/>
<pageSetup paperSize="9" orientation="${print.landscape === false ? "portrait" : "landscape"}"${print.fitWidth === false ? "" : ' fitToWidth="1" fitToHeight="0"'}/>
<headerFooter><oddHeader>&amp;L&amp;"-,Bold"${esc(print.title || sheet.name)}&amp;R${esc(print.subtitle || "")}</oddHeader><oddFooter>&amp;LUtskriven &amp;D&amp;RSida &amp;P av &amp;N</oddFooter></headerFooter>
${sheet.table ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : ""}
</worksheet>`;
  }

  function tableXml(sheet, id) {
    const cols = sheet.columns;
    const ref = `A1:${colName(cols.length - 1)}${Math.max(2, sheet.rows.length + 1)}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="${NS}" id="${id}" name="${esc(sheet.table)}" displayName="${esc(sheet.table)}" ref="${ref}" totalsRowShown="0">
<autoFilter ref="${ref}"/>
<tableColumns count="${cols.length}">${cols.map((c, i) => `<tableColumn id="${i + 1}" name="${esc(c.header)}"/>`).join("")}</tableColumns>
<tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/>
</table>`;
  }

  function validate(workbook) {
    if (!workbook.sheets?.length) throw new Error("Arbetsboken saknar blad");
    const tableNames = new Set();
    for (const sheet of workbook.sheets) {
      if (!/^[^\\/?*[\]:]{1,31}$/.test(sheet.name)) throw new Error(`Ogiltigt bladnamn: ${sheet.name}`);
      const headers = sheet.columns.map((c) => c.header);
      if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new Error("Kolumnrubriker måste vara unika");
      if (sheet.table) {
        if (!/^[A-Za-z_][A-Za-z0-9_.]{0,254}$/.test(sheet.table) || /^[A-Za-z]{1,3}\d+$/.test(sheet.table)) throw new Error(`Ogiltigt tabellnamn: ${sheet.table}`);
        if (tableNames.has(sheet.table.toLowerCase())) throw new Error("Tabellnamn måste vara unika");
        tableNames.add(sheet.table.toLowerCase());
      }
    }
  }

  function buildParts(workbook) {
    validate(workbook);
    const parts = [];
    const sheets = workbook.sheets;
    let tableId = 0;
    const tables = [];
    sheets.forEach((sheet, i) => {
      parts.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, i)]);
      if (sheet.table) {
        tableId++;
        tables.push(tableId);
        parts.push([`xl/tables/table${tableId}.xml`, tableXml(sheet, tableId)]);
        parts.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/table" Target="../tables/table${tableId}.xml"/></Relationships>`]);
      }
    });
    const printTitles = sheets.map((s, i) => {
      const quoted = `'${esc(s.name).replace(/'/g, "''")}'`;
      const columns = s.print?.repeatFirstColumn ? `${quoted}!$A:$A,` : "";
      return `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${columns}${quoted}!$1:$1</definedName>`;
    }).join("");
    parts.push(["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${printTitles}</definedNames><calcPr calcId="191029"/></workbook>`]);
    parts.push(["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`]);
    parts.push(["xl/styles.xml", stylesXml()]);
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    parts.push(["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(workbook.title || "LeakSök")}</dc:title><dc:creator>LeakSök</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`]);
    parts.push(["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>LeakSök</Application></Properties>`]);
    parts.push(["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`]);
    parts.unshift(["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}${tables.map((id) => `<Override PartName="/xl/tables/table${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`]);
    return parts;
  }

  // ---- ZIP container ----------------------------------------------------------
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { return null; }
  }
  async function zip(files) {
    const encoder = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const date = new Date();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    for (const [name, content] of files) {
      const nameBytes = encoder.encode(name);
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const crc = crc32(data);
      const deflated = await deflateRaw(data);
      const useDeflate = deflated && deflated.length < data.length;
      const body = useDeflate ? deflated : data;
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x0800, true);
      header.setUint16(8, useDeflate ? 8 : 0, true); header.setUint16(10, dosTime, true); header.setUint16(12, dosDate, true);
      header.setUint32(14, crc, true); header.setUint32(18, body.length, true); header.setUint32(22, data.length, true);
      header.setUint16(26, nameBytes.length, true); header.setUint16(28, 0, true);
      chunks.push(new Uint8Array(header.buffer), nameBytes, body);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, useDeflate ? 8 : 0, true); entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, body.length, true); entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);
      offset += 30 + nameBytes.length + body.length;
    }
    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((sum, c) => sum + c.length, 0));
    let pos = 0;
    for (const c of all) { out.set(c, pos); pos += c.length; }
    return out;
  }

  async function write(workbook) { return zip(buildParts(workbook)); }

  return { write, buildParts, excelSerial, colName, XF_INDEX };
}));
