(function () {
  "use strict";

  var TAB_TITLES = {
    doc1: "① 안전교육일지",
    doc2: "② T.B.M 사진대지",
    doc3: "③ 안전 순회 점검표",
    doc4: "④ 무인 타워크레인 점검일지",
    doc5: "⑤ T.B.M 일지",
    archive: "보관함",
    guide: "사용 가이드"
  };

  var ZOOM_STORAGE_KEY = "dayrep_sheet_zoom";
  var ZOOM_MIN = 50;
  var ZOOM_MAX = 200;
  var ZOOM_STEP = 10;

  function clampZoom(val) {
    var n = Number(val);
    if (!Number.isFinite(n)) return 100;
    n = Math.round(n);
    if (n < ZOOM_MIN) return ZOOM_MIN;
    if (n > ZOOM_MAX) return ZOOM_MAX;
    return n;
  }

  function loadSavedZoom() {
    try {
      var raw = localStorage.getItem(ZOOM_STORAGE_KEY);
      if (raw === null || raw === "") return 100;
      return clampZoom(raw);
    } catch (_) {
      return 100;
    }
  }

  var state = {
    activeTab: "doc1",
    currentDate: todayIso(),
    dataDir: "",
    settings: null,
    currentDay: null,
    daysIndex: [],
    stamps: {},
    riskLibrary: window.DayrepRiskLibrary ? window.DayrepRiskLibrary.normalizeLibrary(null) : { schemaVersion: 1, entries: [] },
    sheetZoom: loadSavedZoom()
  };

  function isDocTab(tabId) {
    return ["doc1", "doc2", "doc3", "doc4", "doc5"].indexOf(tabId) !== -1;
  }

  function applySheetZoom(pct, persist) {
    state.sheetZoom = clampZoom(pct);
    document.documentElement.style.setProperty("--sheet-zoom", String(state.sheetZoom / 100));
    var resetBtn = document.getElementById("btn-zoom-reset");
    if (resetBtn) {
      resetBtn.textContent = state.sheetZoom + "%";
    }
    if (persist) {
      try {
        localStorage.setItem(ZOOM_STORAGE_KEY, String(state.sheetZoom));
      } catch (_) {}
    }
  }

  function fitSheetWidth() {
    var pane = document.querySelector(".content-pane");
    if (!pane) return;
    var cs = window.getComputedStyle(pane);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var avail = pane.clientWidth - padX - 16;
    if (avail <= 0) return;
    var pct = Math.floor((avail / 793.7) * 100);
    applySheetZoom(pct, true);
  }

  var doc1Ctrl = window.DayrepDoc1UI.createDoc1Controller();
  var doc2Ctrl = window.DayrepDoc2UI.createDoc2Controller();
  var doc3Ctrl = window.DayrepDoc3UI.createDoc3Controller();
  var doc4Ctrl = window.DayrepDoc4UI.createDoc4Controller();
  var doc5Ctrl = window.DayrepDoc5UI.createDoc5Controller();
  var archiveCtrl = window.DayrepArchiveUI.createArchiveController();
  var saveTimer = null;
  var libSaveQueue = Promise.resolve();
  var manualRiskTimer = null;
  var manualRiskBaseline = new Set();
  var manualRiskFailNotified = false;

  function setManualRiskBaseline(dayData) {
    var rows = dayData && dayData.tbmLog && Array.isArray(dayData.tbmLog.riskRows)
      ? dayData.tbmLog.riskRows
      : [];
    if (window.DayrepRiskLibrary && typeof window.DayrepRiskLibrary.collectCompleteSignatures === "function") {
      manualRiskBaseline = window.DayrepRiskLibrary.collectCompleteSignatures(rows);
    } else {
      manualRiskBaseline = new Set();
    }
  }

  function flushManualRiskAccumulation() {
    if (manualRiskTimer) {
      clearTimeout(manualRiskTimer);
      manualRiskTimer = null;
    }
    var day = state.currentDay;
    if (!day || !day.tbmLog || !Array.isArray(day.tbmLog.riskRows)) return;
    if (!window.DayrepRiskLibrary || typeof window.DayrepRiskLibrary.diffChangedCompleteRows !== "function") return;
    var diff = window.DayrepRiskLibrary.diffChangedCompleteRows(day.tbmLog.riskRows, manualRiskBaseline);
    if (!diff.changedRows || diff.changedRows.length === 0) return;
    manualRiskBaseline = diff.nextBaseline;
    accumulateRiskLibrary(diff.changedRows, {
      category: String((day.eduLog && day.eduLog.workType) || "").trim(),
      source: "manual",
      quiet: true
    }).then(function (res) {
      if (res && res.error && !manualRiskFailNotified) {
        manualRiskFailNotified = true;
        showToast("라이브러리 자동 저장 실패(서류 저장은 정상): " + String(res.error), true);
      }
    });
  }

  function enqueueRiskLibrarySave(nextLib) {
    var normalized = window.DayrepRiskLibrary
      ? window.DayrepRiskLibrary.normalizeLibrary(nextLib)
      : nextLib;
    state.riskLibrary = normalized;
    var runSave = async function () {
      var invoke = getInvoke();
      if (!invoke) return;
      await invoke("save_risk_library", { library: state.riskLibrary });
    };
    var p = libSaveQueue.then(runSave, runSave);
    libSaveQueue = p.catch(function () {});
    return p;
  }

  async function accumulateRiskLibrary(rows, meta) {
    if (!window.DayrepRiskLibrary) {
      return { added: 0, merged: 0, saved: false };
    }
    meta = meta || {};
    var res = window.DayrepRiskLibrary.addRows(state.riskLibrary, rows, {
      category: meta.category || "",
      source: meta.source || "ai"
    });
    if (res.added === 0 && res.merged === 0) {
      if (meta.source === "manual" && !meta.quiet) {
        showToast("보관하려면 장비·유해위험요인·감소대책을 모두 입력해 주세요.", true);
      }
      return { added: 0, merged: 0, saved: false };
    }
    if (state.currentDay) {
      setManualRiskBaseline(state.currentDay);
    }
    state.riskLibrary = res.library;
    if (window.DayrepSettingsUI && typeof window.DayrepSettingsUI.renderRiskLibrarySection === "function") {
      window.DayrepSettingsUI.renderRiskLibrarySection();
    }
    try {
      await enqueueRiskLibrarySave(state.riskLibrary);
      if (!meta.quiet) {
        showToast(
          "위험성평가 라이브러리에 보관했습니다. (신규 " + res.added + "건, 갱신 " + res.merged + "건)",
          false
        );
      }
      return { added: res.added, merged: res.merged, saved: true };
    } catch (err) {
      console.warn("[risk_library] save failed:", err);
      if (!meta.quiet) {
        showToast("라이브러리 저장 실패: " + String(err), true);
      }
      return { added: res.added, merged: res.merged, saved: false, error: err };
    }
  }

  async function bumpRiskLibraryUsage(ids) {
    if (!window.DayrepRiskLibrary || !Array.isArray(ids) || ids.length === 0) return;
    if (state.currentDay) {
      setManualRiskBaseline(state.currentDay);
    }
    state.riskLibrary = window.DayrepRiskLibrary.bumpUsage(state.riskLibrary, ids);
    if (window.DayrepSettingsUI && typeof window.DayrepSettingsUI.renderRiskLibrarySection === "function") {
      window.DayrepSettingsUI.renderRiskLibrarySection();
    }
    try {
      await enqueueRiskLibrarySave(state.riskLibrary);
    } catch (err) {
      console.warn("[risk_library] bump usage save failed:", err);
    }
  }

  function getInvoke() {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke;
    }
    return null;
  }

  function todayIso() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function shiftDate(dateStr, deltaDays) {
    var parts = dateStr.split("-").map(Number);
    var dt = new Date(parts[0], parts[1] - 1, parts[2] + deltaDays);
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var day = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function showToast(msg, isError) {
    var el = document.getElementById("global-toast");
    if (!el) return;
    el.textContent = msg;
    el.className = isError ? "global-toast error" : "global-toast";
  }

  async function persistCurrentDay() {
    var invoke = getInvoke();
    if (!invoke || !state.currentDay) return;
    try {
      await invoke("save_day", {
        date: state.currentDate,
        json: state.currentDay
      });
      var badge = document.getElementById("day-status-badge");
      if (badge) badge.textContent = "저장됨";
      showToast("자동 저장됨 (" + state.currentDate + ")", false);
    } catch (err) {
      showToast("저장 실패: " + String(err), true);
    }
  }

  function scheduleSaveDay(dayData) {
    state.currentDay = dayData;
    var badge = document.getElementById("day-status-badge");
    if (badge) badge.textContent = "수정 중...";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persistCurrentDay();
    }, 1000);
    if (state.activeTab === "doc5") {
      if (manualRiskTimer) clearTimeout(manualRiskTimer);
      manualRiskTimer = setTimeout(function () {
        manualRiskTimer = null;
        flushManualRiskAccumulation();
      }, 10000);
    }
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistCurrentDay();
    }
  }

  function openBatchModal(mode) {
    if (!window.DayrepBatchUI) return;
    window.DayrepBatchUI.open({
      mode: mode || "generate",
      invoke: getInvoke(),
      getSettings: function () { return state.settings; },
      getStamps: function () { return state.stamps; },
      getCurrentDate: function () { return state.currentDate; },
      hasPendingEdit: function () { return Boolean(saveTimer); },
      flushPendingSave: flushPendingSave,
      refreshAfterBatch: async function (appliedDates) {
        var invoke = getInvoke();
        if (invoke) {
          try {
            state.daysIndex = await invoke("list_days");
          } catch (_) {}
        }
        if (Array.isArray(appliedDates) && appliedDates.indexOf(state.currentDate) !== -1) {
          await openDate(state.currentDate);
        } else {
          renderActiveView();
        }
      },
      onAccumulateRiskLibrary: accumulateRiskLibrary,
      getRiskLibrary: function () { return state.riskLibrary; },
      onBumpRiskLibraryUsage: bumpRiskLibraryUsage,
      showToast: showToast
    });
  }

  function renderActiveView() {
    var doc1View = document.getElementById("view-doc1");
    var doc2View = document.getElementById("view-doc2");
    var doc3View = document.getElementById("view-doc3");
    var doc4View = document.getElementById("view-doc4");
    var doc5View = document.getElementById("view-doc5");
    var archiveView = document.getElementById("view-archive");
    var guideView = document.getElementById("view-guide");
    var placeholderView = document.getElementById("view-placeholder");
    var settingsView = document.getElementById("view-settings");

    doc1View.classList.add("hidden");
    doc2View.classList.add("hidden");
    doc3View.classList.add("hidden");
    doc4View.classList.add("hidden");
    doc5View.classList.add("hidden");
    archiveView.classList.add("hidden");
    if (guideView) guideView.classList.add("hidden");
    placeholderView.classList.add("hidden");
    settingsView.classList.add("hidden");

    if (state.activeTab === "settings") {
      settingsView.classList.remove("hidden");
    } else if (state.activeTab === "guide") {
      if (guideView) {
        guideView.classList.remove("hidden");
        if (window.DayrepGuideUI && typeof window.DayrepGuideUI.render === "function") {
          window.DayrepGuideUI.render(guideView);
        }
      }
    } else if (state.activeTab === "archive") {
      archiveView.classList.remove("hidden");
      archiveCtrl.render(archiveView, {
        invoke: getInvoke(),
        showToast: showToast,
        onSelectDate: async function (dateStr) {
          await openDate(dateStr);
          switchTab("doc1");
        }
      });
    } else if (state.activeTab === "doc1") {
      doc1View.classList.remove("hidden");
      if (state.currentDay) {
        doc1Ctrl.render(doc1View, {
          invoke: getInvoke(),
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps,
          prevEduContents: state.prevEduContents || "",
          onDayChange: scheduleSaveDay,
          showToast: showToast
        });
      }
    } else if (state.activeTab === "doc2") {
      doc2View.classList.remove("hidden");
      if (state.currentDay) {
        doc2Ctrl.render(doc2View, {
          invoke: getInvoke(),
          dayData: state.currentDay,
          onDayChange: scheduleSaveDay,
          showToast: showToast
        });
      }
    } else if (state.activeTab === "doc3") {
      doc3View.classList.remove("hidden");
      if (state.currentDay) {
        doc3Ctrl.render(doc3View, {
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps,
          onDayChange: scheduleSaveDay
        });
      }
    } else if (state.activeTab === "doc4") {
      doc4View.classList.remove("hidden");
      if (state.currentDay) {
        doc4Ctrl.render(doc4View, {
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps,
          onDayChange: scheduleSaveDay
        });
      }
    } else if (state.activeTab === "doc5") {
      doc5View.classList.remove("hidden");
      if (state.currentDay) {
        doc5Ctrl.render(doc5View, {
          invoke: getInvoke(),
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps,
          onDayChange: scheduleSaveDay,
          onOpenBatch: function () { openBatchModal("generate"); },
          onOpenManage: function () { openBatchModal("manage"); },
          onAccumulateRiskLibrary: accumulateRiskLibrary,
          getRiskLibrary: function () { return state.riskLibrary; },
          onBumpRiskLibraryUsage: bumpRiskLibraryUsage,
          onBeforePrint: flushManualRiskAccumulation,
          showToast: showToast
        });
      }
    } else {
      placeholderView.classList.remove("hidden");
      renderPlaceholder();
    }
  }

  function renderPlaceholder() {
    var titleEl = document.getElementById("placeholder-title");
    var descEl = document.getElementById("placeholder-desc");
    if (titleEl) {
      titleEl.textContent = TAB_TITLES[state.activeTab] || "일일서류";
    }
    if (descEl) {
      descEl.textContent = state.activeTab === "archive"
        ? "보관함 화면은 DR-6 단계에서 구현됩니다."
        : "준비 중입니다. (DR-4~5 단계에서 서류 양식 및 편집 기능이 구현됩니다.)";
    }

    var day = state.currentDay;
    var cfg = window.DayrepCarryover.createDefaultSettings(state.settings);
    document.getElementById("ph-date").textContent = state.currentDate;
    document.getElementById("ph-carried").textContent = day && day.carriedFrom
      ? day.carriedFrom + " 에서 이월됨"
      : "기본값 (신규/기존 저장)";
    document.getElementById("ph-site").textContent = cfg.siteName || "(설정에서 현장명 입력)";

    var sum = 0;
    if (day && day.eduLog && Array.isArray(day.eduLog.categories)) {
      day.eduLog.categories.forEach(function (c) {
        sum += Number(c.count) || 0;
      });
    }
    document.getElementById("ph-headcount").textContent = String(sum) + "명";
  }

  function getSelectedPrintCount() {
    var pd = (state.settings && state.settings.printDocs) || {};
    var keys = ["doc1", "doc2", "doc3", "doc4", "doc5"];
    var cnt = 0;
    keys.forEach(function (k) {
      if (pd[k] !== false) cnt += 1;
    });
    return cnt > 0 ? cnt : 5;
  }

  function updatePrintButtonLabel() {
    var btn = document.getElementById("btn-print-all");
    if (btn) {
      btn.textContent = getSelectedPrintCount() + "종 일괄 인쇄";
    }
  }

  function switchTab(tabId) {
    if (state.activeTab === "doc5" && tabId !== "doc5") {
      flushManualRiskAccumulation();
    }
    state.activeTab = tabId;
    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });
    var zoomBox = document.getElementById("zoom-controls");
    if (zoomBox) {
      zoomBox.classList.toggle("hidden", !isDocTab(tabId));
    }
    renderActiveView();
  }

  async function loadStampsCache(invoke) {
    if (!invoke) return;
    var slots = ["staff", "director", "chief", "crane_staff"];
    var map = {};
    for (var i = 0; i < slots.length; i++) {
      try {
        var res = await invoke("read_stamp", { slot: slots[i] });
        if (res && res.base64) map[slots[i]] = res;
      } catch (e) {
        // ignore missing stamp
      }
    }
    state.stamps = map;
  }

  async function openDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    flushManualRiskAccumulation();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await persistCurrentDay();
    }

    state.currentDate = dateStr;
    doc2Ctrl.resetDateCache();
    var picker = document.getElementById("date-picker");
    if (picker) picker.value = dateStr;

    var badge = document.getElementById("day-status-badge");
    var invoke = getInvoke();
    if (!invoke) {
      state.currentDay = window.DayrepCarryover.buildDayFromCarryover(dateStr, null, state.settings);
      setManualRiskBaseline(state.currentDay);
      if (badge) badge.textContent = "오프라인 미리보기";
      renderActiveView();
      return;
    }

    try {
      state.daysIndex = await invoke("list_days");
      var exists = state.daysIndex.some(function (item) {
        return item.date === dateStr;
      });

      if (exists) {
        state.currentDay = await invoke("load_day", { date: dateStr });
        var prevForCtx = window.DayrepCarryover.findNearestPreviousDate(dateStr, state.daysIndex);
        if (prevForCtx) {
          try {
            var pData = await invoke("load_day", { date: prevForCtx });
            state.prevEduContents = pData && pData.eduLog ? (pData.eduLog.contents || "") : "";
          } catch (e) {
            state.prevEduContents = "";
          }
        } else {
          state.prevEduContents = "";
        }
        if (badge) badge.textContent = "저장된 날짜";
      } else {
        var prevDate = window.DayrepCarryover.findNearestPreviousDate(dateStr, state.daysIndex);
        var prevData = prevDate ? await invoke("load_day", { date: prevDate }) : null;
        state.prevEduContents = prevData && prevData.eduLog ? (prevData.eduLog.contents || "") : "";
        state.currentDay = window.DayrepCarryover.buildDayFromCarryover(
          dateStr,
          prevData,
          state.settings
        );
        if (badge) {
          badge.textContent = prevDate ? ("전일(" + prevDate + ") 이월") : "새 날짜";
        }
      }
      setManualRiskBaseline(state.currentDay);
      renderActiveView();
    } catch (err) {
      showToast("날짜 불러오기 실패: " + String(err), true);
    }
  }

  async function loadInitialState() {
    var invoke = getInvoke();
    if (!invoke) {
      state.settings = window.DayrepCarryover.createDefaultSettings({});
      updatePrintButtonLabel();
      window.DayrepSettingsUI.renderSettingsForm(state.settings, "Tauri 런타임 없음");
      await openDate(state.currentDate);
      return;
    }

    try {
      state.dataDir = await invoke("get_data_dir");
      var rawSettings = await invoke("load_settings");
      state.settings = window.DayrepCarryover.createDefaultSettings(rawSettings);
      var maskedSecrets = {};
      try {
        maskedSecrets = await invoke("load_secrets_masked");
      } catch (e) {
        maskedSecrets = {};
      }

      var sidebarDir = document.getElementById("sidebar-data-dir");
      if (sidebarDir) sidebarDir.textContent = state.dataDir;

      await loadStampsCache(invoke);
      try {
        var rawLib = await invoke("load_risk_library");
        state.riskLibrary = window.DayrepRiskLibrary
          ? window.DayrepRiskLibrary.normalizeLibrary(rawLib)
          : rawLib;
      } catch (libErr) {
        console.warn("[risk_library] load failed:", libErr);
        state.riskLibrary = window.DayrepRiskLibrary
          ? window.DayrepRiskLibrary.normalizeLibrary(null)
          : { schemaVersion: 1, entries: [] };
      }
      updatePrintButtonLabel();
      window.DayrepSettingsUI.renderSettingsForm(state.settings, state.dataDir, maskedSecrets);
      if (window.DayrepSettingsUI && typeof window.DayrepSettingsUI.renderRiskLibrarySection === "function") {
        window.DayrepSettingsUI.renderRiskLibrarySection();
      }
      await window.DayrepSettingsUI.renderStampGrid(invoke, showToast);
      await openDate(state.currentDate);
      showToast("준비 완료", false);
    } catch (err) {
      showToast("초기화 오류: " + String(err), true);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var invoke = getInvoke();

    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.getAttribute("data-tab"));
      });
    });

    var picker = document.getElementById("date-picker");
    if (picker) {
      picker.addEventListener("change", function () {
        if (picker.value) openDate(picker.value);
      });
    }

    document.getElementById("btn-prev-day").addEventListener("click", function () {
      openDate(shiftDate(state.currentDate, -1));
    });
    document.getElementById("btn-next-day").addEventListener("click", function () {
      openDate(shiftDate(state.currentDate, 1));
    });
    document.getElementById("btn-today").addEventListener("click", function () {
      openDate(todayIso());
    });
    document.getElementById("btn-sidebar-today").addEventListener("click", function () {
      openDate(todayIso());
    });

    async function runBackupIfConfigured(dirOverride) {
      var invoke = getInvoke();
      var backupDir = dirOverride !== undefined
        ? dirOverride
        : (state.settings && state.settings.backupDir ? state.settings.backupDir : "");
      if (!invoke || !backupDir) return;
      try {
        await invoke("backup_day", {
          date: state.currentDate,
          backupDir: backupDir
        });
      } catch (err) {
        showToast("추가 백업 폴더 복사 실패 (본 저장은 완료됨): " + String(err), true);
      }
    }

    document.getElementById("btn-export-pdf").addEventListener("click", async function () {
      var invoke = getInvoke();
      if (!state.currentDay) return;
      flushManualRiskAccumulation();
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await persistCurrentDay();

      if (!invoke) {
        showToast("Tauri 환경이 아니어서 시스템 인쇄(Ctrl+P)를 실행합니다.", false);
        await window.DayrepExport.printAllFive({
          invoke: null,
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps
        });
        return;
      }

      try {
        var docCnt = getSelectedPrintCount();
        showToast(docCnt + "장 PDF 생성 중...", false);
        var html = await window.DayrepExport.buildBundleHtml({
          invoke: invoke,
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps
        });
        var savedPath = await invoke("export_pdf", {
          date: state.currentDate,
          html: html
        });
        showToast("PDF 저장 완료: " + savedPath, false);
        await runBackupIfConfigured();
      } catch (err) {
        showToast("PDF 생성 실패(" + String(err) + ") → 시스템 인쇄 창을 엽니다.", true);
        await window.DayrepExport.printAllFive({
          invoke: invoke,
          dayData: state.currentDay,
          settings: state.settings,
          stamps: state.stamps
        });
      }
    });

    document.getElementById("btn-print-all").addEventListener("click", async function () {
      if (!state.currentDay) return;
      flushManualRiskAccumulation();
      await window.DayrepExport.printAllFive({
        invoke: getInvoke(),
        dayData: state.currentDay,
        settings: state.settings,
        stamps: state.stamps
      });
    });

    window.DayrepSettingsUI.bindSettingsEvents({
      invoke: invoke,
      getSettings: function () {
        return state.settings;
      },
      setSettings: function (next) {
        state.settings = next;
        updatePrintButtonLabel();
      },
      onSaved: async function () {
        updatePrintButtonLabel();
        await loadStampsCache(invoke);
        await openDate(state.currentDate);
      },
      onDataDirChanged: async function () {
        await loadInitialState();
        showToast("데이터 폴더가 변경되었습니다.", false);
      },
      onRunBackupNow: async function (backupDir) {
        if (!backupDir) {
          showToast("추가 백업 폴더를 먼저 선택해 주세요.", true);
          return;
        }
        await persistCurrentDay();
        try {
          var dst = await invoke("backup_day", {
            date: state.currentDate,
            backupDir: backupDir
          });
          showToast("백업 완료: " + dst, false);
        } catch (err) {
          showToast("백업 실패: " + String(err), true);
        }
      },
      getRiskLibrary: function () {
        return state.riskLibrary;
      },
      onSaveRiskLibrary: async function (nextLib) {
        await enqueueRiskLibrarySave(nextLib);
        if (window.DayrepSettingsUI && typeof window.DayrepSettingsUI.renderRiskLibrarySection === "function") {
          window.DayrepSettingsUI.renderRiskLibrarySection();
        }
      },
      showToast: showToast
    });

    document.addEventListener("paste", function (e) {
      if (state.activeTab === "doc2") {
        doc2Ctrl.handlePaste(e);
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        flushManualRiskAccumulation();
      }
    });
    window.addEventListener("beforeunload", function () {
      flushManualRiskAccumulation();
    });

    applySheetZoom(state.sheetZoom, false);
    var zoomBoxInit = document.getElementById("zoom-controls");
    if (zoomBoxInit) zoomBoxInit.classList.toggle("hidden", !isDocTab(state.activeTab));

    var btnZoomOut = document.getElementById("btn-zoom-out");
    if (btnZoomOut) {
      btnZoomOut.addEventListener("click", function () {
        applySheetZoom(state.sheetZoom - ZOOM_STEP, true);
      });
    }
    var btnZoomIn = document.getElementById("btn-zoom-in");
    if (btnZoomIn) {
      btnZoomIn.addEventListener("click", function () {
        applySheetZoom(state.sheetZoom + ZOOM_STEP, true);
      });
    }
    var btnZoomReset = document.getElementById("btn-zoom-reset");
    if (btnZoomReset) {
      btnZoomReset.addEventListener("click", function () {
        applySheetZoom(100, true);
      });
    }
    var btnZoomFit = document.getElementById("btn-zoom-fit");
    if (btnZoomFit) {
      btnZoomFit.addEventListener("click", fitSheetWidth);
    }

    var contentPane = document.querySelector(".content-pane");
    if (contentPane) {
      contentPane.addEventListener(
        "wheel",
        function (e) {
          if (!e.ctrlKey) return;
          if (!isDocTab(state.activeTab)) return;
          e.preventDefault();
          var delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
          applySheetZoom(state.sheetZoom + delta, true);
        },
        { passive: false }
      );
    }

    window.addEventListener("focus", async function () {
      var invoke = getInvoke();
      if (!invoke || !state.currentDate || !state.currentDay) return;
      if (saveTimer !== null) {
        showToast("외부 변경 감지(편집 중이라 자동 반영 생략)", false);
        return;
      }
      try {
        var fresh = await invoke("load_day", { date: state.currentDate });
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(state.currentDay)) {
          state.currentDay = fresh;
          renderActiveView();
          showToast("외부 변경이 반영되었습니다.", false);
        }
      } catch (e) {
        // ignore focus refresh failure
      }
    });

    loadInitialState();
  });
})();
