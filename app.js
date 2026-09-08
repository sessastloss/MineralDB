/* MineralDB · 應用邏輯（純前端，無外部依賴） */
"use strict";

const LS_CUSTOM = "mineraldb.custom.v1";
const LS_OVERRIDE = "mineraldb.override.v1";
const LS_HIDDEN = "mineraldb.hidden.v1";

const store = {
  custom: [],      // 用戶自建條目
  override: {},    // id -> 覆蓋內容（含編輯過的內建條目）
  hidden: [],      // 用戶刪除的內建條目 id
};
let editingId = null;   // 當前編輯的條目 id（null = 新增）
let currentQuery = "";
let currentCat = "全部";

/* ── 儲存 ── */
function loadStore() {
  try { store.custom = JSON.parse(localStorage.getItem(LS_CUSTOM)) || []; } catch { store.custom = []; }
  try { store.override = JSON.parse(localStorage.getItem(LS_OVERRIDE)) || {}; } catch { store.override = {}; }
  try { store.hidden = JSON.parse(localStorage.getItem(LS_HIDDEN)) || []; } catch { store.hidden = []; }
}
function saveStore() {
  localStorage.setItem(LS_CUSTOM, JSON.stringify(store.custom));
  localStorage.setItem(LS_OVERRIDE, JSON.stringify(store.override));
  localStorage.setItem(LS_HIDDEN, JSON.stringify(store.hidden));
}

/* ── 條目存取 ── */
function entryToObj(raw) {
  return {
    id: raw.id, en: raw.en || "", zh: raw.zh || "",
    aliases: raw.aliases || [],
    formula: raw.formula || "", category: raw.category || "其他",
    majors: raw.majors || [], traces: raw.traces || [],
    src: raw.src || "", note: raw.note || "",
    custom: !!raw.custom,
  };
}
function getAllEntries() {
  const builtin = BUILTIN.filter(m => !store.hidden.includes(m.id))
    .map(m => entryToObj(Object.assign({}, m, store.override[m.id] || {}, { custom: false })));
  const custom = store.custom.map(m => entryToObj(Object.assign({}, m, store.override[m.id] || {}, { custom: true })));
  return builtin.concat(custom);
}
function getEntry(id) {
  return getAllEntries().find(m => m.id === id) || null;
}

/* ── 工具 ── */
const norm = s => (s || "").toString().toLowerCase().trim();
function formulaHTML(f) {
  return f
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/·/g, " · ")
    .replace(/(\d+(?:\.\d+)?)/g, "<sub>$1</sub>")
    .replace(/₂|₃|₄|₅|₆|₈/g, m => m); // 保留既有下標
}
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, 2200);
}

/* 搜尋匹配：全稱 / 中文 / 簡稱 / 化學式 / 元素 */
function matches(entry, q) {
  const query = norm(q);
  if (!query) return true;
  const fields = [entry.en, entry.zh, entry.formula, entry.category,
    entry.aliases.join(" "), entry.src, entry.note];
  if (fields.some(f => norm(f).includes(query))) return true;
  // 化學式搜尋：去掉下標與空格後比對
  const flat = s => norm(s).replace(/[₀-₉\s]/g, "").replace(/·/g, "");
  if (entry.formula && flat(entry.formula).includes(flat(query))) return true;
  // 元素搜尋：1~3 個字元的精確元素符號或氧化物名
  const elq = query.replace(/₂|₃|₄|₅|₆|₈/g, m => "234568"[m.charCodeAt(0) - 0x2080] || "");
  if (/^[a-z]{1,2}$/.test(elq)) {
    const inMajors = entry.majors.some(r => norm(r[0]).replace(/[0-9]/g, "").startsWith(elq));
    const inTraces = entry.traces.some(r => norm(r[0]).split(/[\s/、,，]/).includes(elq) ||
      norm(r[0]).replace(/[0-9]/g, "").startsWith(elq));
    if (inMajors || inTraces) return true;
  }
  return false;
}

