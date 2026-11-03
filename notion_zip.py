#!/usr/bin/env python3
"""Import a Notion "Markdown & CSV" export (.zip) into Snugnote. No Notion account or token needed.

In Notion: Settings → Export all workspace content (or ••• on a page → Export)
           Format: Markdown & CSV · Include subpages · Create folders for subpages
Then:      python3 notion_zip.py ~/Downloads/Export-xxxx.zip

Pages keep their Notion IDs, so importing again (or later using backup.py) updates the same pages
instead of duplicating them. Pages you've edited in Snugnote are never overwritten.
"""
import csv
import io
import json
import posixpath
import re
import sys
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path

import backup
from backup import DATA, DBS, FILES, PAGES, load_json, save_json

ID_RE = re.compile(r"^(?P<name>.*?)[ _-]?(?P<id>[0-9a-f]{32})(?P<ext>_all\.csv|\.csv|\.md)?$", re.I)
NOW = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def dashed(hex32):
    h = hex32.lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def split_name(base):
    """'My Page 1a2b…(32 hex).md' -> ('My Page', uuid). Falls back to a stable made-up id."""
    stem = base
    for ext in ("_all.csv", ".csv", ".md"):
        if stem.lower().endswith(ext):
            stem = stem[: -len(ext)]
            break
    m = ID_RE.match(stem)
    if m and m.group("id"):
        return m.group("name").strip() or "Untitled", dashed(m.group("id"))
    return stem.strip() or "Untitled", None


# ---------------------------------------------------------------- reading the zip

class Export:
    """All files of an export (including nested Part-N.zip files) as {posix path: bytes-loader}."""

    def __init__(self, zip_path):
        self.files = {}
        self._open(zipfile.ZipFile(zip_path))

    def _open(self, zf):
        for info in zf.infolist():
            name = info.filename
            if info.is_dir() or name.startswith("__MACOSX/") or posixpath.basename(name).startswith("._"):
                continue
            norm = posixpath.normpath(name)
            if norm.startswith("../") or norm.startswith("/"):
                continue  # never trust paths that try to escape
            if norm.lower().endswith(".zip"):
                self._open(zipfile.ZipFile(io.BytesIO(zf.read(info))))
                continue
            self.files[norm] = (zf, info)

    def read(self, path):
        zf, info = self.files[path]
        return zf.read(info)

    def text(self, path):
        return self.read(path).decode("utf-8-sig", errors="replace")


# ---------------------------------------------------------------- inline markdown

INLINE = re.compile(
    r"(?P<code>`[^`]+`)"
    r"|(?P<link>!?\[(?P<ltext>(?:[^\[\]]|\[[^\]]*\])*)\]\((?P<lurl><[^>]+>|[^()\s]*(?:\([^)]*\)[^()\s]*)*)\))"
    r"|(?P<bi>\*\*\*(?=\S)(?P<bitext>.+?)(?<=\S)\*\*\*)"
    r"|(?P<b>\*\*(?=\S)(?P<btext>.+?)(?<=\S)\*\*)"
    r"|(?P<s>~~(?=\S)(?P<stext>.+?)(?<=\S)~~)"
    r"|(?P<i>(?<![\w*])\*(?=\S)(?P<itext>[^*]+?)(?<=\S)\*(?!\*)|(?<![\w_])_(?=\S)(?P<itext2>[^_]+?)(?<=\S)_(?![\w_]))"
    r"|(?P<u><u>(?P<utext>.+?)</u>)"
    r"|(?P<esc>\\[\\`*_{}\[\]()#+\-.!~|>])"
)


def rt(text, href=None, **ann):
    a = {"bold": False, "italic": False, "strikethrough": False, "underline": False, "code": False, "color": "default"}
    a.update(ann)
    return {"type": "text", "text": {"content": text, "link": {"url": href} if href else None},
            "plain_text": text, "href": href, "annotations": a}


