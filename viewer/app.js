"use strict";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (id) => (id || "").replace(/-/g, "");

let items = {};      // id -> index entry
let children = {};   // parent id -> [ids]
let roots = [];
let searchText = null;
const cache = {};

// ---------- data ----------

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function load(kind, id) {
  const key = kind + id;
  if (!cache[key]) cache[key] = getJSON(`/data/${kind === "page" ? "pages" : "databases"}/${id}.json`);
  return cache[key];
}

function findId(raw) {
  if (items[raw]) return raw;
  const n = norm(raw);
  return Object.keys(items).find((k) => norm(k) === n) || raw;
}

// ---------- rich text ----------

function fileUrl(f) {
  if (!f) return "";
  if (f.type === "file") return f.file.local ? "/data/" + f.file.local.split("/").map(encodeURIComponent).join("/") : f.file.url;
  if (f.type === "external") return f.external.url;
  return "";
}

function iconHTML(icon, fallback = "") {
  if (!icon) return fallback;
  if (icon.emoji) return esc(icon.emoji);
  if (icon.type === "emoji") return esc(icon.emoji);
  let src = icon.src || fileUrl(icon);
  if (src && src.startsWith("/images/")) src = "https://www.notion.so" + src;  // Notion's built-in template icons
  return src ? `<img src="${esc(src)}" alt="">` : fallback;
}

function colorClass(color) {
  if (!color || color === "default") return "";
  return color.endsWith("_background") ? "bg-" + color.replace("_background", "") : "c-" + color;
}

function pageLink(id, text) {
  const real = findId(id);
  const it = items[real];
  const label = text || (it ? it.title : "Untitled");
  if (!it) return `<span class="muted">${esc(label)}</span>`;
  return `<a class="mention" href="#/${real}">${it.icon ? iconHTML(it.icon) + " " : ""}${esc(label)}</a>`;
}

