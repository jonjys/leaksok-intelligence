// Reads an .xlsx (zip) into { partName: text } using only Node's zlib.
const zlib = require("node:zlib");

function unzip(buffer) {
  const bytes = Buffer.from(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a zip file");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const parts = {};
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Bad central directory");
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.slice(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localName = bytes.readUInt16LE(local + 26);
    const localExtra = bytes.readUInt16LE(local + 28);
    const data = bytes.slice(local + 30 + localName + localExtra, local + 30 + localName + localExtra + size);
    parts[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    offset += 46 + nameLength + extra + comment;
  }
  return parts;
}

// Minimal cell reader for inline strings and numbers: { "A1": value }.
function cells(sheetXml) {
  const out = {};
  for (const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, attrs, body = ""] = match;
    if (/t="inlineStr"/.test(attrs)) {
      out[ref] = (body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    } else {
      const v = body.match(/<v>([^<]*)<\/v>/)?.[1];
      out[ref] = v == null ? null : Number(v);
    }
    out[`${ref}@s`] = Number(attrs.match(/s="(\d+)"/)?.[1] || 0);
    out[`${ref}@t`] = attrs.match(/t="(\w+)"/)?.[1] || "n";
  }
  return out;
}

module.exports = { unzip, cells };
