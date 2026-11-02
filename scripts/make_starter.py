"""Generate the starter workspace that new users see on first run.

Usage: python3 scripts/make_starter.py starter/data
"""
import json, sys, uuid
from pathlib import Path

DATA = Path(sys.argv[1])
(DATA / "pages").mkdir(parents=True, exist_ok=True)
(DATA / "databases").mkdir(parents=True, exist_ok=True)
T = "2026-10-{:02d}T09:00:00.000Z"


def rt(text, bold=False, italic=False, code=False, color="default", size=None, href=None):
    a = {"bold": bold, "italic": italic, "strikethrough": False, "underline": False, "code": code, "color": color}
    if size:
        a["font_size"] = size
    return {"type": "text", "text": {"content": text, "link": {"url": href} if href else None}, "plain_text": text, "href": href, "annotations": a}


def blk(t, value, children=None):
    b = {"object": "block", "id": str(uuid.uuid4()), "type": t, t: value, "has_children": bool(children)}
    if children:
        b["children"] = children
    return b


def P(*r, color="default"): return blk("paragraph", {"rich_text": list(r), "color": color})
def H(n, text): return blk(f"heading_{n}", {"rich_text": [rt(text)], "color": "default", "is_toggleable": False})
def LI(*r, kids=None): return blk("bulleted_list_item", {"rich_text": list(r), "color": "default"}, kids)
def NUM(*r): return blk("numbered_list_item", {"rich_text": list(r), "color": "default"})
def TODO(text, done=False): return blk("to_do", {"rich_text": [rt(text)], "checked": done, "color": "default"})
def QUOTE(text): return blk("quote", {"rich_text": [rt(text, italic=True)], "color": "default"})
def CALLOUT(emoji, *r, color="blue_background"): return blk("callout", {"rich_text": list(r), "icon": {"type": "emoji", "emoji": emoji}, "color": color})
def TOGGLE(text, kids): return blk("toggle", {"rich_text": [rt(text)], "color": "default"}, kids)
def CODE(text, lang): return blk("code", {"rich_text": [rt(text)], "language": lang, "caption": []})
def DIV(): return blk("divider", {})


def TABLE(rows):
    trs = [blk("table_row", {"cells": [[rt(c)] for c in r]}) for r in rows]
    return blk("table", {"table_width": len(rows[0]), "has_column_header": True, "has_row_header": False}, trs)


pages = {}


def page(title, emoji, parent=None, blocks=(), day=1, props=None, parent_db=None):
    pid = str(uuid.uuid4())
    if parent_db:
        par = {"type": "database_id", "database_id": parent_db}
    elif parent:
        par = {"type": "page_id", "page_id": parent}
    else:
        par = {"type": "workspace", "workspace": True}
    properties = props or {"title": {"id": "title", "type": "title", "title": [rt(title)]}}
    pages[pid] = {"page": {"object": "page", "id": pid, "parent": par, "icon": {"type": "emoji", "emoji": emoji} if emoji else None,
                           "cover": None, "last_edited_time": T.format(day), "properties": properties},
                  "blocks": list(blocks), "text": ""}
    if parent and parent in pages:
        pages[parent]["blocks"].append(blk("child_page", {"title": title}) | {"id": pid})
    return pid