def inline(text, ctx, ann=None, href=None):
    """Markdown inline text -> Notion rich_text list."""
    ann = dict(ann or {})
    out, pos = [], 0

    def plain(s):
        if s:
            out.append(rt(s, href, **ann))

    for m in INLINE.finditer(text):
        plain(text[pos:m.start()])
        pos = m.end()
        if m.group("code"):
            out.append(rt(m.group("code")[1:-1], href, **{**ann, "code": True}))
        elif m.group("link"):
            label, url = m.group("ltext"), m.group("lurl").strip("<>")
            target = ctx.resolve_link(url)
            out.extend(inline(label or url, ctx, ann, target))
        elif m.group("bi"):
            out.extend(inline(m.group("bitext"), ctx, {**ann, "bold": True, "italic": True}, href))
        elif m.group("b"):
            out.extend(inline(m.group("btext"), ctx, {**ann, "bold": True}, href))
        elif m.group("s"):
            out.extend(inline(m.group("stext"), ctx, {**ann, "strikethrough": True}, href))
        elif m.group("i"):
            out.extend(inline(m.group("itext") or m.group("itext2"), ctx, {**ann, "italic": True}, href))
        elif m.group("u"):
            out.extend(inline(m.group("utext"), ctx, {**ann, "underline": True}, href))
        elif m.group("esc"):
            plain(m.group("esc")[1])
    plain(text[pos:])
    return out


# ---------------------------------------------------------------- block markdown

def blk(t, value, children=None):
    b = {"object": "block", "id": str(uuid.uuid4()), "type": t, t: value, "has_children": bool(children)}
    if children:
        b["children"] = children
    return b


LIST_RE = re.compile(r"^(?P<marker>[-*+]|\d+[.)])\s+(?P<rest>.*)$")
TODO_RE = re.compile(r"^\[(?P<x>[ xX])\]\s*(?P<rest>.*)$")
HEAD_RE = re.compile(r"^(?P<h>#{1,6})\s+(?P<rest>.*?)\s*#*\s*$")
IMG_LINE = re.compile(r"^!\[(?P<alt>[^\]]*)\]\((?P<url><[^>]+>|[^)]+)\)\s*$")
LINK_LINE = re.compile(r"^\[(?P<text>[^\]]*)\]\((?P<url><[^>]+>|[^)]+)\)\s*$")
TABLE_SEP = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
EMOJI_START = re.compile(
    "^([\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2190-\u21FF\u2300-\u23FF]"
    "[\uFE0F\u200D\U0001F3FB-\U0001F3FF\U0001F000-\U0001FAFF\u2600-\u27BF]*)\\s*")


def indent_of(line):
    expanded = line.replace("\t", "    ")
    return len(expanded) - len(expanded.lstrip(" "))


def dedent(lines, n):
    out = []
    for l in lines:
        e = l.replace("\t", "    ")
        out.append(e[n:] if e[:n].strip() == "" else e.lstrip(" "))
    return out