/* ── 渲染 ── */
function renderCategories() {
  const cats = ["全部", ...new Set(getAllEntries().map(m => m.category).sort((a, b) => a.localeCompare(b, "zh")))];
  const bar = document.getElementById("catBar");
  bar.innerHTML = "";
  cats.forEach(c => {
    const chip = document.createElement("button");
    chip.className = "chip" + (c === currentCat ? " active" : "");
    chip.textContent = c;
    chip.onclick = () => { currentCat = c; render(); };
    bar.appendChild(chip);
  });
}

function render() {
  renderCategories();
  const all = getAllEntries();
  const list = all
    .filter(m => (currentCat === "全部" || m.category === currentCat))
    .filter(m => matches(m, currentQuery))
    .sort((a, b) => (a.custom - b.custom) || a.en.localeCompare(b.en));

  document.getElementById("stats").innerHTML =
    `共 <b>${all.length}</b> 個條目（內建 ${all.length - store.custom.length} ＋ 自訂 ${store.custom.length}），目前顯示 <b>${list.length}</b> 個。`;

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  document.getElementById("empty").hidden = list.length > 0;

  list.forEach(m => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="head">
        <span class="en">${esc(m.en)}</span>
        <span class="zh">${esc(m.zh)}</span>
      </div>
      <div class="formula">${formulaHTML(m.formula)}</div>
      <div class="meta">
        <span class="badge cat">${esc(m.category)}</span>
        ${m.aliases.length ? `<span class="badge">${esc(m.aliases.slice(0, 3).join(" / "))}</span>` : ""}
        ${m.custom ? '<span class="badge custom">自訂</span>' : ""}
        ${store.override[m.id] ? '<span class="badge custom">已編輯</span>' : ""}
      </div>`;
    card.onclick = () => openDetail(m.id);
    grid.appendChild(card);
  });
}

/* ── 詳情 ── */
function openDetail(id) {
  const m = getEntry(id);
  if (!m) return;
  const majorMax = Math.max(...m.majors.map(r => parseFloat(r[1])) || [1], 1);
  const rows = (arr, head) => arr.length ? `
    <div class="sec-title">${head}</div>
    <table class="data">
      <tr><th>組分 / 元素</th><th>典型含量</th><th>相對丰度</th></tr>
      ${arr.map(r => `
        <tr>
          <td class="el">${esc(r[0])}</td>
          <td class="val">${esc(r[1])}</td>
          <td class="bar-cell"><div class="bar" style="width:${Math.min(100, Math.max(6, (parseFloat(r[1]) / majorMax) * 100))}%"></div></td>
        </tr>`).join("")}
    </table>` : `<div class="sec-title">${head}</div><p class="note">暫無資料，可在編輯中補充。</p>`;

  document.getElementById("detailBody").innerHTML = `
    <div class="detail-head">
      <h2>${esc(m.en)} <span class="sub">${esc(m.zh)}</span></h2>
      <div class="formula">${formulaHTML(m.formula)}</div>
      <div class="sub">
        <span class="badge cat">${esc(m.category)}</span>
        ${m.custom ? '<span class="badge custom">自訂條目（未公開發表）</span>' : '<span class="badge">內建參考條目</span>'}
        ${m.aliases.length ? `<span class="badge">別名：${esc(m.aliases.join("、"))}</span>` : ""}
      </div>
    </div>
    ${rows(m.majors, "主量元素（氧化物 wt%）")}
    ${rows(m.traces, "微量元素")}
    ${m.note ? `<div class="sec-title">備註</div><p class="note">${esc(m.note)}</p>` : ""}
    ${m.src ? `<div class="sec-title">資料來源</div><p class="src">${esc(m.src)}</p>` : ""}
    <div class="detail-actions">
      <button class="btn primary" onclick="openForm('${m.id}')">編輯</button>
      ${m.custom
        ? `<button class="btn danger" onclick="deleteCustom('${m.id}')">刪除此自訂條目</button>`
        : `<button class="btn danger" onclick="hideBuiltin('${m.id}')">隱藏此內建條目</button>`}
    </div>`;
  document.getElementById("modalDetail").hidden = false;
}

function deleteCustom(id) {
  if (!confirm("確定刪除此自訂條目？此操作不可復原。")) return;
  store.custom = store.custom.filter(m => m.id !== id);
  delete store.override[id];
  saveStore(); closeModals(); render(); toast("已刪除");
}
function hideBuiltin(id) {
  if (!confirm("從列表中隱藏此內建條目？（可透過匯出檔管理，重新整理後仍隱藏）")) return;
  if (!store.hidden.includes(id)) store.hidden.push(id);
  saveStore(); closeModals(); render(); toast("已隱藏");
}

/* ── 表單 ── */
function rowHTML(type, name = "", val = "") {
  return `<div class="row" data-type="${type}">
    <input placeholder="${type === "major" ? "氧化物，如 SiO2" : "元素，如 Nb"}" value="${esc(name)}">
    <input placeholder="${type === "major" ? "wt%，如 65.2 或 60–70" : "含量，如 100–500 ppm"}" value="${esc(val)}">
    <button type="button" class="icon-btn" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addRow(type, name = "", val = "") {
  document.getElementById(type === "major" ? "majorRows" : "traceRows").insertAdjacentHTML("beforeend", rowHTML(type, name, val));
}

function openForm(id = null) {
  editingId = id;
  const f = document.getElementById("mineralForm");
  f.reset();
  document.getElementById("majorRows").innerHTML = "";
  document.getElementById("traceRows").innerHTML = "";
  document.getElementById("formTitle").textContent = id ? "編輯礦物條目" : "添加礦物條目（未公開發表資料）";

  if (id) {
    const m = getEntry(id);
    if (!m) return;
    f.en.value = m.en; f.zh.value = m.zh;
    f.aliases.value = m.aliases.join(", ");
    f.formula.value = m.formula; f.category.value = m.category;
    f.src.value = m.src; f.note.value = m.note;
    m.majors.forEach(r => addRow("major", r[0], r[1]));
    m.traces.forEach(r => addRow("trace", r[0], r[1]));
  } else {
    addRow("major"); addRow("major"); addRow("trace");
  }
  closeModals();
  document.getElementById("modalForm").hidden = false;
  document.getElementById("modalForm").querySelector(".modal-card").scrollTop = 0;
  window.scrollTo(0, 0);
}

function collectRows(type) {
  return [...document.querySelectorAll(`.row[data-type="${type}"]`)]
    .map(row => [...row.querySelectorAll("input")].map(i => i.value.trim()))
    .filter(cells => cells[0] && cells[1])
    .map(cells => [cells[0], cells[1]]);
}

document.getElementById("mineralForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = {
    en: fd.get("en").trim(),
    zh: fd.get("zh").trim(),
    aliases: fd.get("aliases").split(/[,，、]/).map(s => s.trim()).filter(Boolean),
    formula: fd.get("formula").trim(),
    category: fd.get("category"),
    src: fd.get("src").trim() || (editingId ? undefined : "未公開發表 / 用戶自建"),
    note: fd.get("note").trim(),
    majors: collectRows("major"),
    traces: collectRows("trace"),
  };

  if (editingId) {
    store.override[editingId] = Object.assign({}, store.override[editingId], data);
    toast("已更新（修改儲存於本機）");
  } else {
    data.id = "u-" + Date.now().toString(36);
    data.custom = true;
    store.custom.push(data);
    toast("已添加自訂條目");
  }
  saveStore(); closeModals(); currentQuery = ""; document.getElementById("search").value = "";
  render();
  // 重新打開詳情，讓用戶立刻看到結果
  const newId = editingId || store.custom[store.custom.length - 1].id;
  openDetail(newId);
});

