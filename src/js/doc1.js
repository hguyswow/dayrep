(function (root) {
  "use strict";

  function formatKoreanDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return dateStr || "";
    var p = dateStr.split("-");
    return p[0] + "년 " + p[1] + "월 " + p[2] + "일";
  }

  function makeEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatNumberedLines(rawText) {
    var lines = String(rawText || "").split(/\r?\n/);
    var out = [];
    var num = 1;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) continue;
      var stripped = trimmed.replace(/^\d+\.\s*/, "");
      out.push(num + ". " + stripped);
      num += 1;
    }
    return out.join("\n");
  }

  function createDoc1Controller() {
    var warningText = "";
    var showStamps = true;
    var aiBusy = false;
    var aiCancelled = false;
    var aiOptionsOpen = false;
    var shouldScrollToPreview = false;
    var aiOpts = {
      mode: "generate",
      useConstruction: true,
      useDailyContext: true,
      useRecentEdu: true
    };
    var aiPreview = null; // { ok, mode, lines, formatted, raw, warnings, retryHint, model }

    async function runAiGenerate(container, ctx, retryHint) {
      if (aiBusy) return;
      var day = ctx.dayData;
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var edu = day.eduLog;

      if (!ctx.invoke) {
        if (ctx.showToast) ctx.showToast("Tauri 런타임에서만 AI 생성이 가능합니다.", true);
        return;
      }

      var aiCfg = settings.ai || {};
      var engine = aiCfg.engine || "hermes";
      var ep = (aiCfg.endpoints && aiCfg.endpoints[engine]) || {};

      var prompt = root.DayrepAiPrompts.buildEduPrompt(settings, {
        date: day.date,
        weather: day.patrol ? day.patrol.weather : "",
        workType: edu.workType || "",
        workSection: day.tbmLog ? (day.tbmLog.workSection || "") : "",
        siteContext: day.siteContext || {},
        prevEduContents: ctx.prevEduContents || "",
        currentContents: edu.contents || "",
        mode: aiOpts.mode,
        useConstruction: aiOpts.useConstruction,
        useDailyContext: aiOpts.useDailyContext,
        useRecentEdu: aiOpts.useRecentEdu,
        aiNote: day.siteContext ? (day.siteContext.aiNote || "") : ""
      });
      if (retryHint) {
        prompt += "\n\n[재요청 지시]\n" + retryHint;
      }

      aiBusy = true;
      aiCancelled = false;
      render(container, ctx);

      try {
        var resp = await ctx.invoke("ai_generate", {
          engine: engine,
          prompt: prompt,
          options: {
            endpoint: aiCfg.hermesEndpoint || "",
            baseUrl: ep.baseUrl || "",
            model: ep.model || "",
            temperature: 0.5
          }
        });
        if (aiCancelled) return;
        var parsed = root.DayrepAiPrompts.parseEduResponse(resp.text || "", aiOpts.mode);
        aiPreview = {
          ok: parsed.ok,
          mode: aiOpts.mode,
          lines: parsed.lines || [],
          formatted: parsed.formatted,
          raw: parsed.raw,
          warnings: parsed.warnings || [],
          retryHint: parsed.retryHint || null,
          model: resp.model || engine
        };
        shouldScrollToPreview = true;
        aiOptionsOpen = false;
      } catch (err) {
        if (!aiCancelled && ctx.showToast) {
          ctx.showToast("AI 교육내용 생성 실패: " + String(err), true);
        }
      } finally {
        aiBusy = false;
        render(container, ctx);
      }
    }

    function render(container, ctx) {
      if (!container) return;
      container.textContent = "";

      var day = ctx.dayData;
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var edu = day.eduLog;
      var stamps = ctx.stamps || {};

      var hcRes = root.DayrepHeadcount.calcHeadcount({
        categories: edu.categories,
        mode: edu.mode,
        absorbIdx: edu.absorbIdx,
        performed: edu.performed,
        femaleCount: edu.femaleCount
      }, { type: "init" });
      var summary = hcRes.summary;

      // 1. 편집 툴바 (.no-print)
      var toolbar = makeEl("div", "doc-toolbar no-print");

      var leftGroup = makeEl("div", "toolbar-group");
      var modeBadge = makeEl(
        "span",
        edu.mode === "fixed" ? "mode-badge fixed" : "mode-badge",
        edu.mode === "fixed" ? "인원 모드: 실시고정" : "인원 모드: 자동합산"
      );
      leftGroup.appendChild(modeBadge);

      if (edu.mode === "fixed") {
        var btnRevert = makeEl("button", "btn-secondary", "합산으로 되돌리기");
        btnRevert.type = "button";
        btnRevert.addEventListener("click", function () {
          var next = root.DayrepHeadcount.calcHeadcount(edu, { type: "revertToSum" });
          edu.mode = next.state.mode;
          edu.performed = next.state.performed;
          warningText = "";
          ctx.onDayChange(day);
          render(container, ctx);
        });
        leftGroup.appendChild(btnRevert);
      }

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

      var btnRenumber = makeEl("button", "btn-secondary", "교육내용 번호 정렬");
      btnRenumber.type = "button";
      btnRenumber.addEventListener("click", function () {
        edu.contents = formatNumberedLines(edu.contents);
        ctx.onDayChange(day);
        render(container, ctx);
      });
      leftGroup.appendChild(btnRenumber);

      if (edu.contentsBackup) {
        var btnUndoAi = makeEl("button", "btn-secondary", "이전 교육내용 되돌리기");
        btnUndoAi.type = "button";
        btnUndoAi.addEventListener("click", function () {
          edu.contents = edu.contentsBackup;
          edu.contentsBackup = "";
          ctx.onDayChange(day);
          render(container, ctx);
          if (ctx.showToast) ctx.showToast("이전 교육내용으로 되돌렸습니다.", false);
        });
        leftGroup.appendChild(btnUndoAi);
      }

      var rightGroup = makeEl("div", "toolbar-group");
      var btnPrint = makeEl("button", "btn-secondary", "이 서류 인쇄");
      btnPrint.type = "button";
      btnPrint.addEventListener("click", function () {
        if (root.DayrepExport && typeof root.DayrepExport.printCurrentSheet === "function") {
          root.DayrepExport.printCurrentSheet(container.querySelector(".a4-sheet"));
        } else {
          window.print();
        }
      });
      rightGroup.appendChild(btnPrint);

      toolbar.appendChild(leftGroup);
      toolbar.appendChild(rightGroup);
      container.appendChild(toolbar);

      if (aiBusy) {
        var stickyBar = makeEl("div", "doc1-ai-sticky-bar no-print");
        stickyBar.setAttribute("role", "status");
        stickyBar.setAttribute("aria-live", "polite");
        stickyBar.appendChild(makeEl("span", "doc1-ai-sticky-text", "⏳ 교육내용 AI 생성 중…"));
        var btnCancelSticky = makeEl("button", "btn-secondary btn-sticky-cancel", "생성 취소");
        btnCancelSticky.type = "button";
        btnCancelSticky.addEventListener("click", function () {
          aiCancelled = true;
          aiBusy = false;
          render(container, ctx);
        });
        stickyBar.appendChild(btnCancelSticky);
        container.appendChild(stickyBar);
      }

      if (warningText) {
        var warnBar = makeEl("div", "doc-warning no-print", warningText);
        container.appendChild(warnBar);
      }

      // 당일 작업일보/장비 메모 입력 패널 (.no-print)
      if (!day.siteContext) {
        day.siteContext = { dailyReportText: "", workEquipmentMemo: "" };
      }
      var ctxDetails = document.createElement("details");
      ctxDetails.className = "ai-site-context-box no-print";
      var ctxSummary = makeEl(
        "summary",
        "ai-site-context-summary",
        "당일 작업일보 · 투입장비 메모 (AI 교육내용 생성 참고용)"
      );
      ctxDetails.appendChild(ctxSummary);

      var ctxBody = makeEl("div", "ai-site-context-body");
      var equipLabel = makeEl("label", "field");
      equipLabel.appendChild(makeEl("span", "", "당일 투입공종/장비 메모"));
      var equipInp = document.createElement("input");
      equipInp.type = "text";
      equipInp.value = day.siteContext.workEquipmentMemo || "";
      equipInp.placeholder = "예: 25톤 카고크레인, 고소작업대, 용접기";
      equipInp.addEventListener("input", function () {
        day.siteContext.workEquipmentMemo = equipInp.value;
        ctx.onDayChange(day);
      });
      equipLabel.appendChild(equipInp);

      var reportLabel = makeEl("label", "field");
      reportLabel.appendChild(makeEl("span", "", "당일 작업일보 텍스트 (붙여넣기)"));
      var reportTa = document.createElement("textarea");
      reportTa.rows = 3;
      reportTa.value = day.siteContext.dailyReportText || "";
      reportTa.placeholder = "금일 작업일보 또는 작업지시 내용을 붙여넣으세요.";
      reportTa.addEventListener("input", function () {
        day.siteContext.dailyReportText = reportTa.value;
        ctx.onDayChange(day);
      });
      reportLabel.appendChild(reportTa);

      ctxBody.appendChild(equipLabel);
      ctxBody.appendChild(reportLabel);
      ctxDetails.appendChild(ctxBody);
      container.appendChild(ctxDetails);

      // AI 옵션 창 (.no-print, 교육내용 헤더 AI 버튼 클릭 시 열림)
      if (aiOptionsOpen && root.DayrepAiPrompts) {
        var optBox = makeEl("div", "ai-options-panel no-print");
        var optHead = makeEl("div", "ai-preview-head");
        optHead.appendChild(makeEl("strong", "", "교육내용 AI 생성 옵션"));
        var optBtns = makeEl("div", "toolbar-group");

        var btnRun = makeEl("button", "btn-primary" + (aiBusy ? " btn-ai-active" : ""), aiBusy ? "" : "실행");
        btnRun.type = "button";
        btnRun.disabled = aiBusy;
        if (aiBusy) {
          btnRun.setAttribute("aria-busy", "true");
          btnRun.title = "생성 중…";
          var spRun = makeEl("span", "ai-btn-spinner");
          spRun.setAttribute("aria-hidden", "true");
          btnRun.appendChild(spRun);
          btnRun.appendChild(document.createTextNode(" AI 생성 중..."));
        }
        btnRun.addEventListener("click", function () {
          runAiGenerate(container, ctx, null);
        });
        optBtns.appendChild(btnRun);

        if (aiBusy) {
          var btnCancelOpt = makeEl("button", "btn-secondary", "생성 취소");
          btnCancelOpt.type = "button";
          btnCancelOpt.addEventListener("click", function () {
            aiCancelled = true;
            aiBusy = false;
            render(container, ctx);
          });
          optBtns.appendChild(btnCancelOpt);
        }

        var btnCloseOpt = makeEl("button", "btn-secondary", "닫기");
        btnCloseOpt.type = "button";
        btnCloseOpt.addEventListener("click", function () {
          aiOptionsOpen = false;
          render(container, ctx);
        });
        optBtns.appendChild(btnCloseOpt);
        optHead.appendChild(optBtns);
        optBox.appendChild(optHead);

        var activeEngine = (settings.ai && settings.ai.engine) || "hermes";
        var isExtEngine = ["opencode", "deepseek", "gemini", "openrouter", "hermes"].indexOf(activeEngine) !== -1;
        if (isExtEngine) {
          var noticeText = activeEngine === "hermes"
            ? "참고: Hermes 경유 외부 모델 사용 시 공사현황·정보입력 텍스트가 전송될 수 있습니다. (근로자 성명·도장 제외)"
            : "주의: 선택한 외부 AI 서비스(" + activeEngine + ")로 공사현황·정보입력 텍스트가 전송됩니다. (근로자 성명·도장 제외)";
          optBox.appendChild(makeEl("div", "ai-notice external", noticeText));
        }

        var modeRow = makeEl("div", "ai-opt-row");
        modeRow.appendChild(makeEl("span", "ai-opt-label", "생성 모드:"));
        [
          { val: "generate", label: "생성 (새로 작성)" },
          { val: "improve", label: "개선 (현재 내용 다듬기)" },
          { val: "append", label: "추가 (기존 뒤에 이어 붙이기)" }
        ].forEach(function (m) {
          var lbl = makeEl("label", "toolbar-check");
          var rad = document.createElement("input");
          rad.type = "radio";
          rad.name = "doc1-ai-mode";
          rad.value = m.val;
          rad.checked = aiOpts.mode === m.val;
          rad.addEventListener("change", function () {
            aiOpts.mode = m.val;
          });
          lbl.appendChild(rad);
          lbl.appendChild(document.createTextNode(" " + m.label));
          modeRow.appendChild(lbl);
        });
        optBox.appendChild(modeRow);

        var refRow = makeEl("div", "ai-opt-row");
        refRow.appendChild(makeEl("span", "ai-opt-label", "참조 정보:"));
        [
          { key: "useConstruction", label: "공사현황(설정)" },
          { key: "useDailyContext", label: "당일 작업일보·작업구간" },
          { key: "useRecentEdu", label: "최근 교육내용(중복 회피)" }
        ].forEach(function (item) {
          var lbl = makeEl("label", "toolbar-check");
          var chk = document.createElement("input");
          chk.type = "checkbox";
          chk.checked = Boolean(aiOpts[item.key]);
          chk.addEventListener("change", function () {
            aiOpts[item.key] = chk.checked;
          });
          lbl.appendChild(chk);
          lbl.appendChild(document.createTextNode(" " + item.label));
          refRow.appendChild(lbl);
        });
        optBox.appendChild(refRow);

        var noteLabel = makeEl("label", "field");
        noteLabel.appendChild(makeEl("span", "", "정보입력 (이번 생성에 반영할 추가 지시·상세 정보)"));
        var noteTa = document.createElement("textarea");
        noteTa.rows = 2;
        noteTa.value = day.siteContext.aiNote || "";
        noteTa.placeholder = "예: 내일 강풍 예보, 굴착기 2대 투입, 지하 1층 방수 작업 집중 교육";
        noteTa.addEventListener("input", function () {
          day.siteContext.aiNote = noteTa.value;
          ctx.onDayChange(day);
        });
        noteLabel.appendChild(noteTa);
        optBox.appendChild(noteLabel);

        container.appendChild(optBox);
      }

      // AI 미리보기 패널 (.no-print)
      if (aiPreview) {
        var prevBox = makeEl("div", "ai-preview-panel no-print");
        var prevHead = makeEl("div", "ai-preview-head");
        prevHead.appendChild(
          makeEl("strong", "", "AI 생성 교육내용 미리보기 (" + aiPreview.model + ")")
        );
        var prevActions = makeEl("div", "toolbar-group");

        var applyText = aiPreview.ok ? aiPreview.formatted : (aiPreview.formatted || aiPreview.raw);
        var btnApply = makeEl("button", "btn-primary", "적용");
        btnApply.type = "button";
        btnApply.addEventListener("click", function () {
          edu.contentsBackup = edu.contents || "";
          if (aiPreview.mode === "append" && root.DayrepAiPrompts) {
            edu.contents = root.DayrepAiPrompts.mergeAppendEduContents(
              edu.contents,
              aiPreview.lines && aiPreview.lines.length > 0 ? aiPreview.lines : applyText
            );
          } else {
            edu.contents = applyText;
          }
          aiPreview = null;
          ctx.onDayChange(day);
          render(container, ctx);
          if (ctx.showToast) ctx.showToast("AI 교육내용이 적용되었습니다.", false);
        });

        var btnRetry = makeEl("button", "btn-secondary", "다시 생성");
        btnRetry.type = "button";
        btnRetry.disabled = aiBusy;
        btnRetry.addEventListener("click", function () {
          runAiGenerate(container, ctx, aiPreview && aiPreview.retryHint);
        });

        var btnClosePrev = makeEl("button", "btn-secondary", "취소");
        btnClosePrev.type = "button";
        btnClosePrev.addEventListener("click", function () {
          aiPreview = null;
          render(container, ctx);
        });

        prevActions.appendChild(btnApply);
        prevActions.appendChild(btnRetry);
        prevActions.appendChild(btnClosePrev);
        prevHead.appendChild(prevActions);
        prevBox.appendChild(prevHead);

        if (aiPreview.warnings && aiPreview.warnings.length > 0) {
          prevBox.appendChild(
            makeEl("div", "ai-preview-warn", aiPreview.warnings.join(" / "))
          );
        }

        var prevPre = makeEl("pre", "ai-preview-text", applyText);
        prevBox.appendChild(prevPre);
        container.appendChild(prevBox);

        if (shouldScrollToPreview) {
          shouldScrollToPreview = false;
          setTimeout(function () {
            try {
              prevBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
            } catch (_) {}
          }, 40);
        }
      }

      // 2. A4 시트
      var sheet = makeEl("div", "a4-sheet doc1-sheet");

      // 상단 헤더 (제목 + 결재란)
      var topRow = makeEl("div", "doc1-top-row");
      var titleBox = makeEl("div", "doc1-title-box");
      var titleH = makeEl("div", "doc1-title", "안전교육일지");
      var subTitle = makeEl("div", "doc1-subtitle", "(발주기관,시공사용)");
      titleBox.appendChild(titleH);
      titleBox.appendChild(subTitle);

      var signTable = makeEl("table", "doc1-sign-table");
      var signHead = makeEl("tr");
      var thGyeol = makeEl("th", "sign-vertical", "결\n재");
      thGyeol.rowSpan = 2;
      var thStaff = makeEl("th", "sign-col", "담당");
      var thDirector = makeEl("th", "sign-col", "현장소장");
      signHead.appendChild(thGyeol);
      signHead.appendChild(thStaff);
      signHead.appendChild(thDirector);

      var signBody = makeEl("tr");
      var tdStaff = makeEl("td", "sign-stamp-cell");
      var tdDirector = makeEl("td", "sign-stamp-cell");

      function appendStampImg(cell, stampObj, alt) {
        if (!showStamps || !stampObj || !stampObj.base64) return;
        var img = document.createElement("img");
        var mime = stampObj.ext === "jpg" ? "jpeg" : stampObj.ext;
        img.src = "data:image/" + mime + ";base64," + stampObj.base64;
        img.alt = alt;
        img.className = "sign-stamp-img";
        cell.appendChild(img);
      }
      appendStampImg(tdStaff, stamps.staff, "담당 도장");
      appendStampImg(tdDirector, stamps.director, "현장소장 도장");

      signBody.appendChild(tdStaff);
      signBody.appendChild(tdDirector);
      signTable.appendChild(signHead);
      signTable.appendChild(signBody);

      topRow.appendChild(titleBox);
      topRow.appendChild(signTable);
      sheet.appendChild(topRow);

      // 메인 표 (9열 colgroup: 원본 613px 기준 63 | 80 | 80 | 40 | 39 | 40 | 148 | 61 | 62)
      var mainTable = makeEl("table", "doc1-main-table");
      var colgroup = document.createElement("colgroup");
      [
        "10.28%",
        "13.05%",
        "13.05%",
        "6.53%",
        "6.36%",
        "6.53%",
        "24.14%",
        "9.95%",
        "10.11%"
      ].forEach(function (w) {
        var col = document.createElement("col");
        col.style.width = w;
        colgroup.appendChild(col);
      });
      mainTable.appendChild(colgroup);

      // 현장명 / 일자 행 (1 + 5 + 1 + 2 = 9열: 일자 시작선 = 교육대상 칸 시작선)
      var rSite = makeEl("tr", "row-site");
      rSite.appendChild(makeEl("th", "col-label", "현 장 명"));
      var tdSite = makeEl("td", "col-site-val", settings.siteName || "");
      tdSite.colSpan = 5;
      rSite.appendChild(tdSite);
      rSite.appendChild(makeEl("th", "col-date-label", "일 자"));
      var tdDate = makeEl("td", "col-date-val", formatKoreanDate(day.date));
      tdDate.colSpan = 2;
      rSite.appendChild(tdDate);
      mainTable.appendChild(rSite);

      // 교육구분 행 (1 + 8 = 9열)
      var rKind = makeEl("tr", "row-kind");
      rKind.appendChild(makeEl("th", "col-label", "교 육\n구 분"));
      var tdKind = makeEl("td", "col-kind-val", "일일 작업전 안전교육");
      tdKind.colSpan = 8;
      rKind.appendChild(tdKind);
      mainTable.appendChild(rKind);

      // 교육 인원·대상·투입공종 블록 (5행, 총 9열)
      var rEduHeader = makeEl("tr", "row-edu-head");
      var thEduSide1 = makeEl("th", "col-label", "교 육\n내 용");
      thEduSide1.rowSpan = 5;
      rEduHeader.appendChild(thEduSide1);
      var thDiv = makeEl("th", "col-sub-div", "구 분");
      thDiv.colSpan = 2;
      rEduHeader.appendChild(thDiv);
      rEduHeader.appendChild(makeEl("th", "col-num", "계"));
      rEduHeader.appendChild(makeEl("th", "col-num", "남"));
      rEduHeader.appendChild(makeEl("th", "col-num", "여"));
      rEduHeader.appendChild(makeEl("th", "col-target", "교 육 대 상"));
      var thWork = makeEl("th", "col-work", "투 입 공 종");
      thWork.colSpan = 2;
      rEduHeader.appendChild(thWork);
      mainTable.appendChild(rEduHeader);

      // 교육대상 인원 행
      var rTarget = makeEl("tr", "row-hc");
      var thTargetLabel = makeEl("th", "col-hc-label", "교육대상 인원");
      thTargetLabel.colSpan = 2;
      rTarget.appendChild(thTargetLabel);

      var tdTargetTotal = makeEl("td", "num-cell");
      var inpTargetTotal = document.createElement("input");
      inpTargetTotal.type = "number";
      inpTargetTotal.min = "0";
      inpTargetTotal.className = "sheet-num-input";
      inpTargetTotal.title = "직접 입력 시 나머지 흡수 구분이 자동 보정됩니다";
      inpTargetTotal.value = summary.targetTotal > 0 ? String(summary.targetTotal) : "";
      inpTargetTotal.addEventListener("change", function () {
        var res = root.DayrepHeadcount.calcHeadcount(edu, {
          type: "setTargetTotal",
          value: inpTargetTotal.value
        });
        if (!res.ok) {
          warningText = res.warning || "교육대상 인원 오류";
          render(container, ctx);
          return;
        }
        warningText = res.warning || "";
        edu.categories = res.state.categories;
        edu.performed = res.state.performed;
        ctx.onDayChange(day);
        render(container, ctx);
      });
      tdTargetTotal.appendChild(inpTargetTotal);
      rTarget.appendChild(tdTargetTotal);

      rTarget.appendChild(makeEl("td", "num-cell", summary.targetMale > 0 ? String(summary.targetMale) : ""));

      var tdTargetFem = makeEl("td", "num-cell");
      var inpTargetFem = document.createElement("input");
      inpTargetFem.type = "number";
      inpTargetFem.min = "0";
      inpTargetFem.className = "sheet-num-input";
      inpTargetFem.value = summary.targetFemale > 0 ? String(summary.targetFemale) : "";
      inpTargetFem.placeholder = "0";
      inpTargetFem.addEventListener("change", function () {
        var res = root.DayrepHeadcount.calcHeadcount(edu, {
          type: "setFemaleCount",
          value: inpTargetFem.value
        });
        warningText = res.warning || "";
        edu.femaleCount = res.state.femaleCount;
        ctx.onDayChange(day);
        render(container, ctx);
      });
      tdTargetFem.appendChild(inpTargetFem);
      rTarget.appendChild(tdTargetFem);

      // 교육대상 구분별 입력 셀 (2행 병합)
      var tdCats = makeEl("td", "cats-cell");
      tdCats.rowSpan = 2;
      var catsList = makeEl("div", "cats-list");
      edu.categories.forEach(function (cat, idx) {
        var item = makeEl("div", "cat-item");
        var isAbsorb = idx === edu.absorbIdx;
        var nameSpan = makeEl("span", isAbsorb ? "cat-name absorb" : "cat-name", cat.name);
        if (isAbsorb) nameSpan.title = "나머지 흡수 구분";
        var countWrap = makeEl("span", "cat-count-wrap");
        countWrap.appendChild(document.createTextNode("("));
        var inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.className = "sheet-num-input cat-input";
        inp.value = String(cat.count);
        inp.addEventListener("change", function () {
          var res = root.DayrepHeadcount.calcHeadcount(edu, {
            type: "updateCategory",
            index: idx,
            count: inp.value
          });
          if (!res.ok) {
            warningText = res.warning || "인원 계산 오류";
            render(container, ctx);
            return;
          }
          warningText = res.warning || "";
          edu.categories = res.state.categories;
          edu.performed = res.state.performed;
          ctx.onDayChange(day);
          render(container, ctx);
        });
        countWrap.appendChild(inp);
        countWrap.appendChild(document.createTextNode(")"));
        item.appendChild(nameSpan);
        item.appendChild(countWrap);
        catsList.appendChild(item);
      });
      tdCats.appendChild(catsList);
      rTarget.appendChild(tdCats);

      // 투입공종 셀 (2행 병합, 2열 병합)
      var tdWork = makeEl("td", "work-cell");
      tdWork.rowSpan = 2;
      tdWork.colSpan = 2;
      var workTa = document.createElement("textarea");
      workTa.className = "sheet-textarea work-textarea";
      workTa.value = edu.workType || "";
      workTa.placeholder = "투입공종 입력";
      workTa.addEventListener("input", function () {
        edu.workType = workTa.value;
        ctx.onDayChange(day);
      });
      tdWork.appendChild(workTa);
      rTarget.appendChild(tdWork);
      mainTable.appendChild(rTarget);

      // 실시 인원 행
      var rPerf = makeEl("tr", "row-hc");
      var thPerfLabel = makeEl("th", "col-hc-label", "실시 인원");
      thPerfLabel.colSpan = 2;
      rPerf.appendChild(thPerfLabel);

      var tdPerfTotal = makeEl("td", "num-cell");
      var inpPerf = document.createElement("input");
      inpPerf.type = "number";
      inpPerf.min = "0";
      inpPerf.className = "sheet-num-input";
      inpPerf.title = "직접 수정 시 실시인원 고정 모드로 전환됩니다";
      inpPerf.value = String(summary.performedTotal);
      inpPerf.addEventListener("change", function () {
        var res = root.DayrepHeadcount.calcHeadcount(edu, {
          type: "setPerformed",
          value: inpPerf.value
        });
        warningText = res.warning || "";
        edu.mode = res.state.mode;
        edu.performed = res.state.performed;
        edu.categories = res.state.categories;
        ctx.onDayChange(day);
        render(container, ctx);
      });
      tdPerfTotal.appendChild(inpPerf);
      rPerf.appendChild(tdPerfTotal);

      rPerf.appendChild(makeEl("td", "num-cell", String(summary.performedMale)));

      var tdPerfFem = makeEl("td", "num-cell");
      var inpFem = document.createElement("input");
      inpFem.type = "number";
      inpFem.min = "0";
      inpFem.className = "sheet-num-input";
      inpFem.value = summary.performedFemale > 0 ? String(summary.performedFemale) : "";
      inpFem.placeholder = "0";
      inpFem.addEventListener("change", function () {
        var res = root.DayrepHeadcount.calcHeadcount(edu, {
          type: "setFemaleCount",
          value: inpFem.value
        });
        warningText = res.warning || "";
        edu.femaleCount = res.state.femaleCount;
        ctx.onDayChange(day);
        render(container, ctx);
      });
      tdPerfFem.appendChild(inpFem);
      rPerf.appendChild(tdPerfFem);
      mainTable.appendChild(rPerf);

      // 미실시 인원 + 미실시 사유/추가교육 헤더 행 (독립 입력 지원)
      var absentRes = root.DayrepHeadcount.calcAbsent(edu.absent, summary, { type: "init" });
      var absState = absentRes.state;

      var rAbsHead = makeEl("tr", "row-abs-head");
      var thAbsLabel = makeEl("th", "col-hc-label");
      thAbsLabel.colSpan = 2;
      thAbsLabel.rowSpan = 2;
      thAbsLabel.appendChild(document.createTextNode("미실시 인원"));
      if (absState.manual) {
        var btnResetAbs = makeEl("button", "btn-mini no-print", "자동");
        btnResetAbs.type = "button";
        btnResetAbs.title = "자동으로 되돌리기 (교육대상−실시)";
        btnResetAbs.addEventListener("click", function () {
          var nextAbs = root.DayrepHeadcount.calcAbsent(edu.absent, summary, { type: "resetAuto" });
          edu.absent = nextAbs.state;
          warningText = "";
          ctx.onDayChange(day);
          render(container, ctx);
        });
        thAbsLabel.appendChild(document.createElement("br"));
        thAbsLabel.appendChild(btnResetAbs);
      }
      rAbsHead.appendChild(thAbsLabel);

      function makeAbsentCell(field, actionType) {
        var td = makeEl("td", "num-cell");
        td.rowSpan = 2;
        var inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.className = "sheet-num-input";
        inp.value = absState.manual
          ? String(absState[field])
          : (absState[field] > 0 ? String(absState[field]) : "");
        inp.addEventListener("change", function () {
          var res = root.DayrepHeadcount.calcAbsent(edu.absent, summary, {
            type: actionType,
            value: inp.value
          });
          warningText = res.warning || "";
          edu.absent = res.state;
          ctx.onDayChange(day);
          render(container, ctx);
        });
        td.appendChild(inp);
        return td;
      }

      rAbsHead.appendChild(makeAbsentCell("total", "setTotal"));
      rAbsHead.appendChild(makeAbsentCell("male", "setMale"));
      rAbsHead.appendChild(makeAbsentCell("female", "setFemale"));
      rAbsHead.appendChild(makeEl("th", "col-abs-sub", "미실시 사유"));
      var thExtra = makeEl("th", "col-abs-sub", "추가교육 여부확인");
      thExtra.colSpan = 2;
      rAbsHead.appendChild(thExtra);
      mainTable.appendChild(rAbsHead);

      // 미실시 사유/추가교육 값 행
      var rAbsVal = makeEl("tr", "row-abs-val");
      var tdReason = makeEl("td", "abs-input-cell");
      var inpReason = document.createElement("input");
      inpReason.type = "text";
      inpReason.className = "sheet-text-input";
      inpReason.value = edu.absentReason || "";
      inpReason.addEventListener("input", function () {
        edu.absentReason = inpReason.value;
        ctx.onDayChange(day);
      });
      tdReason.appendChild(inpReason);

      var tdExtra = makeEl("td", "abs-input-cell");
      tdExtra.colSpan = 2;
      var inpExtra = document.createElement("input");
      inpExtra.type = "text";
      inpExtra.className = "sheet-text-input center";
      inpExtra.value = edu.extraEduCheck !== undefined ? edu.extraEduCheck : "-";
      inpExtra.addEventListener("input", function () {
        edu.extraEduCheck = inpExtra.value;
        ctx.onDayChange(day);
      });
      tdExtra.appendChild(inpExtra);
      rAbsVal.appendChild(tdReason);
      rAbsVal.appendChild(tdExtra);
      mainTable.appendChild(rAbsVal);

      // 교육방법 · 교육내용 · 교육시간 · 사용교재 헤더 행 (1 + 1 + 5 + 1 + 1 = 9열)
      var rBodyHead = makeEl("tr", "row-body-head");
      var thEduSide2 = makeEl("th", "col-label", "교 육\n내 용");
      thEduSide2.rowSpan = 2;
      rBodyHead.appendChild(thEduSide2);
      rBodyHead.appendChild(makeEl("th", "col-method", "교 육 방 법"));
      var thContents = makeEl("th", "col-contents th-ai-host");
      thContents.colSpan = 5;
      thContents.appendChild(document.createTextNode("교육내용"));
      if (root.DayrepAiPrompts) {
        var btnHeaderAi = makeEl(
          "button",
          "btn-cell-ai no-print" + (aiBusy ? " btn-ai-active" : ""),
          aiBusy ? "" : "AI"
        );
        btnHeaderAi.type = "button";
        btnHeaderAi.disabled = aiBusy;
        if (aiBusy) {
          btnHeaderAi.setAttribute("aria-busy", "true");
          btnHeaderAi.title = "생성 중…";
          var spHeader = makeEl("span", "ai-btn-spinner");
          spHeader.setAttribute("aria-hidden", "true");
          btnHeaderAi.appendChild(spHeader);
        } else {
          btnHeaderAi.title = "AI 교육내용 생성/개선/추가 옵션 열기";
        }
        btnHeaderAi.addEventListener("click", function () {
          aiOptionsOpen = !aiOptionsOpen;
          render(container, ctx);
        });
        thContents.appendChild(btnHeaderAi);
      }
      rBodyHead.appendChild(thContents);
      rBodyHead.appendChild(makeEl("th", "col-time", "교 육\n시간(H)"));
      rBodyHead.appendChild(makeEl("th", "col-mat", "사 용\n교재 등"));
      mainTable.appendChild(rBodyHead);

      // 교육방법 · 교육내용 · 교육시간 · 사용교재 본문 행
      var rBody = makeEl("tr", "row-body-content");
      var tdMethod = makeEl("td", "method-cell");
      var taMethod = document.createElement("textarea");
      taMethod.className = "sheet-textarea";
      taMethod.value = edu.method || "";
      taMethod.addEventListener("input", function () {
        edu.method = taMethod.value;
        ctx.onDayChange(day);
      });
      tdMethod.appendChild(taMethod);
      rBody.appendChild(tdMethod);

      var tdContents = makeEl("td", "contents-cell");
      tdContents.colSpan = 5;
      var taContents = document.createElement("textarea");
      taContents.className = "sheet-textarea contents-textarea";
      taContents.value = edu.contents || "";
      taContents.addEventListener("input", function () {
        edu.contents = taContents.value;
        ctx.onDayChange(day);
      });
      tdContents.appendChild(taContents);
      rBody.appendChild(tdContents);

      var tdTime = makeEl("td", "time-cell");
      var inpTime = document.createElement("input");
      inpTime.type = "text";
      inpTime.className = "sheet-text-input center";
      inpTime.value = edu.duration || "20분";
      inpTime.addEventListener("input", function () {
        edu.duration = inpTime.value;
        ctx.onDayChange(day);
      });
      tdTime.appendChild(inpTime);
      rBody.appendChild(tdTime);

      var tdMat = makeEl("td", "mat-cell");
      var inpMat = document.createElement("input");
      inpMat.type = "text";
      inpMat.className = "sheet-text-input center";
      inpMat.value = edu.materials || "-";
      inpMat.addEventListener("input", function () {
        edu.materials = inpMat.value;
        ctx.onDayChange(day);
      });
      tdMat.appendChild(inpMat);
      rBody.appendChild(tdMat);
      mainTable.appendChild(rBody);

      // 교관 및 장소 (원본 비율 80 | 99 | 248 | 123 을 서브 테이블로 정확 재현)
      var rInstRow = makeEl("tr", "row-inst-wrap");
      var thInstSide = makeEl("th", "col-label", "교 관\n및\n장 소");
      rInstRow.appendChild(thInstSide);

      var tdInstWrap = makeEl("td", "inst-wrap-cell");
      tdInstWrap.colSpan = 8;

      var instSub = makeEl("table", "doc1-inst-subtable");
      var instCg = document.createElement("colgroup");
      // 80 + 99 + 248 + 123 = 550
      ["14.55%", "18.00%", "45.09%", "22.36%"].forEach(function (w) {
        var col = document.createElement("col");
        col.style.width = w;
        instCg.appendChild(col);
      });
      instSub.appendChild(instCg);

      var rInstHead = makeEl("tr", "row-inst-head");
      rInstHead.appendChild(makeEl("th", "", "소 속\n(직책)"));
      rInstHead.appendChild(makeEl("th", "", "성 명"));
      rInstHead.appendChild(makeEl("th", "", "교 육 장 소"));
      rInstHead.appendChild(makeEl("th", "", "비 고"));
      instSub.appendChild(rInstHead);

      var rInstVal = makeEl("tr", "row-inst-val");
      var tdRole = makeEl("td", "inst-cell");
      var inpRole = document.createElement("input");
      inpRole.type = "text";
      inpRole.className = "sheet-text-input center";
      inpRole.value = edu.instructorRole || settings.safetyOfficerTitle || "안전관리자";
      inpRole.addEventListener("input", function () {
        edu.instructorRole = inpRole.value;
        ctx.onDayChange(day);
      });
      tdRole.appendChild(inpRole);
      rInstVal.appendChild(tdRole);

      var tdName = makeEl("td", "inst-cell");
      var inpName = document.createElement("input");
      inpName.type = "text";
      inpName.className = "sheet-text-input center";
      inpName.value = edu.instructorName || settings.safetyOfficerName || "";
      inpName.addEventListener("input", function () {
        edu.instructorName = inpName.value;
        ctx.onDayChange(day);
      });
      tdName.appendChild(inpName);
      rInstVal.appendChild(tdName);

      var tdPlace = makeEl("td", "inst-cell");
      var inpPlace = document.createElement("input");
      inpPlace.type = "text";
      inpPlace.className = "sheet-text-input center";
      inpPlace.value = edu.place || settings.defaultEduPlace || "현장";
      inpPlace.addEventListener("input", function () {
        edu.place = inpPlace.value;
        ctx.onDayChange(day);
      });
      tdPlace.appendChild(inpPlace);
      rInstVal.appendChild(tdPlace);

      var tdNote = makeEl("td", "inst-cell");
      var inpNote = document.createElement("input");
      inpNote.type = "text";
      inpNote.className = "sheet-text-input center";
      inpNote.value = edu.note || "";
      inpNote.addEventListener("input", function () {
        edu.note = inpNote.value;
        ctx.onDayChange(day);
      });
      tdNote.appendChild(inpNote);
      rInstVal.appendChild(tdNote);
      instSub.appendChild(rInstVal);

      tdInstWrap.appendChild(instSub);
      rInstRow.appendChild(tdInstWrap);
      mainTable.appendChild(rInstRow);

      // 하단 ※ 2줄 (9열 병합)
      var rFooter = makeEl("tr", "row-footer");
      var tdFooter = makeEl("td", "footer-notice-cell");
      tdFooter.colSpan = 9;
      var p1 = makeEl("div", "notice-line", "※교육대상 및 투입공종은 구체적으로 작성");
      var p2 = makeEl("div", "notice-line", "※교육 미실시 작업원은 원칙적으로 대상 작업공종 투입금지, 추후 추가교육 실시 후 투입");
      tdFooter.appendChild(p1);
      tdFooter.appendChild(p2);
      rFooter.appendChild(tdFooter);
      mainTable.appendChild(rFooter);

      sheet.appendChild(mainTable);
      container.appendChild(sheet);
    }

    return {
      render: render
    };
  }

  root.DayrepDoc1UI = {
    createDoc1Controller: createDoc1Controller
  };
})(window);