home = page("Welcome to OwnNote", "👋", day=31, blocks=[
    CALLOUT("🏡", rt("This is "), rt("your", bold=True), rt(" workspace. Everything lives in a folder on your computer: no account, no subscription, works offline.")),
    H(2, "Try these"),
    TODO("Type / on an empty line to add a heading, list, quote, table…"),
    TODO("Select some text and use the toolbar above to make it bold, colored or bigger"),
    TODO("Hover a page in the sidebar and click + to add a subpage"),
    TODO("Click this page's icon to change it"),
    TODO("Press ⌘K (Ctrl+K) to search everything"),
    TOGGLE("Coming from Notion?", [
        P(rt("Click "), rt("⬇ Import from Notion", bold=True), rt(" at the bottom of the sidebar. Upload Notion's export .zip, or connect your account. Your pages, subpages, databases and images come along.")),
    ]),
    P(rt("These example pages are yours to keep, edit or delete (••• → Delete page).", color="gray")),
    H(2, "Examples"),
])
proj = page("Projects", "🚀", home, day=28, blocks=[P(rt("Side projects and ideas."))])
page("Garden planner app", "🌱", proj, day=21, blocks=[
    H(2, "Idea"), P(rt("A tiny app that reminds me when to water each plant, based on "), rt("sunlight", bold=True), rt(" and "), rt("season", bold=True), rt(".")),
    H(2, "Stack"), LI(rt("SQLite for local storage")), LI(rt("A cron job for reminders")),
    CODE("def needs_water(plant, today):\n    return (today - plant.last_watered).days >= plant.interval", "python"),
])
trip = page("Trip to Kyoto", "⛩️", home, day=29, blocks=[
    P(rt("Autumn trip · ", color="gray"), rt("Nov 14 – Nov 21", bold=True)),
    H(2, "Itinerary"),
    TABLE([["Day", "Morning", "Afternoon"], ["Fri", "Fushimi Inari (go early!)", "Nishiki Market"],
           ["Sat", "Arashiyama bamboo grove", "Tenryū-ji garden"], ["Sun", "Kiyomizu-dera", "Gion walk + tea ceremony"]]),
    H(2, "Packing"),
    TODO("Passport & JR pass", True), TODO("Rain jacket", True), TODO("Comfortable walking shoes"),
    TOGGLE("Phrases to remember", [LI(rt("すみません — excuse me")), LI(rt("ありがとうございます — thank you")), LI(rt("これをください — this one, please"))]),
    QUOTE("“Travel is the only thing you buy that makes you richer.”"),
])
recipes = page("Recipes", "🍜", home, day=27, blocks=[P(rt("Things I actually cook."))])
page("Pork & chive dumplings", "🥟", recipes, day=26, blocks=[
    CALLOUT("⏱️", rt("Makes ~40 · 1 hour"), color="yellow_background"),
    H(2, "Ingredients"),
    LI(rt("500 g ground pork")), LI(rt("1 bunch garlic chives, finely chopped")), LI(rt("2 tbsp soy sauce, 1 tbsp sesame oil")), LI(rt("40 dumpling wrappers")),
    H(2, "Steps"),
    NUM(rt("Mix the filling in one direction until sticky.")), NUM(rt("Fold: a teaspoon of filling, pinch the edges, pleat.")),
    NUM(rt("Pan-fry 2 min, add 1/3 cup water, cover and steam 6 min.")),
    QUOTE("Grandma's tip: a splash of the water you soaked shrimp in makes everything better."),
])
page("Miso salmon", "🐟", recipes, day=20, blocks=[P(rt("Marinate overnight in white miso, mirin and sake. Broil 8 minutes."))])
journal = page("Journal", "📓", home, day=30, blocks=[])
page("Sunday, Oct 26", "☀️", journal, day=26, blocks=[
    P(rt("Slow morning. Finally finished ", ), rt("The Remains of the Day", italic=True), rt(" — the last chapter got me.")),
    P(rt("Small wins this week:", bold=True)),
    LI(rt("Ran 5k without stopping")), LI(rt("Called mom")), LI(rt("Cleaned out 3 years of old notes ✨")),
])
page("Saturday, Oct 18", "🍂", journal, day=18, blocks=[P(rt("Farmers market, then a long walk by the river."))])

# A database: reading list
db = str(uuid.uuid4())
def book(title, author, status, color, rating, tags, day):
    return page(title, "📖", day=day, parent_db=db, props={
        "Title": {"type": "title", "title": [rt(title)]},
        "Author": {"type": "rich_text", "rich_text": [rt(author)]},
        "Status": {"type": "status", "status": {"name": status, "color": color}},
        "Rating": {"type": "select", "select": {"name": rating, "color": "yellow"} if rating else None},
        "Tags": {"type": "multi_select", "multi_select": [{"name": t, "color": c} for t, c in tags]},
    }, blocks=[P(rt("Notes coming soon."))])
rows = [
    book("The Remains of the Day", "Kazuo Ishiguro", "Finished", "green", "★★★★★", [("fiction", "blue"), ("classic", "purple")], 26),
    book("Ficciones", "Jorge Luis Borges", "Reading", "blue", None, [("fiction", "blue"), ("short stories", "pink")], 24),
    book("Atomic Habits", "James Clear", "Finished", "green", "★★★★", [("self-help", "orange")], 12),
    book("Designing Data-Intensive Applications", "Martin Kleppmann", "Reading", "blue", None, [("tech", "gray")], 22),
    book("Pachinko", "Min Jin Lee", "Want to read", "default", None, [("fiction", "blue")], 5),
]
json.dump({"database": {"object": "database", "id": db, "parent": {"type": "page_id", "page_id": home}, "title": [rt("Reading list")],
                        "icon": {"type": "emoji", "emoji": "📚"}, "cover": None, "description": [], "last_edited_time": T.format(25),
                        "properties": {"Title": {"type": "title"}, "Author": {"type": "rich_text"}, "Status": {"type": "status"},
                                       "Rating": {"type": "select"}, "Tags": {"type": "multi_select"}}},
           "rows": rows}, open(DATA / "databases" / f"{db}.json", "w"), ensure_ascii=False)
pages[home]["blocks"].append(blk("child_database", {"title": "Reading list"}) | {"id": db})

for pid, d in pages.items():
    json.dump(d, open(DATA / "pages" / f"{pid}.json", "w"), ensure_ascii=False)
print(len(pages), "pages; home =", home, "trip =", trip, "db =", db)