/* ── 匯入 / 匯出 ── */
document.getElementById("btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify({
    type: "mineraldb-export", version: 1,
    exportedAt: new Date().toISOString(),
    custom: store.custom, override: store.override, hidden: store.hidden,
  }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mineraldb-custom-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click(); URL.revokeObjectURL(a.href);
  toast("已匯出 JSON");
};
document.getElementById("btnImport").onclick = () => document.getElementById("fileImport").click();
document.getElementById("fileImport").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.type !== "mineraldb-export") throw new Error("格式不符");
      let added = 0;
      (data.custom || []).forEach(c => {
        if (!store.custom.some(m => m.id === c.id)) { store.custom.push(c); added++; }
      });
      Object.assign(store.override, data.override || {});
      (data.hidden || []).forEach(h => { if (!store.hidden.includes(h)) store.hidden.push(h); });
      saveStore(); render();
      toast(`匯入完成：新增 ${added} 個自訂條目`);
    } catch (err) {
      alert("匯入失敗：" + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
};

/* ── 彈窗通用 ── */
function closeModals() {
  document.querySelectorAll(".modal").forEach(m => { m.hidden = true; });
}
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close]")) closeModals(); });
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModals();
  if (e.key === "/" && document.activeElement !== document.getElementById("search")) {
    e.preventDefault(); document.getElementById("search").focus();
  }
});

