(function (root) {
  "use strict";

  var MIN_ROWS = 4;

  function getAiConfig(settings) {
    var ai = (settings && settings.ai) || {};
    var engine = ai.engine || "hermes";
    var ep = (ai.endpoints && ai.endpoints[engine]) || {};
    return {
      engine: engine,
      endpoint: ai.hermesEndpoint || "http://127.0.0.1:8642/v1/chat/completions",
      baseUrl: ep.baseUrl || "",
      model: ep.model || ""
    };
  }

  function isLocalEngine(engine) {
    return engine === "hermes" || engine === "lmstudio" || engine === "opencode";
  }

  function hasExistingTbmContent(dayData) {
    var tbm = dayData && dayData.tbmLog;
    if (!tbm || !Array.isArray(tbm.riskRows)) return false;
    return tbm.riskRows.some(function (r) {
      if (!r) return false;
      return Boolean(
        String(r.item || r.tool || "").trim() ||
        String(r.hazard || "").trim() ||
        String(r.measure || "").trim()
      );
    });
  }

  function padRiskRows(rows) {
    var out = Array.isArray(rows)
      ? rows.map(function (r) {
          return {
            item: String((r && (r.item !== undefined ? r.item : r.tool)) || ""),
            hazard: String((r && r.hazard) || ""),
            type: String((r && (r.type !== undefined ? r.type : r.accident)) || ""),
            level: String((r && r.level) || "중"),
            measure: String((r && r.measure) || "")
          };
        })
      : [];
    while (out.length < MIN_ROWS) {
      out.push({ item: "", hazard: "", type: "", level: "중", measure: "" });
    }
    return out;
  }

  function createEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function open(opts) {
    var modalRoot = opts.modalRoot || document.getElementById("batch-modal-root");
    if (!modalRoot) return;

    var settings = (opts.getSettings && opts.getSettings()) || {};
    var currentDate = (opts.getCurrentDate && opts.getCurrentDate()) || "";
    var aiCfg = getAiConfig(settings);

    var BLANK_DATE_STORAGE_KEY = "dayrep_doc5_blank_date_print";
    var DATE_OFFSET_STORAGE_KEY = "dayrep_doc5_print_date_offset";
    var initBlankDate = true;
    var initDateOffset = 0;

    function clampDateOffset(val) {
      var n = Number(val);
      if (!Number.isFinite(n)) return 0;
      n = Math.trunc(n);
      if (n < -7) return -7;
      if (n > 31) return 31;
      return n;
    }

    try {
      var savedBlank = localStorage.getItem(BLANK_DATE_STORAGE_KEY);
      initBlankDate = savedBlank === null ? true : savedBlank === "1";
    } catch (_) {
      initBlankDate = true;
    }
    try {
      var savedOff = localStorage.getItem(DATE_OFFSET_STORAGE_KEY);
      if (savedOff !== null && savedOff !== "") {
        initDateOffset = clampDateOffset(savedOff);
      }
    } catch (_) {
      initDateOffset = 0;
    }

    var AI_ROW_COUNT_STORAGE_KEY = "dayrep_doc5_ai_row_count";
    var MAX_AI_ROW_COUNT = 8;
    var initAiRowCount = "auto";
    try {
      var savedRc = localStorage.getItem(AI_ROW_COUNT_STORAGE_KEY);
      if (savedRc && savedRc !== "auto") {
        var parsedRc = Math.floor(Number(savedRc));
        if (Number.isFinite(parsedRc) && parsedRc >= 3 && parsedRc <= MAX_AI_ROW_COUNT) {
          initAiRowCount = String(parsedRc);
        }
      }
    } catch (_) {
      initAiRowCount = "auto";
    }

    var state = {
      mode: opts.mode === "manage" ? "manage" : "generate",
      stage: opts.mode === "manage" ? "manage_option" : "option",
      spanDays: 7,
      manageSpanType: "7",
      startDate: currentDate,
      manageEndDate: currentDate,
      useSchedule: true,
      useConstruction: true,
      useRiskLibrary: settings.riskLibraryAssist !== false,
      aiRowCount: initAiRowCount,
      blankDateOnPrint: initBlankDate,
      dateOffsetOnPrint: initDateOffset,
      lastDateKey: "",
      selectedDateMap: {},
      daysList: [],
      unsavedDates: [],
      rightTab: "edit",
      cellAiBusy: false,
      cellAiCancelled: false,
      cellAiActive: null,
      cellAiProgress: "",
      cellAiReqToken: 0,
      headerAiMenuCol: null,
      headerAiOverwrite: false,
      cancelled: false,
      abortNotice: "",
      applySummary: "",
      progressIdx: 0,
      progressTotal: 0,
      progressDate: "",
      results: [],
      selectedIdx: 0,
      applying: false,
      printing: false
    };

    function markDirty(item) {
      if (!item) return;
      var nowRowsJson = JSON.stringify(item.rows || []);
      item.dirty = (item.workSection || "") !== (item.origWorkSection || "") || nowRowsJson !== (item.origRowsJson || "");
      if (state.mode === "manage") {
        item.saveChecked = item.dirty;
        var rowEl = modalRoot.querySelector('.batch-review-item[data-batch-date="' + item.date + '"]');
        if (rowEl) {
          var saveChk = rowEl.querySelector(".batch-save-chk");
          if (saveChk) saveChk.checked = Boolean(item.saveChecked);
          var badgeRow = rowEl.querySelector(".batch-badge-row");
          if (badgeRow) {
            var existingDirty = badgeRow.querySelector(".batch-badge.dirty");
            if (item.dirty && !existingDirty) {
              badgeRow.appendChild(createEl("span", "batch-badge dirty", "변경됨"));
            } else if (!item.dirty && existingDirty) {
              existingDirty.remove();
            }
          }
        }
        var btnApply = modalRoot.querySelector(".batch-apply-btn");
        if (btnApply) {
          var cnt = state.results.filter(function (r) {
            return r.saveChecked && (r.status === "saved" || r.status === "ok");
          }).length;
          btnApply.textContent = "변경분 저장 (" + cnt + "건)";
          btnApply.disabled = state.applying || cnt === 0;
        }
      }
    }

    function syncSelectedDates() {
      var dates = root.DayrepSchedule ? root.DayrepSchedule.enumerateDates(state.startDate, state.spanDays) : [];
      var key = dates.join(",");
      if (key !== state.lastDateKey) {
        state.lastDateKey = key;
        var map = {};
        dates.forEach(function (d) {
          map[d] = true;
        });
        state.selectedDateMap = map;
      }
      return dates;
    }

    function getSelectedDates() {
      var dates = syncSelectedDates();
      return dates.filter(function (d) {
        return Boolean(state.selectedDateMap[d]);
      });
    }

    function cancelPendingCellAi() {
      state.cellAiCancelled = true;
      state.cellAiBusy = false;
      state.cellAiActive = null;
      state.cellAiProgress = "";
      state.cellAiReqToken += 1;
      state.headerAiMenuCol = null;
    }

    function cloneRows(rows) {
      return (rows || []).map(function (r) {
        return {
          item: String((r && r.item) || ""),
          hazard: String((r && r.hazard) || ""),
          type: String((r && r.type) || ""),
          level: String((r && r.level) || "중"),
          measure: String((r && r.measure) || "")
        };
      });
    }

    async function callModalAi(prompt, temperature) {
      if (!opts.invoke) {
        if (opts.showToast) opts.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return null;
      }
      if (aiCfg.engine === "claude_mcp") {
        if (opts.showToast) opts.showToast("Claude MCP는 앱 내부에서 직접 AI를 호출하지 않습니다.", true);
        return null;
      }
      return await opts.invoke("ai_generate", {
        engine: aiCfg.engine,
        prompt: prompt,
        options: {
          endpoint: aiCfg.endpoint,
          baseUrl: aiCfg.baseUrl,
          model: aiCfg.model,
          temperature: temperature
        }
      });
    }

    function buildRowDayCtx(item) {
      var d = item && item.dayData ? item.dayData : {};
      return {
        workSection: (item && item.workSection) || "",
        workType: (d.eduLog && d.eduLog.workType) || "",
        weather: (d.patrol && d.patrol.weather) || "",
        siteContext: d.siteContext || {}
      };
    }

    function pickBatchLibraryExamples(workType, workSection, tool, enabled) {
      if (!enabled) return undefined;
      if (typeof opts.getRiskLibrary !== "function" || !root.DayrepRiskLibrary || typeof root.DayrepRiskLibrary.pickExamples !== "function") {
        return undefined;
      }
      try {
        var lib = opts.getRiskLibrary();
        if (!lib || !Array.isArray(lib.entries) || lib.entries.length === 0) return undefined;
        var picked = root.DayrepRiskLibrary.pickExamples(lib, {
          category: workType || "",
          workSection: workSection || "",
          tool: tool || "",
          limit: 8
        });
        return picked && picked.length > 0 ? picked : undefined;
      } catch (_) {
        return undefined;
      }
    }

    async function runCellAi(col, item, rowIdx, skipUndoSave) {
      if (!item || !item.rows || !item.rows[rowIdx]) return { ok: false, error: "행 없음" };
      var rowRef = item.rows[rowIdx];
      var capturedDate = item.date;
      var reqToken = state.cellAiReqToken;
      var dCtx = buildRowDayCtx(item);
      var ap = root.DayrepAiPrompts;
      if (!ap) return { ok: false, error: "AI 프롬프트 모듈 없음" };

      function isStale() {
        if (state.cellAiCancelled || reqToken !== state.cellAiReqToken) return true;
        var cur = state.results[state.selectedIdx];
        if (!cur || cur.date !== capturedDate) return true;
        return !cur.rows || cur.rows[rowIdx] !== rowRef;
      }

      if (col === "tool") {
        var existingTools = item.rows
          .filter(function (_, idx) { return idx !== rowIdx; })
          .map(function (r) { return String((r && r.item) || "").trim(); })
          .filter(Boolean);
        var tPrompt = ap.buildToolPrompt(settings, {
          workSection: dCtx.workSection,
          workType: dCtx.workType,
          siteContext: dCtx.siteContext,
          existingTools: existingTools,
          libraryExamples: pickBatchLibraryExamples(dCtx.workType, dCtx.workSection, "", settings.riskLibraryAssist !== false)
        });
        var tResp = await callModalAi(tPrompt, 0.4);
        if (!tResp || isStale()) return { ok: false, stale: true };
        var tParsed = ap.parseToolResponse(tResp.text || "");
        if (!tParsed.ok) {
          var tRetry = await callModalAi(tPrompt + "\n\n[재요청] 장비/도구 이름 1개만 12자 이내로 출력해 주세요.", 0.3);
          if (!tRetry || isStale()) return { ok: false, stale: true };
          tParsed = ap.parseToolResponse(tRetry.text || "");
        }
        if (!tParsed.ok || !tParsed.tool) {
          return { ok: false, error: (tParsed.warnings && tParsed.warnings[0]) || "장비/도구 파싱 실패" };
        }
        if (!skipUndoSave) item.aiUndoRows = cloneRows(item.rows);
        rowRef.item = tParsed.tool;
        rowRef._aiTouched = true;
        markDirty(item);
        return { ok: true };
      }

      if (col === "hazard") {
        var toolName = String(rowRef.item || "").trim();
        if (!toolName) {
          return { ok: false, validation: "먼저 장비/도구를 입력하세요." };
        }
        var rPrompt = ap.buildRiskRowPrompt(settings, {
          tool: toolName,
          weather: dCtx.weather,
          workSection: dCtx.workSection,
          workType: dCtx.workType,
          siteContext: dCtx.siteContext,
          libraryExamples: pickBatchLibraryExamples(dCtx.workType, dCtx.workSection, toolName, settings.riskLibraryAssist !== false)
        });
        var rResp = await callModalAi(rPrompt, 0.4);
        if (!rResp || isStale()) return { ok: false, stale: true };
        var rParsed = ap.parseRiskRowResponse(rResp.text || "");
        if (!rParsed.ok && rParsed.retryHint) {
          var rRetry = await callModalAi(rPrompt + "\n\n[재요청 지시]\n" + rParsed.retryHint, 0.3);
          if (!rRetry || isStale()) return { ok: false, stale: true };
          rParsed = ap.parseRiskRowResponse(rRetry.text || "");
        }
        if (!rParsed.ok || !rParsed.row) {
          return { ok: false, error: (rParsed.warnings && rParsed.warnings[0]) || "위험성평가 파싱 실패" };
        }
        if (!skipUndoSave) item.aiUndoRows = cloneRows(item.rows);
        rowRef.hazard = rParsed.row.hazard || "";
        rowRef.type = rParsed.row.accident || "";
        rowRef.level = rParsed.row.level || "중";
        rowRef.measure = rParsed.row.measure || "";
        rowRef._aiTouched = true;
        markDirty(item);
        return { ok: true };
      }

      if (col === "measure") {
        var hazText = String(rowRef.hazard || "").trim();
        var tText = String(rowRef.item || "").trim();
        if (!hazText && !tText) {
          return { ok: false, validation: "먼저 유해·위험요인 또는 장비/도구를 입력하세요." };
        }
        var mPrompt = ap.buildMeasurePrompt(settings, {
          tool: tText,
          hazard: hazText,
          accident: String(rowRef.type || "").trim(),
          level: String(rowRef.level || "").trim(),
          weather: dCtx.weather,
          workSection: dCtx.workSection,
          workType: dCtx.workType,
          libraryExamples: pickBatchLibraryExamples(dCtx.workType, dCtx.workSection, tText, settings.riskLibraryAssist !== false)
        });
        var mResp = await callModalAi(mPrompt, 0.4);
        if (!mResp || isStale()) return { ok: false, stale: true };
        var mParsed = ap.parseMeasureResponse(mResp.text || "");
        if (!mParsed.ok && mParsed.retryHint) {
          var mRetry = await callModalAi(mPrompt + "\n\n[재요청 지시]\n" + mParsed.retryHint, 0.3);
          if (!mRetry || isStale()) return { ok: false, stale: true };
          mParsed = ap.parseMeasureResponse(mRetry.text || "");
        }
        if (!mParsed.ok || !mParsed.measure) {
          return { ok: false, error: (mParsed.warnings && mParsed.warnings[0]) || "감소대책 파싱 실패" };
        }
        if (!skipUndoSave) item.aiUndoRows = cloneRows(item.rows);
        rowRef.measure = mParsed.measure;
        rowRef._aiTouched = true;
        markDirty(item);
        return { ok: true };
      }

      return { ok: false, error: "알 수 없는 열" };
    }

    async function handleSingleCellAi(col, item, rowIdx) {
      if (state.cellAiBusy) return;
      state.cellAiBusy = true;
      state.cellAiCancelled = false;
      state.cellAiActive = { type: "cell", col: col, rowIdx: rowIdx };
      state.cellAiReqToken += 1;
      var reqToken = state.cellAiReqToken;
      state.cellAiProgress = (rowIdx + 1) + "행 AI 생성 중...";
      render();
      try {
        var res = await runCellAi(col, item, rowIdx, false);
        if (reqToken === state.cellAiReqToken && !state.cellAiCancelled) {
          if (res.validation && opts.showToast) opts.showToast(res.validation, true);
          else if (!res.ok && !res.stale && res.error && opts.showToast) opts.showToast(res.error, true);
        }
      } catch (err) {
        if (reqToken === state.cellAiReqToken && !state.cellAiCancelled && opts.showToast) {
          opts.showToast("AI 생성 실패: " + String(err), true);
        }
      } finally {
        if (reqToken === state.cellAiReqToken) {
          state.cellAiBusy = false;
          state.cellAiActive = null;
          state.cellAiProgress = "";
          render();
        }
      }
    }

    async function handleHeaderBatchAi(col, item, overwrite) {
      if (state.cellAiBusy || !item || !Array.isArray(item.rows)) return;
      if (!opts.invoke) {
        if (opts.showToast) opts.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      if (aiCfg.engine === "claude_mcp") {
        if (opts.showToast) opts.showToast("Claude MCP는 앱 내부에서 직접 AI를 호출하지 않습니다.", true);
        return;
      }

      var targetIndices = [];
      for (var i = 0; i < item.rows.length; i++) {
        var r = item.rows[i];
        if (!r) continue;
        if (col === "tool") {
          if (overwrite || !String(r.item || "").trim()) targetIndices.push(i);
        } else if (col === "hazard") {
          if (!String(r.item || "").trim()) continue;
          if (overwrite || !String(r.hazard || "").trim()) targetIndices.push(i);
        } else if (col === "measure") {
          if (!String(r.hazard || "").trim() && !String(r.item || "").trim()) continue;
          if (overwrite || !String(r.measure || "").trim()) targetIndices.push(i);
        }
      }

      if (targetIndices.length === 0) {
        if (opts.showToast) opts.showToast("생성할 대상 행이 없습니다.", false);
        state.headerAiMenuCol = null;
        render();
        return;
      }

      item.aiUndoRows = cloneRows(item.rows);
      state.headerAiMenuCol = null;
      state.cellAiBusy = true;
      state.cellAiCancelled = false;
      state.cellAiReqToken += 1;
      var reqToken = state.cellAiReqToken;
      var consecutiveErr = 0;
      var capturedDate = item.date;

      try {
        for (var k = 0; k < targetIndices.length; k++) {
          if (state.cellAiCancelled || reqToken !== state.cellAiReqToken) break;
          var curItem = state.results[state.selectedIdx];
          if (!curItem || curItem.date !== capturedDate) break;

          var rIdx = targetIndices[k];
          var rowRef = item.rows[rIdx];
          if (!rowRef) continue;

          // 빈 칸만 모드에서 사용자가 직접 채웠으면 덮어쓰지 않음
          if (!overwrite) {
            if (col === "tool" && String(rowRef.item || "").trim()) continue;
            if (col === "hazard" && String(rowRef.hazard || "").trim()) continue;
            if (col === "measure" && String(rowRef.measure || "").trim()) continue;
          }

          state.cellAiActive = { type: "header", col: col, curRowIdx: rIdx, k: k + 1, total: targetIndices.length };
          state.cellAiProgress = (k + 1) + " / " + targetIndices.length + "행 생성 중...";
          render();

          try {
            var res = await runCellAi(col, item, rIdx, true);
            if (state.cellAiCancelled || reqToken !== state.cellAiReqToken) break;
            if (!res.ok) {
              if (res.stale) break;
              consecutiveErr += 1;
              if (consecutiveErr >= 3) {
                if (opts.showToast) opts.showToast("AI 요청이 연속 3회 실패하여 중단했습니다.", true);
                break;
              }
            } else {
              consecutiveErr = 0;
            }
          } catch (_) {
            consecutiveErr += 1;
            if (consecutiveErr >= 3) {
              if (opts.showToast) opts.showToast("AI 요청이 연속 3회 실패하여 중단했습니다.", true);
              break;
            }
          }
        }
      } finally {
        if (reqToken === state.cellAiReqToken) {
          state.cellAiBusy = false;
          state.cellAiActive = null;
          state.cellAiProgress = "";
          render();
        }
      }
    }

    function close(force) {
      if (!force && state.mode === "manage" && state.stage === "review") {
        var hasDirty = state.results.some(function (r) { return Boolean(r.dirty); });
        if (hasDirty && !window.confirm("저장하지 않은 변경 내용이 있습니다. 닫으시겠습니까?")) {
          return;
        }
      }
      state.cancelled = true;
      cancelPendingCellAi();
      modalRoot.classList.add("hidden");
      modalRoot.textContent = "";
    }

    async function generateOneDate(dateStr, existingSet, daysList) {
      var exists = existingSet.has(dateStr);
      var dayData = null;
      if (exists) {
        try {
          dayData = await opts.invoke("load_day", { date: dateStr });
        } catch (_) {
          dayData = null;
          exists = false;
        }
      }
      if (!dayData) {
        var prevData = null;
        if (root.DayrepCarryover && typeof root.DayrepCarryover.findNearestPreviousDate === "function") {
          var prevDate = root.DayrepCarryover.findNearestPreviousDate(dateStr, daysList || []);
          if (prevDate) {
            try {
              prevData = await opts.invoke("load_day", { date: prevDate });
            } catch (_) {
              prevData = null;
            }
          }
        }
        dayData = root.DayrepCarryover.buildDayFromCarryover(dateStr, prevData, settings);
      }

      var hasContent = exists && hasExistingTbmContent(dayData);
      var scheduleItems = state.useSchedule && root.DayrepSchedule
        ? root.DayrepSchedule.itemsForDate(settings.schedule, dateStr)
        : [];
      var workSection = scheduleItems.length > 0 && root.DayrepSchedule
        ? root.DayrepSchedule.workSectionFromItems(scheduleItems)
        : ((dayData.tbmLog && dayData.tbmLog.workSection) || "");

      var dayCtx = {
        date: dateStr,
        workSection: workSection,
        workType: (dayData.eduLog && dayData.eduLog.workType) || "",
        eduContents: (dayData.eduLog && dayData.eduLog.contents) || "",
        weather: (dayData.patrol && dayData.patrol.weather) || "",
        scheduleItems: scheduleItems,
        useConstruction: state.useConstruction,
        rowCount: state.aiRowCount === "auto" ? null : Number(state.aiRowCount),
        libraryExamples: pickBatchLibraryExamples(
          (dayData.eduLog && dayData.eduLog.workType) || "",
          workSection,
          "",
          state.useRiskLibrary
        )
      };

      var prompt = root.DayrepAiPrompts.buildRiskPrompt(settings, dayCtx);
      var lastErr = "";
      for (var attempt = 0; attempt < 2; attempt += 1) {
        if (state.cancelled) {
          return {
            date: dateStr,
            exists: exists,
            hasContent: hasContent,
            dayData: dayData,
            workSection: workSection,
            rows: padRiskRows([]),
            status: "cancelled",
            error: "사용자 중단",
            checked: false
          };
        }
        try {
          var resp = await opts.invoke("ai_generate", {
            engine: aiCfg.engine,
            prompt: prompt,
            options: {
              endpoint: aiCfg.endpoint,
              baseUrl: aiCfg.baseUrl,
              model: aiCfg.model,
              temperature: 0.4
            }
          });
          var parsed = root.DayrepAiPrompts.parseRiskResponse(resp && resp.text ? resp.text : "", {
            rowCount: state.aiRowCount === "auto" ? null : Number(state.aiRowCount)
          });
          if (parsed && parsed.ok && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            var padded = padRiskRows(parsed.rows);
            return {
              date: dateStr,
              exists: exists,
              hasContent: hasContent,
              dayData: dayData,
              workSection: workSection,
              rows: padded,
              origWorkSection: workSection,
              origRowsJson: JSON.stringify(padded),
              dirty: false,
              status: "ok",
              error: "",
              checked: !hasContent,
              saveChecked: !hasContent,
              printChecked: !hasContent
            };
          }
          lastErr = (parsed && parsed.warnings && parsed.warnings[0]) || "AI 응답에서 위험성평가 표를 파싱하지 못했습니다.";
        } catch (err) {
          lastErr = String(err);
        }
      }

      return {
        date: dateStr,
        exists: exists,
        hasContent: hasContent,
        dayData: dayData,
        workSection: workSection,
        rows: padRiskRows([]),
        status: "error",
        error: lastErr || "생성 실패",
        checked: false
      };
    }

    async function runBatchGeneration() {
      var dates = getSelectedDates();
      if (dates.length === 0) {
        opts.showToast("생성할 날짜를 1일 이상 선택해 주세요.", true);
        return;
      }

      state.stage = "running";
      state.cancelled = false;
      state.abortNotice = "";
      state.applySummary = "";
      state.results = [];
      state.progressIdx = 0;
      state.progressTotal = dates.length;
      state.progressDate = dates[0];
      render();

      var existingSet = new Set();
      var daysList = [];
      try {
        var list = await opts.invoke("list_days");
        if (Array.isArray(list)) {
          daysList = list;
          list.forEach(function (d) {
            if (d && d.date) existingSet.add(d.date);
          });
        }
      } catch (_) {}
      state.daysList = daysList;

      var consecutiveErrors = 0;
      for (var i = 0; i < dates.length; i += 1) {
        if (state.cancelled) break;
        state.progressIdx = i + 1;
        state.progressDate = dates[i];
        render();

        var res = await generateOneDate(dates[i], existingSet, daysList);
        state.results.push(res);
        if (state.cancelled) break;

        if (res.status === "error") {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            state.abortNotice =
              "AI 요청이 연속 3회 실패하여 생성을 중단했습니다. AI 서버 실행 상태 또는 네트워크/API 설정을 확인해 주세요.";
            for (var j = i + 1; j < dates.length; j += 1) {
              state.results.push({
                date: dates[j],
                exists: existingSet.has(dates[j]),
                hasContent: false,
                dayData: null,
                workSection: "",
                rows: padRiskRows([]),
                status: "unprocessed",
                error: "연속 실패로 미생성",
                checked: false
              });
            }
            break;
          }
        } else {
          consecutiveErrors = 0;
        }
      }

      state.stage = "review";
      state.selectedIdx = 0;
      render();
    }

    function renderManageOptionModal(dialog) {
      var header = createEl("div", "batch-modal-header");
      header.appendChild(createEl("h3", "", "저장된 TBM 일지 기간 확인·인쇄"));
      var btnClose = createEl("button", "btn-secondary", "닫기");
      btnClose.type = "button";
      btnClose.addEventListener("click", function () { close(true); });
      header.appendChild(btnClose);
      dialog.appendChild(header);

      var body = createEl("div", "batch-modal-body");
      body.appendChild(
        createEl("div", "ai-notice", "선택한 기간 중 이미 저장된 TBM 일지를 불러와 확인·수정하고 한 번에 인쇄합니다. (AI를 호출하지 않습니다)")
      );

      var form = createEl("div", "batch-option-grid");
      var dateField = createEl("label", "field");
      dateField.appendChild(createEl("span", "", "시작일"));
      var dateInp = document.createElement("input");
      dateInp.type = "date";
      dateInp.value = state.startDate;
      dateInp.addEventListener("change", function () {
        state.startDate = dateInp.value;
        if (!state.manageEndDate || state.manageEndDate < state.startDate) {
          state.manageEndDate = state.startDate;
        }
        render();
      });
      dateField.appendChild(dateInp);
      form.appendChild(dateField);

      var spanField = createEl("div", "field");
      spanField.appendChild(createEl("span", "", "조회 범위"));
      var radioRow = createEl("div", "batch-radio-row");
      [
        { val: "7", label: "주간 (7일)" },
        { val: "30", label: "월간 (30일)" },
        { val: "custom", label: "직접 종료일" }
      ].forEach(function (opt) {
        var lbl = createEl("label", "batch-check-label");
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "manage-span";
        radio.value = opt.val;
        radio.checked = state.manageSpanType === opt.val;
        radio.addEventListener("change", function () {
          if (radio.checked) {
            state.manageSpanType = opt.val;
            render();
          }
        });
        lbl.appendChild(radio);
        lbl.appendChild(createEl("span", "", opt.label));
        radioRow.appendChild(lbl);
      });
      spanField.appendChild(radioRow);
      form.appendChild(spanField);

      if (state.manageSpanType === "custom") {
        var endField = createEl("label", "field");
        endField.appendChild(createEl("span", "", "종료일 (시작일로부터 최대 31일)"));
        var endInp = document.createElement("input");
        endInp.type = "date";
        endInp.value = state.manageEndDate || state.startDate;
        endInp.addEventListener("change", function () {
          state.manageEndDate = endInp.value;
          render();
        });
        endField.appendChild(endInp);
        form.appendChild(endField);
      }

      body.appendChild(form);
      dialog.appendChild(body);

      var targetDates = [];
      if (root.DayrepSchedule && root.DayrepSchedule.isValidDate(state.startDate)) {
        if (state.manageSpanType === "7") {
          targetDates = root.DayrepSchedule.enumerateDates(state.startDate, 7);
        } else if (state.manageSpanType === "30") {
          targetDates = root.DayrepSchedule.enumerateDates(state.startDate, 30);
        } else {
          var endStr = root.DayrepSchedule.isValidDate(state.manageEndDate) ? state.manageEndDate : state.startDate;
          if (endStr < state.startDate) endStr = state.startDate;
          var all = root.DayrepSchedule.enumerateDates(state.startDate, 31);
          targetDates = all.filter(function (d) { return d <= endStr; });
        }
      }

      var footer = createEl("div", "batch-modal-footer");
      var btnCancel = createEl("button", "btn-secondary", "취소");
      btnCancel.type = "button";
      btnCancel.addEventListener("click", function () { close(true); });

      var btnLoad = createEl("button", "btn-primary", "저장된 일지 불러오기 (" + targetDates.length + "일 범위)");
      btnLoad.type = "button";
      btnLoad.disabled = targetDates.length === 0;
      btnLoad.addEventListener("click", async function () {
        btnLoad.disabled = true;
        btnLoad.textContent = "불러오는 중...";
        var existingSet = new Set();
        var daysList = [];
        try {
          var list = await opts.invoke("list_days");
          if (Array.isArray(list)) {
            daysList = list;
            list.forEach(function (d) {
              if (d && d.date) existingSet.add(d.date);
            });
          }
        } catch (_) {}
        state.daysList = daysList;

        var loaded = [];
        var unsaved = [];
        for (var i = 0; i < targetDates.length; i++) {
          var dt = targetDates[i];
          if (!existingSet.has(dt)) {
            unsaved.push(dt);
            continue;
          }
          try {
            var dayData = await opts.invoke("load_day", { date: dt });
            var hasContent = hasExistingTbmContent(dayData);
            var ws = (dayData && dayData.tbmLog && dayData.tbmLog.workSection) || "";
            var padded = padRiskRows(dayData && dayData.tbmLog && dayData.tbmLog.riskRows);
            loaded.push({
              date: dt,
              exists: true,
              hasContent: hasContent,
              dayData: dayData,
              workSection: ws,
              rows: padded,
              origWorkSection: ws,
              origRowsJson: JSON.stringify(padded),
              dirty: false,
              status: "saved",
              error: "",
              checked: false,
              saveChecked: false,
              printChecked: hasContent
            });
          } catch (err) {
            loaded.push({
              date: dt,
              exists: true,
              hasContent: false,
              dayData: null,
              workSection: "",
              rows: padRiskRows([]),
              origWorkSection: "",
              origRowsJson: JSON.stringify(padRiskRows([])),
              dirty: false,
              status: "error",
              error: "로드 실패: " + String(err),
              checked: false,
              saveChecked: false,
              printChecked: false
            });
          }
        }

        if (loaded.length === 0) {
          btnLoad.disabled = false;
          btnLoad.textContent = "저장된 일지 불러오기 (" + targetDates.length + "일 범위)";
          if (opts.showToast) opts.showToast("선택한 기간에 저장된 일지가 없습니다.", true);
          return;
        }

        // TBM 내용이 있는 날짜가 앞으로 오도록 정렬(날짜 순 유지하되 우선순위)
        loaded.sort(function (a, b) {
          if (a.hasContent !== b.hasContent) return a.hasContent ? -1 : 1;
          return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
        });

        state.results = loaded;
        state.unsavedDates = unsaved;
        state.selectedIdx = 0;
        state.rightTab = "edit";
        state.abortNotice = "";
        state.applySummary = "";
        state.stage = "review";
        render();
      });

      footer.appendChild(btnCancel);
      footer.appendChild(btnLoad);
      dialog.appendChild(footer);
    }

    function renderOptionModal(dialog) {
      var header = createEl("div", "batch-modal-header");
      header.appendChild(createEl("h3", "", "TBM 일지 기간 일괄 생성"));
      var btnClose = createEl("button", "btn-secondary", "닫기");
      btnClose.type = "button";
      btnClose.addEventListener("click", close);
      header.appendChild(btnClose);
      dialog.appendChild(header);

      var body = createEl("div", "batch-modal-body");

      if (aiCfg.engine === "claude_mcp") {
        var mcpNotice = createEl(
          "div",
          "ai-notice",
          "현재 AI 엔진이 Claude MCP로 설정되어 있습니다. Claude MCP는 외부 API를 직접 호출하지 않으므로 Claude Desktop/CLI 대화에서 get_site_context 및 set_risk_rows 도구를 사용해 주간·월간 일지를 생성해 주세요."
        );
        body.appendChild(mcpNotice);
        dialog.appendChild(body);
        var mcpFoot = createEl("div", "batch-modal-footer");
        var btnCancelMcp = createEl("button", "btn-secondary", "닫기");
        btnCancelMcp.type = "button";
        btnCancelMcp.addEventListener("click", close);
        mcpFoot.appendChild(btnCancelMcp);
        dialog.appendChild(mcpFoot);
        return;
      }

      var notice = createEl(
        "div",
        "ai-notice",
        isLocalEngine(aiCfg.engine)
          ? "로컬 AI 엔진(" + aiCfg.engine + ")을 사용합니다. 생성된 내용은 검토 화면에서 확인·수정 후 적용하기 전까지 파일에 저장되지 않습니다."
          : "외부 AI(" + aiCfg.engine + ") 사용 시 공정표의 작업내용·장비·비고 및 공사현황만 전송되며, 근로자 명단·도장·연락처 등 개인정보는 전송되지 않습니다."
      );
      body.appendChild(notice);

      var form = createEl("div", "batch-option-grid");

      var spanField = createEl("div", "field");
      spanField.appendChild(createEl("span", "", "생성 기간"));
      var radioRow = createEl("div", "batch-radio-row");
      [
        { val: 7, label: "주간 (7일)" },
        { val: 30, label: "월간 (30일)" }
      ].forEach(function (opt) {
        var lbl = createEl("label", "batch-check-label");
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "batch-span";
        radio.value = String(opt.val);
        radio.checked = state.spanDays === opt.val;
        radio.addEventListener("change", function () {
          if (radio.checked) {
            state.spanDays = opt.val;
            render();
          }
        });
        lbl.appendChild(radio);
        lbl.appendChild(createEl("span", "", opt.label));
        radioRow.appendChild(lbl);
      });
      spanField.appendChild(radioRow);
      form.appendChild(spanField);

      var dateField = createEl("label", "field");
      dateField.appendChild(createEl("span", "", "시작일"));
      var dateInp = document.createElement("input");
      dateInp.type = "date";
      dateInp.value = state.startDate;
      dateInp.addEventListener("change", function () {
        state.startDate = dateInp.value;
        render();
      });
      dateField.appendChild(dateInp);
      form.appendChild(dateField);

      var refField = createEl("div", "field");
      refField.appendChild(createEl("span", "", "참조 데이터"));
      var chkRow = createEl("div", "batch-radio-row");

      var lblSch = createEl("label", "batch-check-label");
      var chkSch = document.createElement("input");
      chkSch.type = "checkbox";
      chkSch.checked = state.useSchedule;
      chkSch.addEventListener("change", function () {
        state.useSchedule = chkSch.checked;
      });
      lblSch.appendChild(chkSch);
      lblSch.appendChild(createEl("span", "", "공정표 참조"));
      chkRow.appendChild(lblSch);

      var lblConst = createEl("label", "batch-check-label");
      var chkConst = document.createElement("input");
      chkConst.type = "checkbox";
      chkConst.checked = state.useConstruction;
      chkConst.addEventListener("change", function () {
        state.useConstruction = chkConst.checked;
      });
      lblConst.appendChild(chkConst);
      lblConst.appendChild(createEl("span", "", "공사현황 참조"));
      chkRow.appendChild(lblConst);

      var lblRiskLib = createEl("label", "batch-check-label");
      var chkRiskLib = document.createElement("input");
      chkRiskLib.type = "checkbox";
      chkRiskLib.checked = state.useRiskLibrary;
      chkRiskLib.addEventListener("change", function () {
        state.useRiskLibrary = chkRiskLib.checked;
      });
      lblRiskLib.appendChild(chkRiskLib);
      lblRiskLib.appendChild(createEl("span", "", "위험성평가 라이브러리 참고"));
      chkRow.appendChild(lblRiskLib);

      var lblRowCnt = createEl("label", "batch-check-label");
      lblRowCnt.appendChild(createEl("span", "", "생성 행 수:"));
      var selRowCnt = document.createElement("select");
      var optAutoB = document.createElement("option");
      optAutoB.value = "auto";
      optAutoB.textContent = "자동(3~6행)";
      selRowCnt.appendChild(optAutoB);
      for (var brc = 3; brc <= MAX_AI_ROW_COUNT; brc++) {
        var optBrc = document.createElement("option");
        optBrc.value = String(brc);
        optBrc.textContent = brc + "행";
        selRowCnt.appendChild(optBrc);
      }
      selRowCnt.value = state.aiRowCount;
      selRowCnt.addEventListener("change", function () {
        state.aiRowCount = selRowCnt.value || "auto";
      });
      lblRowCnt.appendChild(selRowCnt);
      chkRow.appendChild(lblRowCnt);

      refField.appendChild(chkRow);
      form.appendChild(refField);
      body.appendChild(form);

      var dates = syncSelectedDates();
      var selectedDates = getSelectedDates();

      var previewHead = createEl("div", "batch-preview-head");
      previewHead.appendChild(
        createEl("div", "sub-label", "대상 날짜 미리보기 (선택 " + selectedDates.length + " / 전체 " + dates.length + "일)")
      );
      var previewBtns = createEl("div", "batch-nav-btns");
      var btnOptAll = createEl("button", "btn-secondary", "전체 선택");
      btnOptAll.type = "button";
      btnOptAll.addEventListener("click", function () {
        dates.forEach(function (d) { state.selectedDateMap[d] = true; });
        render();
      });
      var btnOptNone = createEl("button", "btn-secondary", "전체 해제");
      btnOptNone.type = "button";
      btnOptNone.addEventListener("click", function () {
        dates.forEach(function (d) { state.selectedDateMap[d] = false; });
        render();
      });
      previewBtns.appendChild(btnOptAll);
      previewBtns.appendChild(btnOptNone);
      previewHead.appendChild(previewBtns);
      body.appendChild(previewHead);

      var previewBox = createEl("div", "batch-date-preview");
      dates.forEach(function (d) {
        var wk = root.DayrepSchedule ? root.DayrepSchedule.formatWeekdayKo(d) : "";
        var checked = Boolean(state.selectedDateMap[d]);
        var chip = createEl("label", "batch-date-chip" + (checked ? "" : " unchecked"));
        var chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = checked;
        chk.addEventListener("change", function () {
          state.selectedDateMap[d] = chk.checked;
          render();
        });
        chip.appendChild(chk);
        chip.appendChild(createEl("span", "", d + " (" + wk + ")"));
        previewBox.appendChild(chip);
      });
      body.appendChild(previewBox);
      dialog.appendChild(body);

      var footer = createEl("div", "batch-modal-footer");
      var btnCancel = createEl("button", "btn-secondary", "취소");
      btnCancel.type = "button";
      btnCancel.addEventListener("click", close);

      var btnRun = createEl("button", "btn-primary", "생성 시작 (" + selectedDates.length + "일)");
      btnRun.type = "button";
      btnRun.disabled = selectedDates.length === 0;
      btnRun.addEventListener("click", function () {
        runBatchGeneration();
      });

      footer.appendChild(btnCancel);
      footer.appendChild(btnRun);
      dialog.appendChild(footer);
    }

    function renderRunningModal(dialog) {
      var header = createEl("div", "batch-modal-header");
      header.appendChild(createEl("h3", "", "TBM 일지 일괄 생성 중..."));
      dialog.appendChild(header);

      var body = createEl("div", "batch-modal-body");
      var pct = state.progressTotal > 0 ? Math.round((state.progressIdx / state.progressTotal) * 100) : 0;
      body.appendChild(
        createEl(
          "p",
          "",
          state.progressDate + " 처리 중 (" + state.progressIdx + " / " + state.progressTotal + ")"
        )
      );
      var barWrap = createEl("div", "batch-progress-wrap");
      var barFill = createEl("div", "batch-progress-fill");
      barFill.style.width = pct + "%";
      barWrap.appendChild(barFill);
      body.appendChild(barWrap);
      dialog.appendChild(body);

      var footer = createEl("div", "batch-modal-footer");
      var btnStop = createEl("button", "btn-danger", "중단");
      btnStop.type = "button";
      btnStop.addEventListener("click", function () {
        state.cancelled = true;
        btnStop.disabled = true;
        btnStop.textContent = "중단 중...";
      });
      footer.appendChild(btnStop);
      dialog.appendChild(footer);
    }

    function renderReviewModal(dialog) {
      dialog.classList.add("batch-modal-wide");

      var header = createEl("div", "batch-modal-header");
      header.appendChild(
        createEl("h3", "", state.mode === "manage" ? "저장된 TBM 일지 확인·수정·인쇄" : "일괄 생성 결과 검토 및 선택 적용")
      );
      var btnClose = createEl("button", "btn-secondary", "닫기");
      btnClose.type = "button";
      btnClose.addEventListener("click", function () { close(false); });
      header.appendChild(btnClose);
      dialog.appendChild(header);

      if (state.abortNotice) {
        dialog.appendChild(createEl("div", "ai-notice batch-top-notice", state.abortNotice));
      }
      if (state.applySummary) {
        dialog.appendChild(createEl("div", "ai-notice batch-top-notice", state.applySummary));
      }

      var body = createEl("div", "batch-review-layout");

      // Left pane: date list
      var leftPane = createEl("div", "batch-review-list");
      var bulkActions = createEl("div", "batch-bulk-actions");
      var btnPrintAll = createEl("button", "btn-secondary", "인쇄 전체선택");
      btnPrintAll.type = "button";
      btnPrintAll.addEventListener("click", function () {
        state.results.forEach(function (r) {
          if (r.status === "ok" || r.status === "saved") r.printChecked = true;
        });
        render();
      });
      var btnPrintNone = createEl("button", "btn-secondary", "인쇄 전체해제");
      btnPrintNone.type = "button";
      btnPrintNone.addEventListener("click", function () {
        state.results.forEach(function (r) {
          r.printChecked = false;
        });
        render();
      });
      bulkActions.appendChild(btnPrintAll);
      bulkActions.appendChild(btnPrintNone);
      leftPane.appendChild(bulkActions);

      function canUseItem(it) {
        return it && (it.status === "ok" || it.status === "saved");
      }

      state.results.forEach(function (item, idx) {
        var row = createEl("div", "batch-review-item" + (idx === state.selectedIdx ? " active" : ""));
        row.setAttribute("data-batch-date", item.date);

        var info = createEl("div", "batch-review-item-info");
        info.style.flex = "1";
        var wk = root.DayrepSchedule ? root.DayrepSchedule.formatWeekdayKo(item.date) : "";
        info.appendChild(createEl("div", "batch-review-date", item.date + " (" + wk + ")"));

        var badges = createEl("div", "batch-badge-row");
        if (item.status === "ok") {
          badges.appendChild(createEl("span", "batch-badge ok", "생성완료"));
        } else if (item.status === "saved") {
          badges.appendChild(createEl("span", "batch-badge ok", "저장됨"));
        } else if (item.status === "cancelled") {
          badges.appendChild(createEl("span", "batch-badge warn", "중단됨"));
        } else if (item.status === "unprocessed") {
          badges.appendChild(createEl("span", "batch-badge unprocessed", "미생성"));
        } else {
          badges.appendChild(createEl("span", "batch-badge err", "실패"));
        }
        if (state.mode === "generate" && item.hasContent) {
          badges.appendChild(createEl("span", "batch-badge warn", "기존 내용 있음"));
        } else if (state.mode === "manage" && !item.hasContent && item.status === "saved") {
          badges.appendChild(createEl("span", "batch-badge unprocessed", "내용 없음"));
        }
        if (item.dirty) {
          badges.appendChild(createEl("span", "batch-badge dirty", "변경됨"));
        }
        info.appendChild(badges);

        var chkRow = createEl("div", "batch-item-checks");
        var lblSave = createEl("label", "batch-mini-chk");
        var chkSave = document.createElement("input");
        chkSave.type = "checkbox";
        chkSave.className = "batch-save-chk";
        chkSave.checked = state.mode === "manage" ? Boolean(item.saveChecked) : Boolean(item.checked);
        chkSave.disabled = !canUseItem(item);
        chkSave.addEventListener("click", function (ev) { ev.stopPropagation(); });
        chkSave.addEventListener("change", function () {
          if (state.mode === "manage") item.saveChecked = chkSave.checked;
          else item.checked = chkSave.checked;
          render();
        });
        lblSave.appendChild(chkSave);
        lblSave.appendChild(createEl("span", "", state.mode === "manage" ? "저장" : "적용"));

        var lblPrint = createEl("label", "batch-mini-chk");
        var chkPrint = document.createElement("input");
        chkPrint.type = "checkbox";
        chkPrint.checked = Boolean(item.printChecked);
        chkPrint.disabled = !canUseItem(item);
        chkPrint.addEventListener("click", function (ev) { ev.stopPropagation(); });
        chkPrint.addEventListener("change", function () {
          item.printChecked = chkPrint.checked;
          render();
        });
        lblPrint.appendChild(chkPrint);
        lblPrint.appendChild(createEl("span", "", "인쇄"));

        chkRow.appendChild(lblSave);
        chkRow.appendChild(lblPrint);
        info.appendChild(chkRow);

        row.appendChild(info);

        row.addEventListener("click", function () {
          if (state.selectedIdx !== idx) cancelPendingCellAi();
          state.selectedIdx = idx;
          render();
        });

        leftPane.appendChild(row);
      });

      if (state.mode === "manage" && state.unsavedDates.length > 0) {
        var unsavedBox = createEl("div", "batch-unsaved-box");
        unsavedBox.appendChild(createEl("div", "muted-inline", "저장 안 됨 (" + state.unsavedDates.length + "일)"));
        state.unsavedDates.forEach(function (ud) {
          var wkU = root.DayrepSchedule ? root.DayrepSchedule.formatWeekdayKo(ud) : "";
          unsavedBox.appendChild(createEl("div", "batch-unsaved-item", ud + " (" + wkU + ")"));
        });
        leftPane.appendChild(unsavedBox);
      }
      body.appendChild(leftPane);

      // Right pane: selected date detail
      var rightPane = createEl("div", "batch-review-detail");
      var current = state.results[state.selectedIdx];
      if (!current) {
        rightPane.appendChild(createEl("p", "muted", "생성된 결과가 없습니다."));
      } else {
        var navRow = createEl("div", "batch-detail-nav");
        var wkCur = root.DayrepSchedule ? root.DayrepSchedule.formatWeekdayKo(current.date) : "";
        navRow.appendChild(createEl("strong", "", current.date + " (" + wkCur + ")"));

        var navBtns = createEl("div", "batch-nav-btns");
        var btnPrev = createEl("button", "btn-secondary", "이전 날짜");
        btnPrev.type = "button";
        btnPrev.disabled = state.selectedIdx <= 0;
        btnPrev.addEventListener("click", function () {
          if (state.selectedIdx > 0) {
            cancelPendingCellAi();
            state.selectedIdx -= 1;
            render();
          }
        });
        var btnNext = createEl("button", "btn-secondary", "다음 날짜");
        btnNext.type = "button";
        btnNext.disabled = state.selectedIdx >= state.results.length - 1;
        btnNext.addEventListener("click", function () {
          if (state.selectedIdx < state.results.length - 1) {
            cancelPendingCellAi();
            state.selectedIdx += 1;
            render();
          }
        });
        var btnRegen = createEl("button", "btn-secondary", "이 날짜 다시 생성");
        btnRegen.type = "button";
        btnRegen.addEventListener("click", async function () {
          btnRegen.disabled = true;
          btnRegen.textContent = "생성 중...";
          var existingSet = new Set();
          if (current.exists) existingSet.add(current.date);
          state.cancelled = false;
          var regenerated = await generateOneDate(current.date, existingSet, state.daysList);
          if (state.mode === "manage" && current.dayData) {
            regenerated.origWorkSection = current.origWorkSection;
            regenerated.origRowsJson = current.origRowsJson;
            regenerated.printChecked = current.printChecked;
            markDirty(regenerated);
          }
          state.results[state.selectedIdx] = regenerated;
          render();
        });
        navBtns.appendChild(btnPrev);
        navBtns.appendChild(btnNext);
        navBtns.appendChild(btnRegen);
        navRow.appendChild(navBtns);
        rightPane.appendChild(navRow);

        var tabBar = createEl("div", "batch-tab-bar");
        var btnTabEdit = createEl("button", "batch-tab-btn" + (state.rightTab === "edit" ? " active" : ""), "편집");
        btnTabEdit.type = "button";
        btnTabEdit.addEventListener("click", function () {
          state.rightTab = "edit";
          render();
        });
        var btnTabPrev = createEl("button", "batch-tab-btn" + (state.rightTab === "preview" ? " active" : ""), "A4 미리보기");
        btnTabPrev.type = "button";
        btnTabPrev.addEventListener("click", function () {
          state.rightTab = "preview";
          render();
        });
        tabBar.appendChild(btnTabEdit);
        tabBar.appendChild(btnTabPrev);
        rightPane.appendChild(tabBar);

        if (state.rightTab === "preview") {
          var prevWrap = createEl("div", "batch-a4-preview-wrap");
          try {
            if (!root.DayrepExport || typeof root.DayrepExport.renderDoc5PreviewSnapshot !== "function") {
              prevWrap.appendChild(createEl("p", "muted", "미리보기 모듈(DayrepExport)을 불러올 수 없습니다."));
            } else {
              var prevDayCopy = current.dayData
                ? JSON.parse(JSON.stringify(current.dayData))
                : root.DayrepCarryover.buildDayFromCarryover(current.date, null, settings);
              if (!prevDayCopy.tbmLog) prevDayCopy.tbmLog = {};
              prevDayCopy.tbmLog.workSection = current.workSection || "";
              prevDayCopy.tbmLog.riskRows = padRiskRows(current.rows);

              var snap = root.DayrepExport.renderDoc5PreviewSnapshot({
                dayData: prevDayCopy,
                settings: settings,
                stamps: (opts.getStamps && opts.getStamps()) || {},
                blankDate: state.blankDateOnPrint,
                dateOffset: state.dateOffsetOnPrint
              });
              if (snap) {
                var inner = createEl("div", "batch-a4-preview-inner");
                inner.appendChild(snap);
                prevWrap.appendChild(inner);
              } else {
                prevWrap.appendChild(createEl("p", "muted", "A4 미리보기를 생성하지 못했습니다."));
              }
            }
          } catch (err) {
            prevWrap.appendChild(createEl("p", "muted", "A4 미리보기 오류: " + String(err)));
          }
          rightPane.appendChild(prevWrap);
        } else {
          if (current.status === "error") {
            rightPane.appendChild(createEl("div", "ai-notice", "생성 오류: " + (current.error || "알 수 없는 오류")));
          }
          if (state.mode === "generate" && current.hasContent) {
            rightPane.appendChild(
              createEl("div", "ai-notice", "이 날짜에는 이미 TBM 내용이 있습니다. 적용 체크 시 기존 내용이 덮어쓰기(백업 보관)됩니다.")
            );
          }

          var wsLabel = createEl("label", "field");
          wsLabel.appendChild(createEl("span", "", "작업구간 / 공종"));
          var wsInp = document.createElement("input");
          wsInp.type = "text";
          wsInp.value = current.workSection || "";
          wsInp.addEventListener("input", function () {
            current.workSection = wsInp.value;
            markDirty(current);
          });
          wsLabel.appendChild(wsInp);
          rightPane.appendChild(wsLabel);

        if (state.cellAiBusy) {
          var stickyBar = createEl("div", "batch-ai-sticky-bar no-print");
          stickyBar.setAttribute("role", "status");
          stickyBar.setAttribute("aria-live", "polite");
          var barText = createEl("span", "batch-ai-sticky-text", "⏳ " + (state.cellAiProgress || "AI 작업 진행 중…"));
          stickyBar.appendChild(barText);
          var btnStopCellAiTop = createEl("button", "btn-secondary btn-sticky-cancel", "AI 중단");
          btnStopCellAiTop.type = "button";
          btnStopCellAiTop.addEventListener("click", function () {
            cancelPendingCellAi();
            render();
          });
          stickyBar.appendChild(btnStopCellAiTop);
          rightPane.appendChild(stickyBar);
        }

        var tblHeadRow = createEl("div", "card-head-row");
        tblHeadRow.style.marginTop = "10px";
        var tblTitleGroup = createEl("div", "batch-nav-btns");
        tblTitleGroup.style.alignItems = "center";
        tblTitleGroup.appendChild(createEl("span", "sub-label", "위험성평가 항목"));
        if (state.cellAiProgress) {
          tblTitleGroup.appendChild(createEl("span", "muted-inline", state.cellAiProgress));
        }
        if (state.cellAiBusy) {
          var btnStopCellAi = createEl("button", "btn-danger", "AI 중단");
          btnStopCellAi.type = "button";
          btnStopCellAi.addEventListener("click", function () {
            cancelPendingCellAi();
            render();
          });
          tblTitleGroup.appendChild(btnStopCellAi);
        }
        tblHeadRow.appendChild(tblTitleGroup);

        var tblActionBtns = createEl("div", "batch-nav-btns");
        if (Array.isArray(current.aiUndoRows)) {
          var btnUndoAi = createEl("button", "btn-secondary", "AI 되돌리기");
          btnUndoAi.type = "button";
          btnUndoAi.disabled = state.cellAiBusy;
          btnUndoAi.addEventListener("click", function () {
            current.rows = cloneRows(current.aiUndoRows);
            current.aiUndoRows = null;
            markDirty(current);
            render();
          });
          tblActionBtns.appendChild(btnUndoAi);
        }
        var btnAddRow = createEl("button", "btn-secondary", "+ 행 추가");
        btnAddRow.type = "button";
        btnAddRow.addEventListener("click", function () {
          current.rows.push({ item: "", hazard: "", type: "", level: "중", measure: "" });
          markDirty(current);
          render();
        });
        tblActionBtns.appendChild(btnAddRow);
        if (root.DayrepRiskPickerModal && root.DayrepRiskLibrary) {
          var btnBatchPickLib = createEl("button", "btn-secondary", "라이브러리에서 추가");
          btnBatchPickLib.type = "button";
          btnBatchPickLib.disabled = state.cellAiBusy;
          btnBatchPickLib.addEventListener("click", function () {
            var lib = typeof opts.getRiskLibrary === "function" ? opts.getRiskLibrary() : null;
            var defCat = (current.dayData && current.dayData.eduLog && current.dayData.eduLog.workType) || "";
            root.DayrepRiskPickerModal.open({
              library: lib,
              defaultCategory: defCat,
              onConfirm: function (selected) {
                if (!selected || selected.length === 0) return;
                current.aiUndoRows = cloneRows(current.rows);
                var res = root.DayrepRiskPickerModal.applySelectedToRows(current.rows, selected, 12);
                current.rows = res.rows;
                markDirty(current);
                render();
                if (res.addedIds.length > 0 && typeof opts.onBumpRiskLibraryUsage === "function") {
                  opts.onBumpRiskLibraryUsage(res.addedIds);
                }
                if (opts.showToast) {
                  var msgs = [];
                  if (res.addedIds.length > 0) msgs.push(res.addedIds.length + "건 추가");
                  if (res.skippedDup > 0) msgs.push("중복 " + res.skippedDup + "건 건너뜀");
                  if (res.skippedLimit > 0) msgs.push("최대 12행 제한으로 " + res.skippedLimit + "건 제외");
                  opts.showToast(msgs.join(" · ") || "추가된 항목이 없습니다.", res.addedIds.length === 0);
                }
              }
            });
          });
          tblActionBtns.appendChild(btnBatchPickLib);
        }
        tblHeadRow.appendChild(tblActionBtns);
        rightPane.appendChild(tblHeadRow);

        if (state.headerAiMenuCol) {
          var colTitles = { tool: "공구/장비", hazard: "유해·위험요인", measure: "감소대책" };
          var optBar = createEl("div", "batch-header-ai-bar");
          optBar.appendChild(createEl("strong", "", (colTitles[state.headerAiMenuCol] || "") + " 열 AI 일괄:"));
          [
            { val: false, label: "빈 칸만 채우기" },
            { val: true, label: "모두 덮어쓰기" }
          ].forEach(function (opt) {
            var lbl = createEl("label", "batch-mini-chk");
            var rd = document.createElement("input");
            rd.type = "radio";
            rd.name = "batch-header-ai-mode";
            rd.checked = state.headerAiOverwrite === opt.val;
            rd.addEventListener("change", function () {
              if (rd.checked) state.headerAiOverwrite = opt.val;
            });
            lbl.appendChild(rd);
            lbl.appendChild(createEl("span", "", opt.label));
            optBar.appendChild(lbl);
          });
          var btnRunHeader = createEl("button", "btn-primary", "실행");
          btnRunHeader.type = "button";
          btnRunHeader.addEventListener("click", function () {
            handleHeaderBatchAi(state.headerAiMenuCol, current, state.headerAiOverwrite);
          });
          var btnCancelHeader = createEl("button", "btn-secondary", "취소");
          btnCancelHeader.type = "button";
          btnCancelHeader.addEventListener("click", function () {
            state.headerAiMenuCol = null;
            render();
          });
          optBar.appendChild(btnRunHeader);
          optBar.appendChild(btnCancelHeader);
          rightPane.appendChild(optBar);
        }

        var table = createEl("table", "schedule-table batch-risk-table");
        var thead = document.createElement("thead");
        var thr = document.createElement("tr");
        [
          { label: "공구/장비", aiCol: "tool" },
          { label: "유해·위험요인", aiCol: "hazard" },
          { label: "재해형태", aiCol: null },
          { label: "등급", aiCol: null },
          { label: "감소대책", aiCol: "measure" },
          { label: "삭제", aiCol: null }
        ].forEach(function (h) {
          var th = document.createElement("th");
          if (h.aiCol) {
            var thWrap = createEl("div", "batch-th-ai-wrap");
            thWrap.appendChild(createEl("span", "", h.label));
            var isHdrActive = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "header" && state.cellAiActive.col === h.aiCol;
            var btnThAi = createEl("button", "batch-ai-mini-btn" + (isHdrActive ? " btn-ai-active" : ""), isHdrActive ? "" : "AI");
            btnThAi.type = "button";
            btnThAi.disabled = state.cellAiBusy;
            if (isHdrActive) {
              btnThAi.setAttribute("aria-busy", "true");
              btnThAi.title = "생성 중…";
              var spHdr = createEl("span", "ai-btn-spinner");
              spHdr.setAttribute("aria-hidden", "true");
              btnThAi.appendChild(spHdr);
            } else if (state.cellAiBusy) {
              btnThAi.title = "다른 AI 작업 진행 중";
            } else {
              btnThAi.title = h.label + " 열 일괄 AI 생성";
            }
            btnThAi.addEventListener("click", function () {
              state.headerAiMenuCol = state.headerAiMenuCol === h.aiCol ? null : h.aiCol;
              render();
            });
            thWrap.appendChild(btnThAi);
            th.appendChild(thWrap);
          } else {
            th.textContent = h.label;
          }
          thr.appendChild(th);
        });
        thead.appendChild(thr);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        var stdAcc = (root.DayrepAiPrompts && root.DayrepAiPrompts.STANDARD_ACCIDENTS) || [];
        current.rows.forEach(function (r, rIdx) {
          var tr = document.createElement("tr");

          var tdTool = document.createElement("td");
          var wrapTool = createEl("div", "batch-cell-ai-wrap");
          var inpTool = document.createElement("input");
          inpTool.type = "text";
          inpTool.value = r.item || "";
          inpTool.addEventListener("input", function () { r.item = inpTool.value; markDirty(current); });
          var isToolCellActive = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "cell" && state.cellAiActive.col === "tool" && state.cellAiActive.rowIdx === rIdx;
          var isToolRowInBatch = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "header" && state.cellAiActive.col === "tool" && state.cellAiActive.curRowIdx === rIdx;
          if (isToolCellActive || isToolRowInBatch) {
            wrapTool.classList.add("ai-target-highlight");
            inpTool.classList.add("ai-target-highlight");
          }
          var btnToolAi = createEl("button", "batch-ai-mini-btn" + (isToolCellActive ? " btn-ai-active" : ""), isToolCellActive ? "" : "AI");
          btnToolAi.type = "button";
          btnToolAi.disabled = state.cellAiBusy;
          if (isToolCellActive) {
            btnToolAi.setAttribute("aria-busy", "true");
            btnToolAi.title = "생성 중…";
            var spTool = createEl("span", "ai-btn-spinner");
            spTool.setAttribute("aria-hidden", "true");
            btnToolAi.appendChild(spTool);
          } else if (state.cellAiBusy) {
            btnToolAi.title = "다른 AI 작업 진행 중";
          }
          btnToolAi.addEventListener("click", function () { handleSingleCellAi("tool", current, rIdx); });
          wrapTool.appendChild(inpTool);
          wrapTool.appendChild(btnToolAi);
          tdTool.appendChild(wrapTool);

          var tdHaz = document.createElement("td");
          var wrapHaz = createEl("div", "batch-cell-ai-wrap");
          var inpHaz = document.createElement("input");
          inpHaz.type = "text";
          inpHaz.value = r.hazard || "";
          inpHaz.addEventListener("input", function () { r.hazard = inpHaz.value; markDirty(current); });
          var isHazCellActive = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "cell" && state.cellAiActive.col === "hazard" && state.cellAiActive.rowIdx === rIdx;
          var isHazRowInBatch = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "header" && state.cellAiActive.col === "hazard" && state.cellAiActive.curRowIdx === rIdx;
          if (isHazCellActive || isHazRowInBatch) {
            wrapHaz.classList.add("ai-target-highlight");
            inpHaz.classList.add("ai-target-highlight");
          }
          var btnHazAi = createEl("button", "batch-ai-mini-btn" + (isHazCellActive ? " btn-ai-active" : ""), isHazCellActive ? "" : "AI");
          btnHazAi.type = "button";
          btnHazAi.disabled = state.cellAiBusy;
          if (isHazCellActive) {
            btnHazAi.setAttribute("aria-busy", "true");
            btnHazAi.title = "생성 중…";
            var spHaz = createEl("span", "ai-btn-spinner");
            spHaz.setAttribute("aria-hidden", "true");
            btnHazAi.appendChild(spHaz);
          } else if (state.cellAiBusy) {
            btnHazAi.title = "다른 AI 작업 진행 중";
          }
          btnHazAi.addEventListener("click", function () { handleSingleCellAi("hazard", current, rIdx); });
          wrapHaz.appendChild(inpHaz);
          wrapHaz.appendChild(btnHazAi);
          tdHaz.appendChild(wrapHaz);

            var tdAcc = document.createElement("td");
            var selAcc = document.createElement("select");
            var emptyOpt = document.createElement("option");
            emptyOpt.value = "";
            emptyOpt.textContent = "선택";
            selAcc.appendChild(emptyOpt);
            stdAcc.forEach(function (a) {
              var o = document.createElement("option");
              o.value = a;
              o.textContent = a;
              selAcc.appendChild(o);
            });
            if (r.type && stdAcc.indexOf(r.type) === -1) {
              var customOpt = document.createElement("option");
              customOpt.value = r.type;
              customOpt.textContent = r.type;
              selAcc.appendChild(customOpt);
            }
            selAcc.value = r.type || "";
            selAcc.addEventListener("change", function () { r.type = selAcc.value; markDirty(current); render(); });
            tdAcc.appendChild(selAcc);

            var tdLvl = document.createElement("td");
            var selLvl = document.createElement("select");
            ["상", "중", "하"].forEach(function (lv) {
              var o = document.createElement("option");
              o.value = lv;
              o.textContent = lv;
              selLvl.appendChild(o);
            });
            selLvl.value = r.level || "중";
            selLvl.addEventListener("change", function () { r.level = selLvl.value; markDirty(current); render(); });
            tdLvl.appendChild(selLvl);

            var tdMeas = document.createElement("td");
            var wrapMeas = createEl("div", "batch-cell-ai-wrap");
            var inpMeas = document.createElement("input");
            inpMeas.type = "text";
            inpMeas.value = r.measure || "";
            inpMeas.addEventListener("input", function () { r.measure = inpMeas.value; markDirty(current); });
            var isMeasCellActive = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "cell" && state.cellAiActive.col === "measure" && state.cellAiActive.rowIdx === rIdx;
            var isMeasRowInBatch = state.cellAiBusy && state.cellAiActive && state.cellAiActive.type === "header" && state.cellAiActive.col === "measure" && state.cellAiActive.curRowIdx === rIdx;
            if (isMeasCellActive || isMeasRowInBatch) {
              wrapMeas.classList.add("ai-target-highlight");
              inpMeas.classList.add("ai-target-highlight");
            }
            var btnMeasAi = createEl("button", "batch-ai-mini-btn" + (isMeasCellActive ? " btn-ai-active" : ""), isMeasCellActive ? "" : "AI");
            btnMeasAi.type = "button";
            btnMeasAi.disabled = state.cellAiBusy;
            if (isMeasCellActive) {
              btnMeasAi.setAttribute("aria-busy", "true");
              btnMeasAi.title = "생성 중…";
              var spMeas = createEl("span", "ai-btn-spinner");
              spMeas.setAttribute("aria-hidden", "true");
              btnMeasAi.appendChild(spMeas);
            } else if (state.cellAiBusy) {
              btnMeasAi.title = "다른 AI 작업 진행 중";
            }
            btnMeasAi.addEventListener("click", function () { handleSingleCellAi("measure", current, rIdx); });
            wrapMeas.appendChild(inpMeas);
            wrapMeas.appendChild(btnMeasAi);
            tdMeas.appendChild(wrapMeas);

            var tdDel = document.createElement("td");
            var btnKeepRow = createEl("button", "btn-secondary btn-cell-keep", "보관");
            btnKeepRow.type = "button";
            btnKeepRow.title = "이 행을 위험성평가 라이브러리에 보관";
            btnKeepRow.addEventListener("click", function () {
              if (typeof opts.onAccumulateRiskLibrary === "function") {
                opts.onAccumulateRiskLibrary([r], {
                  category: String((current.dayData && current.dayData.eduLog && current.dayData.eduLog.workType) || "").trim(),
                  source: "manual",
                  quiet: false
                });
              }
            });
            tdDel.appendChild(btnKeepRow);
            var isMinBatchRows = current.rows.length <= MIN_ROWS;
            var btnDelRow = createEl("button", "btn-danger", isMinBatchRows ? "비우기" : "삭제");
            btnDelRow.type = "button";
            btnDelRow.disabled = state.cellAiBusy;
            btnDelRow.title = isMinBatchRows ? "최소 4행 유지: 이 행의 내용을 비웁니다" : "이 행 삭제";
            btnDelRow.addEventListener("click", function () {
              var hasContentRow = Boolean(
                String(r.item || "").trim() ||
                String(r.hazard || "").trim() ||
                String(r.type || "").trim() ||
                String(r.measure || "").trim()
              );
              if (hasContentRow) {
                current.aiUndoRows = cloneRows(current.rows);
              }
              if (current.rows.length > MIN_ROWS) {
                current.rows.splice(rIdx, 1);
              } else {
                current.rows[rIdx] = { item: "", hazard: "", type: "", level: "중", measure: "" };
              }
              markDirty(current);
              render();
            });
            tdDel.appendChild(btnDelRow);

            tr.appendChild(tdTool);
            tr.appendChild(tdHaz);
            tr.appendChild(tdAcc);
            tr.appendChild(tdLvl);
            tr.appendChild(tdMeas);
            tr.appendChild(tdDel);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          rightPane.appendChild(table);
        }
      }
      body.appendChild(rightPane);
      dialog.appendChild(body);

      function getSaveTargets() {
        return state.results.filter(function (r) {
          if (!canUseItem(r)) return false;
          return state.mode === "manage" ? Boolean(r.saveChecked) : Boolean(r.checked);
        });
      }
      function getPrintTargets() {
        return state.results.filter(function (r) {
          return canUseItem(r) && Boolean(r.printChecked);
        });
      }
      var saveTargets = getSaveTargets();
      var printTargets = getPrintTargets();

      var footer = createEl("div", "batch-modal-footer");

      var blankLabel = createEl("label", "batch-check-label");
      var blankChk = document.createElement("input");
      blankChk.type = "checkbox";
      blankChk.checked = state.blankDateOnPrint;
      blankLabel.appendChild(blankChk);
      blankLabel.appendChild(createEl("span", "", "일자 비우고 인쇄"));
      footer.appendChild(blankLabel);

      var offsetWrap = createEl("span", "print-date-offset-wrap");
      offsetWrap.style.marginRight = "auto";
      offsetWrap.appendChild(createEl("span", "muted-inline", "일자 이동(일)"));
      var offsetInp = document.createElement("input");
      offsetInp.type = "number";
      offsetInp.className = "print-date-offset-input";
      offsetInp.min = "-7";
      offsetInp.max = "31";
      offsetInp.step = "1";
      offsetInp.value = String(state.dateOffsetOnPrint);
      offsetWrap.appendChild(offsetInp);

      var btnNextDay = createEl("button", "btn-secondary", "+1(다음날)");
      btnNextDay.type = "button";
      offsetWrap.appendChild(btnNextDay);

      var previewSpan = createEl("span", "print-date-preview");
      offsetWrap.appendChild(previewSpan);
      footer.appendChild(offsetWrap);

      function syncBatchDateOffsetUi() {
        offsetInp.value = String(state.dateOffsetOnPrint);
        offsetInp.disabled = state.blankDateOnPrint;
        btnNextDay.disabled = state.blankDateOnPrint;
        if (state.blankDateOnPrint) {
          previewSpan.textContent = "출력: 비움";
        } else if (state.dateOffsetOnPrint === 0) {
          previewSpan.textContent = "각 날짜 그대로";
        } else {
          var sign = state.dateOffsetOnPrint > 0 ? "+" : "";
          previewSpan.textContent = "각 날짜 " + sign + state.dateOffsetOnPrint + "일";
        }
      }
      syncBatchDateOffsetUi();

      blankChk.addEventListener("change", function () {
        state.blankDateOnPrint = blankChk.checked;
        try {
          localStorage.setItem(BLANK_DATE_STORAGE_KEY, state.blankDateOnPrint ? "1" : "0");
        } catch (_) {}
        syncBatchDateOffsetUi();
        if (state.rightTab === "preview") render();
      });

      offsetInp.addEventListener("change", function () {
        state.dateOffsetOnPrint = clampDateOffset(offsetInp.value);
        try {
          localStorage.setItem(DATE_OFFSET_STORAGE_KEY, String(state.dateOffsetOnPrint));
        } catch (_) {}
        syncBatchDateOffsetUi();
        if (state.rightTab === "preview") render();
      });

      btnNextDay.addEventListener("click", function () {
        state.dateOffsetOnPrint = state.dateOffsetOnPrint === 1 ? 0 : 1;
        try {
          localStorage.setItem(DATE_OFFSET_STORAGE_KEY, String(state.dateOffsetOnPrint));
        } catch (_) {}
        syncBatchDateOffsetUi();
        if (state.rightTab === "preview") render();
      });

      var btnCancel = createEl("button", "btn-secondary", "닫기");
      btnCancel.type = "button";
      btnCancel.addEventListener("click", function () { close(false); });

      var btnBatchPrint = createEl("button", "btn-secondary", "선택 날짜 TBM일지 인쇄 (" + printTargets.length + "장)");
      btnBatchPrint.type = "button";
      btnBatchPrint.disabled = state.applying || state.printing || printTargets.length === 0 || !root.DayrepExport;
      btnBatchPrint.addEventListener("click", async function () {
        var curPrintTargets = getPrintTargets();
        if (state.printing || curPrintTargets.length === 0 || !root.DayrepExport) return;
        var maxSheets = root.DayrepExport.MAX_TBM_PRINT_SHEETS || 31;
        var targets = curPrintTargets.slice(0, maxSheets);
        if (curPrintTargets.length > maxSheets && opts.showToast) {
          opts.showToast("한 번에 최대 " + maxSheets + "장까지 인쇄됩니다. 앞 " + maxSheets + "장을 인쇄합니다.", false);
        }
        var printDays = targets.map(function (item) {
          var dayCopy = item.dayData
            ? JSON.parse(JSON.stringify(item.dayData))
            : root.DayrepCarryover.buildDayFromCarryover(item.date, null, settings);
          if (!dayCopy.tbmLog) dayCopy.tbmLog = {};
          dayCopy.tbmLog.workSection = item.workSection || "";
          dayCopy.tbmLog.riskRows = padRiskRows(item.rows);
          return dayCopy;
        });

        state.printing = true;
        btnBatchPrint.disabled = true;
        try {
          await root.DayrepExport.printTbmSheets({
            days: printDays,
            settings: settings,
            stamps: (opts.getStamps && opts.getStamps()) || {},
            blankDate: state.blankDateOnPrint,
            dateOffset: state.dateOffsetOnPrint
          });
        } catch (err) {
          if (opts.showToast) opts.showToast("일괄 인쇄 실패: " + String(err), true);
        } finally {
          state.printing = false;
          btnBatchPrint.disabled = state.applying || getPrintTargets().length === 0;
        }
      });

      var applyBtnLabel = state.mode === "manage"
        ? "변경분 저장 (" + saveTargets.length + "건)"
        : "선택 날짜 적용 (" + saveTargets.length + "건)";
      var btnApply = createEl("button", "btn-primary batch-apply-btn", applyBtnLabel);
      btnApply.type = "button";
      btnApply.disabled = state.applying || saveTargets.length === 0;
      btnApply.addEventListener("click", async function () {
        var curSaveTargets = getSaveTargets();
        if (state.applying || curSaveTargets.length === 0) return;

        if (state.mode === "generate") {
          var overwriteCount = curSaveTargets.filter(function (r) { return r.hasContent; }).length;
          if (overwriteCount > 0) {
            var ok = window.confirm(
              "기존 TBM 내용이 있는 " + overwriteCount + "개 날짜를 덮어씁니다. (기존 위험성평가는 백업됩니다) 계속하시겠습니까?"
            );
            if (!ok) return;
          }
        }

        state.applying = true;
        state.applySummary = "";
        render();

        try {
          if (opts.flushPendingSave) {
            await opts.flushPendingSave();
          }
        } catch (_) {}

        var appliedDates = [];
        var failedList = [];
        var skippedCurrent = false;

        for (var i = 0; i < curSaveTargets.length; i += 1) {
          var item = curSaveTargets[i];
          if (item.date === opts.getCurrentDate() && opts.hasPendingEdit && opts.hasPendingEdit()) {
            skippedCurrent = true;
            continue;
          }
          try {
            var targetDay = null;
            if (item.exists) {
              try {
                targetDay = await opts.invoke("load_day", { date: item.date });
              } catch (_) {
                targetDay = null;
              }
            }
            if (!targetDay) {
              targetDay = item.dayData ? JSON.parse(JSON.stringify(item.dayData)) : root.DayrepCarryover.buildDayFromCarryover(item.date, null, settings);
            }
            if (!targetDay.tbmLog) targetDay.tbmLog = {};
            if (item.exists && Array.isArray(targetDay.tbmLog.riskRows)) {
              targetDay.tbmLog.riskRowsBackup = JSON.parse(JSON.stringify(targetDay.tbmLog.riskRows));
            }
            targetDay.tbmLog.workSection = item.workSection || "";
            targetDay.tbmLog.riskRows = padRiskRows(item.rows);

            await opts.invoke("save_day", { date: item.date, json: targetDay });
            appliedDates.push(item.date);
            if (typeof opts.onAccumulateRiskLibrary === "function") {
              try {
                var libRows = item.status === "ok"
                  ? item.rows
                  : (Array.isArray(item.rows) ? item.rows.filter(function (row) { return row && row._aiTouched; }) : []);
                if (libRows && libRows.length > 0) {
                  await opts.onAccumulateRiskLibrary(libRows, {
                    category: String((targetDay && targetDay.eduLog && targetDay.eduLog.workType) || (item.dayData && item.dayData.eduLog && item.dayData.eduLog.workType) || "").trim(),
                    source: "ai",
                    quiet: true
                  });
                }
              } catch (libErr) {
                console.warn("[batch] risk library accumulate failed:", libErr);
              }
            }
          } catch (err) {
            failedList.push({ date: item.date, error: String(err) });
          }
        }

        if (opts.refreshAfterBatch && appliedDates.length > 0) {
          try {
            await opts.refreshAfterBatch(appliedDates);
          } catch (_) {}
        }

        state.applying = false;
        if (failedList.length === 0) {
          close(true);
          if (skippedCurrent) {
            opts.showToast(
              appliedDates.length + "건 적용 완료 (현재 편집 중인 날짜는 충돌 방지를 위해 건너뛰었습니다).",
              false
            );
          } else {
            opts.showToast(appliedDates.length + "개 날짜에 TBM 일지를 적용했습니다.", false);
          }
        } else {
          var summary =
            appliedDates.length +
            "건 성공 / " +
            failedList.length +
            "건 실패 (" +
            failedList.map(function (f) { return f.date; }).join(", ") +
            ")";
          state.applySummary = summary;
          opts.showToast(summary, true);
          render();
        }
      });

      footer.appendChild(btnCancel);
      footer.appendChild(btnBatchPrint);
      footer.appendChild(btnApply);
      dialog.appendChild(footer);
    }

    function render() {
      modalRoot.classList.remove("hidden");
      modalRoot.textContent = "";

      var backdrop = createEl("div", "batch-modal-backdrop");
      var dialog = createEl("div", "batch-modal-dialog");

      if (state.stage === "manage_option") {
        renderManageOptionModal(dialog);
      } else if (state.stage === "option") {
        renderOptionModal(dialog);
      } else if (state.stage === "running") {
        renderRunningModal(dialog);
      } else {
        renderReviewModal(dialog);
      }

      backdrop.appendChild(dialog);
      modalRoot.appendChild(backdrop);
    }

    render();
  }

  root.DayrepBatchUI = {
    open: open
  };
})(window);
