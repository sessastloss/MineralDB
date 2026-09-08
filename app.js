/* MineralDB · 應用邏輯（純前端，無外部依賴，支持三語） */
"use strict";

const LS_CUSTOM = "mineraldb.custom.v1";
const LS_OVERRIDE = "mineraldb.override.v1";
const LS_HIDDEN = "mineraldb.hidden.v1";
const LS_LOCALE = "mineraldb.locale.v1";

const store = {
  custom: [],      // 用戶自建條目
  override: {},    // id -> 覆蓋內容
  hidden: [],      // 被隱藏的內建條目 id
};
let editingId = null;
let currentQuery = "";
let currentCat = "__all__";
let locale = "zh-Hant";
try { locale = localStorage.getItem(LS_LOCALE) || "zh-Hant"; } catch { locale = "zh-Hant"; }
if (!I18N[locale]) locale = "zh-Hant";

/* ── i18n ── */
function ensureHans() {
  if (!Object.keys(I18N["zh-Hans"]).length) {
    for (const [k, v] of Object.entries(I18N["zh-Hant"])) {
      I18N["zh-Hans"][k] = t2s(v).replace(/汇出/g, "导出").replace(/汇入/g, "导入").replace(/搜寻/g, "搜索");
    }
  }
}
function t(key) { return (I18N[locale] && I18N[locale][key]) || I18N["zh-Hant"][key] || key; }
function fmt(key, params) {
  let s = t(key);
  for (const [k, v] of Object.entries(params || {})) s = s.replace("{" + k + "}", v);
  return s;
}
const CAT_KEYS = {
  "島狀矽酸鹽": "cat_neso", "鏈狀矽酸鹽": "cat_ino", "層狀矽酸鹽": "cat_phyllo",
  "架狀矽酸鹽": "cat_tecto", "環狀矽酸鹽": "cat_cyclo", "氧化物": "cat_oxide",
  "硫化物": "cat_sulfide", "硫酸鹽": "cat_sulfate", "碳酸鹽": "cat_carbonate",
  "磷酸鹽": "cat_phosphate", "鹵化物": "cat_halide", "自然元素": "cat_native", "其他": "cat_other",
};
function catKey(cat) { return CAT_KEYS[cat] || "cat_other"; }
function catDisplay(cat) { return t(catKey(cat)); }
function nameFor(m) {
  if (locale === "en") return { main: m.en || m.zh, sub: m.zh ? t2s(m.zh) : "" };
  if (locale === "zh-Hans") return { main: m.zh ? t2s(m.zh) : m.en, sub: m.en };
  return { main: m.zh || m.en, sub: m.en };
}

function applyI18n() {
  ensureHans();
  document.documentElement.lang = locale;
  document.title = "MineralDB · " + t("tagline");
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  // 分類下拉
  const sel = document.getElementById("catSelect");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = "";
    Object.values(CAT_KEYS).forEach(k => {
      const opt = document.createElement("option");
      opt.value = Object.keys(CAT_KEYS).find(kk => CAT_KEYS[kk] === k);
      opt.textContent = t(k);
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  }
  // 批量導入說明表
  const bt = document.getElementById("batchHelpTable");
  if (bt) {
    const rows = [
      ["bh_en", "bh_en_h"], ["bh_formula", "bh_formula_h"], ["bh_zh", "bh_zh_h"],
      ["bh_aliases", "bh_aliases_h"], ["bh_cat", "bh_cat_h"], ["bh_majors", "bh_majors_h"],
      ["bh_traces", "bh_traces_h"], ["bh_src", "bh_src_h"], ["bh_note", "bh_note_h"],
    ];
    bt.innerHTML = `<tr><th>${t("bh_field")}</th><th>${t("bh_header")}</th></tr>` +
      rows.map(([a, b]) => `<tr><td>${t(a)}</td><td>${t(b)}</td></tr>`).join("");
  }
  document.getElementById("langSel").value = locale;
}

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
function getEntry(id) { return getAllEntries().find(m => m.id === id) || null; }

/* ── 工具 ── */
const norm = s => (s || "").toString().toLowerCase().trim();
function formulaHTML(f) {
  return f
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/·/g, " · ")
    .replace(/(\d+(?:\.\d+)?)/g, "<sub>$1</sub>");
}
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(el._tm); el._tm = setTimeout(() => { el.hidden = true; }, 2200);
}