/* ── 初始化 ── */
document.getElementById("btnAdd").onclick = () => openForm(null);
document.getElementById("search").addEventListener("input", e => {
  currentQuery = e.target.value;
  document.getElementById("clearSearch").hidden = !currentQuery;
  render();
});
document.getElementById("clearSearch").onclick = () => {
  document.getElementById("search").value = ""; currentQuery = ""; render();
};

loadStore();
render();

/* ══ 批量匯入（CSV / TSV / Excel）══ */
const HEADER_ALIASES = {
  en:      ["英文名", "英文", "英文全稱", "英文名稱", "en", "name", "name_en", "english name"],
  zh:      ["中文名", "中文", "中文名稱", "zh", "name_zh", "chinese name"],
  aliases: ["別名", "别名", "簡稱", "简称", "aliases", "alias", "abbrev", "abbr"],
  formula: ["化學式", "化学式", "formula"],
  category:["分類", "分类", "category", "type"],
  majors:  ["主量元素", "主量", "majors", "major", "major elements"],
  traces:  ["微量元素", "微量", "traces", "trace", "trace elements"],
  src:     ["資料來源", "资料来源", "來源", "来源", "src", "source", "reference", "文獻", "文献"],
  note:    ["備註", "备注", "note", "notes", "comment", "說明", "说明"],
};

/* CSV/TSV 解析：自動識別分隔符，支援引號包褁的含分隔符/換行欄位 */
function parseDelimitedTable(text) {
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const counts = { ",": (firstLine.match(/,/g) || []).length, ";": (firstLine.match(/;/g) || []).length, "\t": (firstLine.match(/\t/g) || []).length };
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}

/* 解析「SiO2=64.8; Al2O3:18」這類鍵值串 */
function parsePairs(s) {
  if (!s || !s.trim()) return [];
  return s.split(/[;|\n]/).map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^([^=：:]+)[=：:](.+)$/);
    return m ? [m[1].trim(), m[2].trim()] : null;
  }).filter(Boolean);
}

function mapHeaders(headers) {
  const norm2 = s => norm(s).replace(/\s|_|-/g, "");
  const map = {};
  headers.forEach((h, i) => {
    const hn = norm2(h);
    for (const [field, names] of Object.entries(HEADER_ALIASES)) {
      if (names.some(n => norm2(n) === hn)) { map[field] = i; return; }
    }
  });
  return map;
}

