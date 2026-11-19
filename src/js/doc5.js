(function (root) {
  "use strict";

  function formatDotDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return dateStr || "";
    var p = dateStr.split("-");
    return p[0] + ".  " + p[1] + ".  " + p[2] + ".";
  }

  function makeEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function addColgroup(table, widths) {
    var cg = document.createElement("colgroup");
    widths.forEach(function (w) {
      var col = document.createElement("col");
      col.style.width = w;
      cg.appendChild(col);
    });
    table.appendChild(cg);
  }

  function ensureTbmLog(day) {
    if (!day.tbmLog) {
      day.tbmLog = {
        companyWorkType: "",
        workSection: "",
        riskRows: [],
        workers: root.DayrepCarryover.makeDefaultTbmWorkers(),
        opinion: ""
      };
    }
    var tbm = day.tbmLog;
    if (!Array.isArray(tbm.riskRows)) tbm.riskRows = [];
    while (tbm.riskRows.length < 4) {
      tbm.riskRows.push({ item: "", hazard: "", type: "", level: "", measure: "" });
    }
    if (!Array.isArray(tbm.workers)) tbm.workers = [];
    while (tbm.workers.length < 30) {
      tbm.workers.push({ role: "", name: "", note: "" });
    }
    return tbm;
  }

  function createDoc5Controller() {
    var showStamps = true;
    var BLANK_DATE_STORAGE_KEY = "dayrep_doc5_blank_date_print";
    var DATE_OFFSET_STORAGE_KEY = "dayrep_doc5_print_date_offset";
    var blankDateOnPrint = false;
    var dateOffsetOnPrint = 0;

    function clampDateOffset(val) {
      var n = Number(val);
      if (!Number.isFinite(n)) return 0;
      n = Math.trunc(n);
      if (n < -7) return -7;
      if (n > 31) return 31;
      return n;
    }

    try {
      blankDateOnPrint = localStorage.getItem(BLANK_DATE_STORAGE_KEY) === "1";
    } catch (_) {
      blankDateOnPrint = false;
    }
    try {
      var rawOff = localStorage.getItem(DATE_OFFSET_STORAGE_KEY);
      if (rawOff !== null && rawOff !== "") {
        dateOffsetOnPrint = clampDateOffset(rawOff);
      }
    } catch (_) {
      dateOffsetOnPrint = 0;
    }
    var AI_ROW_COUNT_STORAGE_KEY = "dayrep_doc5_ai_row_count";
    var MAX_AI_ROW_COUNT = 8;
    var aiRowCount = "auto";
    try {
      var savedRowCnt = localStorage.getItem(AI_ROW_COUNT_STORAGE_KEY);
      if (savedRowCnt && savedRowCnt !== "auto") {
        var parsedCnt = Math.floor(Number(savedRowCnt));
        if (Number.isFinite(parsedCnt) && parsedCnt >= 3 && parsedCnt <= MAX_AI_ROW_COUNT) {
          aiRowCount = String(parsedCnt);
        }
      }
    } catch (_) {
      aiRowCount = "auto";
    }
    var aiBusy = false;
    var aiCancelled = false;
    var aiProgressText = "";
    var aiActiveTask = null; // { type: "table"|"cell"|"batch", col?: "tool"|"hazard"|"measure", rowIdx?: number, curRowIdx?: number, total?: number, k?: number }
    var activeHeaderMenuCol = null; // "tool" | "hazard" | "measure" | null
    var headerMenuCleanup = null; // function or null
    var lastContainer = null;
    var lastCtx = null;

    function removeHeaderMenuListeners() {
      if (typeof headerMenuCleanup === "function") {
        headerMenuCleanup();
        headerMenuCleanup = null;
      }
    }

    function closeHeaderMenu(triggerRender, container, ctx) {
      if (!activeHeaderMenuCol && !headerMenuCleanup) return;
      activeHeaderMenuCol = null;
      removeHeaderMenuListeners();
      var c = container || lastContainer;
      var cx = ctx || lastCtx;
      if (triggerRender && c && cx) {
        render(c, cx);
      }
    }

    function ensureHeaderMenuListeners(container, ctx) {
      if (headerMenuCleanup) return;
      var c = container || lastContainer;
      var cx = ctx || lastCtx;

      function onDocClick(e) {
        if (!activeHeaderMenuCol) {
          removeHeaderMenuListeners();
          return;
        }
        if (!e.target.closest || (!e.target.closest(".doc5-header-ai-menu") && !e.target.closest(".btn-cell-ai-hdr"))) {
          closeHeaderMenu(true, c, cx);
        }
      }

      function onDocKeydown(e) {
        if (e.key === "Escape") {
          closeHeaderMenu(true, c, cx);
        }
      }

      var timerId = setTimeout(function () {
        document.addEventListener("click", onDocClick);
        document.addEventListener("keydown", onDocKeydown);
      }, 0);

      headerMenuCleanup = function () {
        clearTimeout(timerId);
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onDocKeydown);
      };
    }

    var shouldScrollToPreview = false;
    var aiPreview = null; // { ok, rows, warnings, raw, model }
    var toolPreview = null; // { rowIdx, tool, warnings, raw, model }
    var rowPreview = null; // { rowIdx, tool, ok, row, warnings, raw, model }
    var measurePreview = null; // { rowIdx, basis, ok, measure, warnings, raw, model }

    function getAiConfig(ctx) {
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var aiCfg = settings.ai || {};
      var engine = aiCfg.engine || "hermes";
      var ep = (aiCfg.endpoints && aiCfg.endpoints[engine]) || {};
      return { settings: settings, aiCfg: aiCfg, engine: engine, ep: ep };
    }

    async function callAi(ctx, prompt, temp) {
      var cfg = getAiConfig(ctx);
      return await ctx.invoke("ai_generate", {
        engine: cfg.engine,
        prompt: prompt,
        options: {
          endpoint: cfg.aiCfg.hermesEndpoint || "",
          baseUrl: cfg.ep.baseUrl || "",
          model: cfg.ep.model || "",
          temperature: temp !== undefined ? temp : 0.4
        }
      });
    }

    function backupRiskRows(tbm) {
      tbm.riskRowsBackup = tbm.riskRows.map(function (r) {
        return Object.assign({}, r);
      });
    }

    function pickLibraryExamples(ctx, settingsObj, tbm, day, tool) {
      if (!settingsObj || settingsObj.riskLibraryAssist === false) return undefined;
      if (!ctx || typeof ctx.getRiskLibrary !== "function" || !root.DayrepRiskLibrary || typeof root.DayrepRiskLibrary.pickExamples !== "function") {
        return undefined;
      }
      try {
        var lib = ctx.getRiskLibrary();
        if (!lib || !Array.isArray(lib.entries) || lib.entries.length === 0) return undefined;
        var picked = root.DayrepRiskLibrary.pickExamples(lib, {
          category: (day && day.eduLog && day.eduLog.workType) || "",
          workSection: (tbm && tbm.workSection) || "",
          tool: tool || "",
          limit: 8
        });
        return picked && picked.length > 0 ? picked : undefined;
      } catch (_) {
        return undefined;
      }
    }

    async function runToolCellAi(container, ctx, rowIdx) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var cfg = getAiConfig(ctx);
      var existingTools = tbm.riskRows
        .filter(function (_, idx) { return idx !== rowIdx; })
        .map(function (r) { return String(r.item || "").trim(); })
        .filter(Boolean);

      var prompt = root.DayrepAiPrompts.buildToolPrompt(cfg.settings, {
        workSection: tbm.workSection || "",
        workType: (day.eduLog && day.eduLog.workType) || "",
        siteContext: day.siteContext || {},
        existingTools: existingTools,
        libraryExamples: pickLibraryExamples(ctx, cfg.settings, tbm, day, "")
      });

      aiBusy = true;
      aiCancelled = false;
      aiActiveTask = { type: "cell", col: "tool", rowIdx: rowIdx };
      aiProgressText = (rowIdx + 1) + "행 장비/도구 생성 중...";
      render(container, ctx);

      try {
        var resp = await callAi(ctx, prompt, 0.4);
        if (aiCancelled) return;
        var parsed = root.DayrepAiPrompts.parseToolResponse(resp.text || "");
        toolPreview = {
          rowIdx: rowIdx,
          tool: parsed.tool || "",
          ok: parsed.ok,
          warnings: parsed.warnings || [],
          raw: parsed.raw || "",
          model: resp.model || cfg.engine
        };
        shouldScrollToPreview = true;
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("장비/도구 AI 생성 실패: " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    async function runRiskRowCellAi(container, ctx, rowIdx) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var row = tbm.riskRows[rowIdx];
      var toolName = String((row && row.item) || "").trim();
      if (!toolName) {
        if (ctx.showToast) ctx.showToast("먼저 장비/도구를 입력하세요.", true);
        return;
      }

      var cfg = getAiConfig(ctx);
      var basePrompt = root.DayrepAiPrompts.buildRiskRowPrompt(cfg.settings, {
        tool: toolName,
        weather: day.patrol ? day.patrol.weather : "",
        workSection: tbm.workSection || "",
        workType: (day.eduLog && day.eduLog.workType) || "",
        siteContext: day.siteContext || {},
        libraryExamples: pickLibraryExamples(ctx, cfg.settings, tbm, day, toolName)
      });

      aiBusy = true;
      aiCancelled = false;
      aiActiveTask = { type: "cell", col: "hazard", rowIdx: rowIdx };
      aiProgressText = (rowIdx + 1) + "행 위험성평가 생성 중...";
      render(container, ctx);

      try {
        var resp = await callAi(ctx, basePrompt, 0.4);
        if (aiCancelled) return;
        var parsed = root.DayrepAiPrompts.parseRiskRowResponse(resp.text || "");
        if (!parsed.ok && parsed.retryHint) {
          var retryResp = await callAi(ctx, basePrompt + "\n\n[재요청 지시]\n" + parsed.retryHint, 0.3);
          if (aiCancelled) return;
          resp = retryResp;
          parsed = root.DayrepAiPrompts.parseRiskRowResponse(retryResp.text || "");
        }
        rowPreview = {
          rowIdx: rowIdx,
          tool: toolName,
          ok: parsed.ok,
          row: parsed.row,
          warnings: parsed.warnings || [],
          raw: parsed.raw || "",
          model: resp.model || cfg.engine
        };
        shouldScrollToPreview = true;
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("행 위험성평가 AI 생성 실패: " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    async function runBatchToolsAi(container, ctx, overwrite) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var cfg = getAiConfig(ctx);
      var targetIndices = [];
      for (var i = 0; i < tbm.riskRows.length; i++) {
        if (overwrite || !String(tbm.riskRows[i].item || "").trim()) {
          targetIndices.push(i);
        }
      }
      if (targetIndices.length === 0) {
        if (ctx.showToast) {
          ctx.showToast(overwrite ? "대상 행이 없습니다." : "비어 있는 장비/도구 칸이 없습니다.", false);
        }
        return;
      }

      aiBusy = true;
      aiCancelled = false;
      backupRiskRows(tbm);
      var filled = 0;
      var failCount = 0;
      try {
        for (var k = 0; k < targetIndices.length; k++) {
          if (aiCancelled) break;
          var rIdx = targetIndices[k];
          var snapshot = JSON.stringify(tbm.riskRows[rIdx]);
          aiActiveTask = { type: "batch", col: "tool", curRowIdx: rIdx, k: k + 1, total: targetIndices.length };
          aiProgressText = "장비/도구 " + (overwrite ? "열 재생성 중 (" : "일괄 제안 중 (") + (k + 1) + "/" + targetIndices.length + ")";
          render(container, ctx);

          var existingTools = tbm.riskRows
            .filter(function (_, idx) { return idx !== rIdx; })
            .map(function (r) { return String(r.item || "").trim(); })
            .filter(Boolean);
          var prompt = root.DayrepAiPrompts.buildToolPrompt(cfg.settings, {
            workSection: tbm.workSection || "",
            workType: (day.eduLog && day.eduLog.workType) || "",
            siteContext: day.siteContext || {},
            existingTools: existingTools,
            libraryExamples: pickLibraryExamples(ctx, cfg.settings, tbm, day, "")
          });
          var resp = await callAi(ctx, prompt, 0.4);
          if (aiCancelled) break;
          var parsed = root.DayrepAiPrompts.parseToolResponse(resp.text || "");
          if (parsed.ok && parsed.tool) {
            if (overwrite) {
              if (JSON.stringify(tbm.riskRows[rIdx]) === snapshot) {
                tbm.riskRows[rIdx].item = parsed.tool;
                filled += 1;
                ctx.onDayChange(day);
              }
            } else {
              if (!String(tbm.riskRows[rIdx].item || "").trim()) {
                tbm.riskRows[rIdx].item = parsed.tool;
                filled += 1;
                ctx.onDayChange(day);
              }
            }
          } else {
            failCount += 1;
          }
        }
        if (ctx.showToast) {
          if (failCount > 0) {
            ctx.showToast(filled + "개 행 적용, " + failCount + "개 실패", true);
          } else {
            ctx.showToast(filled + "개 행의 장비/도구를 " + (overwrite ? "다시 생성했습니다." : "채웠습니다."), false);
          }
        }
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("장비/도구 일괄 제안 중단(" + filled + "건 적용됨): " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    async function runBatchRiskRowsAi(container, ctx, overwrite) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var cfg = getAiConfig(ctx);
      var targets = [];
      for (var i = 0; i < tbm.riskRows.length; i++) {
        var tool = String(tbm.riskRows[i].item || "").trim();
        if (tool) {
          if (overwrite || !String(tbm.riskRows[i].hazard || "").trim()) {
            targets.push({
              idx: i,
              tool: tool,
              snapshot: JSON.stringify(tbm.riskRows[i])
            });
          }
        }
      }
      if (targets.length === 0) {
        if (ctx.showToast) {
          ctx.showToast(
            overwrite ? "먼저 장비/도구가 입력된 행이 있어야 합니다." : "장비/도구가 있고 위험요인이 비어 있는 행이 없습니다.",
            true
          );
        }
        return;
      }

      aiBusy = true;
      aiCancelled = false;
      backupRiskRows(tbm);
      var doneCount = 0;
      var failCount = 0;
      try {
        for (var k = 0; k < targets.length; k++) {
          if (aiCancelled) break;
          var tgt = targets[k];
          aiActiveTask = { type: "batch", col: "hazard", curRowIdx: tgt.idx, k: k + 1, total: targets.length };
          aiProgressText = "위험성평가 " + (overwrite ? "열 재생성 중 (" : "일괄 생성 중 (") + (k + 1) + "/" + targets.length + ")";
          render(container, ctx);

          var prompt = root.DayrepAiPrompts.buildRiskRowPrompt(cfg.settings, {
            tool: tgt.tool,
            weather: day.patrol ? day.patrol.weather : "",
            workSection: tbm.workSection || "",
            workType: (day.eduLog && day.eduLog.workType) || "",
            siteContext: day.siteContext || {},
            libraryExamples: pickLibraryExamples(ctx, cfg.settings, tbm, day, tgt.tool)
          });
          var resp = await callAi(ctx, prompt, 0.4);
          if (aiCancelled) break;
          var parsed = root.DayrepAiPrompts.parseRiskRowResponse(resp.text || "");
          if (!parsed.ok && parsed.retryHint) {
            var retryResp = await callAi(ctx, prompt + "\n\n[재요청 지시]\n" + parsed.retryHint, 0.3);
            if (aiCancelled) break;
            parsed = root.DayrepAiPrompts.parseRiskRowResponse(retryResp.text || "");
          }
          // 적용 시점 값 재확인: 사용자가 그 사이 직접 수정했으면 덮어쓰지 않음
          if (parsed.ok && parsed.row && JSON.stringify(tbm.riskRows[tgt.idx]) === tgt.snapshot) {
            tbm.riskRows[tgt.idx].hazard = parsed.row.hazard;
            tbm.riskRows[tgt.idx].type = parsed.row.accident;
            tbm.riskRows[tgt.idx].level = parsed.row.level;
            tbm.riskRows[tgt.idx].measure = parsed.row.measure;
            doneCount += 1;
            ctx.onDayChange(day);
            if (ctx.onAccumulateRiskLibrary) {
              try {
                ctx.onAccumulateRiskLibrary([tbm.riskRows[tgt.idx]], {
                  category: (day.eduLog && day.eduLog.workType) || "",
                  source: "ai",
                  quiet: true
                });
              } catch (_) {}
            }
          } else if (!parsed.ok) {
            failCount += 1;
          }
        }
        if (ctx.showToast) {
          if (failCount > 0) {
            ctx.showToast(doneCount + "개 행 생성, " + failCount + "개 실패", true);
          } else {
            ctx.showToast(doneCount + "개 행의 위험성평가를 " + (overwrite ? "다시 생성했습니다." : "생성했습니다."), false);
          }
        }
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("일괄 생성 중단(" + doneCount + "건 적용됨): " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    async function runMeasureCellAi(container, ctx, rowIdx) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var row = tbm.riskRows[rowIdx] || {};
      var hazard = String(row.hazard || "").trim();
      var tool = String(row.item || "").trim();
      if (!hazard && !tool) {
        if (ctx.showToast) ctx.showToast("먼저 유해·위험요인을 입력하세요.", true);
        return;
      }

      var cfg = getAiConfig(ctx);
      var basePrompt = root.DayrepAiPrompts.buildMeasurePrompt(cfg.settings, {
        tool: tool,
        hazard: hazard,
        accident: String(row.type || "").trim(),
        level: String(row.level || "").trim(),
        weather: day.patrol ? day.patrol.weather : "",
        workSection: tbm.workSection || "",
        workType: (day.eduLog && day.eduLog.workType) || "",
        libraryExamples: pickLibraryExamples(ctx, cfg.settings, tbm, day, tool)
      });

      aiBusy = true;
      aiCancelled = false;
      aiActiveTask = { type: "cell", col: "measure", rowIdx: rowIdx };
      aiProgressText = (rowIdx + 1) + "행 감소대책 생성 중...";
      render(container, ctx);

      try {
        var resp = await callAi(ctx, basePrompt, 0.4);
        if (aiCancelled) return;
        var parsed = root.DayrepAiPrompts.parseMeasureResponse(resp.text || "");
        if (!parsed.ok && parsed.retryHint) {
          var retryResp = await callAi(ctx, basePrompt + "\n\n[재요청 지시]\n" + parsed.retryHint, 0.3);
          if (aiCancelled) return;
          resp = retryResp;
          parsed = root.DayrepAiPrompts.parseMeasureResponse(retryResp.text || "");
        }
        measurePreview = {
          rowIdx: rowIdx,
          basis: hazard || tool,
          ok: parsed.ok,
          measure: parsed.measure || "",
          warnings: parsed.warnings || [],
          raw: parsed.raw || "",
          model: resp.model || cfg.engine
        };
        shouldScrollToPreview = true;
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("감소대책 AI 생성 실패: " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    async function runBatchMeasuresAi(container, ctx, overwrite) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }
      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var cfg = getAiConfig(ctx);
      var targets = [];
      for (var i = 0; i < tbm.riskRows.length; i++) {
        var haz = String(tbm.riskRows[i].hazard || "").trim();
        var meas = String(tbm.riskRows[i].measure || "").trim();
        if (haz) {
          if (overwrite || !meas) {
            targets.push({
              idx: i,
              row: Object.assign({}, tbm.riskRows[i]),
              snapshot: JSON.stringify(tbm.riskRows[i])
            });
          }
        }
      }
      if (targets.length === 0) {
        if (ctx.showToast) {
          ctx.showToast(
            overwrite ? "유해·위험요인이 입력된 행이 없습니다." : "유해·위험요인이 있고 감소대책이 빈 행이 없습니다.",
            true
          );
        }
        return;
      }

      aiBusy = true;
      aiCancelled = false;
      backupRiskRows(tbm);
      var doneCount = 0;
      var failCount = 0;
      try {
        for (var k = 0; k < targets.length; k++) {
          if (aiCancelled) break;
          var tgt = targets[k];
          aiActiveTask = { type: "batch", col: "measure", curRowIdx: tgt.idx, k: k + 1, total: targets.length };
          aiProgressText = "감소대책 " + (overwrite ? "열 재생성 중 (" : "일괄 생성 중 (") + (k + 1) + "/" + targets.length + ")";
          render(container, ctx);

          var prompt = root.DayrepAiPrompts.buildMeasurePrompt(cfg.settings, {
            tool: String(tgt.row.item || "").trim(),
            hazard: String(tgt.row.hazard || "").trim(),
            accident: String(tgt.row.type || "").trim(),
            level: String(tgt.row.level || "").trim(),
            weather: day.patrol ? day.patrol.weather : "",
            workSection: tbm.workSection || "",
            workType: (day.eduLog && day.eduLog.workType) || "",
            libraryExamples: pickLibraryExamples(ctx, cfg.settings, tbm, day, String(tgt.row.item || "").trim())
          });
          var resp = await callAi(ctx, prompt, 0.4);
          if (aiCancelled) break;
          var parsed = root.DayrepAiPrompts.parseMeasureResponse(resp.text || "");
          if (parsed.ok && parsed.measure && JSON.stringify(tbm.riskRows[tgt.idx]) === tgt.snapshot) {
            tbm.riskRows[tgt.idx].measure = parsed.measure;
            doneCount += 1;
            ctx.onDayChange(day);
            if (ctx.onAccumulateRiskLibrary) {
              try {
                ctx.onAccumulateRiskLibrary([tbm.riskRows[tgt.idx]], {
                  category: (day.eduLog && day.eduLog.workType) || "",
                  source: "ai",
                  quiet: true
                });
              } catch (_) {}
            }
          } else if (!parsed.ok) {
            failCount += 1;
          }
        }
        if (ctx.showToast) {
          if (failCount > 0) {
            ctx.showToast(doneCount + "개 행 생성, " + failCount + "개 실패", true);
          } else {
            ctx.showToast(doneCount + "개 행의 감소대책을 " + (overwrite ? "다시 생성했습니다." : "생성했습니다."), false);
          }
        }
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("감소대책 일괄 생성 중단(" + doneCount + "건 적용됨): " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    async function runRiskGenerate(container, ctx, manualRetryHint) {
      if (aiBusy) return;
      closeHeaderMenu(false);
      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }

      var day = ctx.dayData;
      var tbm = ensureTbmLog(day);
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var aiCfg = settings.ai || {};
      var engine = aiCfg.engine || "hermes";
      var ep = (aiCfg.endpoints && aiCfg.endpoints[engine]) || {};

      var basePrompt = root.DayrepAiPrompts.buildRiskPrompt(settings, {
        date: day.date,
        weather: day.patrol ? day.patrol.weather : "",
        workType: (day.eduLog && day.eduLog.workType) || "",
        workSection: tbm.workSection || "",
        siteContext: day.siteContext || {},
        rowCount: aiRowCount === "auto" ? null : Number(aiRowCount),
        libraryExamples: pickLibraryExamples(ctx, settings, tbm, day, "")
      });

      async function callOnce(hint) {
        var p = hint ? (basePrompt + "\n\n[재요청 지시]\n" + hint) : basePrompt;
        return await ctx.invoke("ai_generate", {
          engine: engine,
          prompt: p,
          options: {
            endpoint: aiCfg.hermesEndpoint || "",
            baseUrl: ep.baseUrl || "",
            model: ep.model || "",
            temperature: 0.4
          }
        });
      }

      aiBusy = true;
      aiCancelled = false;
      aiActiveTask = { type: "table" };
      aiProgressText = "표 전체 위험성평가 생성 중...";
      render(container, ctx);

      try {
        var resp = await callOnce(manualRetryHint);
        if (aiCancelled) return;
        var rowCountOpt = { rowCount: aiRowCount === "auto" ? null : Number(aiRowCount) };
        var parsed = root.DayrepAiPrompts.parseRiskResponse(resp.text || "", rowCountOpt);
        // 파싱 실패 시 1회 자동 재요청
        if (!parsed.ok && parsed.retryHint) {
          var retryResp = await callOnce(parsed.retryHint);
          if (aiCancelled) return;
          resp = retryResp;
          parsed = root.DayrepAiPrompts.parseRiskResponse(retryResp.text || "", rowCountOpt);
        }
        aiPreview = {
          ok: parsed.ok,
          rows: parsed.rows || [],
          warnings: parsed.warnings || [],
          raw: parsed.raw || "",
          model: resp.model || engine
        };
        shouldScrollToPreview = true;
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("AI 위험성평가 생성 실패: " + String(err), true);
        }
      } finally {
        aiBusy = false;
        aiActiveTask = null;
        aiProgressText = "";
        render(container, ctx);
      }
    }

    function renderHeaderAiMenu(colKey, container, ctx, tbm, day) {
      var menu = makeEl("div", "doc5-header-ai-menu no-print");
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", "열 AI 생성 옵션");

      var colConfig = {
        tool: {
          title: "장비/도구 열 AI 일괄",
          emptyCount: tbm.riskRows.filter(function (r) { return !String(r.item || "").trim(); }).length,
          allCount: tbm.riskRows.length,
          warning: "※ 장비 변경 시 해당 행의 요인·대책은 바뀌지 않습니다.",
          run: function (overwrite) { runBatchToolsAi(container, ctx, overwrite); }
        },
        hazard: {
          title: "위험성평가 열 AI 일괄",
          emptyCount: tbm.riskRows.filter(function (r) {
            return String(r.item || "").trim() && !String(r.hazard || "").trim();
          }).length,
          allCount: tbm.riskRows.filter(function (r) { return String(r.item || "").trim(); }).length,
          warning: "※ 장비/도구가 입력된 행만 대상입니다.",
          run: function (overwrite) { runBatchRiskRowsAi(container, ctx, overwrite); }
        },
        measure: {
          title: "감소대책 열 AI 일괄",
          emptyCount: tbm.riskRows.filter(function (r) {
            return String(r.hazard || "").trim() && !String(r.measure || "").trim();
          }).length,
          allCount: tbm.riskRows.filter(function (r) { return String(r.hazard || "").trim(); }).length,
          warning: "※ 유해·위험요인이 있는 행만 대상입니다.",
          run: function (overwrite) { runBatchMeasuresAi(container, ctx, overwrite); }
        }
      }[colKey];

      var titleEl = makeEl("div", "header-ai-menu-title", colConfig.title);
      menu.appendChild(titleEl);

      var btnGroup = makeEl("div", "header-ai-menu-btns");

      // 1. 빈 칸만 채우기
      var emptyLabel = colConfig.emptyCount > 0
        ? "빈 칸만 채우기 (" + colConfig.emptyCount + "개 행)"
        : "빈 칸만 채우기 (빈 칸 없음)";
      var btnEmpty = makeEl("button", "btn-secondary btn-menu-opt", emptyLabel);
      btnEmpty.type = "button";
      btnEmpty.disabled = colConfig.emptyCount === 0;
      btnEmpty.addEventListener("click", function (e) {
        e.stopPropagation();
        closeHeaderMenu(false);
        colConfig.run(false);
      });
      btnGroup.appendChild(btnEmpty);

      // 2. 열 전체 다시 생성 (덮어쓰기)
      var allLabel = colConfig.allCount > 0
        ? "열 전체 다시 생성 (덮어쓰기, " + colConfig.allCount + "개 행)"
        : "열 전체 다시 생성 (대상 행 없음)";
      var btnOverwrite = makeEl("button", "btn-secondary btn-menu-opt", allLabel);
      btnOverwrite.type = "button";
      btnOverwrite.disabled = colConfig.allCount === 0;
      btnOverwrite.addEventListener("click", function (e) {
        e.stopPropagation();
        closeHeaderMenu(false);
        colConfig.run(true);
      });
      btnGroup.appendChild(btnOverwrite);

      menu.appendChild(btnGroup);

      var noticeBox = makeEl("div", "header-ai-menu-notes");
      noticeBox.appendChild(makeEl("div", "menu-note-item", "• 덮어쓰기 전 이전 내용은 백업되어 되돌리기가 가능합니다."));
      if (colConfig.warning) {
        noticeBox.appendChild(makeEl("div", "menu-note-item", colConfig.warning));
      }
      menu.appendChild(noticeBox);

      var foot = makeEl("div", "header-ai-menu-foot");
      var btnClose = makeEl("button", "btn-secondary btn-menu-close", "닫기");
      btnClose.type = "button";
      btnClose.addEventListener("click", function (e) {
        e.stopPropagation();
        closeHeaderMenu(true, container, ctx);
      });
      foot.appendChild(btnClose);
      menu.appendChild(foot);

      return menu;
    }

    function render(container, ctx) {
      container = container || lastContainer;
      ctx = ctx || lastCtx;
      if (!container) return;
      lastContainer = container;
      lastCtx = ctx;
      container.textContent = "";

      var day = ctx.dayData;
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var stamps = ctx.stamps || {};
      var tbm = ensureTbmLog(day);

      // 1. 툴바 (.no-print)
      var toolbar = makeEl("div", "doc-toolbar no-print");
      var leftGroup = makeEl("div", "toolbar-group");

      var stampLabel = makeEl("label", "toolbar-check");
      var stampChk = document.createElement("input");
      stampChk.type = "checkbox";
      stampChk.checked = showStamps;
      stampChk.addEventListener("change", function () {
        showStamps = stampChk.checked;
        render(container, ctx);
      });
      stampLabel.appendChild(stampChk);
      stampLabel.appendChild(document.createTextNode(" 결재 도장 표시"));
      leftGroup.appendChild(stampLabel);

      var btnAddRisk = makeEl("button", "btn-secondary", "+ 위험성평가 행 추가");
      btnAddRisk.type = "button";
      btnAddRisk.addEventListener("click", function () {
        tbm.riskRows.push({ item: "", hazard: "", type: "", level: "", measure: "" });
        ctx.onDayChange(day);
        render(container, ctx);
      });
      leftGroup.appendChild(btnAddRisk);

      if (root.DayrepRiskPickerModal && root.DayrepRiskLibrary) {
        var btnPickLib = makeEl("button", "btn-secondary", "라이브러리에서 추가");
        btnPickLib.type = "button";
        btnPickLib.addEventListener("click", function () {
          var lib = typeof ctx.getRiskLibrary === "function" ? ctx.getRiskLibrary() : null;
          root.DayrepRiskPickerModal.open({
            library: lib,
            defaultCategory: (day.eduLog && day.eduLog.workType) || "",
            onConfirm: function (selected) {
              if (!selected || selected.length === 0) return;
              backupRiskRows(tbm);
              var res = root.DayrepRiskPickerModal.applySelectedToRows(tbm.riskRows, selected, 12);
              tbm.riskRows = res.rows;
              ctx.onDayChange(day);
              render(container, ctx);
              if (res.addedIds.length > 0 && typeof ctx.onBumpRiskLibraryUsage === "function") {
                ctx.onBumpRiskLibraryUsage(res.addedIds);
              }
              if (ctx.showToast) {
                var msgs = [];
                if (res.addedIds.length > 0) msgs.push(res.addedIds.length + "건 추가");
                if (res.skippedDup > 0) msgs.push("중복 " + res.skippedDup + "건 건너뜀");
                if (res.skippedLimit > 0) msgs.push("최대 12행 제한으로 " + res.skippedLimit + "건 제외");
                ctx.showToast(msgs.join(" · ") || "추가된 항목이 없습니다.", res.addedIds.length === 0);
              }
            }
          });
        });
        leftGroup.appendChild(btnPickLib);
      }

      var btnDelRisk = makeEl("button", "btn-secondary", "마지막 행 삭제");
      btnDelRisk.type = "button";
      btnDelRisk.disabled = tbm.riskRows.length <= 4;
      btnDelRisk.addEventListener("click", function () {
        if (tbm.riskRows.length <= 4) return;
        tbm.riskRows.pop();
        ctx.onDayChange(day);
        render(container, ctx);
      });
      leftGroup.appendChild(btnDelRisk);

      var btnLoadWorkers = makeEl("button", "btn-secondary", "명단 불러오기");
      btnLoadWorkers.type = "button";
      btnLoadWorkers.addEventListener("click", function () {
        var list = settings.workers || [];
        if (list.length === 0) {
          ctx.showToast("설정에 등록된 근로자 명단이 없습니다.", true);
          return;
        }
        for (var i = 0; i < 30; i++) {
          if (i < list.length) {
            tbm.workers[i] = {
              role: list[i].role || "",
              name: list[i].name || "",
              note: tbm.workers[i] ? (tbm.workers[i].note || "") : ""
            };
          } else {
            tbm.workers[i] = { role: "", name: "", note: "" };
          }
        }
        ctx.onDayChange(day);
        render(container, ctx);
        ctx.showToast(Math.min(30, list.length) + "명의 명단을 불러왔습니다.", false);
      });
      leftGroup.appendChild(btnLoadWorkers);

      if (root.DayrepAiPrompts) {
        var isTableAiActive = aiActiveTask && aiActiveTask.type === "table";
        var btnAiRisk = makeEl(
          "button",
          "btn-primary" + (isTableAiActive ? " btn-ai-active" : ""),
          aiBusy ? "" : "AI로 위험성평가 생성"
        );
        btnAiRisk.type = "button";
        btnAiRisk.disabled = aiBusy;
        if (isTableAiActive) {
          btnAiRisk.setAttribute("aria-busy", "true");
          btnAiRisk.title = "생성 중…";
          var spTable = makeEl("span", "ai-btn-spinner");
          spTable.setAttribute("aria-hidden", "true");
          btnAiRisk.appendChild(spTable);
          btnAiRisk.appendChild(document.createTextNode(" AI 생성 중..."));
        } else if (aiBusy) {
          btnAiRisk.title = "다른 AI 작업 진행 중";
          btnAiRisk.textContent = "AI 생성 중...";
        }
        btnAiRisk.addEventListener("click", function () {
          runRiskGenerate(container, ctx, null);
        });
        leftGroup.appendChild(btnAiRisk);

        var selAiRowCnt = document.createElement("select");
        selAiRowCnt.className = "doc5-ai-row-select no-print";
        selAiRowCnt.title = "AI가 생성할 위험성평가 행 수";
        selAiRowCnt.disabled = aiBusy;
        var optAuto = document.createElement("option");
        optAuto.value = "auto";
        optAuto.textContent = "자동(3~6행)";
        selAiRowCnt.appendChild(optAuto);
        for (var rc = 3; rc <= MAX_AI_ROW_COUNT; rc++) {
          var optRc = document.createElement("option");
          optRc.value = String(rc);
          optRc.textContent = rc + "행";
          selAiRowCnt.appendChild(optRc);
        }
        selAiRowCnt.value = aiRowCount;
        selAiRowCnt.addEventListener("change", function () {
          aiRowCount = selAiRowCnt.value || "auto";
          try {
            localStorage.setItem(AI_ROW_COUNT_STORAGE_KEY, aiRowCount);
          } catch (_) {}
        });
        leftGroup.appendChild(selAiRowCnt);

        if (aiBusy) {
          var btnCancelAi = makeEl("button", "btn-secondary", "생성 취소");
          btnCancelAi.type = "button";
          btnCancelAi.addEventListener("click", function () {
            aiCancelled = true;
            aiBusy = false;
            aiActiveTask = null;
            aiProgressText = "";
            render(container, ctx);
          });
          leftGroup.appendChild(btnCancelAi);
        }
      }

      if (Array.isArray(tbm.riskRowsBackup) && tbm.riskRowsBackup.length > 0) {
        var btnUndoRisk = makeEl("button", "btn-secondary", "이전 위험성평가 되돌리기");
        btnUndoRisk.type = "button";
        btnUndoRisk.addEventListener("click", function () {
          tbm.riskRows = tbm.riskRowsBackup.map(function (r) {
            return Object.assign({}, r);
          });
          tbm.riskRowsBackup = null;
          ctx.onDayChange(day);
          render(container, ctx);
          if (ctx.showToast) ctx.showToast("이전 위험성평가로 되돌렸습니다.", false);
        });
        leftGroup.appendChild(btnUndoRisk);
      }

      if (aiProgressText) {
        leftGroup.appendChild(makeEl("span", "muted-inline", aiProgressText));
      }

      if (ctx.onOpenBatch) {
        var btnBatch = makeEl("button", "btn-secondary", "기간 일괄 생성");
        btnBatch.type = "button";
        btnBatch.addEventListener("click", function () {
          ctx.onOpenBatch();
        });
        leftGroup.appendChild(btnBatch);
      }

      if (ctx.onOpenManage) {
        var btnManage = makeEl("button", "btn-secondary", "기간 확인·인쇄");
        btnManage.type = "button";
        btnManage.addEventListener("click", function () {
          ctx.onOpenManage();
        });
        leftGroup.appendChild(btnManage);
      }

      var rightGroup = makeEl("div", "toolbar-group");
      var blankLabel = makeEl("label", "toolbar-check");
      var blankChk = document.createElement("input");
      blankChk.type = "checkbox";
      blankChk.checked = blankDateOnPrint;
      blankLabel.appendChild(blankChk);
      blankLabel.appendChild(document.createTextNode(" 일자 비우고 인쇄"));
      rightGroup.appendChild(blankLabel);

      var offsetWrap = makeEl("span", "print-date-offset-wrap");
      offsetWrap.appendChild(makeEl("span", "muted-inline", "일자 이동(일)"));
      var offsetInp = document.createElement("input");
      offsetInp.type = "number";
      offsetInp.className = "print-date-offset-input";
      offsetInp.min = "-7";
      offsetInp.max = "31";
      offsetInp.step = "1";
      offsetInp.value = String(dateOffsetOnPrint);
      offsetWrap.appendChild(offsetInp);

      var btnNextDay = makeEl("button", "btn-secondary", "+1(다음날)");
      btnNextDay.type = "button";
      offsetWrap.appendChild(btnNextDay);

      var previewSpan = makeEl("span", "print-date-preview");
      offsetWrap.appendChild(previewSpan);
      rightGroup.appendChild(offsetWrap);

      function getScreenDateText(dateStr) {
        if (blankDateOnPrint && root.DayrepExport && typeof root.DayrepExport.formatBlankDateStr === "function") {
          return root.DayrepExport.formatBlankDateStr(dateStr);
        }
        return formatDotDate(dateStr);
      }

      function syncDateOffsetUi() {
        offsetInp.value = String(dateOffsetOnPrint);
        offsetInp.disabled = blankDateOnPrint;
        btnNextDay.disabled = blankDateOnPrint;
        if (blankDateOnPrint) {
          previewSpan.textContent = "출력: 비움";
        } else {
          var targetDate = (root.DayrepSchedule && typeof root.DayrepSchedule.addDays === "function")
            ? root.DayrepSchedule.addDays(day.date, dateOffsetOnPrint)
            : day.date;
          previewSpan.textContent = "출력 일자: " + formatDotDate(targetDate);
        }
        var screenDateEl = container.querySelector(".doc5-date-val");
        if (screenDateEl) {
          screenDateEl.textContent = getScreenDateText(day.date);
          screenDateEl.style.whiteSpace = blankDateOnPrint ? "pre" : "";
        }
      }
      syncDateOffsetUi();

      blankChk.addEventListener("change", function () {
        blankDateOnPrint = blankChk.checked;
        try {
          localStorage.setItem(BLANK_DATE_STORAGE_KEY, blankDateOnPrint ? "1" : "0");
        } catch (_) {}
        syncDateOffsetUi();
      });

      offsetInp.addEventListener("change", function () {
        dateOffsetOnPrint = clampDateOffset(offsetInp.value);
        try {
          localStorage.setItem(DATE_OFFSET_STORAGE_KEY, String(dateOffsetOnPrint));
        } catch (_) {}
        syncDateOffsetUi();
      });

      btnNextDay.addEventListener("click", function () {
        dateOffsetOnPrint = dateOffsetOnPrint === 1 ? 0 : 1;
        try {
          localStorage.setItem(DATE_OFFSET_STORAGE_KEY, String(dateOffsetOnPrint));
        } catch (_) {}
        syncDateOffsetUi();
      });

      var btnPrint = makeEl("button", "btn-secondary", "이 서류 인쇄");
      btnPrint.type = "button";
      btnPrint.addEventListener("click", function () {
        if (typeof ctx.onBeforePrint === "function") {
          ctx.onBeforePrint();
        }
        if (root.DayrepExport && typeof root.DayrepExport.printCurrentSheet === "function") {
          root.DayrepExport.printCurrentSheet(container.querySelector(".a4-sheet"), {
            blankDate: blankDateOnPrint,
            dateOffset: dateOffsetOnPrint,
            baseDate: day.date
          });
        } else {
          window.print();
        }
      });
      rightGroup.appendChild(btnPrint);

      toolbar.appendChild(leftGroup);
      toolbar.appendChild(rightGroup);
      container.appendChild(toolbar);

      if (aiBusy) {
        var stickyBar = makeEl("div", "doc5-ai-sticky-bar no-print");
        stickyBar.setAttribute("role", "status");
        stickyBar.setAttribute("aria-live", "polite");
        var barText = makeEl("span", "doc5-ai-sticky-text", "⏳ " + (aiProgressText || "AI 작업 진행 중…"));
        stickyBar.appendChild(barText);
        var btnStickyCancel = makeEl("button", "btn-secondary btn-sticky-cancel", "생성 취소");
        btnStickyCancel.type = "button";
        btnStickyCancel.addEventListener("click", function () {
          aiCancelled = true;
          aiBusy = false;
          aiActiveTask = null;
          aiProgressText = "";
          render(container, ctx);
        });
        stickyBar.appendChild(btnStickyCancel);
        container.appendChild(stickyBar);
      }

      if (activeHeaderMenuCol) {
        ensureHeaderMenuListeners(container, ctx);
      } else {
        removeHeaderMenuListeners();
      }

      var latestPreviewPanel = null;

      if (aiPreview) {
        var prevBox = makeEl("div", "ai-preview-panel no-print");
        var prevHead = makeEl("div", "ai-preview-head");
        prevHead.appendChild(
          makeEl("strong", "", "AI 생성 위험성평가 미리보기 (" + aiPreview.model + ")")
        );
        var prevActions = makeEl("div", "toolbar-group");

        if (aiPreview.ok && aiPreview.rows.length > 0) {
          var btnApply = makeEl("button", "btn-primary", "적용");
          btnApply.type = "button";
          btnApply.addEventListener("click", function () {
            tbm.riskRowsBackup = tbm.riskRows.map(function (r) {
              return Object.assign({}, r);
            });
            var mapped = aiPreview.rows.map(function (r) {
              return {
                item: r.tool || "",
                hazard: r.hazard || "",
                type: r.accident || "",
                level: r.level || "중",
                measure: r.measure || ""
              };
            });
            while (mapped.length < 4) {
              mapped.push({ item: "", hazard: "", type: "", level: "", measure: "" });
            }
            tbm.riskRows = mapped;
            aiPreview = null;
            ctx.onDayChange(day);
            if (ctx.onAccumulateRiskLibrary) {
              try {
                ctx.onAccumulateRiskLibrary(mapped, {
                  category: (day.eduLog && day.eduLog.workType) || "",
                  source: "ai",
                  quiet: true
                });
              } catch (_) {}
            }
            render(container, ctx);
            if (ctx.showToast) ctx.showToast("AI 위험성평가가 적용되었습니다.", false);
          });
          prevActions.appendChild(btnApply);
        }

        var btnRetry = makeEl("button", "btn-secondary", "다시 생성");
        btnRetry.type = "button";
        btnRetry.disabled = aiBusy;
        btnRetry.addEventListener("click", function () {
          runRiskGenerate(container, ctx, null);
        });

        var btnCancelPrev = makeEl("button", "btn-secondary", "취소");
        btnCancelPrev.type = "button";
        btnCancelPrev.addEventListener("click", function () {
          aiPreview = null;
          render(container, ctx);
        });

        prevActions.appendChild(btnRetry);
        prevActions.appendChild(btnCancelPrev);
        prevHead.appendChild(prevActions);
        prevBox.appendChild(prevHead);

        if (aiPreview.warnings && aiPreview.warnings.length > 0) {
          prevBox.appendChild(
            makeEl("div", "ai-preview-warn", aiPreview.warnings.join(" / "))
          );
        }

        if (aiPreview.ok && aiPreview.rows.length > 0) {
          var pTable = makeEl("table", "ai-preview-table");
          var pHead = document.createElement("tr");
          ["No.", "장비/도구", "유해위험요인", "재해형태", "위험성", "감소대책"].forEach(function (h) {
            pHead.appendChild(makeEl("th", "", h));
          });
          pTable.appendChild(pHead);
          aiPreview.rows.forEach(function (r, idx) {
            var tr = document.createElement("tr");
            tr.appendChild(makeEl("td", "center", String(idx + 1)));
            tr.appendChild(makeEl("td", "", r.tool));
            tr.appendChild(makeEl("td", "", r.hazard));
            tr.appendChild(makeEl("td", "center", r.accident));
            tr.appendChild(makeEl("td", "center", r.level));
            tr.appendChild(makeEl("td", "", r.measure));
            pTable.appendChild(tr);
          });
          prevBox.appendChild(pTable);
        } else {
          prevBox.appendChild(makeEl("pre", "ai-preview-text", aiPreview.raw || "(빈 응답)"));
        }

        container.appendChild(prevBox);
        latestPreviewPanel = prevBox;
      }

      // 장비/도구 셀 AI 미리보기 팝오버 (.no-print)
      if (toolPreview) {
        var tpBox = makeEl("div", "ai-preview-panel no-print");
        var tpHead = makeEl("div", "ai-preview-head");
        tpHead.appendChild(
          makeEl("strong", "", (toolPreview.rowIdx + 1) + "행 장비/도구 AI 제안 (" + toolPreview.model + ")")
        );
        var tpActs = makeEl("div", "toolbar-group");
        if (toolPreview.ok && toolPreview.tool) {
          var btnTpApply = makeEl("button", "btn-primary", "적용");
          btnTpApply.type = "button";
          btnTpApply.addEventListener("click", function () {
            backupRiskRows(tbm);
            tbm.riskRows[toolPreview.rowIdx].item = toolPreview.tool;
            toolPreview = null;
            ctx.onDayChange(day);
            render(container, ctx);
          });
          tpActs.appendChild(btnTpApply);
        }
        var btnTpRetry = makeEl("button", "btn-secondary", "다시");
        btnTpRetry.type = "button";
        btnTpRetry.disabled = aiBusy;
        btnTpRetry.addEventListener("click", function () {
          var idx = toolPreview.rowIdx;
          toolPreview = null;
          runToolCellAi(container, ctx, idx);
        });
        var btnTpCancel = makeEl("button", "btn-secondary", "취소");
        btnTpCancel.type = "button";
        btnTpCancel.addEventListener("click", function () {
          toolPreview = null;
          render(container, ctx);
        });
        tpActs.appendChild(btnTpRetry);
        tpActs.appendChild(btnTpCancel);
        tpHead.appendChild(tpActs);
        tpBox.appendChild(tpHead);
        tpBox.appendChild(makeEl("div", "ai-preview-text", toolPreview.tool || toolPreview.raw));
        container.appendChild(tpBox);
        latestPreviewPanel = tpBox;
      }

      // 유해위험요인 행 전체 AI 미리보기 패널 (.no-print)
      if (rowPreview) {
        var rpBox = makeEl("div", "ai-preview-panel no-print");
        var rpHead = makeEl("div", "ai-preview-head");
        rpHead.appendChild(
          makeEl("strong", "", (rowPreview.rowIdx + 1) + "행(" + rowPreview.tool + ") 위험성평가 미리보기 (" + rowPreview.model + ")")
        );
        var rpActs = makeEl("div", "toolbar-group");

        if (rowPreview.ok && rowPreview.row) {
          var targetRow = tbm.riskRows[rowPreview.rowIdx];
          var hasExisting = Boolean(
            String(targetRow.hazard || "").trim() ||
            String(targetRow.type || "").trim() ||
            String(targetRow.measure || "").trim()
          );

          function applyRowData(overwriteAll) {
            backupRiskRows(tbm);
            var r = tbm.riskRows[rowPreview.rowIdx];
            var g = rowPreview.row;
            if (overwriteAll || !String(r.hazard || "").trim()) r.hazard = g.hazard;
            if (overwriteAll || !String(r.type || "").trim()) r.type = g.accident;
            if (overwriteAll || !String(r.level || "").trim()) r.level = g.level;
            if (overwriteAll || !String(r.measure || "").trim()) r.measure = g.measure;
            rowPreview = null;
            ctx.onDayChange(day);
            if (ctx.onAccumulateRiskLibrary) {
              try {
                ctx.onAccumulateRiskLibrary([r], {
                  category: (day.eduLog && day.eduLog.workType) || "",
                  source: "ai",
                  quiet: true
                });
              } catch (_) {}
            }
            render(container, ctx);
          }

          if (hasExisting) {
            var btnFillEmpty = makeEl("button", "btn-primary", "빈 칸만 채우기");
            btnFillEmpty.type = "button";
            btnFillEmpty.addEventListener("click", function () { applyRowData(false); });
            var btnOverwrite = makeEl("button", "btn-secondary", "모두 덮어쓰기");
            btnOverwrite.type = "button";
            btnOverwrite.addEventListener("click", function () { applyRowData(true); });
            rpActs.appendChild(btnFillEmpty);
            rpActs.appendChild(btnOverwrite);
          } else {
            var btnRpApply = makeEl("button", "btn-primary", "적용");
            btnRpApply.type = "button";
            btnRpApply.addEventListener("click", function () { applyRowData(true); });
            rpActs.appendChild(btnRpApply);
          }
        }

        var btnRpRetry = makeEl("button", "btn-secondary", "다시");
        btnRpRetry.type = "button";
        btnRpRetry.disabled = aiBusy;
        btnRpRetry.addEventListener("click", function () {
          var idx = rowPreview.rowIdx;
          rowPreview = null;
          runRiskRowCellAi(container, ctx, idx);
        });
        var btnRpCancel = makeEl("button", "btn-secondary", "취소");
        btnRpCancel.type = "button";
        btnRpCancel.addEventListener("click", function () {
          rowPreview = null;
          render(container, ctx);
        });
        rpActs.appendChild(btnRpRetry);
        rpActs.appendChild(btnRpCancel);
        rpHead.appendChild(rpActs);
        rpBox.appendChild(rpHead);

        if (rowPreview.warnings && rowPreview.warnings.length > 0) {
          rpBox.appendChild(makeEl("div", "ai-preview-warn", rowPreview.warnings.join(" / ")));
        }
        if (rowPreview.ok && rowPreview.row) {
          var rpTable = makeEl("table", "ai-preview-table");
          var rph = document.createElement("tr");
          ["유해위험요인", "재해형태", "위험성", "감소대책"].forEach(function (h) {
            rph.appendChild(makeEl("th", "", h));
          });
          rpTable.appendChild(rph);
          var rpb = document.createElement("tr");
          rpb.appendChild(makeEl("td", "", rowPreview.row.hazard));
          rpb.appendChild(makeEl("td", "center", rowPreview.row.accident));
          rpb.appendChild(makeEl("td", "center", rowPreview.row.level));
          rpb.appendChild(makeEl("td", "", rowPreview.row.measure));
          rpTable.appendChild(rpb);
          rpBox.appendChild(rpTable);
        } else {
          rpBox.appendChild(makeEl("pre", "ai-preview-text", rowPreview.raw || "(빈 응답)"));
        }
        container.appendChild(rpBox);
        latestPreviewPanel = rpBox;
      }

      // 위험성 감소대책 셀 AI 미리보기 패널 (.no-print)
      if (measurePreview) {
        var mpBox = makeEl("div", "ai-preview-panel no-print");
        var mpHead = makeEl("div", "ai-preview-head");
        mpHead.appendChild(
          makeEl("strong", "", (measurePreview.rowIdx + 1) + "행 감소대책 AI 제안 (" + measurePreview.model + ")")
        );
        var mpActs = makeEl("div", "toolbar-group");
        if (measurePreview.ok && measurePreview.measure) {
          var existingMeas = String((tbm.riskRows[measurePreview.rowIdx] && tbm.riskRows[measurePreview.rowIdx].measure) || "").trim();
          var btnMpApply = makeEl("button", "btn-primary", existingMeas ? "기존 내용 덮어쓰기" : "적용");
          btnMpApply.type = "button";
          btnMpApply.addEventListener("click", function () {
            backupRiskRows(tbm);
            tbm.riskRows[measurePreview.rowIdx].measure = measurePreview.measure;
            var savedRow = tbm.riskRows[measurePreview.rowIdx];
            measurePreview = null;
            ctx.onDayChange(day);
            if (ctx.onAccumulateRiskLibrary && savedRow) {
              try {
                ctx.onAccumulateRiskLibrary([savedRow], {
                  category: (day.eduLog && day.eduLog.workType) || "",
                  source: "ai",
                  quiet: true
                });
              } catch (_) {}
            }
            render(container, ctx);
          });
          mpActs.appendChild(btnMpApply);
        }
        var btnMpRetry = makeEl("button", "btn-secondary", "다시");
        btnMpRetry.type = "button";
        btnMpRetry.disabled = aiBusy;
        btnMpRetry.addEventListener("click", function () {
          var idx = measurePreview.rowIdx;
          measurePreview = null;
          runMeasureCellAi(container, ctx, idx);
        });
        var btnMpCancel = makeEl("button", "btn-secondary", "취소");
        btnMpCancel.type = "button";
        btnMpCancel.addEventListener("click", function () {
          measurePreview = null;
          render(container, ctx);
        });
        mpActs.appendChild(btnMpRetry);
        mpActs.appendChild(btnMpCancel);
        mpHead.appendChild(mpActs);
        mpBox.appendChild(mpHead);

        if (measurePreview.warnings && measurePreview.warnings.length > 0) {
          mpBox.appendChild(makeEl("div", "ai-preview-warn", measurePreview.warnings.join(" / ")));
        }
        mpBox.appendChild(makeEl("div", "ai-preview-text", measurePreview.measure || measurePreview.raw));
        container.appendChild(mpBox);
        latestPreviewPanel = mpBox;
      }

      if (shouldScrollToPreview && latestPreviewPanel) {
        shouldScrollToPreview = false;
        var panelToScroll = latestPreviewPanel;
        setTimeout(function () {
          try {
            panelToScroll.scrollIntoView({ block: "nearest", behavior: "smooth" });
          } catch (_) {}
        }, 40);
      }

      // 2. A4 시트
      var sheet = makeEl("div", "a4-sheet doc5-sheet");

      // 상단 영역
      var topRow = makeEl("div", "doc5-top-row");
      var topLeft = makeEl("div", "doc5-top-left");
      topLeft.appendChild(makeEl("div", "doc5-title", "T  B  M   일  지"));

      var metaGrid = makeEl("div", "doc5-meta");
      var m1 = makeEl("div", "doc5-meta-row");
      m1.appendChild(makeEl("span", "doc5-meta-label", "현   장   명 :"));
      m1.appendChild(makeEl("span", "doc5-meta-val", settings.siteName || ""));

      var m2 = makeEl("div", "doc5-meta-row");
      m2.appendChild(makeEl("span", "doc5-meta-label", "업체 / 공종명 :"));
      var inpCompanyWork = document.createElement("input");
      inpCompanyWork.type = "text";
      inpCompanyWork.className = "doc5-meta-input";
      var defaultCW = tbm.companyWorkType || (day.eduLog && day.eduLog.workType) || "";
      inpCompanyWork.value = defaultCW;
      inpCompanyWork.addEventListener("input", function () {
        tbm.companyWorkType = inpCompanyWork.value;
        ctx.onDayChange(day);
      });
      m2.appendChild(inpCompanyWork);

      var m3 = makeEl("div", "doc5-meta-row");
      m3.appendChild(makeEl("span", "doc5-meta-label", "일         자 :"));
      var dateValEl = makeEl("span", "doc5-meta-val doc5-date-val", getScreenDateText(day.date));
      if (blankDateOnPrint) dateValEl.style.whiteSpace = "pre";
      m3.appendChild(dateValEl);

      metaGrid.appendChild(m1);
      metaGrid.appendChild(m2);
      metaGrid.appendChild(m3);
      topLeft.appendChild(metaGrid);

      var signBox = makeEl("div", "doc5-sign-wrap");
      var signTable = makeEl("table", "doc5-sign-table");
      var sH = document.createElement("tr");
      sH.appendChild(makeEl("th", "doc5-sign-div", "구분"));
      sH.appendChild(makeEl("th", "doc5-sign-col", "담당자"));
      sH.appendChild(makeEl("th", "doc5-sign-col", "현장소장"));
      signTable.appendChild(sH);

      var sB = document.createElement("tr");
      sB.appendChild(makeEl("th", "doc5-sign-div", "확인"));
      var tdS1 = makeEl("td", "doc5-stamp-cell");
      var tdS2 = makeEl("td", "doc5-stamp-cell");
      function putStamp(cell, obj, alt) {
        if (!showStamps || !obj || !obj.base64) return;
        var img = document.createElement("img");
        var mime = obj.ext === "jpg" ? "jpeg" : obj.ext;
        img.src = "data:image/" + mime + ";base64," + obj.base64;
        img.alt = alt;
        img.className = "doc5-stamp-img";
        cell.appendChild(img);
      }
      putStamp(tdS1, stamps.staff, "담당자 도장");
      putStamp(tdS2, stamps.director, "현장소장 도장");
      sB.appendChild(tdS1);
      sB.appendChild(tdS2);
      signTable.appendChild(sB);

      var sFoot = document.createElement("tr");
      var tdSubmit = makeEl("td", "doc5-submit-note", "* 매일 오전10시 이전 제출 필수.");
      tdSubmit.colSpan = 3;
      sFoot.appendChild(tdSubmit);
      signTable.appendChild(sFoot);

      signBox.appendChild(signTable);
      topRow.appendChild(topLeft);
      topRow.appendChild(signBox);
      sheet.appendChild(topRow);

      // 위험성평가 표 (원본 576px 기준 8열: 36 | 72 | 123 | 56 | 34 | 24 | 24 | 207)
      var riskTable = makeEl("table", "doc5-risk-table");
      addColgroup(riskTable, [
        "6.25%",
        "12.50%",
        "21.35%",
        "9.72%",
        "4.75%",
        "4.75%",
        "4.75%",
        "35.93%"
      ]);

      var rSection = document.createElement("tr");
      rSection.className = "doc5-section-row";
      var thSec = makeEl("th", "", "금일 작업구간 및 내용");
      thSec.colSpan = 2;
      rSection.appendChild(thSec);
      var tdSec = makeEl("td", "doc5-section-cell");
      tdSec.colSpan = 6;
      var inpSec = document.createElement("input");
      inpSec.type = "text";
      inpSec.className = "sheet-text-input center bold";
      inpSec.value = tbm.workSection || "";
      inpSec.addEventListener("input", function () {
        tbm.workSection = inpSec.value;
        ctx.onDayChange(day);
      });
      tdSec.appendChild(inpSec);
      rSection.appendChild(tdSec);
      riskTable.appendChild(rSection);

      var rRH1 = document.createElement("tr");
      rRH1.className = "doc5-risk-head1";
      var thNo = makeEl("th", "", "No.");
      thNo.rowSpan = 2;
      function appendHeaderAiButton(thEl, colKey, titleText) {
        if (!root.DayrepAiPrompts) return;
        var wrap = makeEl("div", "th-ai-wrap no-print");
        var isHdrActive = aiActiveTask && aiActiveTask.type === "batch" && aiActiveTask.col === colKey;
        var btn = makeEl(
          "button",
          "btn-cell-ai-hdr" + (isHdrActive ? " btn-ai-active" : ""),
          isHdrActive ? "" : "AI"
        );
        btn.type = "button";
        btn.disabled = aiBusy;
        if (isHdrActive) {
          btn.setAttribute("aria-busy", "true");
          btn.title = "생성 중…";
          var spHdr = makeEl("span", "ai-btn-spinner");
          spHdr.setAttribute("aria-hidden", "true");
          btn.appendChild(spHdr);
        } else if (aiBusy) {
          btn.title = "다른 AI 작업 진행 중";
        } else {
          btn.title = titleText;
        }

        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (aiBusy) return;
          if (activeHeaderMenuCol === colKey) {
            closeHeaderMenu(true, container, ctx);
          } else {
            closeHeaderMenu(false);
            activeHeaderMenuCol = colKey;
            render(container, ctx);
          }
        });
        wrap.appendChild(btn);

        if (activeHeaderMenuCol === colKey && !aiBusy) {
          var menu = renderHeaderAiMenu(colKey, container, ctx, tbm, day);
          wrap.appendChild(menu);
        }

        thEl.appendChild(wrap);
      }

      var thItem = makeEl("th", "");
      thItem.rowSpan = 2;
      thItem.appendChild(document.createTextNode("주요사항\n장비 / 도구"));
      if (aiActiveTask && aiActiveTask.type === "batch" && aiActiveTask.col === "tool") {
        thItem.classList.add("ai-target-highlight");
      }
      appendHeaderAiButton(thItem, "tool", "장비/도구 열 AI 일괄 옵션");

      var thHaz = makeEl("th", "");
      thHaz.rowSpan = 2;
      thHaz.appendChild(document.createTextNode("유해·위험요인\n및 위험성"));
      if (aiActiveTask && aiActiveTask.type === "batch" && aiActiveTask.col === "hazard") {
        thHaz.classList.add("ai-target-highlight");
      }
      appendHeaderAiButton(thHaz, "hazard", "위험성평가 열 AI 일괄 옵션");

      var thType = makeEl("th", "", "재해\n형태");
      thType.rowSpan = 2;
      var thEval = makeEl("th", "", "위험성 평가");
      thEval.colSpan = 3;
      var thMeas = makeEl("th", "");
      thMeas.rowSpan = 2;
      thMeas.appendChild(document.createTextNode("위험성 감소대책"));
      if (aiActiveTask && aiActiveTask.type === "batch" && aiActiveTask.col === "measure") {
        thMeas.classList.add("ai-target-highlight");
      }
      appendHeaderAiButton(thMeas, "measure", "감소대책 열 AI 일괄 옵션");
      rRH1.appendChild(thNo);
      rRH1.appendChild(thItem);
      rRH1.appendChild(thHaz);
      rRH1.appendChild(thType);
      rRH1.appendChild(thEval);
      rRH1.appendChild(thMeas);
      riskTable.appendChild(rRH1);

      var rRH2 = document.createElement("tr");
      rRH2.className = "doc5-risk-head2";
      rRH2.appendChild(makeEl("th", "", "상"));
      rRH2.appendChild(makeEl("th", "", "중"));
      rRH2.appendChild(makeEl("th", "", "하"));
      riskTable.appendChild(rRH2);

      for (var ri = 0; ri < tbm.riskRows.length; ri++) {
        (function (rowIdx) {
          var row = tbm.riskRows[rowIdx];
          var tr = document.createElement("tr");
          tr.className = "doc5-risk-row";

          tr.appendChild(makeEl("td", "center bold", String(rowIdx + 1)));

          function makeTaCell(field, aiKind) {
            var td = makeEl("td", aiKind ? "doc5-risk-cell th-ai-host" : "doc5-risk-cell");
            var ta = document.createElement("textarea");
            ta.className = aiKind ? "doc5-risk-ta has-cell-ai" : "doc5-risk-ta";
            ta.value = row[field] || "";
            ta.addEventListener("input", function () {
              row[field] = ta.value;
              ctx.onDayChange(day);
            });

            var isTargetCell = false;
            var isTargetBtnActive = false;
            if (aiActiveTask) {
              if (aiActiveTask.type === "cell" && aiActiveTask.rowIdx === rowIdx && aiActiveTask.col === aiKind) {
                isTargetCell = true;
                isTargetBtnActive = true;
              } else if (aiActiveTask.type === "batch" && aiActiveTask.curRowIdx === rowIdx && aiActiveTask.col === aiKind) {
                isTargetCell = true;
              }
            }

            if (isTargetCell) {
              td.classList.add("ai-target-highlight");
              ta.classList.add("ai-target-highlight");
            }

            td.appendChild(ta);
            if (aiKind && root.DayrepAiPrompts) {
              var btnCell = makeEl(
                "button",
                "btn-cell-ai btn-cell-ai-xs no-print" + (isTargetBtnActive ? " btn-ai-active" : ""),
                isTargetBtnActive ? "" : "AI"
              );
              btnCell.type = "button";
              btnCell.disabled = aiBusy;
              if (isTargetBtnActive) {
                btnCell.setAttribute("aria-busy", "true");
                btnCell.title = "생성 중…";
                var spCell = makeEl("span", "ai-btn-spinner");
                spCell.setAttribute("aria-hidden", "true");
                btnCell.appendChild(spCell);
              } else if (aiBusy) {
                btnCell.title = "다른 AI 작업 진행 중";
              } else {
                btnCell.title = aiKind === "tool"
                  ? "이 행 장비/도구 AI 제안"
                  : (aiKind === "measure"
                    ? "이 행 감소대책 AI 생성"
                    : "이 행 장비/도구 기준으로 행 전체 위험성평가 생성");
              }
              btnCell.addEventListener("click", function () {
                if (aiKind === "tool") runToolCellAi(container, ctx, rowIdx);
                else if (aiKind === "measure") runMeasureCellAi(container, ctx, rowIdx);
                else runRiskRowCellAi(container, ctx, rowIdx);
              });
              td.appendChild(btnCell);
            }
            if (aiKind === "measure" && root.DayrepRiskLibrary) {
              var btnKeep = makeEl("button", "btn-cell-keep no-print", "보관");
              btnKeep.type = "button";
              btnKeep.title = "이 행을 위험성평가 라이브러리에 보관";
              btnKeep.addEventListener("click", function () {
                if (!root.DayrepRiskLibrary.isCompleteRow(row)) {
                  if (ctx.showToast) {
                    ctx.showToast("장비/도구, 유해·위험요인, 감소대책을 모두 입력해야 보관할 수 있습니다.", true);
                  }
                  return;
                }
                if (ctx.onAccumulateRiskLibrary) {
                  ctx.onAccumulateRiskLibrary([row], {
                    category: (day.eduLog && day.eduLog.workType) || "",
                    source: "manual",
                    quiet: false
                  });
                }
                if (ctx.showToast) ctx.showToast("위험성평가 라이브러리에 보관했습니다.", false);
              });
              td.appendChild(btnKeep);
            }
            if (aiKind === "measure") {
              var isMinRows = tbm.riskRows.length <= 4;
              var btnDelThis = makeEl("button", "btn-cell-del no-print", isMinRows ? "비우기" : "삭제");
              btnDelThis.type = "button";
              btnDelThis.disabled = aiBusy;
              btnDelThis.title = isMinRows
                ? "최소 4행 유지: 이 행의 내용을 비웁니다"
                : "이 행 삭제";
              btnDelThis.addEventListener("click", function () {
                var hasRowContent = Boolean(
                  String(row.item || "").trim() ||
                  String(row.hazard || "").trim() ||
                  String(row.type || "").trim() ||
                  String(row.measure || "").trim()
                );
                if (hasRowContent) {
                  backupRiskRows(tbm);
                }
                if (tbm.riskRows.length <= 4) {
                  tbm.riskRows[rowIdx] = { item: "", hazard: "", type: "", level: "", measure: "" };
                } else {
                  tbm.riskRows.splice(rowIdx, 1);
                }
                ctx.onDayChange(day);
                render(container, ctx);
              });
              td.appendChild(btnDelThis);
            }
            return td;
          }

          tr.appendChild(makeTaCell("item", "tool"));
          tr.appendChild(makeTaCell("hazard", "hazard"));
          tr.appendChild(makeTaCell("type"));

          ["상", "중", "하"].forEach(function (lvl) {
            var tdLvl = makeEl("td", "doc5-lvl-cell", row.level === lvl ? "○" : "");
            tdLvl.addEventListener("click", function () {
              row.level = row.level === lvl ? "" : lvl;
              ctx.onDayChange(day);
              render(container, ctx);
            });
            tr.appendChild(tdLvl);
          });

          tr.appendChild(makeTaCell("measure", "measure"));
          riskTable.appendChild(tr);
        })(ri);
      }

      // 중간 안내 행
      var rBanner = document.createElement("tr");
      rBanner.className = "doc5-banner-row";
      var tdBanner = makeEl(
        "td",
        "doc5-banner-cell",
        "* 당일 작업관련 상시 위험성평가 및 근로자 전파(확인) 실시."
      );
      tdBanner.colSpan = 8;
      rBanner.appendChild(tdBanner);
      riskTable.appendChild(rBanner);
      sheet.appendChild(riskTable);

      // 근로자 전파확인 서명표 30행 (좌 1~15, 우 16~30, 원본 중앙 경계 328 기준)
      var workerTable = makeEl("table", "doc5-worker-table");
      addColgroup(workerTable, [
        "6.25%", "12.50%", "10.59%", "10.76%", "9.72%",
        "5.90%", "8.33%", "10.59%", "10.59%", "10.77%"
      ]);

      var rWH = document.createElement("tr");
      rWH.className = "doc5-worker-head";
      ["NO.", "직 종", "성 명", "서 명", "비 고", "NO.", "직 종", "성 명", "서 명", "비 고"].forEach(function (h) {
        rWH.appendChild(makeEl("th", "", h));
      });
      workerTable.appendChild(rWH);

      for (var wi = 0; wi < 15; wi++) {
        (function (leftIdx, rightIdx) {
          var tr = document.createElement("tr");
          tr.className = "doc5-worker-row";

          function appendWorkerCells(wIdx) {
            var w = tbm.workers[wIdx];
            tr.appendChild(makeEl("td", "center", String(wIdx + 1)));

            var tdRole = makeEl("td", "doc5-w-cell");
            var inpRole = document.createElement("input");
            inpRole.type = "text";
            inpRole.className = "doc5-w-input";
            inpRole.value = w.role || "";
            inpRole.addEventListener("input", function () {
              w.role = inpRole.value;
              ctx.onDayChange(day);
            });
            tdRole.appendChild(inpRole);
            tr.appendChild(tdRole);

            var tdName = makeEl("td", "doc5-w-cell");
            var inpName = document.createElement("input");
            inpName.type = "text";
            inpName.className = "doc5-w-input";
            inpName.value = w.name || "";
            inpName.addEventListener("input", function () {
              w.name = inpName.value;
              ctx.onDayChange(day);
            });
            tdName.appendChild(inpName);
            tr.appendChild(tdName);

            // 서명칸은 빈칸 출력
            tr.appendChild(makeEl("td", "doc5-sign-empty", ""));

            var tdNote = makeEl("td", "doc5-w-cell");
            var inpNote = document.createElement("input");
            inpNote.type = "text";
            inpNote.className = "doc5-w-input";
            inpNote.value = w.note || "";
            inpNote.addEventListener("input", function () {
              w.note = inpNote.value;
              ctx.onDayChange(day);
            });
            tdNote.appendChild(inpNote);
            tr.appendChild(tdNote);
          }

          appendWorkerCells(leftIdx);
          appendWorkerCells(rightIdx);
          workerTable.appendChild(tr);
        })(wi, wi + 15);
      }

      // 하단 근로자 의견청취란
      var rOp = document.createElement("tr");
      rOp.className = "doc5-opinion-row";
      var tdOp = makeEl("td", "doc5-opinion-cell");
      tdOp.colSpan = 10;
      tdOp.appendChild(
        makeEl("div", "doc5-opinion-title", "* 근로자 의견청취 (현장 위험요인 제안 및 기타 건의사항)")
      );
      var taOp = document.createElement("textarea");
      taOp.className = "doc5-opinion-ta";
      taOp.value = tbm.opinion || "";
      taOp.addEventListener("input", function () {
        tbm.opinion = taOp.value;
        ctx.onDayChange(day);
      });
      tdOp.appendChild(taOp);
      rOp.appendChild(tdOp);
      workerTable.appendChild(rOp);

      sheet.appendChild(workerTable);
      container.appendChild(sheet);
    }

    var ctrl = {
      render: render,
      closeHeaderMenu: closeHeaderMenu
    };
    if (typeof root !== "undefined") {
      root.__doc5Ctrl = ctrl;
    }
    return ctrl;
  }

  root.DayrepDoc5UI = {
    createDoc5Controller: createDoc5Controller
  };
})(window);
