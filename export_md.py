#!/usr/bin/env python3
"""Export Snugnote pages to Markdown files.

Usage: python3 export_md.py [output-directory]
"""
import json
import re
import sys
from pathlib import Path

from backup import DATA, PAGES, page_title


def _rich_text(rich):
    parts = []
    for item in rich or []:
        value = item.get("plain_text") or item.get("text", {}).get("content", "")
        ann = item.get("annotations") or {}
        if ann.get("code"):
            value = "`" + value.replace("`", "\\`") + "`"
        else:
            value = value.replace("\\", "\\\\").replace("*", "\\*").replace("_", "\\_").replace("~", "\\~")
            if ann.get("bold"):
                value = "**" + value + "**"
            if ann.get("italic"):
                value = "*" + value + "*"
            if ann.get("strikethrough"):
                value = "~~" + value + "~~"
            if ann.get("underline"):
                value = "<u>" + value + "</u>"
        href = item.get("href") or ((item.get("text") or {}).get("link") or {}).get("url")
        if href:
            value = "[" + value + "](" + href.replace(" ", "%20").replace(")", "%29") + ")"
        parts.append(value)
    return "".join(parts)


def _block_lines(blocks, indent=0):
    lines = []
    pad = "  " * indent
    for block in blocks or []:
        kind = block.get("type", "")
        value = block.get(kind) or {}
        text = _rich_text(value.get("rich_text"))
        children = block.get("children") or []
        if kind in ("heading_1", "heading_2", "heading_3"):
            lines += ["#" * int(kind[-1]) + " " + text, ""]
        elif kind == "paragraph":
            if text:
                lines.append(pad + text)
            if children:
                lines.extend(_block_lines(children, indent))
            lines.append("")
        elif kind in ("bulleted_list_item", "numbered_list_item", "to_do"):
            marker = "- "
            if kind == "numbered_list_item":
                marker = "1. "
            elif kind == "to_do":
                marker = "- [x] " if value.get("checked") else "- [ ] "
            lines.append(pad + marker + text)
            if children:
                lines.extend(_block_lines(children, indent + 1))
        elif kind == "quote":
            lines += [pad + "> " + text, ""]
            if children:
                lines.extend(pad + "> " + line if line else ">" for line in _block_lines(children))
        elif kind == "callout":
            icon = (value.get("icon") or {}).get("emoji", "💡")
            lines += [pad + "> " + icon + (" " + text if text else ""), ""]
            if children:
                lines.extend(pad + "> " + line if line else ">" for line in _block_lines(children))
        elif kind == "toggle":
            lines += [pad + "<details>", pad + "<summary>" + text + "</summary>", ""]
            lines.extend(_block_lines(children, indent))
            lines += [pad + "</details>", ""]
        elif kind == "code":
            content = "".join(item.get("plain_text") or item.get("text", {}).get("content", "")
                              for item in value.get("rich_text", []))
            ticks = max((len(m.group(0)) for m in re.finditer(r"`+", content)), default=0) + 1
            fence = "`" * max(3, ticks)
            language = value.get("language", "")
            if language == "plain text":
                language = ""
            lines += [pad + fence + language, content, pad + fence, ""]
        elif kind == "equation":
            lines += ["$$", value.get("expression", ""), "$$", ""]
        elif kind == "divider":
            lines += ["---", ""]
        elif kind in ("image", "file", "pdf", "video", "audio"):
            file = value.get("file") or value.get("external") or {}
            url = file.get("url", "")
            caption = _rich_text(value.get("caption")) or value.get("name") or kind
            lines += [(f"![{caption}]({url})" if kind == "image" else f"[{caption}]({url})"), ""]
        elif kind in ("bookmark", "embed", "link_preview"):
            url = value.get("url", "")
            lines += [f"[{text or url}]({url})", ""]
        elif kind in ("child_page", "child_database"):
            lines += [f"[{value.get('title', 'Untitled')}]", ""]
        elif kind == "link_to_page":
            lines += ["[Linked page]", ""]
        elif kind == "table":
            rows = [row.get("table_row", {}).get("cells", []) for row in children]
            if rows:
                width = max(len(row) for row in rows)
                def render_row(row):
                    cells = [_rich_text(cell).replace("|", "\\|") for cell in row]
                    cells += [""] * (width - len(cells))
                    return "| " + " | ".join(cells) + " |"
                lines.append(render_row(rows[0]))
                lines.append("| " + " | ".join("---" for _ in range(width)) + " |")
                lines.extend(render_row(row) for row in rows[1:])
                lines.append("")
        elif kind in ("column_list", "column", "synced_block"):
            lines.extend(_block_lines(children, indent))
        elif text:
            # Keep text from unfamiliar block types instead of silently dropping it.
            lines += [pad + text, ""]
    while lines and not lines[-1]:
        lines.pop()
    return lines


def page_markdown(document):
    title = page_title(document.get("page", {})) or "Untitled"
    content = "\n".join(_block_lines(document.get("blocks", [])))
    return f"# {title}\n\n{content}\n"


def _safe_name(name):
    # Exclude path separators and characters Windows disallows in filenames.
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name or "Untitled"


def export_workspace(destination):
    index = DATA / "index.json"
    items = json.loads(index.read_text(encoding="utf-8")).get("items", []) if index.exists() else []
    pages = [item for item in items if item.get("kind") == "page"]
    by_id = {item["id"]: item for item in pages}
    output_paths = {}
    used_names = set()

    def relative_path(item, seen=None):
        pid = item["id"]
        if pid in output_paths:
            return output_paths[pid]
        seen = set() if seen is None else seen
        if pid in seen:  # malformed parent cycle: treat this page as a root.
            parent = None
        else:
            seen.add(pid)
            parent = by_id.get(item.get("parent"))
        parent_dir = relative_path(parent, seen).with_suffix("") if parent else Path()
        stem = _safe_name(item.get("title") or "Untitled")
        path = parent_dir / (stem + ".md")
        key = str(path).casefold()
        if key in used_names:
            path = parent_dir / (stem + " (" + pid[:8] + ").md")
            key = str(path).casefold()
        used_names.add(key)
        output_paths[pid] = path
        return path

    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for item in pages:
        source = PAGES / (item["id"] + ".json")
        if not source.is_file():
            continue
        target = destination / relative_path(item)
        target.parent.mkdir(parents=True, exist_ok=True)
        document = json.loads(source.read_text(encoding="utf-8"))
        target.write_text(page_markdown(document), encoding="utf-8")
        count += 1
    return count


if __name__ == "__main__":
    output = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path("markdown-export")
    output = output.resolve()
    print(f"Exported {export_workspace(output)} pages to {output}")