function rowToEntry(cells, map) {
  const get = f => map[f] !== undefined ? (cells[map[f]] || "").trim() : "";
  const en = get("en"), formula = get("formula");
  if (!en || !formula) return { error: "缺少英文全稱或化學式" };
  return {
    id: "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    en, zh: get("zh"),
    aliases: get("aliases").split(/[,，、;；]/).map(s => s.trim()).filter(Boolean),
    formula, category: get("category") || "其他",
    majors: parsePairs(get("majors")),
    traces: parsePairs(get("traces")),
    src: get("src") || "批量匯入 / 未公開發表",
    note: get("note"),
    custom: true,
  };
}

const flatFormula = s => norm(s).replace(/[₀-₉\s]/g, "").replace(/·/g, "");
function runBatchImport(entries, skipDup) {
  const existing = getAllEntries();
  const seen = new Set(existing.map(m => norm(m.en) + "|" + flatFormula(m.formula)));
  let imported = 0, skipped = 0;
  const errors = [];
  entries.forEach((e, i) => {
    if (e.error) { errors.push(`第 ${i + 2} 行：${e.error}`); return; }
    const key = norm(e.en) + "|" + flatFormula(e.formula);
    if (skipDup && seen.has(key)) { skipped++; return; }
    seen.add(key);
    store.custom.push(e); imported++;
  });
  saveStore(); render();
  return { imported, skipped, errors };
}

function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if (window.XLSX) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("無法載入 Excel 解析庫（需聯網）"));
    document.head.appendChild(s);
  });
}

async function handleBatchFile(file) {
  const box = document.getElementById("batchResult");
  box.hidden = false;
  box.innerHTML = '<span class="warn">正在解析…</span>';
  try {
    let rows;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      await loadScriptOnce("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
    } else {
      const text = await file.text();
      rows = parseDelimitedTable(text);
    }
    if (!rows.length) throw new Error("檔案內容為空");
    const headers = rows[0].map(h => String(h));
    const map = mapHeaders(headers);
    if (map.en === undefined || map.formula === undefined)
      throw new Error('表頭缺少「英文名/en」或「化學式/formula」欄位。實際表頭：' + headers.join(" | "));
    const entries = rows.slice(1).filter(r => r.some(c => String(c).trim() !== "")).map(r => rowToEntry(r.map(String), map));
    const skipDup = document.getElementById("skipDup").checked;
    const result = runBatchImport(entries, skipDup);
    box.innerHTML =
      `<p class="ok">✔ 匯入完成：新增 <b>${result.imported}</b> 條` +
      (result.skipped ? `，跳過重複 ${result.skipped} 條` : "") + "。</p>" +
      (result.errors.length ? `<p class="err">${result.errors.length} 行有誤（已忽略）：</p>` +
        result.errors.slice(0, 10).map(e => `<p class="err">· ${esc(e)}</p>`).join("") : "");
    toast(`批量匯入完成：新增 ${result.imported} 條`);
  } catch (err) {
    box.innerHTML = `<p class="err">匯入失敗：${esc(err.message)}</p>`;
  }
}

function downloadTemplate() {
  const tpl = "\uFEFF" +
    "英文名,中文名,別名,化學式,分類,主量元素,微量元素,資料來源,備註\n" +
    'Zircon,鋯石,Zrn,ZrSiO4,島狀矽酸鹽,"SiO2=32; ZrO2=67; HfO2=1.5","Hf=0.5-2 wt%; U=10-4000 ppm",未發表，EMP+LA-ICP-MS,示例行可刪除\n' +
    'Pyrite,黃鐵礦,Py,FeS2,硫化物,"Fe=45.5; S=53.5","Co=10-5000 ppm; Au=0.01-500 ppm",本實驗室數據,';
  const blob = new Blob([tpl], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mineraldb-import-template.csv";
  a.click(); URL.revokeObjectURL(a.href);
}

document.getElementById("btnBatch").onclick = () => {
  document.getElementById("batchResult").hidden = true;
  document.getElementById("modalBatch").hidden = false;
};
document.getElementById("btnTemplate").onclick = downloadTemplate;
document.getElementById("fileBatch").onchange = e => {
  const f = e.target.files[0];
  if (f) handleBatchFile(f);
  e.target.value = "";
};
