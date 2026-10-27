// Small and fast XML parser producing a minimal DOM. Sufficient for the
// XStream generated files of Portfolio Performance.

export interface XmlElement {
  name: string;
  attrs: Record<string, string> | null;
  children: XmlElement[];
  text: string;
  parent: XmlElement | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    const v = ENTITIES[e];
    return v !== undefined ? v : m;
  });
}

function isNameChar(c: number): boolean {
  // anything but whitespace, '/', '>', '='
  return !(c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2f || c === 0x3e || c === 0x3d);
}

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: null, children: [], text: '', parent: null };
  let current = root;
  let pos = 0;
  const len = xml.length;
  // skip BOM
  if (xml.charCodeAt(0) === 0xfeff) pos = 1;

  while (pos < len) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) break;
    // text is only relevant for leaf elements (XStream does not write mixed content)
    if (lt > pos && current !== root && current.children.length === 0) {
      current.text += xml.substring(pos, lt);
    }
    const next = xml.charCodeAt(lt + 1);
    if (next === 0x2f /* / */) {
      // closing tag
      const gt = xml.indexOf('>', lt);
      if (gt < 0) throw new Error('XML: unterminated closing tag');
      const name = xml.substring(lt + 2, gt).trim();
      if (name !== current.name) throw new Error(`XML: mismatched closing tag </${name}> for <${current.name}>`);
      current.text = decodeEntities(current.text);
      current = current.parent ?? root;
      pos = gt + 1;
      continue;
    }
    if (next === 0x3f /* ? */) {
      const end = xml.indexOf('?>', lt);
      if (end < 0) throw new Error('XML: unterminated processing instruction');
      pos = end + 2;
      continue;
    }
    if (next === 0x21 /* ! */) {
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt);
        if (end < 0) throw new Error('XML: unterminated comment');
        pos = end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt);
        if (end < 0) throw new Error('XML: unterminated CDATA');
        // keep CDATA raw; entities are decoded on close, so escape '&'
        current.text += xml.substring(lt + 9, end).replace(/&/g, '&amp;');
        pos = end + 3;
        continue;
      }
      // DOCTYPE etc.
      const end = xml.indexOf('>', lt);
      pos = end < 0 ? len : end + 1;
      continue;
    }

    // opening tag
    let i = lt + 1;
    while (i < len && isNameChar(xml.charCodeAt(i))) i++;
    const name = xml.substring(lt + 1, i);
    let attrs: Record<string, string> | null = null;
    let selfClosing = false;
    for (;;) {
      // skip whitespace
      let c = xml.charCodeAt(i);
      while (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) c = xml.charCodeAt(++i);
      if (c === 0x3e /* > */) {
        i++;
        break;
      }
      if (c === 0x2f /* / */) {
        selfClosing = true;
        i = xml.indexOf('>', i) + 1;
        break;
      }
      if (i >= len) throw new Error('XML: unterminated tag');
      const nameStart = i;
      while (i < len && isNameChar(xml.charCodeAt(i))) i++;
      const attrName = xml.substring(nameStart, i);
      // skip to '='
      while (i < len && xml.charCodeAt(i) !== 0x3d) i++;
      i++;
      while (xml.charCodeAt(i) === 0x20 || xml.charCodeAt(i) === 0x0a || xml.charCodeAt(i) === 0x0d || xml.charCodeAt(i) === 0x09) i++;
      const quote = xml[i];
      const valueEnd = xml.indexOf(quote, i + 1);
      if (valueEnd < 0) throw new Error('XML: unterminated attribute');
      if (attrs === null) attrs = {};
      attrs[attrName] = decodeEntities(xml.substring(i + 1, valueEnd));
      i = valueEnd + 1;
    }
    const el: XmlElement = { name, attrs, children: [], text: '', parent: current };
    current.children.push(el);
    if (!selfClosing) current = el;
    pos = i;
  }
  if (current !== root) throw new Error('XML: unexpected end of document');
  const doc = root.children[0];
  if (!doc) throw new Error('XML: empty document');
  doc.parent = null;
  return doc;
}

export function child(el: XmlElement, name: string): XmlElement | undefined {
  for (const c of el.children) if (c.name === name) return c;
  return undefined;
}

export function childText(el: XmlElement, name: string): string | undefined {
  const c = child(el, name);
  return c ? c.text : undefined;
}
