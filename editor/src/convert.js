// Convert between Notion block JSON (what's stored in data/pages) and BlockNote blocks.

const plain = (rts) => (rts || []).map((r) => r.plain_text ?? r.text?.content ?? "").join("");

function colorProps(color) {
  if (!color || color === "default") return {};
  return color.endsWith("_background") ? { backgroundColor: color.replace("_background", "") } : { textColor: color };
}

function notionColor(props) {
  if (props?.backgroundColor && props.backgroundColor !== "default") return props.backgroundColor + "_background";
  if (props?.textColor && props.textColor !== "default") return props.textColor;
  return "default";
}

function internalHref(href) {
  const m = href.match(/^\/([0-9a-f]{32})/i) || href.match(/notion\.so\/.*?([0-9a-f]{32})(?:[?#]|$)/i);
  return m ? "#/" + m[1] : href;
}

export function richToInline(rts) {
  const out = [];
  for (const r of rts || []) {
    const a = r.annotations || {};
    const styles = {};
    if (a.bold) styles.bold = true;
    if (a.italic) styles.italic = true;
    if (a.underline) styles.underline = true;
    if (a.strikethrough) styles.strike = true;
    if (a.code) styles.code = true;
    if (a.font_size) styles.fontSize = a.font_size;
    if (a.color && a.color !== "default") {
      if (a.color.endsWith("_background")) styles.backgroundColor = a.color.replace("_background", "");
      else styles.textColor = a.color;
    }
    let text = r.plain_text ?? r.text?.content ?? "";
    let href = r.href || r.text?.link?.url || null;
    if (r.type === "mention") {
      const m = r.mention;
      if (m.type === "page" || m.type === "database") href = "#/" + m[m.type].id;
      else if (m.type === "link_mention") href = m.link_mention.href;
      else if (m.type !== "date") href = href || null;
    } else if (r.type === "equation") {
      text = r.equation.expression;
      styles.code = true;
    }
    if (!text) continue;
    if (styles.code) for (const k of Object.keys(styles)) if (k !== "code") delete styles[k];  // the editor's inline code can't be bold/colored
    if (href) out.push({ type: "link", href: internalHref(href), content: [{ type: "text", text, styles }] });
    else out.push({ type: "text", text, styles });
  }
  return out;
}

function rt(text, styles = {}, href = null) {
  const r = {
    type: "text",
    text: { content: text, link: href ? { url: href } : null },
    plain_text: text,
    href,
    annotations: {
      bold: !!styles.bold, italic: !!styles.italic, strikethrough: !!styles.strike,
      underline: !!styles.underline, code: !!styles.code,
      color: styles.textColor && styles.textColor !== "default" ? styles.textColor
        : styles.backgroundColor && styles.backgroundColor !== "default" ? styles.backgroundColor + "_background" : "default",
    },
  };
  if (styles.fontSize) r.annotations.font_size = styles.fontSize;  // not a Notion field; local extension
  return r;
}

export function inlineToRich(content) {
  if (typeof content === "string") return content ? [rt(content)] : [];
  const out = [];
  for (const c of content || []) {
    if (c.type === "text") { if (c.text) out.push(rt(c.text, c.styles)); }
    else if (c.type === "link") for (const t of c.content || []) { if (t.text) out.push(rt(t.text, t.styles, c.href)); }
  }
  return out;
}

// ---------- files ----------

function fileUrl(f) {
  if (!f) return "";
  if (f.type === "file") return f.file?.local ? "/data/" + f.file.local.split("/").map(encodeURIComponent).join("/") : f.file?.url || "";
  if (f.type === "external") return f.external?.url || "";
  return "";
}

function fileObject(url) {
  if (url.startsWith("/data/")) {
    const local = url.slice(6).split("/").map(decodeURIComponent).join("/");
    return { type: "file", file: { url: "", local } };
  }
  return { type: "external", external: { url } };
}

const baseName = (u) => decodeURIComponent((u || "").split("?")[0].split("/").pop() || "");

// ---------- blocks: Notion -> BlockNote ----------

const LIST = { bulleted_list_item: "bulletListItem", numbered_list_item: "numberedListItem", toggle: "toggleListItem", quote: "quote", paragraph: "paragraph" };
const FILE_TYPES = { image: "image", video: "video", audio: "audio", file: "file", pdf: "file" };

const ALIGNABLE = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"]);

export function notionToBlocks(blocks) {
  return (blocks || []).map((b) => {
    const out = toBN(b);
    const align = b[b.type]?.text_align;  // local extension, not a Notion field
    if (align && ALIGNABLE.has(out.type)) out.props.textAlignment = align;
    return out;
  });
}

function toBN(b) {
  const v = b[b.type] || {};
  const children = notionToBlocks(b.children);
  const mk = (type, props, content) => ({ id: b.id, type, props, content, children });

  if (LIST[b.type]) return mk(LIST[b.type], colorProps(v.color), richToInline(v.rich_text));
  if (/^heading_[1-6]$/.test(b.type)) {
    return mk("heading", { level: Number(b.type.slice(-1)), isToggleable: !!v.is_toggleable, ...colorProps(v.color) }, richToInline(v.rich_text));
  }
  switch (b.type) {
    case "to_do": return mk("checkListItem", { checked: !!v.checked, ...colorProps(v.color) }, richToInline(v.rich_text));
    case "code": return { id: b.id, type: "codeBlock", props: { language: v.language || "plain text" }, content: plain(v.rich_text), children: [] };
    case "divider": return { id: b.id, type: "divider", props: {}, children: [] };
    case "callout": {
      const emoji = v.icon?.type === "emoji" ? v.icon.emoji : "💡";
      return mk("callout", { emoji, color: v.color || "gray_background" }, richToInline(v.rich_text));
    }
    case "child_page": return { id: b.id, type: "subpage", props: { pageId: b.id, title: v.title || "" }, children: [] };
    case "table": {
      const rows = (b.children || []).filter((r) => r.type === "table_row");
      return {
        id: b.id, type: "table", props: {},
        content: {
          type: "tableContent",
          headerRows: v.has_column_header ? 1 : 0,
          headerCols: v.has_row_header ? 1 : 0,
          rows: rows.map((r) => ({ cells: r.table_row.cells.map(richToInline) })),
        },
        children: [],
      };
    }
  }
  if (FILE_TYPES[b.type]) {
    const url = fileUrl(v);
    return {
      id: b.id, type: FILE_TYPES[b.type],
      props: { url, name: v.name || baseName(url), caption: plain(v.caption) },
      children,
    };
  }
  // Anything else (columns, embeds, databases, bookmarks...) is kept as-is and shown read-only.
  return { id: b.id, type: "notionRaw", props: { json: JSON.stringify(b) }, children: [] };
}

// ---------- blocks: BlockNote -> Notion ----------

const REV = { bulletListItem: "bulleted_list_item", numberedListItem: "numbered_list_item", toggleListItem: "toggle", quote: "quote", paragraph: "paragraph" };

export function blocksToNotion(blocks) {
  return (blocks || []).map((b) => {
    const out = fromBN(b);
    const align = b.props?.textAlignment;
    if (align && align !== "left" && out[out.type] && ALIGNABLE.has(b.type)) out[out.type].text_align = align;
    return out;
  });
}

function fromBN(b) {
  const children = blocksToNotion(b.children);
  const mk = (type, value, kids = children) => {
    const out = { object: "block", id: b.id, type, [type]: value, has_children: kids.length > 0 };
    if (kids.length) out.children = kids;
    return out;
  };
  const p = b.props || {};
  if (REV[b.type]) return mk(REV[b.type], { rich_text: inlineToRich(b.content), color: notionColor(p) });
  switch (b.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(p.level) || 1, 1), 4);
      return mk("heading_" + level, { rich_text: inlineToRich(b.content), color: notionColor(p), is_toggleable: !!p.isToggleable });
    }
    case "checkListItem": return mk("to_do", { rich_text: inlineToRich(b.content), checked: !!p.checked, color: notionColor(p) });
    case "codeBlock": {
      const text = typeof b.content === "string" ? b.content : (b.content || []).map((c) => c.text || "").join("");
      return mk("code", { rich_text: text ? [rt(text)] : [], language: p.language || "plain text", caption: [] }, []);
    }
    case "divider": return mk("divider", {}, []);
    case "callout": return mk("callout", { rich_text: inlineToRich(b.content), icon: { type: "emoji", emoji: p.emoji || "💡" }, color: p.color || "gray_background" });
    case "subpage": return { object: "block", id: p.pageId || b.id, type: "child_page", child_page: { title: p.title || "" }, has_children: false };
    case "table": {
      const c = b.content || { rows: [] };
      const rows = c.rows.map((r, i) => ({
        object: "block", id: `${b.id}-r${i}`, type: "table_row", has_children: false,
        table_row: { cells: r.cells.map((cell) => inlineToRich(cell?.type === "tableCell" ? cell.content : cell)) },
      }));
      const width = Math.max(0, ...rows.map((r) => r.table_row.cells.length));
      return mk("table", { table_width: width, has_column_header: (c.headerRows || 0) > 0, has_row_header: (c.headerCols || 0) > 0 }, rows);
    }
    case "image": case "video": case "audio": case "file": {
      if (!p.url) return mk("paragraph", { rich_text: [], color: "default" });
      return mk(b.type, { ...fileObject(p.url), name: p.name || baseName(p.url), caption: p.caption ? [rt(p.caption)] : [] });
    }
    case "notionRaw": return JSON.parse(p.json);
  }
  return mk("paragraph", { rich_text: inlineToRich(b.content), color: "default" });
}

export function blockText(blocks) {
  // Plain text of Notion blocks, for the search index (mirrors backup.py's block_text).
  const out = [];
  for (const b of blocks || []) {
    const v = b[b.type] || {};
    if (v.rich_text) out.push(plain(v.rich_text));
    if (b.type === "table_row") out.push(...v.cells.map(plain));
    if (b.type === "child_page") out.push(v.title || "");
    if (b.children) out.push(blockText(b.children));
  }
  return out.filter(Boolean).join("\n");
}
