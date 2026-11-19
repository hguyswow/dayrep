(function (root) {
  "use strict";

  var MAX_RISK_ROWS = 12;
  var PAGE_SIZE = 50;

  function isBlankRow(r) {
    if (!r || typeof r !== "object") return true;
    return !String(r.item || "").trim() &&
      !String(r.hazard || "").trim() &&
      !String(r.measure || "").trim();
  }

  function applySelectedToRows(currentRows, selectedEntries, maxRows) {
    var rl = root.DayrepRiskLibrary;
    var limit = Number.isFinite(Number(maxRows)) && Number(maxRows) > 0 ? Math.floor(Number(maxRows)) : MAX_RISK_ROWS;
    var out = Array.isArray(currentRows)
      ? currentRows.map(function (r) {
          return Object.assign({}, r);
        })
      : [];
    var existingKeys = new Set();
    out.forEach(function (r) {
      if (r && (String(r.item || "").trim() || String(r.hazard || "").trim())) {
        existingKeys.add(rl ? rl.makeKey(r.item, r.hazard) : (String(r.item || "").trim() + "::" + String(r.hazard || "").trim()));
      }
    });

    var addedIds = [];
    var skippedDup = 0;
    var skippedLimit = 0;
    var list = Array.isArray(selectedEntries) ? selectedEntries : [];

    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i];
      if (!entry) continue;
      var key = rl
        ? rl.makeKey(entry.item, entry.hazard)
        : (String(entry.item || "").trim() + "::" + String(entry.hazard || "").trim());
      if (existingKeys.has(key)) {
        skippedDup += 1;
        continue;
      }

      var newRow = {
        item: entry.item || "",
        hazard: entry.hazard || "",
        type: entry.type || "",
        level: entry.level || "중",
        measure: entry.measure || ""
      };

      var blankIdx = -1;
      for (var b = 0; b < out.length; b += 1) {
        if (isBlankRow(out[b])) {
          blankIdx = b;
          break;
        }
      }

      if (blankIdx !== -1) {
        out[blankIdx] = Object.assign({}, out[blankIdx], newRow);
        existingKeys.add(key);
        if (entry.id) addedIds.push(entry.id);
      } else if (out.length < limit) {
        out.push(newRow);
        existingKeys.add(key);
        if (entry.id) addedIds.push(entry.id);
      } else {
        skippedLimit += 1;
      }
    }

    return {
      rows: out,
      addedIds: addedIds,
      skippedDup: skippedDup,
      skippedLimit: skippedLimit
    };
  }

  function makeEl(tag, cls, txt) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt !== undefined && txt !== null) el.textContent = String(txt);
    return el;
  }

  function open(opts) {
    var rl = root.DayrepRiskLibrary;
    if (!rl) return;
    var lib = rl.normalizeLibrary(opts && opts.library);
    var state = {
      category: "",
      q: "",
      sort: "most",
      limit: PAGE_SIZE,
      selectedMap: {}
    };

    var existingRoot = document.getElementById("risk-picker-modal-root");
    if (existingRoot && existingRoot.parentNode) {
      existingRoot.parentNode.removeChild(existingRoot);
    }

    var backdrop = makeEl("div", "risk-picker-backdrop no-print");
    backdrop.id = "risk-picker-modal-root";
    var dialog = makeEl("div", "risk-picker-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "위험성평가 라이브러리에서 추가");

    var header = makeEl("div", "risk-picker-header");
    header.appendChild(makeEl("h3", "", "위험성평가 라이브러리에서 추가"));
    var btnCloseX = makeEl("button", "btn-secondary risklib-btn-sm", "닫기");
    btnCloseX.type = "button";
    header.appendChild(btnCloseX);
    dialog.appendChild(header);

    var toolbar = makeEl("div", "risk-picker-toolbar");
    var selCat = document.createElement("select");
    var cats = rl.listCategories(lib);
    var optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "전체 종류 (" + lib.entries.length + ")";
    selCat.appendChild(optAll);
    cats.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.category;
      o.textContent = c.category + " (" + c.count + ")";
      selCat.appendChild(o);
    });
    if (opts && opts.defaultCategory) {
      var hasDef = cats.some(function (c) { return c.category === opts.defaultCategory; });
      if (hasDef) {
        state.category = opts.defaultCategory;
        selCat.value = opts.defaultCategory;
      }
    }

    var inpSearch = document.createElement("input");
    inpSearch.type = "search";
    inpSearch.placeholder = "장비/도구·유해위험요인·감소대책 검색";

    var selSort = document.createElement("select");
    [
      { val: "most", label: "많이 쓴 순" },
      { val: "recent", label: "최근 순" }
    ].forEach(function (sOpt) {
      var o = document.createElement("option");
      o.value = sOpt.val;
      o.textContent = sOpt.label;
      selSort.appendChild(o);
    });

    toolbar.appendChild(selCat);
    toolbar.appendChild(inpSearch);
    toolbar.appendChild(selSort);
    dialog.appendChild(toolbar);

    var tableWrap = makeEl("div", "risk-picker-table-wrap");
    var table = makeEl("table", "risklib-table risk-picker-table");
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    ["", "종류", "장비/도구", "유해·위험요인", "재해형태", "등급", "감소대책", "사용"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    dialog.appendChild(tableWrap);

    var moreWrap = makeEl("div", "risk-picker-more-wrap");
    var btnMore = makeEl("button", "btn-secondary hidden", "더 보기");
    btnMore.type = "button";
    moreWrap.appendChild(btnMore);
    dialog.appendChild(moreWrap);

    var footer = makeEl("div", "risk-picker-footer");
    var selCountEl = makeEl("span", "risk-picker-sel-count", "선택 0건");
    var footerBtns = makeEl("div", "risk-picker-footer-btns");
    var btnCancel = makeEl("button", "btn-secondary", "취소");
    btnCancel.type = "button";
    var btnApply = makeEl("button", "btn-primary", "표에 추가");
    btnApply.type = "button";
    btnApply.disabled = true;
    footerBtns.appendChild(btnCancel);
    footerBtns.appendChild(btnApply);
    footer.appendChild(selCountEl);
    footer.appendChild(footerBtns);
    dialog.appendChild(footer);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (opts && typeof opts.onClose === "function") opts.onClose();
    }

    function updateSelFooter() {
      var cnt = Object.keys(state.selectedMap).length;
      selCountEl.textContent = "선택 " + cnt + "건";
      btnApply.disabled = cnt === 0;
    }

    function getFilteredSorted() {
      var list = rl.query(lib, { category: state.category, q: state.q });
      var sorted = list.slice();
      sorted.sort(function (a, b) {
        if (state.sort === "recent") {
          if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt > b.lastUsedAt ? -1 : 1;
          return (b.useCount || 0) - (a.useCount || 0);
        }
        if ((b.useCount || 0) !== (a.useCount || 0)) return (b.useCount || 0) - (a.useCount || 0);
        if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt > b.lastUsedAt ? -1 : 1;
        return 0;
      });
      return sorted;
    }

    function renderRows() {
      var matched = getFilteredSorted();
      var visible = matched.slice(0, state.limit);
      tbody.textContent = "";

      if (visible.length === 0) {
        var emptyTr = document.createElement("tr");
        var emptyTd = makeEl("td", "risklib-empty", lib.entries.length === 0 ? "보관된 라이브러리 항목이 없습니다." : "조건에 맞는 항목이 없습니다.");
        emptyTd.colSpan = 8;
        emptyTr.appendChild(emptyTd);
        tbody.appendChild(emptyTr);
      } else {
        visible.forEach(function (entry) {
          var tr = document.createElement("tr");
          var tdChk = document.createElement("td");
          var chk = document.createElement("input");
          chk.type = "checkbox";
          chk.checked = Boolean(state.selectedMap[entry.id]);
          chk.addEventListener("change", function () {
            if (chk.checked) state.selectedMap[entry.id] = entry;
            else delete state.selectedMap[entry.id];
            updateSelFooter();
          });
          tdChk.appendChild(chk);
          tr.appendChild(tdChk);

          tr.appendChild(makeEl("td", "", entry.category || "미분류"));
          tr.appendChild(makeEl("td", "", entry.item || ""));
          tr.appendChild(makeEl("td", "", entry.hazard || ""));
          tr.appendChild(makeEl("td", "", entry.type || ""));
          tr.appendChild(makeEl("td", "", entry.level || "중"));

          var tdMeas = makeEl("td", "risk-picker-ellipsis", entry.measure || "");
          tdMeas.title = entry.measure || "";
          tr.appendChild(tdMeas);

          tr.appendChild(makeEl("td", "", String(entry.useCount || 1) + "회"));
          tbody.appendChild(tr);
        });
      }

      var rem = matched.length - visible.length;
      if (rem > 0) {
        btnMore.classList.remove("hidden");
        btnMore.textContent = "더 보기 (" + rem + "건 남음)";
      } else {
        btnMore.classList.add("hidden");
      }
      updateSelFooter();
    }

    selCat.addEventListener("change", function () {
      state.category = selCat.value || "";
      state.limit = PAGE_SIZE;
      renderRows();
    });
    inpSearch.addEventListener("input", function () {
      state.q = inpSearch.value || "";
      state.limit = PAGE_SIZE;
      renderRows();
    });
    selSort.addEventListener("change", function () {
      state.sort = selSort.value || "most";
      renderRows();
    });
    btnMore.addEventListener("click", function () {
      state.limit += PAGE_SIZE;
      renderRows();
    });
    btnCloseX.addEventListener("click", close);
    btnCancel.addEventListener("click", close);
    backdrop.addEventListener("click", function (ev) {
      if (ev.target === backdrop) close();
    });
    btnApply.addEventListener("click", function () {
      var selectedEntries = Object.keys(state.selectedMap).map(function (id) {
        return state.selectedMap[id];
      });
      close();
      if (opts && typeof opts.onConfirm === "function") {
        opts.onConfirm(selectedEntries);
      }
    });

    renderRows();
  }

  root.DayrepRiskPickerModal = {
    MAX_RISK_ROWS: MAX_RISK_ROWS,
    applySelectedToRows: applySelectedToRows,
    open: open
  };
})(window);