/* 搜尋：全稱（三語）/ 簡稱 / 化學式 / 元素 */
function matches(entry, q) {
  const query = norm(q);
  if (!query) return true;
  const zhHans = t2s(entry.zh);
  const fields = [
    entry.en, entry.zh, zhHans, entry.formula,
    entry.aliases.join(" "), t2s(entry.aliases.join(" ")),
    entry.category, catDisplay(entry.category), "Nesosilicates Inosilicates Phyllosilicates Tectosilicates Cyclosilicates Oxides Sulfides Sulfates Carbonates Phosphates Halides Native elements".includes(catDisplay(entry.category)) ? catDisplay(entry.category) : "",
    entry.src, entry.note, t2s(entry.note),
  ];
  if (fields.some(f => norm(f).includes(query))) return true;
  const flat = s => norm(s).replace(/[₀-₉\s]/g, "").replace(/·/g, "");
  if (entry.formula && flat(entry.formula).includes(flat(query))) return true;
  const elq = query.replace(/₂|₃|₄|₅|₆|₈/g, m => "234568"[m.charCodeAt(0) - 0x2080] || "");
  if (/^[a-z]{1,2}$/.test(elq)) {
    const inMajors = entry.majors.some(r => norm(r[0]).replace(/[0-9]/g, "").startsWith(elq));
    const inTraces = entry.traces.some(r =>
      norm(r[0]).split(/[\s/、,，]/).includes(elq) ||
      norm(r[0]).replace(/[0-9]/g, "").startsWith(elq));
    if (inMajors || inTraces) return true;
  }
  return false;
}

/* ── 渲染 ── */
function renderCategories() {
  const cats = [...new Set(getAllEntries().map(m => m.category))].sort((a, b) => catDisplay(a).localeCompare(catDisplay(b), locale));
  const bar = document.getElementById("catBar");
  bar.innerHTML = "";
  const allChip = document.createElement("button");
  allChip.className = "chip" + (currentCat === "__all__" ? " active" : "");
  allChip.textContent = t("cat_all");
  allChip.onclick = () => { currentCat = "__all__"; render(); };
  bar.appendChild(allChip);
  cats.forEach(c => {
    const chip = document.createElement("button");
    chip.className = "chip" + (c === currentCat ? " active" : "");
    chip.textContent = catDisplay(c);
    chip.onclick = () => { currentCat = c; render(); };
    bar.appendChild(chip);
  });
}