def split_row(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells, cur, i = [], "", 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            cur += "|"
            i += 2
            continue
        if s[i] == "|":
            cells.append(cur.strip())
            cur = ""
        else:
            cur += s[i]
        i += 1
    cells.append(cur.strip())
    return cells


def parse_blocks(lines, ctx):
    blocks, i = [], 0
    n = len(lines)
    while i < n:
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue

        # fenced code
        if s.startswith("```"):
            lang = s[3:].strip().lower() or "plain text"
            body = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            base = min((indent_of(b) for b in body if b.strip()), default=0)
            code = "\n".join(dedent(body, base))
            blocks.append(blk("code", {"rich_text": [rt(code)] if code else [], "language": lang, "caption": []}))
            continue

        # $$ equation $$
        if s.startswith("$$"):
            expr = [s[2:]]
            if not (s.endswith("$$") and len(s) > 2):
                i += 1
                while i < n and not lines[i].strip().endswith("$$"):
                    expr.append(lines[i])
                    i += 1
                if i < n:
                    expr.append(lines[i].strip()[:-2])
            else:
                expr = [s[2:-2]]
            i += 1
            blocks.append(blk("equation", {"expression": "\n".join(expr).strip()}))
            continue

        # <aside> callout </aside>
        if s.lower().startswith("<aside>"):
            body = []
            rest = s[7:]
            if rest.strip():
                body.append(rest)
            i += 1
            while i < n and "</aside>" not in lines[i].lower():
                body.append(lines[i])
                i += 1
            if i < n:
                tail = re.split(r"</aside>", lines[i], flags=re.I)[0]
                if tail.strip():
                    body.append(tail)
            i += 1
            body = [b for b in body]
            while body and not body[0].strip():
                body.pop(0)
            emoji = "💡"
            first_text = []
            if body:
                m = EMOJI_START.match(body[0].strip())
                if m:
                    emoji = m.group(1)
                    body[0] = body[0].strip()[m.end():]
                # first paragraph becomes the callout text, the rest its children
                j = 0
                while j < len(body) and body[j].strip():
                    first_text.append(body[j].strip())
                    j += 1
                body = body[j:]
            blocks.append(blk("callout", {"rich_text": inline("\n".join(first_text), ctx),
                                          "icon": {"type": "emoji", "emoji": emoji}, "color": "gray_background"},
                              parse_blocks(body, ctx)))
            continue

        # headings
        m = HEAD_RE.match(s)
        if m:
            level = min(len(m.group("h")), 3)
            blocks.append(blk(f"heading_{level}", {"rich_text": inline(m.group("rest"), ctx), "color": "default", "is_toggleable": False}))
            i += 1
            continue

        # divider
        if re.fullmatch(r"(-\s*){3,}|(\*\s*){3,}|(_\s*){3,}", s):
            blocks.append(blk("divider", {}))
            i += 1
            continue

        # table
        if s.startswith("|") and i + 1 < n and TABLE_SEP.match(lines[i + 1].strip()):
            rows = [split_row(s)]
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            width = max(len(r) for r in rows)
            trs = [blk("table_row", {"cells": [inline(c, ctx) for c in r + [""] * (width - len(r))]}) for r in rows]
            blocks.append(blk("table", {"table_width": width, "has_column_header": True, "has_row_header": False}, trs))
            continue

        # quote (consecutive > lines)
        if s.startswith(">"):
            body = []
            while i < n and lines[i].strip().startswith(">"):
                body.append(re.sub(r"^>\s?", "", lines[i].strip()))
                i += 1
            blocks.append(blk("quote", {"rich_text": inline("\n".join(body), ctx), "color": "default"}))
            continue

        # list items (with indented children)
        m = LIST_RE.match(s)
        if m:
            base = indent_of(line)
            rest = m.group("rest")
            i += 1
            child = []
            while i < n and (not lines[i].strip() or indent_of(lines[i]) > base):
                child.append(lines[i])
                i += 1
            # a trailing blank line belongs to the parent level
            while child and not child[-1].strip():
                child.pop()
            step = min((indent_of(c) for c in child if c.strip()), default=base)
            kids = parse_blocks(dedent(child, step), ctx) if child else []
            tm = TODO_RE.match(rest)
            if tm:
                blocks.append(blk("to_do", {"rich_text": inline(tm.group("rest"), ctx), "checked": tm.group("x") != " ", "color": "default"}, kids))
            elif m.group("marker")[0].isdigit():
                blocks.append(blk("numbered_list_item", {"rich_text": inline(rest, ctx), "color": "default"}, kids))
            else:
                blocks.append(blk("bulleted_list_item", {"rich_text": inline(rest, ctx), "color": "default"}, kids))
            continue

        # a line that is only an image
        m = IMG_LINE.match(s)
        if m:
            blocks.append(ctx.media_block(m.group("url").strip("<>"), m.group("alt")))
            i += 1
            continue

        # a line that is only a link to another exported page/database -> embedded subpage
        m = LINK_LINE.match(s)
        if m:
            sub = ctx.child_block(m.group("url").strip("<>"), m.group("text"))
            if sub:
                blocks.append(sub)
                i += 1
                continue

        # paragraph: consecutive non-special lines
        para = [s]
        i += 1
        while i < n and lines[i].strip() and not starts_block(lines[i].strip(), lines[i + 1].strip() if i + 1 < n else ""):
            para.append(lines[i].strip())
            i += 1
        blocks.append(blk("paragraph", {"rich_text": inline("\n".join(para), ctx), "color": "default"}))
    return blocks


def starts_block(s, nxt):
    return bool(s.startswith(("```", "$$", ">", "<aside", "|")) and (not s.startswith("|") or TABLE_SEP.match(nxt))
                or HEAD_RE.match(s) or LIST_RE.match(s) or IMG_LINE.match(s)
                or re.fullmatch(r"(-\s*){3,}|(\*\s*){3,}", s))


# ---------------------------------------------------------------- import

class Importer:
    def __init__(self, zip_path, progress=print):
        self.ex = Export(zip_path)
        self.progress = progress
        self.ids = {}         # export path (md/csv) -> id
        self.names = {}       # export path -> title
        self.parents = {}     # id -> (parent id or None, "page_id"|"database_id"|"workspace")
        self.db_paths = {}    # db folder path -> db id
        self.stats = {"pages": 0, "databases": 0, "files": 0, "skipped_edited": 0, "skipped_existing": 0}

    # -- structure

    def scan(self):
        mds = [p for p in self.ex.files if p.lower().endswith(".md")]
        csvs = [p for p in self.ex.files if p.lower().endswith(".csv")]
        # prefer "X_all.csv" (all rows) over "X.csv" (current view only)
        by_stem = {}
        for p in csvs:
            stem = p[:-8] if p.lower().endswith("_all.csv") else p[:-4]
            if stem not in by_stem or p.lower().endswith("_all.csv"):
                by_stem[stem] = p
        self.csvs = list(by_stem.values())
        for p in mds + self.csvs:
            title, pid = split_name(posixpath.basename(p))
            self.ids[p] = pid or str(uuid.uuid5(uuid.NAMESPACE_URL, "snugnote-export:" + p))
            self.names[p] = title
        for p in self.csvs:
            stem = p[:-8] if p.lower().endswith("_all.csv") else p[:-4]
            self.db_paths[stem] = self.ids[p]
            self.ids.setdefault(stem + ".csv", self.ids[p])
        self.mds = mds
        # folder "Title <id>/" holds the children of "Title <id>.md"
        self.folder_owner = {}
        for p in mds:
            self.folder_owner[p[:-3]] = self.ids[p]
        for p in mds + self.csvs:
            self.parents[self.ids[p]] = self.parent_of(p)

    def parent_of(self, path):
        d = posixpath.dirname(path)
        while d and d != ".":
            if d in self.db_paths:
                return self.db_paths[d], "database_id"
            if d in self.folder_owner:
                return self.folder_owner[d], "page_id"
            d = posixpath.dirname(d)
        return None, "workspace"

    # -- link helpers used by the markdown parser

    def resolve(self, url):
        """Relative link in the current file -> export path, or None for external links."""
        if re.match(r"^[a-z][a-z0-9+.-]*:", url, re.I) or url.startswith("#"):
            return None
        path = urllib.parse.unquote(url.split("#")[0].split("?")[0])
        return posixpath.normpath(posixpath.join(posixpath.dirname(self.current), path))

    def resolve_link(self, url):
        target = self.resolve(url)
        if target is None:
            return url
        if target in self.ids:
            return "#/" + self.ids[target]
        if target in self.ex.files:
            return self.copy_file(target)
        return None

    def child_block(self, url, text):
        target = self.resolve(url)
        if target is None or target not in self.ids:
            return None
        tid = self.ids[target]
        if self.parents.get(tid, (None,))[0] == self.current_id:
            kind = "child_database" if target.lower().endswith(".csv") else "child_page"
            b = blk(kind, {"title": self.names.get(target, text)})
            b["id"] = tid
            return b
        return blk("link_to_page", {"type": "page_id", "page_id": tid})

    def media_block(self, url, alt):
        target = self.resolve(url)
        caption = [rt(alt)] if alt and not re.search(r"\.(png|jpe?g|gif|webp|svg|heic)$", alt, re.I) else []
        if target is None:
            return blk("image", {"type": "external", "external": {"url": url}, "caption": caption})
        local = self.copy_file(target) if target in self.ex.files else None
        if not local:
            return blk("paragraph", {"rich_text": [rt(f"[missing image: {posixpath.basename(target)}]")], "color": "gray"})
        kind = "image" if re.search(r"\.(png|jpe?g|gif|webp|svg|bmp|heic|avif)$", target, re.I) else "file"
        return blk(kind, {"type": "file", "file": {"url": "", "local": local[len("/data/"):]}, "caption": caption,
                          "name": posixpath.basename(target)})

    def copy_file(self, target):
        safe = re.sub(r"[^\w.\- ]", "_", posixpath.basename(target))[-80:] or "file"
        dest_dir = FILES / self.current_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / safe
        if not dest.exists():
            dest.write_bytes(self.ex.read(target))
            self.stats["files"] += 1
        rel = dest.relative_to(DATA).as_posix()
        return "/data/" + rel

    # -- writing

    def page_obj(self, pid, title, props=None):
        parent, ptype = self.parents.get(pid, (None, "workspace"))
        par = {"type": ptype, ptype: parent} if parent else {"type": "workspace", "workspace": True}
        return {"object": "page", "id": pid, "created_time": NOW, "last_edited_time": NOW, "parent": par,
                "icon": None, "cover": None, "archived": False,
                "properties": props or {"title": {"id": "title", "type": "title", "title": [rt(title)]}}}

    def keep_existing(self, pid):
        """Never overwrite pages edited in Snugnote, or richer copies that came from the Notion API."""
        old = load_json(PAGES / f"{pid}.json")
        if not old:
            return False
        if old.get("local_edited"):
            self.stats["skipped_edited"] += 1
            return True
        if old.get("source") != "zip":
            self.stats["skipped_existing"] += 1
            return True
        return False

    def write_page(self, path, props=None, db_columns=None):
        pid = self.ids[path]
        if self.keep_existing(pid):
            return
        self.current, self.current_id = path, pid
        lines = self.ex.text(path).replace("\r\n", "\n").split("\n")
        title = self.names[path]
        # "# Title" first line
        while lines and not lines[0].strip():
            lines.pop(0)
        if lines and lines[0].startswith("# "):
            title = lines.pop(0)[2:].strip() or title
        # database rows: "Key: value" property lines right after the title
        if db_columns:
            while lines and not lines[0].strip():
                lines.pop(0)
            while lines and ":" in lines[0] and lines[0].split(":", 1)[0].strip() in db_columns:
                lines.pop(0)
        blocks = parse_blocks(lines, self)
        page = self.page_obj(pid, title, props)
        if props is None:
            page["properties"]["title"]["title"] = [rt(title)]
        save_json(PAGES / f"{pid}.json", {"page": page, "blocks": blocks, "text": backup.block_text(blocks), "source": "zip"})
        self.stats["pages"] += 1

    def write_database(self, path):
        did = self.ids[path]
        self.current, self.current_id = path, did
        rows = list(csv.reader(io.StringIO(self.ex.text(path))))
        if not rows:
            return
        header = [h.strip() for h in rows[0]]
        body = [r + [""] * (len(header) - len(r)) for r in rows[1:] if any(c.strip() for c in r)]
        types = {}
        for ci, h in enumerate(header):
            vals = {r[ci].strip() for r in body if r[ci].strip()}
            types[h] = "title" if ci == 0 else ("checkbox" if vals and vals <= {"Yes", "No"} else "rich_text")
        stem = path[:-8] if path.lower().endswith("_all.csv") else path[:-4]
        # match each CSV row to its exported page (same folder, same title)
        row_files = {}
        for p in self.mds:
            if posixpath.dirname(p) == stem:
                row_files.setdefault(self.names[p], []).append(p)
        row_ids = []
        for r in body:
            title = r[0].strip() or "Untitled"
            props = {}
            for ci, h in enumerate(header):
                v = r[ci].strip()
                if types[h] == "title":
                    props[h] = {"type": "title", "title": [rt(v)] if v else []}
                elif types[h] == "checkbox":
                    props[h] = {"type": "checkbox", "checkbox": v == "Yes"}
                else:
                    props[h] = {"type": "rich_text", "rich_text": [rt(v)] if v else []}
            files = row_files.get(title)
            if files:
                p = files.pop(0)
                self.parents[self.ids[p]] = (did, "database_id")
                self.write_page(p, props=props, db_columns=set(header))
                row_ids.append(self.ids[p])
            else:
                rid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"snugnote-row:{path}:{len(row_ids)}:{title}"))
                self.parents[rid] = (did, "database_id")
                if not self.keep_existing(rid):
                    save_json(PAGES / f"{rid}.json", {"page": self.page_obj(rid, title, props), "blocks": [], "text": "", "source": "zip"})
                    self.stats["pages"] += 1
                row_ids.append(rid)
        # row pages with no matching CSV line (e.g. renamed) are still imported
        for leftovers in row_files.values():
            for p in leftovers:
                self.parents[self.ids[p]] = (did, "database_id")
                self.write_page(p)
                row_ids.append(self.ids[p])
        self.current, self.current_id = path, did
        parent, ptype = self.parents.get(did, (None, "workspace"))
        db = {"object": "database", "id": did, "title": [rt(self.names[path])], "description": [],
              "parent": {"type": ptype, ptype: parent} if parent else {"type": "workspace", "workspace": True},
              "icon": None, "cover": None, "last_edited_time": NOW,
              "properties": {h: {"type": types[h]} for h in header}}
        save_json(DBS / f"{did}.json", {"database": db, "rows": row_ids})
        self.stats["databases"] += 1

    def run(self):
        for d in (PAGES, DBS, FILES):
            d.mkdir(parents=True, exist_ok=True)
        self.scan()
        db_row_files = {p for p in self.mds if posixpath.dirname(p) in self.db_paths}
        plain_pages = [p for p in self.mds if p not in db_row_files]
        total = len(plain_pages) + len(self.csvs)
        if not total:
            raise ValueError("No Notion pages found in this file. Export as \"Markdown & CSV\" and upload the .zip.")
        done = 0
        for p in sorted(plain_pages):
            done += 1
            self.progress(f"[{done}/{total}] {self.names[p]}")
            self.write_page(p)
        for p in sorted(self.csvs):
            done += 1
            self.progress(f"[{done}/{total}] {self.names[p]} (database)")
            self.write_database(p)
        backup.rebuild_from_disk()
        return self.stats


def import_zip(zip_path, progress=print):
    return Importer(zip_path, progress).run()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    s = import_zip(sys.argv[1])
    n = lambda k, word: f"{s[k]} {word}{'' if s[k] == 1 else 's'}"
    print(f"Done: {n('pages', 'page')}, {n('databases', 'database')} and {n('files', 'file')} imported into {DATA}"
          + (f"; kept {n('skipped_edited', 'page')} you edited in Snugnote" if s["skipped_edited"] else "")
          + (f"; kept {n('skipped_existing', 'page')} already imported from your Notion account" if s["skipped_existing"] else ""))