function rich(rts) {
  return (rts || []).map((r) => {
    let s;
    if (r.type === "mention") {
      const m = r.mention;
      if (m.type === "page" || m.type === "database") s = pageLink(m[m.type].id, null);
      else if (m.type === "date") s = `<span class="muted">${esc(r.plain_text)}</span>`;
      else s = esc(r.plain_text);
    } else if (r.type === "equation") {
      s = `<span class="eqi">${esc(r.equation.expression)}</span>`;
    } else {
      s = esc(r.plain_text).replace(/\n/g, "<br>");
    }
    const a = r.annotations || {};
    if (a.code) s = `<code class="inline">${s}</code>`;
    if (a.bold) s = `<strong>${s}</strong>`;
    if (a.italic) s = `<em>${s}</em>`;
    if (a.strikethrough) s = `<s>${s}</s>`;
    if (a.underline) s = `<u>${s}</u>`;
    if (a.color && a.color !== "default") s = `<span class="${colorClass(a.color)}">${s}</span>`;
    if (a.font_size && /^\d+px$/.test(a.font_size)) s = `<span style="font-size:${a.font_size}">${s}</span>`;
    const href = r.href || r.text?.link?.url;
    if (href && href.startsWith("#/")) s = `<a href="${esc(href)}">${s}</a>`;
    else if (href && r.type !== "mention") {
      const internal = href.match(/^\/([0-9a-f]{32})/i) || href.match(/notion\.so\/.*?([0-9a-f]{32})(?:[?#]|$)/i);
      if (internal && items[findId(internal[1])]) s = `<a href="#/${findId(internal[1])}">${s}</a>`;
      else s = `<a href="${esc(href)}" target="_blank" rel="noopener">${s}</a>`;
    }
    return s;
  }).join("");
}

const plain = (rts) => (rts || []).map((r) => r.plain_text).join("");

// ---------- blocks ----------

function renderBlocks(blocks) {
  let out = "";
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
      const tag = b.type === "bulleted_list_item" ? "ul" : "ol";
      let lis = "";
      while (i < blocks.length && blocks[i].type === b.type) {
        const it = blocks[i][b.type];
        lis += `<li class="${colorClass(it.color)}">${rich(it.rich_text)}${renderBlocks(blocks[i].children || [])}</li>`;
        i++;
      }
      i--;
      out += `<${tag}>${lis}</${tag}>`;
    } else {
      out += renderBlock(b);
    }
  }
  return out;
}

function caption(v) {
  return v.caption && v.caption.length ? `<figcaption>${rich(v.caption)}</figcaption>` : "";
}

function renderBlock(b) {
  const v = b[b.type] || {};
  if (v.text_align) return `<div style="text-align:${esc(v.text_align)}">${renderBlockInner(b)}</div>`;
  return renderBlockInner(b);
}

function renderBlockInner(b) {
  const v = b[b.type] || {};
  const kids = () => renderBlocks(b.children || []);
  const cc = colorClass(v.color);
  switch (b.type) {
    case "paragraph": return `<p class="${cc}">${rich(v.rich_text)}</p>${b.children ? `<div style="padding-left:24px">${kids()}</div>` : ""}`;
    case "heading_1": case "heading_2": case "heading_3": {
      const tag = "h" + (Number(b.type.slice(-1)) + 1);
      const h = `<${tag} id="b-${b.id}" class="${cc}">${rich(v.rich_text)}</${tag}>`;
      return v.is_toggleable ? `<details open><summary>${h}</summary><div class="inner">${kids()}</div></details>` : h;
    }
    case "to_do": return `<div class="todo ${v.checked ? "done" : ""}"><input type="checkbox" disabled ${v.checked ? "checked" : ""}><span>${rich(v.rich_text)}</span></div>${b.children ? `<div style="padding-left:24px">${kids()}</div>` : ""}`;
    case "toggle": return `<details class="${cc}"><summary>${rich(v.rich_text)}</summary><div class="inner">${kids()}</div></details>`;
    case "quote": return `<blockquote class="${cc}">${rich(v.rich_text)}${kids()}</blockquote>`;
    case "callout": return `<div class="callout ${v.color?.endsWith("_background") ? cc : ""}"><div class="ic">${iconHTML(v.icon, "💡")}</div><div class="body ${v.color?.endsWith("_background") ? "" : cc}">${rich(v.rich_text)}${kids()}</div></div>`;
    case "code": return `<pre><span class="lang">${esc(v.language)}</span><code>${esc(plain(v.rich_text))}</code></pre>${caption(v)}`;
    case "equation": return `<div class="eq">${esc(v.expression)}</div>`;
    case "divider": return "<hr>";
    case "image": { const u = fileUrl(v); return `<figure><a href="${esc(u)}" target="_blank"><img loading="lazy" src="${esc(u)}" alt="${esc(plain(v.caption))}"></a>${caption(v)}</figure>`; }
    case "video": {
      const u = fileUrl(v);
      const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
      if (yt) return `<figure><a class="bookmark" href="${esc(u)}" target="_blank">▶ YouTube video — ${esc(u)}</a>${caption(v)}</figure>`;
      return `<figure><video controls src="${esc(u)}"></video>${caption(v)}</figure>`;
    }
    case "audio": return `<figure><audio controls src="${esc(fileUrl(v))}"></audio>${caption(v)}</figure>`;
    case "file": case "pdf": {
      const u = fileUrl(v);
      const name = v.name || decodeURIComponent(u.split("/").pop() || "file");
      return `<div><a class="fileblk" href="${esc(u)}" target="_blank">📎 ${esc(name)}</a></div>${caption(v)}`;
    }
    case "bookmark": case "embed": case "link_preview":
      return `<a class="bookmark" href="${esc(v.url)}" target="_blank" rel="noopener">🔗 ${esc(v.url)}${v.caption?.length ? `<div class="muted">${rich(v.caption)}</div>` : ""}</a>`;
    case "child_page": case "child_database": {
      const id = findId(b.id);
      const it = items[id];
      const ic = it?.icon ? iconHTML(it.icon) : (b.type === "child_page" ? "📄" : "🗂️");
      return `<a class="subpage" href="#/${id}"><span>${ic}</span><span class="label">${esc(it ? it.title : v.title || "Untitled")}</span></a>`;
    }
    case "link_to_page": { const t = v.type; return `<div>↗ ${pageLink(v[t])}</div>`; }
    case "column_list": return `<div class="cols">${(b.children || []).map((c) => `<div class="col">${renderBlocks(c.children || [])}</div>`).join("")}</div>`;
    case "column": return `<div class="col">${kids()}</div>`;
    case "synced_block": return kids();
    case "table": {
      const rows = b.children || [];
      const body = rows.map((r, ri) => "<tr>" + (r.table_row?.cells || []).map((c, ci) => {
        const head = (v.has_column_header && ri === 0) || (v.has_row_header && ci === 0);
        return head ? `<th>${rich(c)}</th>` : `<td>${rich(c)}</td>`;
      }).join("") + "</tr>").join("");
      return `<div class="tablewrap"><table class="simple">${body}</table></div>`;
    }
    case "table_of_contents": return `<div class="toc muted" data-toc></div>`;
    case "breadcrumb": return "";
    case "template": return `<div class="muted">Template: ${rich(v.rich_text)}</div>${kids()}`;
    case "unsupported": return `<div class="unsupported">(This Notion block type isn’t available through Notion’s API)</div>`;
    default: return `<div class="unsupported">(${esc(b.type)})</div>`;
  }
}

// ---------- properties ----------

function propHTML(p) {
  if (!p) return "";
  const v = p[p.type];
  switch (p.type) {
    case "title": case "rich_text": return rich(v);
    case "number": return v == null ? "" : esc(v.toLocaleString());
    case "select": case "status": return v ? `<span class="tag bg-${esc(v.color || "default")}">${esc(v.name)}</span>` : "";
    case "multi_select": return v.map((o) => `<span class="tag bg-${esc(o.color || "default")}">${esc(o.name)}</span>`).join("");
    case "date": return v ? esc(fmtDate(v.start) + (v.end ? " → " + fmtDate(v.end) : "")) : "";
    case "checkbox": return v ? "☑" : "☐";
    case "url": return v ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : "";
    case "email": return v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : "";
    case "phone_number": return esc(v || "");
    case "people": return v.map((u) => esc(u.name || "Someone")).join(", ");
    case "files": return v.map((f) => `<a href="${esc(fileUrl(f))}" target="_blank">📎 ${esc(f.name)}</a>`).join(" ");
    case "relation": return v.map((r) => pageLink(r.id)).join(", ");
    case "formula": return esc(v[v.type] == null ? "" : typeof v[v.type] === "object" ? fmtDate(v[v.type].start) : String(v[v.type]));
    case "rollup":
      if (v.type === "array") return v.array.map((x) => propHTML(x)).join(", ");
      if (v.type === "date") return esc(v.date ? fmtDate(v.date.start) : "");
      return esc(v[v.type] ?? "");
    case "created_time": case "last_edited_time": return esc(fmtDate(v));
    case "created_by": case "last_edited_by": return esc(v?.name || "");
    case "unique_id": return v ? esc((v.prefix ? v.prefix + "-" : "") + v.number) : "";
    case "verification": return esc(v?.state || "");
    default: return "";
  }
}

function propSortValue(p) {
  if (!p) return "";
  const v = p[p.type];
  switch (p.type) {
    case "title": case "rich_text": return plain(v).toLowerCase();
    case "number": return v ?? -Infinity;
    case "select": case "status": return v?.name || "";
    case "multi_select": return v.map((o) => o.name).join(",");
    case "date": return v?.start || "";
    case "checkbox": return v ? 1 : 0;
    case "created_time": case "last_edited_time": return v || "";
    default: return stripTags(propHTML(p)).toLowerCase();
  }
}

const stripTags = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; };