function render() {
  renderCategories();
  const all = getAllEntries();
  const list = all
    .filter(m => (currentCat === "__all__" || m.category === currentCat))
    .filter(m => matches(m, currentQuery))
    .sort((a, b) => (a.custom - b.custom) || nameFor(a).main.localeCompare(nameFor(b).main, locale));

  const stats = document.getElementById("stats");
  stats.innerHTML = fmt("stat_line", { total: all.length, builtin: all.length - store.custom.length, custom: store.custom.length, shown: list.length });

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  document.getElementById("empty").hidden = list.length > 0;

  list.forEach(m => {
    const nm = nameFor(m);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="head">
        <span class="en">${esc(nm.main)}</span>
        <span class="zh">${esc(nm.sub)}</span>
      </div>
      <div class="formula">${formulaHTML(m.formula)}</div>
      <div class="meta">
        <span class="badge cat">${esc(catDisplay(m.category))}</span>
        ${m.aliases.length ? `<span class="badge">${esc(m.aliases.slice(0, 3).join(" / "))}</span>` : ""}
        ${m.custom ? `<span class="badge custom">${t("badge_custom")}</span>` : ""}
        ${store.override[m.id] ? `<span class="badge custom">${t("badge_edited")}</span>` : ""}
      </div>`;
    card.onclick = () => openDetail(m.id);
    grid.appendChild(card);
  });
}

/* ── 詳情 ── */
function refsFor(m) {
  if (CORE_REFS[m.id] && CORE_REFS[m.id].length) return CORE_REFS[m.id];
  const def = CORE_REFS["_default_" + catKey(m.category)];
  return def && def.length ? def : CORE_REFS._default_general;
}
function openDetail(id) {
  const m = getEntry(id);
  if (!m) return;
  const majorMax = Math.max(...m.majors.map(r => parseFloat(r[1])) || [1], 1);
  const rows = (arr, headKey) => arr.length ? `
    <div class="sec-title">${t(headKey)}</div>
    <table class="data">
      <tr><th>${t("col_comp")}</th><th>${t("col_typical")}</th><th>${t("col_bar")}</th></tr>
      ${arr.map(r => `
        <tr>
          <td class="el">${esc(r[0])}</td>
          <td class="val">${esc(r[1])}</td>
          <td class="bar-cell"><div class="bar" style="width:${Math.min(100, Math.max(6, (parseFloat(r[1]) / majorMax) * 100))}%"></div></td>
        </tr>`).join("")}
    </table>` : `<div class="sec-title">${t(headKey)}</div><p class="note">${t("no_data")}</p>`;

  const refs = refsFor(m);
  document.getElementById("detailBody").innerHTML = `
    <div class="detail-head">
      <h2>${esc(nameFor(m).main)} <span class="sub">${esc(nameFor(m).sub)}</span></h2>
      <div class="formula">${formulaHTML(m.formula)}</div>
      <div class="sub">
        <span class="badge cat">${esc(catDisplay(m.category))}</span>
        ${m.custom ? `<span class="badge custom">${t("badge_custom_detail")}</span>` : `<span class="badge">${t("badge_builtin")}</span>`}
        ${m.aliases.length ? `<span class="badge">${t("badge_refs")}：${esc(m.aliases.join("、"))}</span>` : ""}
      </div>
    </div>
    ${rows(m.majors, "detail_majors")}
    ${rows(m.traces, "detail_traces")}
    ${m.note ? `<div class="sec-title">${t("detail_note")}</div><p class="note">${esc(locale === "en" ? m.note : locale === "zh-Hans" ? t2s(m.note) : m.note)}</p>` : ""}
    <div class="sec-title">${t("detail_refs")}</div>
    ${refs.map(r => `<p class="src">· ${esc(r)}</p>`).join("")}
    ${m.src ? `<p class="src">（${t("detail_note")}：${esc(locale === "en" ? m.src : locale === "zh-Hans" ? t2s(m.src) : m.src)}）</p>` : ""}
    <div class="detail-actions">
      <button class="btn primary" onclick="openForm('${m.id}')">${t("btn_edit")}</button>
      ${m.custom
        ? `<button class="btn danger" onclick="deleteCustom('${m.id}')">${t("btn_delete")}</button>`
        : `<button class="btn danger" onclick="hideBuiltin('${m.id}')">${t("btn_hide")}</button>`}
    </div>`;
  document.getElementById("modalDetail").hidden = false;
}

function deleteCustom(id) {
  if (!confirm(t("confirm_delete"))) return;
  store.custom = store.custom.filter(m => m.id !== id);
  delete store.override[id];
  saveStore(); closeModals(); render(); toast(t("toast_deleted"));
}
function hideBuiltin(id) {
  if (!confirm(t("confirm_hide"))) return;
  if (!store.hidden.includes(id)) store.hidden.push(id);
  saveStore(); closeModals(); render(); toast(t("toast_hidden"));
}

/* ── 表單 ── */
function rowHTML(type, name = "", val = "") {
  const ph1 = t(type === "major" ? "row_major_ph" : "row_trace_ph");
  const ph2 = t(type === "major" ? "row_major_val_ph" : "row_trace_val_ph");
  return `<div class="row" data-type="${type}">
    <input placeholder="${esc(ph1)}" value="${esc(name)}">
    <input placeholder="${esc(ph2)}" value="${esc(val)}">
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
  document.getElementById("formTitle").textContent = id ? t("form_edit_title") : t("form_add_title");

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
    src: fd.get("src").trim() || (editingId ? undefined : t("src_user_default")),
    note: fd.get("note").trim(),
    majors: collectRows("major"),
    traces: collectRows("trace"),
  };

  if (editingId) {
    store.override[editingId] = Object.assign({}, store.override[editingId], data);
    toast(t("toast_updated"));
  } else {
    data.id = "u-" + Date.now().toString(36);
    data.custom = true;
    store.custom.push(data);
    toast(t("toast_added"));
  }
  saveStore(); closeModals(); currentQuery = ""; document.getElementById("search").value = "";
  render();
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
  toast(t("toast_exported"));
};
document.getElementById("btnImport").onclick = () => document.getElementById("fileImport").click();
document.getElementById("fileImport").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.type !== "mineraldb-export") throw new Error("format");
      let added = 0;
      (data.custom || []).forEach(c => {
        if (!store.custom.some(m => m.id === c.id)) { store.custom.push(c); added++; }
      });
      Object.assign(store.override, data.override || {});
      (data.hidden || []).forEach(h => { if (!store.hidden.includes(h)) store.hidden.push(h); });
      saveStore(); render();
      toast(fmt("import_done", { n: added }));
    } catch (err) {
      alert(t("import_fail") + err.message);
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
document.getElementById("langSel").onchange = e => {
  locale = e.target.value;
  try { localStorage.setItem(LS_LOCALE, locale); } catch {}
  applyI18n(); render();
  if (!document.getElementById("modalDetail").hidden) {
    // 刷新已打開的詳情（取最後瀏覽的條目）
    const en = document.querySelector("#detailBody .detail-head h2");
    if (en) { closeModals(); }
  }
};

loadStore();
applyI18n();
render();

/* ══ 批量匯入（CSV / TSV / Excel）══ */
const HEADER_ALIASES = {
  en:      ["英文名", "英文", "英文全稱", "英文名稱", "英文全称", "en", "name", "name_en", "english name"],
  zh:      ["中文名", "中文", "中文名稱", "中文名称", "zh", "name_zh", "chinese name"],
  aliases: ["別名", "别名", "簡稱", "简称", "aliases", "alias", "abbrev", "abbr"],
  formula: ["化學式", "化学式", "formula"],
  category:["分類", "分类", "category", "type"],
  majors:  ["主量元素", "主量", "majors", "major", "major elements"],
  traces:  ["微量元素", "微量", "traces", "trace", "trace elements"],
  src:     ["資料來源", "资料来源", "來源", "来源", "src", "source", "reference", "文獻", "文献"],
  note:    ["備註", "备注", "note", "notes", "comment", "說明", "说明"],
};

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

function parsePairs(s) {
  if (!s || !s.trim()) return [];
  return s.split(/[;|\n]/).map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^([^=：:]+)[=：:](.+)$/);
    return m ? [m[1].trim(), m[2].trim()] : null;
  }).filter(Boolean);
}

