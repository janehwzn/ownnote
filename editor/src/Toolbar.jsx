import React, { useState } from "react";

// A fixed formatting toolbar (like Google Docs) on top of BlockNote's own selection toolbar.

const BLOCK_TYPES = [
  ["paragraph", "Text"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["bulletListItem", "Bulleted list"],
  ["numberedListItem", "Numbered list"],
  ["checkListItem", "To-do list"],
  ["toggleListItem", "Toggle list"],
  ["quote", "Quote"],
  ["codeBlock", "Code"],
];

const SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "30px", "36px", "48px"];
const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const INLINE_TYPES = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout"]);

function selectedBlocks(editor) {
  return editor.getSelection()?.blocks || [editor.getTextCursorPosition().block];
}

function typeKey(block) {
  if (!block) return "";
  if (block.type === "heading") return "h" + block.props.level;
  return block.type;
}

// Buttons use onMouseDown + preventDefault so the editor keeps its selection.
function Btn({ title, active, disabled, onClick, children, className = "" }) {
  return (
    <button
      type="button" title={title} disabled={disabled}
      className={"tb-btn " + className + (active ? " on" : "")}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick(e); }}
    >{children}</button>
  );
}

function ColorMenu({ editor, onClose }) {
  const pick = (kind, c) => {
    if (c === "default") editor.removeStyles({ [kind]: editor.getActiveStyles()[kind] || c });
    else editor.addStyles({ [kind]: c });
    onClose();
  };
  return (
    <div className="tb-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="tb-menu-label">Text color</div>
      <div className="tb-swatches">
        {COLORS.map((c) => <button key={c} title={c} className={"tb-swatch c-" + c} onMouseDown={(e) => { e.preventDefault(); pick("textColor", c); }}>A</button>)}
      </div>
      <div className="tb-menu-label">Highlight</div>
      <div className="tb-swatches">
        {COLORS.map((c) => <button key={c} title={c} className={"tb-swatch bg-" + c} onMouseDown={(e) => { e.preventDefault(); pick("backgroundColor", c); }}>A</button>)}
      </div>
    </div>
  );
}

export function Toolbar({ editor }) {
  const [, setTick] = useState(0);
  const [menu, setMenu] = useState(null);
  React.useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const u1 = editor.onSelectionChange(bump);
    const u2 = editor.onChange(bump);
    return () => { u1?.(); u2?.(); };
  }, [editor]);

  let styles = {}, block = null;
  try { styles = editor.getActiveStyles(); block = editor.getTextCursorPosition().block; } catch { /* not ready */ }
  const cur = typeKey(block);

  const setType = (key) => {
    for (const b of selectedBlocks(editor)) {
      if (!INLINE_TYPES.has(b.type) && b.type !== "codeBlock") continue;
      if (key.startsWith("h")) editor.updateBlock(b, { type: "heading", props: { level: Number(key[1]) } });
      else editor.updateBlock(b, { type: key, props: {} });
    }
    editor.focus();
  };

  const setSize = (size) => {
    if (!size) editor.removeStyles({ fontSize: styles.fontSize || "16px" });
    else editor.addStyles({ fontSize: size });
    editor.focus();
  };

  const align = (a) => {
    for (const b of selectedBlocks(editor)) if ("textAlignment" in (b.props || {})) editor.updateBlock(b, { props: { textAlignment: a } });
  };

  const toggle = (s) => editor.toggleStyles({ [s]: true });
  const quickType = (t) => setType(cur === t ? "paragraph" : t);

  return (
    <div className="nl-toolbar" onMouseLeave={() => setMenu(null)}>
      <Btn title="Undo (⌘Z)" onClick={() => editor.undo()}>↶</Btn>
      <Btn title="Redo (⌘⇧Z)" onClick={() => editor.redo()}>↷</Btn>
      <span className="tb-sep" />
      <select className="tb-select" title="Turn into" value={BLOCK_TYPES.some(([k]) => k === cur) ? cur : ""} onChange={(e) => setType(e.target.value)}>
        {!BLOCK_TYPES.some(([k]) => k === cur) && <option value="">—</option>}
        {BLOCK_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <select className="tb-select" title="Font size" value={styles.fontSize || ""} onChange={(e) => setSize(e.target.value)}>
        <option value="">Size</option>
        {SIZES.map((s) => <option key={s} value={s}>{parseInt(s)}</option>)}
        {styles.fontSize && !SIZES.includes(styles.fontSize) && <option value={styles.fontSize}>{styles.fontSize}</option>}
      </select>
      <span className="tb-sep" />
      <Btn title="Bold (⌘B)" active={styles.bold} onClick={() => toggle("bold")}><b>B</b></Btn>
      <Btn title="Italic (⌘I)" active={styles.italic} onClick={() => toggle("italic")}><i>I</i></Btn>
      <Btn title="Underline (⌘U)" active={styles.underline} onClick={() => toggle("underline")}><u>U</u></Btn>
      <Btn title="Strikethrough (⌘⇧X)" active={styles.strike} onClick={() => toggle("strike")}><s>S</s></Btn>
      <Btn title="Inline code (⌘E)" active={styles.code} onClick={() => toggle("code")}><code>{"</>"}</code></Btn>
      <span className="tb-wrap">
        <Btn title="Text color / highlight" active={menu === "color"} onClick={() => setMenu(menu === "color" ? null : "color")}>
          <span className={"tb-color c-" + (styles.textColor || "default") + " bg-" + (styles.backgroundColor || "none")}>A</span>▾
        </Btn>
        {menu === "color" && <ColorMenu editor={editor} onClose={() => setMenu(null)} />}
      </span>
      <Btn title="Link" active={!!editor.getSelectedLinkUrl?.()} onClick={() => {
        const url = prompt("Link URL:", editor.getSelectedLinkUrl?.() || "https://");
        if (url) editor.createLink(url);
      }}>🔗</Btn>
      <span className="tb-sep" />
      <Btn title="Bulleted list" active={cur === "bulletListItem"} onClick={() => quickType("bulletListItem")}>•≡</Btn>
      <Btn title="Numbered list" active={cur === "numberedListItem"} onClick={() => quickType("numberedListItem")}>1≡</Btn>
      <Btn title="To-do list" active={cur === "checkListItem"} onClick={() => quickType("checkListItem")}>☑</Btn>
      <Btn title="Outdent (⇧Tab)" disabled={!safe(() => editor.canUnnestBlock())} onClick={() => editor.unnestBlock()}>⇤</Btn>
      <Btn title="Indent (Tab)" disabled={!safe(() => editor.canNestBlock())} onClick={() => editor.nestBlock()}>⇥</Btn>
      <span className="tb-sep" />
      {["left", "center", "right"].map((a) => (
        <Btn key={a} title={"Align " + a} active={block?.props?.textAlignment === a && a !== "left"} onClick={() => align(a)}>
          <span className={"tb-align tb-align-" + a}><i /><i /><i /></span>
        </Btn>
      ))}
    </div>
  );
}

function safe(f) {
  try { return f(); } catch { return false; }
}
