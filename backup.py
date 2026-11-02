#!/usr/bin/env python3
"""Download everything a Notion integration can see into ./data.

Usage:
    NOTION_TOKEN=ntn_xxx python3 backup.py        # or put the token in ./token.txt

Re-running is incremental: pages whose last_edited_time hasn't changed are skipped.
"""
import json
import mimetypes
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = os.environ.get("NOTION_API", "https://api.notion.com/v1")
VERSION = "2022-06-28"
ROOT = Path(__file__).resolve().parent


def data_dir():
    """Where notes live: $OWNOTE_DATA, else the path in data-location.txt, else ./data."""
    env = os.environ.get("OWNOTE_DATA", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    loc = ROOT / "data-location.txt"
    if loc.exists() and loc.read_text().strip():
        return Path(loc.read_text().strip()).expanduser().resolve()
    return ROOT / "data"


DATA = data_dir()
PAGES = DATA / "pages"
DBS = DATA / "databases"
FILES = DATA / "files"
MIN_INTERVAL = float(os.environ.get("NOTION_MIN_INTERVAL", "0.34"))  # Notion allows ~3 req/s

FILE_BLOCKS = {"image", "file", "pdf", "video", "audio"}
CHILD_ENTITY_BLOCKS = {"child_page", "child_database"}


def load_token():
    # token.txt sits next to the data folder (never inside it, so the app never serves it).
    tok = os.environ.get("NOTION_TOKEN", "").strip()
    for f in (DATA.parent / "token.txt", ROOT / "token.txt"):
        if not tok and f.exists():
            tok = f.read_text().strip()
    if not tok and sys.stdin.isatty():
        import getpass
        tok = getpass.getpass("Paste your Notion integration secret (starts with ntn_), then press Enter: ").strip()
        if tok:
            f = DATA.parent / "token.txt"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(tok + "\n")
            f.chmod(0o600)
            print(f"Saved to {f}")
    if not tok:
        sys.exit("No token. Set NOTION_TOKEN or create token.txt (see README.md).")
    return tok


TOKEN = None
_last = 0.0


def api(method, path, body=None):
    global _last
    url = path if path.startswith("http") else API + path
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(8):
        wait = MIN_INTERVAL - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {TOKEN}",
            "Notion-Version": VERSION,
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")
            if e.code == 429 or e.code >= 500:
                delay = float(e.headers.get("Retry-After") or 2 ** attempt)
                print(f"  ...{e.code}, retrying in {delay:.0f}s", flush=True)
                time.sleep(delay)
                continue
            if e.code == 401:
                sys.exit("Notion rejected the token (401). Check token.txt.")
            raise RuntimeError(f"{method} {path} -> {e.code}: {msg}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  ...network error ({e}), retrying", flush=True)
            time.sleep(2 ** attempt)
    raise RuntimeError(f"{method} {path} failed after retries")


def paginate(method, path, body=None):
    cursor = None
    while True:
        if method == "GET":
            sep = "&" if "?" in path else "?"
            p = path + sep + "page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
            res = api("GET", p)
        else:
            b = dict(body or {}, page_size=100)
            if cursor:
                b["start_cursor"] = cursor
            res = api("POST", path, b)
        yield from res.get("results", [])
        if not res.get("has_more"):
            return
        cursor = res.get("next_cursor")


# ---------- files ----------

def download_file(url, owner_id):
    """Notion-hosted file URLs expire after an hour, so save them locally now."""
    name = urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]) or "file"
    name = re.sub(r"[^\w.\- ]", "_", name)[-80:]
    dest_dir = FILES / owner_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name
    i = 1
    while dest.exists():
        stem, ext = os.path.splitext(name)
        dest = dest_dir / f"{stem}-{i}{ext}"
        i += 1
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            body = r.read()
        if not os.path.splitext(name)[1]:
            ext = mimetypes.guess_extension(r.headers.get_content_type() or "") or ""
            dest = dest.with_name(dest.name + ext)
        dest.write_bytes(body)
        return str(dest.relative_to(DATA))
    except Exception as e:
        print(f"  ! could not download file: {e}", flush=True)
        return None