function mapHeaders(headers) {
  const norm2 = s => norm(t2s(s)).replace(/\s|_|-/g, "");
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
  if (!en || !formula) return { error: t("batch_missing") };
  return {
    id: "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    en, zh: get("zh"),
    aliases: get("aliases").split(/[,，、;；]/).map(s => s.trim()).filter(Boolean),
    formula, category: get("category") || "其他",
    majors: parsePairs(get("majors")),
    traces: parsePairs(get("traces")),
    src: get("src") || t("src_batch_default"),
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
    if (e.error) { errors.push(fmt("batch_line", { n: i + 2 }) + "：" + e.error); return; }
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
    s.src = src; s.onload = res; s.onerror = () => rej(new Error(t("err_load_xlsx")));
    document.head.appendChild(s);
  });
}

async function handleBatchFile(file) {
  const box = document.getElementById("batchResult");
  box.hidden = false;
  box.innerHTML = `<span class="warn">${t("batch_parsing")}</span>`;
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
    if (!rows.length) throw new Error(t("err_empty_file"));
    const headers = rows[0].map(h => String(h));
    const map = mapHeaders(headers);
    if (map.en === undefined || map.formula === undefined)
      throw new Error(t("err_bad_header") + headers.join(" | "));
    const entries = rows.slice(1).filter(r => r.some(c => String(c).trim() !== "")).map(r => rowToEntry(r.map(String), map));
    const skipDup = document.getElementById("skipDup").checked;
    const result = runBatchImport(entries, skipDup);
    box.innerHTML =
      `<p class="ok">${fmt("batch_done", { n: result.imported })}` +
      (result.skipped ? fmt("batch_skipped", { n: result.skipped }) : "") + "</p>" +
      (result.errors.length ? `<p class="err">${fmt("batch_errors", { n: result.errors.length })}</p>` +
        result.errors.slice(0, 10).map(e => `<p class="err">· ${esc(e)}</p>`).join("") : "");
    toast(fmt("batch_done", { n: result.imported }).replace(/<[^>]+>/g, ""));
  } catch (err) {
    box.innerHTML = `<p class="err">${t("import_fail")}${esc(err.message)}</p>`;
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
