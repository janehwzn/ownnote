#!/usr/bin/env python3
"""Serve Ownote at http://localhost:8765, open it in the browser, and save edits to ./data."""
import functools
import http.server
import json
import os
import posixpath
import re
import shutil
import sys
import threading
import time
import urllib.parse
import uuid
import webbrowser
from pathlib import Path

from backup import DATA, FILES, PAGES, block_text, icon_of, load_json, page_title, save_json

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8765"))
TRASH = DATA / "trash"
LOCK = threading.Lock()


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


class Store:
    """In-memory copy of index.json/search.json, written back after every change."""

    def __init__(self):
        self.stamp = None
        self.refresh()

    def _mtime(self):
        try:
            return (DATA / "index.json").stat().st_mtime_ns
        except FileNotFoundError:
            return None

    def refresh(self):
        """Reload from disk if something else (e.g. backup.py) rewrote the index since we last saw it."""
        if self.stamp is not None and self._mtime() == self.stamp:
            return
        idx = load_json(DATA / "index.json") or {"items": []}
        self.items = {i["id"]: i for i in idx["items"]}
        self.search = load_json(DATA / "search.json") or {}
        self.stamp = self._mtime()

    def write(self):
        DATA.mkdir(exist_ok=True)
        save_json(DATA / "index.json", {"generated": time.strftime("%Y-%m-%d %H:%M"), "items": list(self.items.values())})
        save_json(DATA / "search.json", self.search)
        self.stamp = self._mtime()

    def load_page(self, pid):
        d = load_json(PAGES / f"{pid}.json")
        if not d:
            raise KeyError(pid)
        return d

    def save_page(self, d):
        d["page"]["last_edited_time"] = now_iso()
        d["local_edited"] = True
        d["text"] = block_text(d.get("blocks", []))
        pid = d["page"]["id"]
        save_json(PAGES / f"{pid}.json", d)
        self.search[pid] = d["text"]
        it = self.items.get(pid)
        if it:
            it.update(title=page_title(d["page"]) or "Untitled", icon=icon_of(d["page"]), edited=d["page"]["last_edited_time"])
        return it

    # --- operations ---

    def create(self, parent, title, link):
        pid = str(uuid.uuid4())
        if parent and parent in self.items:
            parent_obj = {"type": "page_id", "page_id": parent}
            sib = [i.get("pos") or 0 for i in self.items.values() if i.get("parent") == parent]
            pos = max(sib, default=0) + 1
        else:
            parent, parent_obj, pos = None, {"type": "workspace", "workspace": True}, None
        page = {
            "object": "page", "id": pid, "created_time": now_iso(), "last_edited_time": now_iso(),
            "parent": parent_obj, "icon": None, "cover": None, "archived": False,
            "properties": {"title": {"id": "title", "type": "title", "title": text_rt(title)}},
        }
        self.items[pid] = {"id": pid, "kind": "page", "title": title or "Untitled", "parent": parent, "pos": pos,
                           "parent_type": parent_obj["type"], "icon": None, "edited": page["last_edited_time"]}
        self.save_page({"page": page, "blocks": []})
        if link and parent and self.items[parent]["kind"] == "page":
            pd = self.load_page(parent)
            pd["blocks"].append({"object": "block", "id": pid, "type": "child_page", "child_page": {"title": title}, "has_children": False})
            self.save_page(pd)
        self.write()
        return self.items[pid]

    def update(self, pid, body):
        d = self.load_page(pid)
        if "blocks" in body:
            d["blocks"] = body["blocks"]
        if "title" in body:
            for prop in d["page"]["properties"].values():
                if prop.get("type") == "title":
                    prop["title"] = text_rt(body["title"])
                    break
            parent = self.items.get(pid, {}).get("parent")
            if parent in self.items and self.items[parent]["kind"] == "page":
                pd = self.load_page(parent)
                if rename_child_block(pd["blocks"], pid, body["title"]):
                    save_json(PAGES / f"{parent}.json", pd)
        if "icon" in body:
            d["page"]["icon"] = {"type": "emoji", "emoji": body["icon"]} if body["icon"] else None
        if "format" in body:
            d["format"] = {**d.get("format", {}), **body["format"]}
        it = self.save_page(d)
        self.write()
        return it

    def delete(self, pid):
        ids = [pid]
        for i in ids:  # collect descendants
            ids += [c for c, it in self.items.items() if it.get("parent") == i and c not in ids]
        dest = TRASH / time.strftime("%Y%m%d-%H%M%S")
        dest.mkdir(parents=True, exist_ok=True)
        parent = self.items.get(pid, {}).get("parent")
        for i in ids:
            kind = self.items.get(i, {}).get("kind")
            src = (PAGES if kind == "page" else DATA / "databases") / f"{i}.json"
            if src.exists():
                shutil.move(str(src), str(dest / src.name))
            self.items.pop(i, None)
            self.search.pop(i, None)
        trashed = set(load_json(TRASH / "trashed.json") or []) | set(ids)
        save_json(TRASH / "trashed.json", sorted(trashed))
        if parent in self.items and self.items[parent]["kind"] == "page":
            pd = self.load_page(parent)
            if remove_child_block(pd["blocks"], pid):
                self.save_page(pd)
        self.write()
        return ids