def localize(obj, owner_id):
    """Replace Notion-hosted file URLs inside a file object with local paths."""
    if isinstance(obj, dict) and obj.get("type") == "file" and isinstance(obj.get("file"), dict):
        local = download_file(obj["file"]["url"], owner_id)
        if local:
            obj["file"]["local"] = local
    return obj


def localize_page_meta(page):
    pid = page["id"]
    for key in ("icon", "cover"):
        if page.get(key):
            localize(page[key], pid)
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "files":
            for f in prop["files"]:
                localize(f, pid)


# ---------- blocks ----------

def fetch_blocks(block_id, owner_id, depth=0):
    blocks = []
    for b in paginate("GET", f"/blocks/{block_id}/children"):
        t = b["type"]
        if t in FILE_BLOCKS:
            localize(b[t], owner_id)
        if t == "callout" and b[t].get("icon"):
            localize(b[t]["icon"], owner_id)
        if b.get("has_children") and t not in CHILD_ENTITY_BLOCKS and depth < 30:
            src = b[t].get("synced_from") if t == "synced_block" else None
            target = (src or {}).get("block_id") or b["id"]
            try:
                b["children"] = fetch_blocks(target, owner_id, depth + 1)
            except RuntimeError as e:
                print(f"  ! skipped children of {b['id']}: {e}", flush=True)
                b["children"] = []
        blocks.append(b)
    return blocks


def plain(rich):
    return "".join(r.get("plain_text", "") for r in rich or [])


def block_text(blocks):
    out = []
    for b in blocks:
        v = b.get(b["type"], {})
        if isinstance(v, dict):
            if "rich_text" in v:
                out.append(plain(v["rich_text"]))
            if b["type"] == "table_row":
                out.extend(plain(c) for c in v.get("cells", []))
            if b["type"] == "child_page":
                out.append(v.get("title", ""))
        out.append(block_text(b.get("children", [])))
    return "\n".join(x for x in out if x)


def page_title(page):
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "title":
            return plain(prop["title"])
    return ""


def db_title(db):
    return plain(db.get("title"))


def walk_structure(blocks, owner, owners, order):
    """Record which page owns each block, and the on-page order of subpages/databases."""
    for b in blocks:
        owners[b["id"]] = owner
        if b["type"] in CHILD_ENTITY_BLOCKS:
            order.setdefault(b["id"], len(order))
        walk_structure(b.get("children", []), owner, owners, order)


def parent_of(obj):
    p = obj.get("parent", {})
    t = p.get("type")
    if t in ("page_id", "database_id", "block_id"):
        return p[t]
    return None  # workspace


# ---------- main ----------

def load_json(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def save_json(path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False))
    tmp.replace(path)