function fmtDate(s) {
  if (!s) return "";
  const hasTime = s.length > 10;
  const d = new Date(hasTime ? s : s + "T00:00:00");
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
    (hasTime ? " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
}

// ---------- saving ----------

async function api(method, url, body) {
  const r = await fetch(url, {
    method, headers: { "Content-Type": "application/json", "X-Notion-Local": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

function setStatus(s) {
  const el = $("#status");
  if (!el) return;
  el.textContent = { unsaved: "Editing…", saving: "Saving…", saved: "Saved", error: "⚠ Couldn’t save — is the app still running?" }[s] || "";
  el.className = s === "error" ? "status err" : "status";
}

async function savePage(id, body) {
  const it = await api("PUT", `/api/pages/${id}`, body);
  delete cache["page" + id];
  if (it && it.id) {
    Object.assign(items[id], it);
    refreshNode(id);
    if (searchText && body.blocks) searchText = null;
  }
  return it;
}

async function createPage(parent, link = true) {
  const it = await api("POST", "/api/pages", { parent: parent || null, title: "", link });
  items[it.id] = it;
  if (it.parent) {
    (children[it.parent] ||= []).push(it.id);
    sortIds(children[it.parent]);
  } else {
    roots.push(it.id);
    sortIds(roots);
  }
  renderTree();
  return it;
}

async function newPageFromSidebar(parent) {
  await current?.editor?.flush();
  let it;
  if (parent && current?.id === parent && current.editor) {
    it = await createPage(parent, false);
    current.editor.insertSubpage(it);
    await current.editor.flush();
  } else {
    it = await createPage(parent, true);
  }
  focusTitleNext = true;
  location.hash = "#/" + it.id;
}

async function deletePage(id) {
  const it = items[id];
  let n = 0;
  const count = (i) => (children[i] || []).forEach((c) => { n++; count(c); });
  count(id);
  const msg = `Move “${it.title}”${n ? ` and its ${n} sub-page${n > 1 ? "s" : ""}` : ""} to the trash?\n\n(It goes to data/trash, so it can still be recovered.)`;
  if (!confirm(msg)) return;
  if (current?.editor) { current.editor.destroy(); current = null; }
  const { removed } = await api("DELETE", `/api/pages/${id}`);
  for (const r of removed) delete items[r];
  rebuildChildren();
  renderTree();
  searchText = null;
  location.hash = it.parent && items[it.parent] ? "#/" + it.parent : "#/";
}

// Keep child_page titles in sync with the pages' real titles (used for search).
function withChildTitles(blocks) {
  for (const b of blocks) {
    if (b.type === "child_page" && items[b.id]) b.child_page.title = items[b.id].title === "Untitled" ? "" : items[b.id].title;
    if (b.children) withChildTitles(b.children);
  }
  return blocks;
}

// ---------- views ----------

let current = null;        // { id, editor }
let focusTitleNext = false;

const FONTS = { default: "Default", serif: "Serif", mono: "Mono" };

function applyFormat(f = {}) {
  const c = $("#content");
  c.classList.remove("font-serif", "font-mono", "small-text", "full-width");
  if (f.font && f.font !== "default") c.classList.add("font-" + f.font);
  if (f.small) c.classList.add("small-text");
  if (f.full) c.classList.add("full-width");
}

function header(obj, title) {
  let h = "";
  if (obj.cover) h += `<img class="cover" src="${esc(fileUrl(obj.cover))}" alt="">`;
  const ic = items[obj.id]?.icon;
  return { cover: h, top: `${ic ? `<div class="page-icon">${iconHTML(ic)}</div>` : ""}<h1 class="title">${esc(title)}</h1>` };
}

function titleOf(page) {
  for (const p of Object.values(page.properties || {})) if (p.type === "title") return plain(p.title);
  return "";
}

async function showPage(id, hit) {
  const data = await getJSON(`/data/pages/${id}.json`);
  const p = data.page;
  const it = items[id];
  const cover = p.cover ? `<img class="cover" src="${esc(fileUrl(p.cover))}" alt="">` : "";
  let props = "";
  if (p.parent?.type === "database_id") {
    const rows = Object.entries(p.properties).filter(([, v]) => v.type !== "title");
    props = `<div class="props static">${rows.map(([k, v]) => `<div class="prop"><div class="k">${esc(k)}</div><div class="v">${propHTML(v) || '<span class="muted">Empty</span>'}</div></div>`).join("")}</div>`;
  }
  const c = $("#content");
  c.classList.remove("wide");
  applyFormat(data.format);
  c.innerHTML = `
    <div class="page-head">
      <div class="icon-slot">${it.icon ? `<button class="page-icon" title="Change icon">${iconHTML(it.icon)}</button>` : ""}</div>
      <div class="head-tools">${it.icon ? "" : `<button class="ghost add-icon">☺ Add icon</button>`}</div>
      <h1 class="title" contenteditable="plaintext-only" spellcheck="false" data-ph="Untitled">${esc(titleOf(p))}</h1>
    </div>${props}<div id="editor"></div>`;
  c.insertAdjacentHTML("beforebegin", cover ? `<div id="cover-wrap">${cover}</div>` : "");
  $("#page-tools").hidden = false;
  $("#page-tools").dataset.id = id;
  $("#page-tools").dataset.format = JSON.stringify(data.format || {});

  // title
  const h1 = c.querySelector("h1.title");
  let tTimer;
  h1.addEventListener("input", () => {
    const t = h1.textContent.replace(/\n/g, " ");
    items[id].title = t || "Untitled";
    refreshNode(id);
    crumbs(id);
    setStatus("unsaved");
    clearTimeout(tTimer);
    tTimer = setTimeout(() => savePage(id, { title: t }).then(() => setStatus("saved"), () => setStatus("error")), 500);
  });
  h1.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); current?.editor?.focusStart(); }
  });

  // icon
  const pickIcon = (anchor) => pickEmoji(anchor, async (emoji) => {
    await savePage(id, { icon: emoji });
    crumbs(id);
    const fresh = items[id];
    c.querySelector(".icon-slot").innerHTML = fresh.icon ? `<button class="page-icon" title="Change icon">${iconHTML(fresh.icon)}</button>` : "";
    c.querySelector(".head-tools").innerHTML = fresh.icon ? "" : `<button class="ghost add-icon">☺ Add icon</button>`;
  }, true);
  c.querySelector(".page-head").addEventListener("click", (e) => {
    const b = e.target.closest(".page-icon, .add-icon");
    if (b) pickIcon(b);
  });

  // body
  if (window.NotionEditor) {
    const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    current = {
      id,
      editor: window.NotionEditor.mount($("#editor"), data.blocks, {
        theme,
        save: (blocks) => savePage(id, { blocks: withChildTitles(blocks) }),
        createSubpage: () => createPage(id, false),
        uploadFile: async (file) => {
          const r = await fetch(`/api/upload?page=${id}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "X-Notion-Local": "1" }, body: file });
          if (!r.ok) throw new Error("upload failed");
          return (await r.json()).url;
        },
        onStatus: setStatus,
      }),
    };
  } else {
    $("#editor").innerHTML = `<p class="muted">(Editor failed to load — showing read-only view.)</p><div class="static">${renderBlocks(data.blocks)}</div>`;
  }
  setStatus("");
  if (focusTitleNext) {
    focusTitleNext = false;
    h1.focus();
  } else if (hit) {
    setTimeout(() => highlight(hit), 300);
  }
}

async function showDatabase(id) {
  const data = await load("db", id);
  const db = data.database;
  const it = items[id];
  const { cover, top } = header(db, it.title);
  const desc = db.description?.length ? `<p class="muted">${rich(db.description)}</p>` : "";
  const rows = await Promise.all(data.rows.filter((r) => items[r]).map((r) => getJSON(`/data/pages/${r}.json`).then((d) => d.page).catch(() => null)));
  const cols = Object.entries(db.properties);
  cols.sort((a, b) => (a[1].type === "title" ? -1 : b[1].type === "title" ? 1 : 0));
  const state = { rows: rows.filter(Boolean), sortKey: null, dir: 1, q: "" };

  $("#content").classList.add("wide");
  applyFormat({});
  $("#content").innerHTML = `<div class="static">${top}${desc}<div class="db-toolbar"><input id="dbfilter" placeholder="Filter rows…"><span class="muted" id="dbcount"></span></div><div class="tablewrap"><table><thead><tr>${cols.map(([k, c]) => `<th class="sortable" data-k="${esc(k)}">${esc(k)}</th>`).join("")}</tr></thead><tbody id="dbbody"></tbody></table></div></div>`;
  $("#content").insertAdjacentHTML("beforebegin", cover ? `<div id="cover-wrap">${cover}</div>` : "");

  const draw = () => {
    let rs = state.rows;
    if (state.q) {
      const q = state.q.toLowerCase();
      rs = rs.filter((r) => stripTags(cols.map(([k]) => propHTML(r.properties[k])).join(" ")).toLowerCase().includes(q));
    }
    if (state.sortKey) {
      rs = [...rs].sort((a, b) => {
        const x = propSortValue(a.properties[state.sortKey]), y = propSortValue(b.properties[state.sortKey]);
        return (x > y ? 1 : x < y ? -1 : 0) * state.dir;
      });
    }
    $("#dbcount").textContent = `${rs.length} of ${state.rows.length} rows`;
    $("#dbbody").innerHTML = rs.map((r) => `<tr class="dbrow">${cols.map(([k, c]) => {
      if (c.type === "title") {
        const ic = items[r.id]?.icon;
        return `<td><a href="#/${r.id}">${ic ? iconHTML(ic) + " " : ""}${esc(items[r.id]?.title || plain(r.properties[k]?.title) || "Untitled")}</a></td>`;
      }
      return `<td>${propHTML(r.properties[k])}</td>`;
    }).join("")}</tr>`).join("");
  };
  $("#dbfilter").addEventListener("input", (e) => { state.q = e.target.value; draw(); });
  document.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    state.dir = state.sortKey === k ? -state.dir : 1;
    state.sortKey = k;
    document.querySelectorAll("th.sortable").forEach((t) => (t.textContent = t.dataset.k));
    th.textContent = k + (state.dir > 0 ? " ↑" : " ↓");
    draw();
  }));
  draw();
}

function fillTOC() {
  const toc = document.querySelector("[data-toc]");
  if (!toc) return;
  const hs = [...document.querySelectorAll("#content h2, #content h3, #content h4")];
  toc.innerHTML = hs.map((h) => `<div style="padding-left:${(Number(h.tagName[1]) - 2) * 18}px"><a href="javascript:void 0" data-goto="${h.id}">${esc(h.textContent)}</a></div>`).join("");
  toc.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => document.getElementById(a.dataset.goto)?.scrollIntoView({ behavior: "smooth" })));
}

// Highlight search hits without touching the editor's DOM (CSS Custom Highlight API).
function highlight(q) {
  const root = $("#editor") || $("#content");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const lq = q.toLowerCase();
  const ranges = [];
  let n;
  while ((n = walker.nextNode()) && ranges.length < 200) {
    const idx = n.nodeValue.toLowerCase().indexOf(lq);
    if (idx < 0) continue;
    const r = document.createRange();
    r.setStart(n, idx); r.setEnd(n, idx + q.length);
    ranges.push(r);
  }
  if (!ranges.length) return;
  if (window.CSS?.highlights && window.Highlight) CSS.highlights.set("search-hit", new Highlight(...ranges));
  ranges[0].startContainer.parentElement?.scrollIntoView({ block: "center" });
}

function crumbs(id) {
  const chain = [];
  let cur = id, guard = 0;
  while (cur && items[cur] && guard++ < 50) { chain.unshift(cur); cur = items[cur].parent; }
  $("#crumb-path").innerHTML = chain.map((c) => `<a href="#/${c}">${items[c].icon ? iconHTML(items[c].icon) + " " : ""}${esc(items[c].title)}</a>`).join(" / ");
  document.title = (items[id]?.title || "OwnNote") + " · OwnNote";
}

function rememberPage(id) {
  try { localStorage.setItem("ownnote:last", id); } catch { /* storage unavailable */ }
}

function startPage() {
  let last = null;
  try { last = localStorage.getItem("ownnote:last"); } catch { /* storage unavailable */ }
  if (last && items[last]) return last;
  const pages = Object.values(items).filter((i) => i.kind === "page");
  pages.sort((a, b) => (b.edited || "").localeCompare(a.edited || ""));
  return pages[0]?.id;
}

async function route() {
  if (!location.hash) {
    const start = startPage();
    if (start) { history.replaceState(null, "", "#/" + start); }
  }
  const [, raw, hit] = location.hash.match(/^#\/([^?]+)(?:\?q=(.*))?/) || [];
  if (current?.editor) {
    await current.editor.flush();
    current.editor.destroy();
  }
  current = null;
  window.CSS?.highlights?.clear();
  closePopovers();
  document.getElementById("cover-wrap")?.remove();
  $("#page-tools").hidden = true;
  setStatus("");
  const id = raw ? findId(raw) : null;
  if (!id || !items[id]) return showHome();
  crumbs(id);
  markActive(id);
  rememberPage(id);
  $("#main").scrollTop = 0;
  try {
    if (items[id].kind === "database") await showDatabase(id);
    else await showPage(id, hit ? decodeURIComponent(hit) : null);
  } catch (e) {
    $("#content").innerHTML = `<p class="muted">Couldn’t load this page (${esc(e.message)}).</p>`;
  }
}

function showHome() {
  $("#crumb-path").innerHTML = "";
  document.title = "OwnNote";
  $("#content").classList.remove("wide");
  applyFormat({});
  const recent = Object.values(items).filter((i) => i.kind === "page").sort((a, b) => (b.edited || "").localeCompare(a.edited || "")).slice(0, 25);
  $("#content").innerHTML = `<div class="static"><h1 class="title">Your workspace</h1>
    <p class="muted">${Object.keys(items).length} pages and databases. Pick one from the sidebar, or press <code class="inline">/</code> to search.</p>
    <p><button class="btn" id="home-new">+ New page</button></p>
    <h3>Recently edited</h3>${recent.map((i) => `<a class="subpage" href="#/${i.id}"><span>${i.icon ? iconHTML(i.icon) : "📄"}</span><span class="label">${esc(i.title)}</span><span class="muted" style="font-weight:400;margin-left:auto">${esc(fmtDate(i.edited))}</span></a>`).join("")}</div>`;
  $("#home-new").onclick = () => newPageFromSidebar(null);
}

// ---------- page menu (font, width, delete) ----------

function closePopovers() {
  document.querySelectorAll(".popover").forEach((p) => p.remove());
}

function popover(anchor, html) {
  closePopovers();
  const el = document.createElement("div");
  el.className = "popover";
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8) + "px";
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  setTimeout(() => {
    const off = (e) => {
      if (!el.contains(e.target)) { el.remove(); document.removeEventListener("mousedown", off); }
    };
    document.addEventListener("mousedown", off);
  });
  return el;
}

$("#menu-btn").onclick = (e) => {
  const tools = $("#page-tools");
  const id = tools.dataset.id;
  const f = JSON.parse(tools.dataset.format || "{}");
  const el = popover(e.currentTarget, `
    <div class="pop-label">Style</div>
    <div class="fonts">${Object.entries(FONTS).map(([k, v]) => `<button data-font="${k}" class="${(f.font || "default") === k ? "on" : ""}"><span class="ag font-${k}">Ag</span>${v}</button>`).join("")}</div>
    <label class="pop-row"><span>Small text</span><input type="checkbox" data-opt="small" ${f.small ? "checked" : ""}></label>
    <label class="pop-row"><span>Full width</span><input type="checkbox" data-opt="full" ${f.full ? "checked" : ""}></label>
    <hr><button class="pop-row danger" data-act="delete">🗑 Delete page</button>`);
  const set = async (patch) => {
    Object.assign(f, patch);
    tools.dataset.format = JSON.stringify(f);
    applyFormat(f);
    el.querySelectorAll("[data-font]").forEach((b) => b.classList.toggle("on", b.dataset.font === (f.font || "default")));
    await savePage(id, { format: patch });
  };
  el.querySelectorAll("[data-font]").forEach((b) => (b.onclick = () => set({ font: b.dataset.font })));
  el.querySelectorAll("[data-opt]").forEach((cb) => (cb.onchange = () => set({ [cb.dataset.opt]: cb.checked })));
  el.querySelector("[data-act=delete]").onclick = () => { el.remove(); deletePage(id); };
};

// ---------- emoji picker ----------

function pickEmoji(anchor, done, allowRemove) {
  const el = popover(anchor, `
    <div class="emoji-top"><input class="emoji-q" placeholder="Search emoji (e.g. book, heart, 笑)…" autocomplete="off">${allowRemove ? `<button class="ghost emoji-rm">Remove</button>` : ""}</div>
    <div class="emoji-grid"></div>`);
  el.classList.add("emoji-pop");
  const grid = el.querySelector(".emoji-grid");
  const q = el.querySelector(".emoji-q");
  const fill = async () => {
    if (!window.NotionEditor) return;
    const list = await window.NotionEditor.emojis(q.value.trim());
    grid.innerHTML = list.slice(0, 400).map((e) => `<button title="${esc(e.label)}">${e.emoji}</button>`).join("") || `<div class="muted">No match — you can also paste any emoji here.</div>`;
  };
  grid.onclick = (e) => {
    const b = e.target.closest("button");
    if (b) { el.remove(); done(b.textContent); }
  };
  q.oninput = () => {
    const v = q.value.trim();
    if (v && /\p{Extended_Pictographic}/u.test(v) && [...v].length <= 4) { el.remove(); return done(v); }
    fill();
  };
  q.onkeydown = (e) => { if (e.key === "Escape") el.remove(); };
  el.querySelector(".emoji-rm")?.addEventListener("click", () => { el.remove(); done(null); });
  fill();
  q.focus();
}

// ---------- sidebar ----------

function sortIds(ids) {
  return ids.sort((a, b) => {
    const pa = items[a].pos, pb = items[b].pos;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pb != null && pa == null) return 1;
    return items[a].title.localeCompare(items[b].title);
  });
}

function rebuildChildren() {
  children = {};
  roots = [];
  for (const it of Object.values(items)) {
    if (it.parent && items[it.parent]) (children[it.parent] ||= []).push(it.id);
    else roots.push(it.id);
  }
  Object.values(children).forEach(sortIds);
  sortIds(roots);
}

const openNodes = new Set();

function nodeIcon(it) {
  return it.icon ? iconHTML(it.icon) : it.kind === "database" ? "🗂️" : "📄";
}

function nodeHTML(id) {
  const it = items[id];
  const has = (children[id] || []).length > 0;
  const add = it.kind === "page" ? `<span class="add" title="Add a page inside">+</span>` : "";
  return `<div class="node closed" data-id="${id}"><a class="row" href="#/${id}"><span class="caret" ${has ? "" : 'style="visibility:hidden"'}>▶</span><span class="ic">${nodeIcon(it)}</span>&nbsp;<span class="label">${esc(it.title)}</span>${add}</a><div class="kids"></div></div>`;
}

function renderTree() {
  $("#tree").innerHTML = roots.map(nodeHTML).join("") + `<a class="row new-page" href="javascript:void 0">＋ New page</a>`;
  for (const id of [...openNodes]) {
    const n = document.querySelector(`.node[data-id="${id}"]`);
    if (n) expand(n, true);
  }
  if (current) markActive(current.id);
  $("#meta").textContent = `${Object.keys(items).length} items · saved on this Mac`;
}

function refreshNode(id) {
  const it = items[id];
  document.querySelectorAll(`.node[data-id="${id}"] > .row`).forEach((row) => {
    row.querySelector(".label").textContent = it.title;
    row.querySelector(".ic").innerHTML = nodeIcon(it);
  });
}

function expand(node, open) {
  const id = node.dataset.id;
  const kids = node.querySelector(":scope > .kids");
  if (open && !kids.childElementCount) {
    kids.innerHTML = (children[id] || []).map(nodeHTML).join("");
    for (const c of children[id] || []) {
      if (openNodes.has(c)) { const n = kids.querySelector(`.node[data-id="${c}"]`); if (n) expand(n, true); }
    }
  }
  open ? openNodes.add(id) : openNodes.delete(id);
  node.classList.toggle("closed", !open);
  const caret = node.querySelector(":scope > .row .caret");
  if (caret) {
    caret.textContent = open ? "▼" : "▶";
    caret.style.visibility = (children[id] || []).length ? "" : "hidden";
  }
}

function markActive(id) {
  document.querySelectorAll(".row.active").forEach((r) => r.classList.remove("active"));
  const chain = [];
  let cur = items[id]?.parent, guard = 0;
  while (cur && items[cur] && guard++ < 50) { chain.unshift(cur); cur = items[cur].parent; }
  for (const c of chain) {
    const n = document.querySelector(`.node[data-id="${c}"]`);
    if (n) expand(n, true);
  }
  const node = document.querySelector(`.node[data-id="${id}"]`);
  if (node) {
    node.querySelector(".row").classList.add("active");
    node.querySelector(".row").scrollIntoView({ block: "nearest" });
  }
}

$("#tree").addEventListener("click", (e) => {
  if (e.target.closest(".new-page")) { e.preventDefault(); return newPageFromSidebar(null); }
  const add = e.target.closest(".add");
  if (add) {
    e.preventDefault();
    const node = add.closest(".node");
    openNodes.add(node.dataset.id);
    return newPageFromSidebar(node.dataset.id);
  }
  const caret = e.target.closest(".caret");
  if (caret) {
    e.preventDefault();
    const node = caret.closest(".node");
    expand(node, node.classList.contains("closed"));
  }
});

// Internal links inside the editor (#/page-id) navigate in place.
$("#content").addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && $("#editor")?.contains(a)) { e.preventDefault(); location.hash = a.getAttribute("href"); }
});

// ---------- search ----------

let searchTimer;
async function doSearch(q) {
  const box = $("#results");
  if (!q.trim()) { box.hidden = true; $("#tree").hidden = false; return; }
  if (!searchText) searchText = await getJSON("/data/search.json").catch(() => ({}));
  const lq = q.toLowerCase();
  const res = [];
  for (const it of Object.values(items)) {
    const t = it.title.toLowerCase();
    const body = searchText[it.id] || "";
    const bi = body.toLowerCase().indexOf(lq);
    const score = t === lq ? 3 : t.includes(lq) ? 2 : bi >= 0 ? 1 : 0;
    if (score) res.push({ it, score, snip: bi >= 0 ? body.slice(Math.max(0, bi - 40), bi + q.length + 60) : "" });
  }
  res.sort((a, b) => b.score - a.score || (b.it.edited || "").localeCompare(a.it.edited || ""));
  const mark = (s) => esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[&<>"']/g, (c) => esc(c)), "gi"), (m) => `<mark>${m}</mark>`);
  box.innerHTML = res.length ? res.slice(0, 100).map(({ it, snip }) =>
    `<a class="result" href="#/${it.id}?q=${encodeURIComponent(q)}"><div>${it.icon ? iconHTML(it.icon) : "📄"} ${mark(it.title)}</div>${snip ? `<div class="snip">…${mark(snip)}…</div>` : ""}</a>`).join("")
    : `<div class="muted" style="padding:8px">No results</div>`;
  box.hidden = false;
  $("#tree").hidden = true;
}
$("#search").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 120); });

const typing = () => {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
};
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); current?.editor?.flush(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); $("#search").select(); }
  if (e.key === "/" && !typing()) { e.preventDefault(); $("#search").focus(); }
  if (e.key === "Escape" && document.activeElement === $("#search")) { $("#search").value = ""; doSearch(""); }
});
window.addEventListener("beforeunload", (e) => {
  if (current?.editor?.dirty) { current.editor.flush(); e.preventDefault(); }
});

$("#toggle-side").onclick = () => { document.body.classList.add("side-hidden"); $("#show-side").hidden = false; };
$("#show-side").onclick = () => { document.body.classList.remove("side-hidden"); $("#show-side").hidden = true; };

// ---------- boot ----------

window.NL = { items, findId, iconHTML, renderBlocks: (bs) => `<div class="static">${renderBlocks(bs)}</div>`, pickEmoji };

(async function init() {
  let idx;
  try {
    idx = await getJSON("/data/index.json");
  } catch {
    idx = { items: [] };
  }
  for (const it of idx.items) items[it.id] = it;
  rebuildChildren();
  renderTree();
  window.addEventListener("hashchange", route);
  route();
})();
