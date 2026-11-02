"use strict";
// "Import from Notion" dialog: upload a Notion export .zip, or connect with an integration secret.

(function () {

  function openImport() {
    document.querySelector(".modal-back")?.remove();
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `
      <div class="modal" role="dialog" aria-label="Import from Notion">
        <button class="ghost modal-x" title="Close">✕</button>
        <h2>Import from Notion</h2>
        <p class="muted">Bring your pages, subpages, databases and images into OwnNote. Pick whichever is easier for you.</p>
        <div class="choices">
          <section class="choice">
            <div class="choice-head"><span class="choice-icon">📦</span><div><b>Upload an export file</b><div class="badge">Easiest · no setup</div></div></div>
            <ol>
              <li>In Notion, open <b>Settings → Export all workspace content</b>. For a single page, use <b>•••</b> → <b>Export</b>.</li>
              <li>Choose <b>Markdown &amp; CSV</b> and turn on <b>Create folders for subpages</b> and <b>Include private pages</b> (or <b>Include subpages</b>). Notion emails you a download link.</li>
              <li>Upload the <b>.zip</b> as is, without unzipping it.</li>
            </ol>
            <label class="drop" tabindex="0">
              <input type="file" accept=".zip,application/zip" hidden>
              <span class="drop-big">⬆</span>
              <span><b>Drop the .zip here</b> or click to choose</span>
            </label>
            <p class="fine">Brings text, headings, lists, to-dos, tables, code, images, subpages and databases.
              Notion's export leaves out colors and some block styles. Use the option on the right to keep them.</p>
          </section>
          <section class="choice">
            <div class="choice-head"><span class="choice-icon">🔗</span><div><b>Connect your Notion account</b><div class="badge">Best quality · can re-sync</div></div></div>
            <ol>
              <li>Open <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener">notion.so/profile/integrations ↗</a> → <b>New integration</b>. Type: <b>Internal</b>, capabilities: <b>Read content</b> only.</li>
              <li>On its <b>Access</b> tab, select all your top-level pages.</li>
              <li>Copy the <b>Internal Integration Secret</b> and paste it here:</li>
            </ol>
            <input class="secret" type="password" placeholder="ntn_…" autocomplete="off" spellcheck="false">
            <label class="remember"><input type="checkbox" checked> Remember it on this computer for re-syncing</label>
            <div class="row-btns">
              <button class="btn primary go-notion">Import</button>
              <button class="btn resync" hidden>Sync again with saved secret</button>
            </div>
            <p class="fine">Keeps colors, callouts, toggles and icons. Re-syncing only fetches pages that changed,
              and it never overwrites pages you've edited in OwnNote. The secret is read-only and stays on this computer.</p>
          </section>
        </div>
        <div class="import-progress" hidden>
          <div class="bar"><i></i></div>
          <div class="msg"></div>
          <pre class="log"></pre>
        </div>
        <p class="err" hidden></p>
      </div>`;
    document.body.appendChild(back);
    const m = back.querySelector(".modal");
    const close = () => back.remove();
    back.querySelector(".modal-x").onclick = close;
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });

    const err = (msg) => { const p = m.querySelector(".err"); p.textContent = msg || ""; p.hidden = !msg; };

    // zip upload
    const drop = m.querySelector(".drop");
    const input = drop.querySelector("input");
    const upload = async (file) => {
      if (!file) return;
      err("");
      if (!/\.zip$/i.test(file.name)) return err("Please choose the .zip file that Notion gave you.");
      showProgress(`Uploading ${file.name}…`);
      const r = await fetch("/api/import/zip", { method: "POST", headers: { "X-Notion-Local": "1" }, body: file });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { hideProgress(); return err(data.error || "Upload failed."); }
      poll();
    };
    input.onchange = () => upload(input.files[0]);
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => upload(e.dataTransfer.files[0]));

    // API import
    const startNotion = async (token) => {
      err("");
      try {
        await api("POST", "/api/import/notion", { token, remember: m.querySelector(".remember input").checked });
      } catch (e) {
        return err(e.message);
      }
      showProgress("Connecting to Notion…");
      poll();
    };
    m.querySelector(".go-notion").onclick = () => startNotion(m.querySelector(".secret").value.trim());
    m.querySelector(".secret").addEventListener("keydown", (e) => { if (e.key === "Enter") m.querySelector(".go-notion").click(); });
    m.querySelector(".resync").onclick = () => startNotion("");

    function showProgress(msg) {
      m.querySelector(".choices").hidden = true;
      m.querySelector(".import-progress").hidden = false;
      m.querySelector(".msg").textContent = msg;
    }
    function hideProgress() {
      m.querySelector(".choices").hidden = false;
      m.querySelector(".import-progress").hidden = true;
    }

    async function poll() {
      let s;
      try { s = await api("GET", "/api/import/status"); } catch { return setTimeout(poll, 1500); }
      const bar = m.querySelector(".bar i");
      bar.style.width = s.total ? Math.round((100 * s.done) / s.total) + "%" : "8%";
      m.querySelector(".msg").textContent = s.total ? `${s.done} of ${s.total} · ${s.message || ""}` : s.message || "Working…";
      m.querySelector(".log").textContent = (s.log || []).join("\n");
      if (s.running) return setTimeout(poll, 700);
      if (s.error) {
        hideProgress();
        return err(s.error);
      }
      const r = s.result || {};
      bar.style.width = "100%";
      m.querySelector(".import-progress").innerHTML = `
        <div class="done-big">✅</div>
        <p><b>Imported ${plural(r.pages, "page")}${r.databases ? ` and ${plural(r.databases, "database")}` : ""}.</b></p>
        ${r.skipped_edited ? `<p class="muted">Kept ${plural(r.skipped_edited, "page")} you'd edited in OwnNote as they are.</p>` : ""}
        ${r.skipped_existing ? `<p class="muted">Kept ${plural(r.skipped_existing, "page")} already imported from your Notion account (that copy has more detail).</p>` : ""}
        <button class="btn primary open-pages">Open my pages</button>
        ${askForStar() ? `<p class="star-ask">If OwnNote saved you a subscription, a
          <a href="https://github.com/janehwzn/ownnote" target="_blank" rel="noopener">⭐ on GitHub</a>
          helps other people find it. Thank you!</p>` : ""}`;
      m.querySelector(".open-pages").onclick = () => location.reload();
    }

    // reflect state: saved secret? import already running?
    api("GET", "/api/import/status").then((s) => {
      m.querySelector(".resync").hidden = !s.has_token;
      if (s.running) { showProgress(s.message || "Working…"); poll(); }
    }).catch(() => {});
  }

  // Ask once, ever: right after a successful import, never as a pop-up.
  function askForStar() {
    try {
      if (localStorage.getItem("ownnote:star-asked")) return false;
      localStorage.setItem("ownnote:star-asked", "1");
      return true;
    } catch {
      return false;
    }
  }

  function plural(n, word) {
    if (n == null) return "your " + word + "s";
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  window.openImport = openImport;
  document.getElementById("import-btn")?.addEventListener("click", openImport);
})();
