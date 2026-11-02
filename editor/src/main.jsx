import React from "react";
import { createRoot } from "react-dom/client";
import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { loadFrimousseData, searchEmojis } from "@blocknote/core/emoji-data";
import { createReactBlockSpec, createReactStyleSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { blocksToNotion, notionToBlocks } from "./convert.js";
import { Toolbar } from "./Toolbar.jsx";

const NL = () => window.NL || {};

// ---------- custom blocks ----------

const CALLOUT_COLORS = ["gray_background", "brown_background", "orange_background", "yellow_background", "green_background", "blue_background", "purple_background", "pink_background", "red_background"];

const Callout = createReactBlockSpec(
  { type: "callout", propSchema: { emoji: { default: "💡" }, color: { default: "gray_background" } }, content: "inline" },
  {
    render: ({ block, editor, contentRef }) => (
      <div className={"nl-callout bg-" + block.props.color.replace("_background", "")}>
        <span
          className="nl-callout-emoji" contentEditable={false} title="Click to change icon · Shift+click to change color"
          onClick={(e) => {
            if (e.shiftKey) {
              const i = CALLOUT_COLORS.indexOf(block.props.color);
              editor.updateBlock(block, { props: { color: CALLOUT_COLORS[(i + 1) % CALLOUT_COLORS.length] } });
            } else {
              NL().pickEmoji?.(e.currentTarget, (emoji) => emoji && editor.updateBlock(block, { props: { emoji } }));
            }
          }}
        >{block.props.emoji}</span>
        <div className="nl-callout-text" ref={contentRef} />
      </div>
    ),
  },
);

const Subpage = createReactBlockSpec(
  { type: "subpage", propSchema: { pageId: { default: "" }, title: { default: "" } }, content: "none" },
  {
    render: ({ block }) => {
      const it = NL().items?.[NL().findId?.(block.props.pageId)];
      const icon = it?.icon ? NL().iconHTML(it.icon) : "📄";
      return (
        <a className="subpage nl-subpage" href={"#/" + block.props.pageId} contentEditable={false}>
          <span dangerouslySetInnerHTML={{ __html: icon }} />
          <span className="label">{it?.title || block.props.title || "Untitled"}</span>
        </a>
      );
    },
  },
);

const NotionRaw = createReactBlockSpec(
  { type: "notionRaw", propSchema: { json: { default: "{}" } }, content: "none" },
  {
    render: ({ block }) => {
      let html = "";
      try { html = NL().renderBlocks([JSON.parse(block.props.json)]); } catch { html = "<em>(block)</em>"; }
      return <div className="nl-raw" contentEditable={false} title="This block can be viewed but not edited here" dangerouslySetInnerHTML={{ __html: html }} />;
    },
  },
);

const FontSize = createReactStyleSpec(
  { type: "fontSize", propSchema: "string" },
  { render: ({ value, contentRef }) => <span style={{ fontSize: value }} ref={contentRef} /> },
);

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: Callout(), subpage: Subpage(), notionRaw: NotionRaw() },
  styleSpecs: { ...defaultStyleSpecs, fontSize: FontSize },
});

// ---------- editor ----------

function Editor({ initial, opts, handle }) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: initial.length ? initial : undefined,
    uploadFile: opts.uploadFile,
  });
  handle.editor = editor;

  const slashItems = (q) => {
    const extra = [
      {
        title: "Page", subtext: "Embed a sub-page inside this page", aliases: ["page", "subpage", "new page"], group: "Basic blocks",
        icon: <span style={{ fontSize: 16 }}>📄</span>,
        onItemClick: async () => {
          const page = await opts.createSubpage();
          if (!page) return;
          insertOrUpdateBlockForSlashMenu(editor, { type: "subpage", props: { pageId: page.id, title: "" } });
          await handle.flush();
          location.hash = "#/" + page.id;
        },
      },
      {
        title: "Callout", subtext: "Make writing stand out", aliases: ["callout", "note", "tip"], group: "Basic blocks",
        icon: <span style={{ fontSize: 16 }}>💡</span>,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
      },
    ];
    const items = [...getDefaultReactSlashMenuItems(editor)];
    const lastBasic = items.map((i) => i.group).lastIndexOf("Basic blocks");
    items.splice(lastBasic < 0 ? items.length : lastBasic + 1, 0, ...extra);
    return filterSuggestionItems(items, q);
  };

  return (
    <>
    <Toolbar editor={editor} />
    <BlockNoteView
      editor={editor}
      theme={opts.theme}
      slashMenu={false}
      onChange={() => handle.changed()}
    >
      <SuggestionMenuController triggerCharacter="/" getItems={async (q) => slashItems(q)} />
    </BlockNoteView>
    </>
  );
}

function mount(el, notionBlocks, opts) {
  const handle = {
    editor: null,
    timer: null,
    dirty: false,
    changed() {
      handle.dirty = true;
      opts.onStatus?.("unsaved");
      clearTimeout(handle.timer);
      handle.timer = setTimeout(() => handle.flush(), 700);
    },
    async flush() {
      clearTimeout(handle.timer);
      if (!handle.dirty || !handle.editor) return;
      handle.dirty = false;
      opts.onStatus?.("saving");
      try {
        await opts.save(blocksToNotion(handle.editor.document));
        opts.onStatus?.(handle.dirty ? "unsaved" : "saved");
      } catch (e) {
        handle.dirty = true;
        opts.onStatus?.("error", e);
      }
    },
    focusStart() {
      const ed = handle.editor;
      const first = ed?.document[0];
      if (first) { ed.setTextCursorPosition(first, "start"); ed.focus(); }
    },
    insertSubpage(page) {
      const ed = handle.editor;
      const doc = ed.document;
      ed.insertBlocks([{ type: "subpage", props: { pageId: page.id, title: "" } }], doc[doc.length - 1], "after");
    },
    destroy() {
      clearTimeout(handle.timer);
      root.unmount();
    },
  };
  const root = createRoot(el);
  root.render(<Editor initial={notionToBlocks(notionBlocks)} opts={opts} handle={handle} />);
  return handle;
}

let emojiData = null;
async function emojis(query) {
  emojiData ||= await loadFrimousseData("en");
  return query ? searchEmojis(emojiData.emojis, query) : emojiData.emojis;
}

window.NotionEditor = { mount, emojis, notionToBlocks, blocksToNotion };