def text_rt(text):
    if not text:
        return []
    return [{"type": "text", "text": {"content": text, "link": None}, "plain_text": text, "href": None,
             "annotations": {"bold": False, "italic": False, "strikethrough": False, "underline": False, "code": False, "color": "default"}}]


def rename_child_block(blocks, pid, title):
    for b in blocks:
        if b["id"] == pid and b["type"] == "child_page":
            b["child_page"]["title"] = title
            return True
        if rename_child_block(b.get("children", []), pid, title):
            return True
    return False


def remove_child_block(blocks, pid):
    for i, b in enumerate(blocks):
        if b["id"] == pid and b["type"] in ("child_page", "child_database"):
            del blocks[i]
            return True
        if remove_child_block(b.get("children", []), pid):
            return True
    return False


STORE = None


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path):
        # /data/... is served from the notes folder, which may live outside the app folder.
        p = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(path).path))
        if p == "/data" or p.startswith("/data/"):
            rel = posixpath.normpath(p[len("/data"):]).lstrip("/")
            base = DATA.resolve()
            target = (base / rel).resolve()
            if target == base or base in target.parents:
                return str(target)
            return str(base / "__forbidden__")
        if not p.startswith("/viewer/") or ".." in p.split("/"):
            return str(ROOT / "viewer" / "__forbidden__")  # only the app's own files are served
        return super().translate_path(path)

    def do_GET(self):
        if self.path in ("/", "/index.html") or self.path.startswith("/?"):
            self.path = "/viewer/index.html"
        return super().do_GET()

    def reply(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def api(self, method):
        url = urllib.parse.urlparse(self.path)
        parts = url.path.strip("/").split("/")
        q = dict(urllib.parse.parse_qsl(url.query))
        if self.headers.get("X-Notion-Local") != "1":  # blocks cross-site form posts
            return self.reply({"error": "forbidden"}, 403)
        try:
            with LOCK:
                STORE.refresh()
                if parts[:2] == ["api", "pages"] and len(parts) == 2 and method == "POST":
                    b = json.loads(self.body() or b"{}")
                    return self.reply(STORE.create(b.get("parent"), b.get("title", ""), b.get("link", True)))
                if parts[:2] == ["api", "pages"] and len(parts) == 3:
                    pid = parts[2]
                    if pid not in STORE.items:
                        return self.reply({"error": "not found"}, 404)
                    if method == "PUT":
                        return self.reply(STORE.update(pid, json.loads(self.body())))
                    if method == "DELETE":
                        return self.reply({"removed": STORE.delete(pid)})
                if parts == ["api", "upload"] and method == "POST":
                    pid = re.sub(r"[^\w-]", "", q.get("page", "misc")) or "misc"
                    name = re.sub(r"[^\w.\- ]", "_", q.get("name", "file"))[-80:] or "file"
                    d = FILES / pid
                    d.mkdir(parents=True, exist_ok=True)
                    dest, n = d / name, 1
                    while dest.exists():
                        stem, ext = os.path.splitext(name)
                        dest, n = d / f"{stem}-{n}{ext}", n + 1
                    dest.write_bytes(self.body())
                    rel = dest.relative_to(DATA).as_posix()
                    return self.reply({"url": "/data/" + "/".join(urllib.parse.quote(p) for p in rel.split("/"))})
            return self.reply({"error": "unknown endpoint"}, 404)
        except KeyError:
            return self.reply({"error": "not found"}, 404)
        except Exception as e:
            return self.reply({"error": str(e)}, 500)

    def do_POST(self):
        self.api("POST")

    def do_PUT(self):
        self.api("PUT")

    def do_DELETE(self):
        self.api("DELETE")


class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # Skip HTTPServer's reverse-DNS lookup (socket.getfqdn), which can hang on some Macs.
        http.server.socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "localhost", self.server_address[1]


def main():
    global STORE
    print(f"Notes folder: {DATA}")
    if not (DATA / "index.json").exists():
        print("No notes yet - starting with an empty workspace.")
    STORE = Store()
    handler = functools.partial(Handler, directory=str(ROOT))
    try:
        server = Server(("127.0.0.1", PORT), handler)
    except OSError:
        print(f"Port {PORT} is busy - the viewer is probably already running.")
        webbrowser.open(f"http://localhost:{PORT}/")
        return
    url = f"http://localhost:{PORT}/"
    print(f"Ownote running at {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