def main():
    global TOKEN
    TOKEN = load_token()
    for d in (PAGES, DBS, FILES):
        d.mkdir(parents=True, exist_ok=True)

    print("Listing everything shared with the integration...", flush=True)
    found = {}
    for obj in paginate("POST", "/search", {}):
        if not obj.get("archived") and not obj.get("in_trash"):
            found[obj["id"]] = obj
    dbs = [o for o in found.values() if o["object"] == "database"]
    # Database rows don't always show up in search, so query each database too.
    db_rows = {}
    for db in dbs:
        try:
            rows = list(paginate("POST", f"/databases/{db['id']}/query", {}))
        except RuntimeError as e:
            print(f"  ! could not query database {db_title(db)!r}: {e}", flush=True)
            rows = []
        db_rows[db["id"]] = [r["id"] for r in rows]
        for r in rows:
            found.setdefault(r["id"], r)

    trashed = set(load_json(DATA / "trash" / "trashed.json") or [])
    found = {k: v for k, v in found.items() if k not in trashed}
    dbs = [o for o in dbs if o["id"] not in trashed]
    pages = [o for o in found.values() if o["object"] == "page"]
    print(f"Found {len(pages)} pages and {len(dbs)} databases.", flush=True)

    for db in dbs:
        shutil.rmtree(FILES / db["id"], ignore_errors=True)
        localize_page_meta(db)
        save_json(DBS / f"{db['id']}.json", {"database": db, "rows": db_rows.get(db["id"], [])})

    search = {}
    saved = {}
    owners, order = {}, {}
    for rows in db_rows.values():
        for n, rid in enumerate(rows):
            order[rid] = n
    for i, page in enumerate(pages, 1):
        pid = page["id"]
        path = PAGES / f"{pid}.json"
        old = load_json(path)
        title = page_title(page) or "Untitled"
        if old and old.get("local_edited"):
            print(f"[{i}/{len(pages)}] {title} - edited locally, keeping your version", flush=True)
            continue
        if old and old["page"].get("last_edited_time") == page.get("last_edited_time"):
            search[pid] = old.get("text", "")
            saved[pid] = old["page"]
            walk_structure(old.get("blocks", []), pid, owners, order)
            continue
        print(f"[{i}/{len(pages)}] {title}", flush=True)
        shutil.rmtree(FILES / pid, ignore_errors=True)
        try:
            blocks = fetch_blocks(pid, pid)
        except RuntimeError as e:
            print(f"  ! failed: {e}", flush=True)
            if old:
                search[pid], saved[pid] = old.get("text", ""), old["page"]
                walk_structure(old.get("blocks", []), pid, owners, order)
            continue
        localize_page_meta(page)
        text = block_text(blocks)
        save_json(path, {"page": page, "blocks": blocks, "text": text})
        search[pid] = text
        saved[pid] = page
        walk_structure(blocks, pid, owners, order)

    # Build the index from everything on disk, so pages created locally are kept too.
    rebuild_from_disk()
    print(f"Done. {len(pages)} pages, {len(dbs)} databases saved to {DATA}", flush=True)


def write_index(pages, dbs, owners, order, search):
    """Write the files the viewer reads: tree structure, titles and search text."""
    known = {o["id"] for o in pages} | {o["id"] for o in dbs}

    def resolve_parent(o):
        p = parent_of(o)
        seen = 0
        while p in owners and p not in known and seen < 50:  # block parent -> owning page
            p, seen = owners[p], seen + 1
        return p

    def entry(o, kind, title):
        return {
            "id": o["id"], "kind": kind, "title": title,
            "parent": resolve_parent(o), "pos": order.get(o["id"]), "parent_type": o.get("parent", {}).get("type"),
            "icon": icon_of(o), "edited": o.get("last_edited_time"),
        }

    index = [entry(o, "page", page_title(o) or "Untitled") for o in pages]
    index += [entry(o, "database", db_title(o) or "Untitled database") for o in dbs]
    save_json(DATA / "index.json", {"generated": time.strftime("%Y-%m-%d %H:%M"), "items": index})
    save_json(DATA / "search.json", search)


def rebuild_from_disk():
    """Rebuild the viewer index from whatever is already in data/ (no network)."""
    pages, dbs, search, owners, order = [], [], {}, {}, {}
    for f in sorted(DBS.glob("*.json")):
        d = load_json(f)
        if d:
            dbs.append(d["database"])
            for n, rid in enumerate(d.get("rows", [])):
                order[rid] = n
    for f in sorted(PAGES.glob("*.json")):
        d = load_json(f)
        if d:
            pages.append(d["page"])
            search[d["page"]["id"]] = d.get("text", "")
            walk_structure(d.get("blocks", []), d["page"]["id"], owners, order)
    write_index(pages, dbs, owners, order, search)
    print(f"Index rebuilt: {len(pages)} pages, {len(dbs)} databases.")


def icon_of(o):
    ic = o.get("icon") or {}
    if ic.get("type") == "emoji":
        return {"emoji": ic["emoji"]}
    if ic.get("type") == "file":
        return {"src": ic["file"].get("local")}
    if ic.get("type") == "external":
        return {"src": ic["external"]["url"]}
    return None


if __name__ == "__main__":
    try:
        if "--index-only" in sys.argv:
            rebuild_from_disk()
        else:
            main()
    except KeyboardInterrupt:
        sys.exit("\nInterrupted. Re-run to resume; finished pages are kept.")
