<div align="center">

# 📝 Ownote

### Your own Notion-style workspace. Free forever, offline, and on your computer.

**Import your whole Notion workspace in one go and keep using it without a subscription.**<br>
No account. No cloud. No lock-in. Just a folder of your notes.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Python 3.8+](https://img.shields.io/badge/python-3.8%2B-blue.svg)
![No account needed](https://img.shields.io/badge/account-not%20needed-orange.svg)
![Works offline](https://img.shields.io/badge/works-offline-purple.svg)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

[Quick start](#-quick-start) · [Import from Notion](#-bring-your-notion-workspace) · [Features](#-features) · [FAQ](#-faq)

<br>

<img src="docs/screenshots/hero.png" alt="Ownote editing a travel plan page with a table, to-dos and a toggle" width="900">

</div>

---

## 💡 Why Ownote?

Notion is wonderful, but if you mostly use it as a **personal notebook**, you end up paying a monthly
subscription to read your own notes, on someone else's server, behind a login.

**Ownote is the personal-notebook part of Notion, running on your own computer:**

- 🆓 **Free forever.** No plans, no seat limits, no upgrade prompts.
- 🔒 **Private by default.** Your notes never leave your machine. No telemetry, no account.
- ✈️ **Works offline.** On a plane, in a cabin, or when the Wi-Fi is down.
- 📦 **Your data is just files.** Back it up with Time Machine, Dropbox, a USB stick or git.
- 🚚 **Bring your Notion history.** Import every page, subpage, database and image in one go.

## ✨ Features

| | |
|---|---|
| ✍️ **Notion-style block editor** | `/` menu, Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, `---`), drag-and-drop blocks, Tab to indent |
| 🧱 **All the everyday blocks** | Headings, bullets, numbered and to-do lists, toggles, quotes, callouts, code, tables, images, dividers |
| 🎨 **Rich formatting** | Bold, italic, underline, strikethrough, inline code, text and highlight colors, **font sizes**, alignment, links |
| 🗂️ **Nested pages** | Unlimited subpages, a sidebar tree, breadcrumbs, emoji icons |
| 🔍 **Instant full-text search** | Search every page title and paragraph with ⌘K, with highlighted matches |
| 📊 **Databases** | Imported Notion databases show as sortable, filterable tables |
| 🖋️ **Page styles** | Default, Serif or Mono fonts, small text, full width (like Notion's ••• menu) |
| 🌗 **Light and dark mode** | Follows your system setting |
| 💾 **Autosave** | Changes are written to disk within a second. Deleted pages go to a trash folder, not into the void. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/slash.png" alt="Slash command menu"><p align="center"><b>Type <code>/</code> for any block</b></p></td>
    <td width="50%"><img src="docs/screenshots/database.png" alt="Database table view"><p align="center"><b>Your Notion databases, imported</b></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/search.png" alt="Full-text search"><p align="center"><b>Instant search across everything</b></p></td>
    <td width="50%"><img src="docs/screenshots/dark.png" alt="Dark mode"><p align="center"><b>Dark mode included</b></p></td>
  </tr>
</table>

## 🚀 Quick start

You need **Python 3.8+**, which comes with macOS. Nothing else to install.

```bash
git clone https://github.com/janehwzn/ownote.git
cd ownote
python3 serve.py
```

Your browser opens at **http://localhost:8765**. Click **＋ New page** and start writing.

> **On a Mac?** Just double-click **`Open Ownote.command`** in Finder.

## 🚚 Bring your Notion workspace

Ownote imports through Notion's official API, which is free on every Notion plan, including Free.
It takes about 5 minutes to set up:

1. Go to **[notion.so/profile/integrations](https://www.notion.so/profile/integrations)** → **New integration**.
   Choose type **Internal**, give it **Read content** only, and save.
2. On the integration's **Access** tab, select all your top-level pages. Subpages come along automatically.
3. Copy the **Internal Integration Secret** (starts with `ntn_`).
4. Run the importer and paste the secret when asked:

```bash
python3 backup.py            # or double-click "Import from Notion.command" on a Mac
```

Everything lands in `data/`: pages, subpages, databases, images and attachments. Notion's API allows about
3 requests per second, so a workspace with ~600 pages takes around 15–20 minutes. If the import is
interrupted, run it again and it picks up where it stopped.

**Re-importing is safe.** It only fetches pages that changed in Notion. It **never overwrites pages you've
edited in Ownote**, and it never brings back pages you deleted.

## ⌨️ Keyboard shortcuts

| Shortcut | Action | | Shortcut | Action |
|---|---|---|---|---|
| `/` | Block menu | | `⌘B` `⌘I` `⌘U` | Bold, italic, underline |
| `#` `##` `###` + space | Headings | | `⌘Z` / `⌘⇧Z` | Undo / redo |
| `-` + space | Bullet list | | `Tab` / `⇧Tab` | Indent / outdent |
| `1.` + space | Numbered list | | `⌘K` | Search |
| `[]` + space | To-do | | `⌘S` | Save now (it autosaves anyway) |
| `>` + space | Quote | | `Enter` in the title | Jump into the page |
| `---` | Divider | | ```` ``` ```` + space | Code block |

## 🗃️ Where your data lives

```
ownote/
├── data/                  ← all your notes (back this folder up!)
│   ├── pages/<id>.json    ← one file per page
│   ├── databases/         ← imported Notion databases
│   ├── files/             ← images and attachments
│   ├── trash/             ← deleted pages, recoverable
│   └── index.json         ← sidebar tree and titles
├── serve.py               ← the local app server (Python standard library only)
├── backup.py              ← the Notion importer (Python standard library only)
├── viewer/                ← the web app
└── editor/                ← editor source (BlockNote + React)
```

### Keep your notes in a separate folder (recommended)

By default notes go in `ownote/data/`. To keep them apart from the app (for example in iCloud Drive or a
backup folder), put the folder path in a file called `data-location.txt` next to `serve.py`:

```bash
echo "$HOME/Documents/My Notes/data" > data-location.txt
```

You can also set the `OWNOTE_DATA` environment variable. Your Notion token is then kept next to that folder
(`My Notes/token.txt`), never inside the app folder, and never served by the app.

Pages are stored in **Notion's own block JSON format**, so your data stays readable, scriptable, and
easy to convert to anything else later.

## ❓ FAQ

<details>
<summary><b>Is this affiliated with Notion?</b></summary>
<br>
No. Ownote is an independent open-source project. It uses Notion's public API only to import your own content.
</details>

<details>
<summary><b>Does anything get sent to the internet?</b></summary>
<br>
No. The app runs entirely on <code>localhost</code>. The only network traffic is the optional import, which
talks to <code>api.notion.com</code> using a token you created yourself.
</details>

<details>
<summary><b>Can I cancel my Notion subscription after importing?</b></summary>
<br>
Yes. That's the main reason Ownote exists. Before you cancel, run the importer one last time, open Ownote and
check your important pages. As a second copy, also use Notion's built-in
<i>Settings → Export all workspace content → Markdown & CSV</i>.
</details>

<details>
<summary><b>Can I use it on several computers?</b></summary>
<br>
Ownote is a single-user, single-device app. You can keep the folder in iCloud Drive, Dropbox or a git repo to
move it between machines. Just don't edit on two computers at the same time.
</details>

<details>
<summary><b>Does it work on Windows or Linux?</b></summary>
<br>
It's developed and tested on macOS. The app is plain Python plus a web page, so <code>python3 serve.py</code>
should work anywhere Python runs. The <code>.command</code> launchers are Mac-only. Reports and PRs for other
platforms are welcome.
</details>

<details>
<summary><b>What doesn't work yet?</b></summary>
<br>

- **Databases are read-only.** You can view, sort and filter them and edit each row's page, but you can't add rows or change columns yet.
- **Some blocks are read-only.** Column layouts, embeds and linked database views display but can't be edited.
- **No real-time sync.** It's single-user and single-device by design.
- **Notion-only blocks.** A few blocks Notion doesn't expose through its API (some embeds, AI blocks) show as a placeholder.
</details>

## 🗺️ Roadmap

- [x] Import an entire Notion workspace (pages, databases, images)
- [x] Block editor with slash menu, Markdown shortcuts and a formatting toolbar
- [x] Subpages, icons, page styles, full-text search, dark mode
- [ ] Editable databases (add rows, edit properties, board view)
- [ ] Export to Markdown / HTML
- [ ] Page covers, column layouts, @-mentions
- [ ] Packaged desktop app (no terminal needed)

Want one of these sooner? [Open an issue](../../issues) or send a PR.

## 🤝 Contributing

Contributions are very welcome. To work on the editor:

```bash
cd editor
npm install
npm run build      # outputs to viewer/editor/
```

The server and importer are dependency-free Python. Please keep it that way, so anyone can run Ownote with just `python3`.

## 🙏 Built with

- [BlockNote](https://www.blocknotejs.org): the open-source block editor that powers the writing experience
- [React](https://react.dev) and [Mantine](https://mantine.dev)
- The [Notion API](https://developers.notion.com), for importing

## 📄 License

[MIT](LICENSE). Free for personal and commercial use.

<sub>Notion is a trademark of Notion Labs, Inc. Ownote is not affiliated with, endorsed by, or sponsored by Notion Labs.</sub>

<div align="center">
<br>

**If Ownote saved you a subscription, consider giving it a ⭐. It helps others find it.**

</div>
