(function (root) {
  "use strict";

  async function collectInlineCss() {
    var parts = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i];
      try {
        var rules = sheet.cssRules || sheet.rules;
        if (rules) {
          for (var j = 0; j < rules.length; j++) {
            parts.push(rules[j].cssText);
          }
        }
      } catch (e) {
        // fallback below if cross-origin/file restriction
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
    try {
      var resp = await fetch("css/style.css");
      if (resp.ok) return await resp.text();
    } catch (e2) {
      // ignore
    }
    return "";
  }

  function snapshotElementForPrint(sheetEl) {
    var clone = sheetEl.cloneNode(true);

    // .no-print 제거
    var noPrints = clone.querySelectorAll(".no-print");
    for (var i = 0; i < noPrints.length; i++) {
      noPrints[i].remove();
    }

    // 원본과 복제본의 textarea, input, select 매칭해 값 텍스트 노드로 치환
    var origTas = sheetEl.querySelectorAll("textarea");
    var cloneTas = clone.querySelectorAll("textarea");
    for (var t = 0; t < cloneTas.length; t++) {
      var origTa = origTas[t];
      var cTa = cloneTas[t];
      var div = document.createElement("div");
      div.className = cTa.className + " print-mirror-ta";
      div.classList.remove("has-cell-ai");
      div.textContent = origTa ? origTa.value : cTa.value;
      cTa.parentNode.replaceChild(div, cTa);
    }

    var origInps = sheetEl.querySelectorAll("input");
    var cloneInps = clone.querySelectorAll("input");
    for (var k = 0; k < cloneInps.length; k++) {
      var origInp = origInps[k];
      var cInp = cloneInps[k];
      if (cInp.type === "hidden" || cInp.type === "file" || cInp.type === "checkbox") {
        continue;
      }
      var span = document.createElement("span");
      span.className = cInp.className + " print-mirror-input";
      span.textContent = origInp ? origInp.value : cInp.value;
      cInp.parentNode.replaceChild(span, cInp);
    }

    var origSels = sheetEl.querySelectorAll("select");
    var cloneSels = clone.querySelectorAll("select");
    for (var s = 0; s < cloneSels.length; s++) {
      var origSel = origSels[s];
      var cSel = cloneSels[s];
      var sSpan = document.createElement("span");
      sSpan.className = cSel.className + " print-mirror-input";
      sSpan.textContent = origSel ? origSel.value : cSel.value;
      cSel.parentNode.replaceChild(sSpan, cSel);
    }

    return clone;
  }

  var MAX_TBM_PRINT_SHEETS = 31;
  var activePrintCleanup = null;

  function renderDoc5Into(box, dayData, settings, stamps) {
    var c5 = root.DayrepDoc5UI.createDoc5Controller();
    c5.render(box, {
      dayData: dayData,
      settings: settings,
      stamps: stamps,
      onDayChange: function () {},
      showToast: function () {}
    });
  }

  function createOffscreenHost() {
    var host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-99999px";
    host.style.top = "0";
    host.style.width = "210mm";
    document.body.appendChild(host);
    return host;
  }

  function resolvePrintDocs(settings) {
    if (root.DayrepCarryover && typeof root.DayrepCarryover.normalizePrintDocs === "function") {
      return root.DayrepCarryover.normalizePrintDocs(settings && settings.printDocs);
    }
    var src = (settings && settings.printDocs) || {};
    var keys = ["doc1", "doc2", "doc3", "doc4", "doc5"];
    var out = {};
    var any = false;
    keys.forEach(function (k) {
      out[k] = typeof src[k] === "boolean" ? src[k] : true;
      if (out[k]) any = true;
    });
    if (!any) {
      keys.forEach(function (k) { out[k] = true; });
    }
    return out;
  }

  async function renderAllSheets(ctx) {
    var host = createOffscreenHost();
    var printDocs = resolvePrintDocs(ctx && ctx.settings);

    var snapshots = [];
    try {
      var boxes = [];
      if (printDocs.doc1) {
        var d1 = document.createElement("div");
        host.appendChild(d1);
        var c1 = root.DayrepDoc1UI.createDoc1Controller();
        c1.render(d1, {
          dayData: ctx.dayData,
          settings: ctx.settings,
          stamps: ctx.stamps,
          onDayChange: function () {}
        });
        boxes.push(d1);
      }

      if (printDocs.doc2) {
        var d2 = document.createElement("div");
        host.appendChild(d2);
        var c2 = root.DayrepDoc2UI.createDoc2Controller();
        await c2.render(d2, {
          invoke: ctx.invoke,
          dayData: ctx.dayData,
          onDayChange: function () {},
          showToast: function () {}
        });
        boxes.push(d2);
      }

      if (printDocs.doc3) {
        var d3 = document.createElement("div");
        host.appendChild(d3);
        var c3 = root.DayrepDoc3UI.createDoc3Controller();
        c3.render(d3, {
          dayData: ctx.dayData,
          settings: ctx.settings,
          stamps: ctx.stamps,
          onDayChange: function () {}
        });
        boxes.push(d3);
      }

      if (printDocs.doc4) {
        var d4 = document.createElement("div");
        host.appendChild(d4);
        var c4 = root.DayrepDoc4UI.createDoc4Controller();
        c4.render(d4, {
          dayData: ctx.dayData,
          settings: ctx.settings,
          stamps: ctx.stamps,
          onDayChange: function () {}
        });
        boxes.push(d4);
      }

      if (printDocs.doc5) {
        var d5 = document.createElement("div");
        host.appendChild(d5);
        renderDoc5Into(d5, ctx.dayData, ctx.settings, ctx.stamps);
        boxes.push(d5);
      }

      boxes.forEach(function (box) {
        var sheet = box.querySelector(".a4-sheet");
        if (!sheet) return;
        snapshots.push(snapshotElementForPrint(sheet));
      });

      for (var i = 0; i < snapshots.length - 1; i++) {
        snapshots[i].classList.add("print-page-break");
      }
    } finally {
      host.remove();
    }
    return snapshots;
  }

  async function buildBundleHtml(ctx) {
    var snapshots = await renderAllSheets(ctx);
    var cssText = await collectInlineCss();

    var wrapper = document.createElement("div");
    snapshots.forEach(function (s) {
      wrapper.appendChild(s);
    });

    return [
      "<!DOCTYPE html>",
      "<html lang=\"ko\">",
      "<head>",
      "<meta charset=\"UTF-8\">",
      "<title>일일서류_" + (ctx.dayData.date || "") + "</title>",
      "<style>",
      cssText,
      "@page { size: A4 portrait; margin: 0; }",
      "body.print-bundle { margin: 0; padding: 0; background: #ffffff; }",
      "body.print-bundle .a4-sheet { box-shadow: none !important; margin: 0 !important; }",
      ".print-page-break { break-after: page; page-break-after: always; }",
      ".print-mirror-ta { white-space: pre-wrap; word-break: break-word; }",
      ".print-mirror-input { display: inline-block; }",
      "</style>",
      "</head>",
      "<body class=\"print-bundle\">",
      wrapper.innerHTML,
      "</body>",
      "</html>"
    ].join("\n");
  }

  function clampDateOffset(val) {
    var n = Number(val);
    if (!Number.isFinite(n)) return 0;
    n = Math.trunc(n);
    if (n < -7) return -7;
    if (n > 31) return 31;
    return n;
  }

  function formatDotDateStr(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return dateStr || "";
    var p = dateStr.split("-");
    return p[0] + ".  " + p[1] + ".  " + p[2] + ".";
  }

  function formatBlankDateStr(dateStr, fallbackText) {
    var m = String(dateStr || "").match(/^(\d{4})-\d{2}-\d{2}$/);
    var year = m ? m[1] : "";
    if (!year) {
      var fm = String(fallbackText || "").match(/(\d{4})/);
      year = fm ? fm[1] : String(new Date().getFullYear());
    }
    var gap = "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0";
    return year + "년" + gap + "월" + gap + "일";
  }

  function applyDoc5DateOption(snap, baseDate, opts) {
    if (!snap) return;
    if (opts && opts.blankDate) {
      var blankEl = snap.querySelector(".doc5-date-val");
      if (blankEl) {
        blankEl.textContent = formatBlankDateStr(baseDate, blankEl.textContent);
        blankEl.style.whiteSpace = "pre";
      }
      return;
    }
    var offset = clampDateOffset(opts && opts.dateOffset);
    if (offset !== 0 && baseDate && root.DayrepSchedule && typeof root.DayrepSchedule.addDays === "function") {
      var shifted = root.DayrepSchedule.addDays(baseDate, offset);
      var dateEl = snap.querySelector(".doc5-date-val");
      if (dateEl) {
        dateEl.textContent = formatDotDateStr(shifted);
      }
    }
  }

  async function renderTbmSnapshots(ctx) {
    var days = Array.isArray(ctx && ctx.days) ? ctx.days.slice(0, MAX_TBM_PRINT_SHEETS) : [];
    if (days.length === 0) return [];
    var host = createOffscreenHost();
    var snapshots = [];
    try {
      for (var i = 0; i < days.length; i++) {
        var box = document.createElement("div");
        host.appendChild(box);
        renderDoc5Into(box, days[i], ctx.settings, ctx.stamps);
        var sheet = box.querySelector(".a4-sheet");
        if (sheet) {
          var snap = snapshotElementForPrint(sheet);
          applyDoc5DateOption(snap, days[i] && days[i].date, {
            blankDate: Boolean(ctx.blankDate),
            dateOffset: ctx.dateOffset
          });
          if (i < days.length - 1) {
            snap.classList.add("print-page-break");
          }
          snapshots.push(snap);
        }
        box.remove();
        if (i < days.length - 1) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 0);
          });
        }
      }
    } finally {
      host.remove();
    }
    return snapshots;
  }

  function printSnapshots(snapshots) {
    var printContainer = document.getElementById("print-all-container");
    if (!printContainer) {
      window.print();
      return;
    }
    if (activePrintCleanup) {
      window.removeEventListener("afterprint", activePrintCleanup);
      activePrintCleanup();
    }
    printContainer.textContent = "";
    snapshots.forEach(function (s) {
      printContainer.appendChild(s);
    });
    document.body.classList.add("printing-all");
    activePrintCleanup = function () {
      document.body.classList.remove("printing-all");
      printContainer.textContent = "";
      activePrintCleanup = null;
    };
    window.addEventListener("afterprint", activePrintCleanup, { once: true });
    window.print();
  }

  function renderSingleSheetSnapshot(sheetEl, opts) {
    var snap = snapshotElementForPrint(sheetEl);
    applyDoc5DateOption(snap, opts && opts.baseDate, opts);
    return snap;
  }

  function renderDoc5PreviewSnapshot(ctx) {
    var host = createOffscreenHost();
    try {
      var box = document.createElement("div");
      host.appendChild(box);
      renderDoc5Into(box, ctx.dayData, ctx.settings, ctx.stamps);
      var sheet = box.querySelector(".a4-sheet");
      if (!sheet) return null;
      return renderSingleSheetSnapshot(sheet, {
        blankDate: Boolean(ctx.blankDate),
        dateOffset: ctx.dateOffset,
        baseDate: ctx.dayData && ctx.dayData.date
      });
    } finally {
      host.remove();
    }
  }

  function printCurrentSheet(sheetEl, opts) {
    if (!sheetEl) {
      window.print();
      return;
    }
    var snap = renderSingleSheetSnapshot(sheetEl, opts);
    printSnapshots([snap]);
  }

  async function printAllFive(ctx) {
    var snapshots = await renderAllSheets(ctx);
    printSnapshots(snapshots);
  }

  async function printTbmSheets(ctx) {
    var snapshots = await renderTbmSnapshots(ctx);
    if (snapshots.length === 0) return;
    printSnapshots(snapshots);
  }

  root.DayrepExport = {
    MAX_TBM_PRINT_SHEETS: MAX_TBM_PRINT_SHEETS,
    formatBlankDateStr: formatBlankDateStr,
    buildBundleHtml: buildBundleHtml,
    renderSingleSheetSnapshot: renderSingleSheetSnapshot,
    renderDoc5PreviewSnapshot: renderDoc5PreviewSnapshot,
    renderTbmSnapshots: renderTbmSnapshots,
    printCurrentSheet: printCurrentSheet,
    printAllFive: printAllFive,
    printTbmSheets: printTbmSheets
  };
})(window);
