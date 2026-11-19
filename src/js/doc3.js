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

  function addColgroup(table, widths) {
    var cg = document.createElement("colgroup");
    widths.forEach(function (w) {
      var col = document.createElement("col");
      col.style.width = w;
      cg.appendChild(col);
    });
    table.appendChild(cg);
  }

  function createDoc3Controller() {
    var showStamps = true;
    var warningText = "";

    function render(container, ctx) {
      if (!container) return;
      container.textContent = "";

      var day = ctx.dayData;
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var stamps = ctx.stamps || {};

      if (!day.patrol) {
        day.patrol = {
          weather: "맑음",
          weeklyFocus: "",
          eduEvents: root.DayrepCarryover.DEFAULT_EDU_EVENTS.slice(),
          direct: 1,
          worker: 0,
          checks: root.DayrepCarryover.makeDefaultPatrolChecks(),
          zeroAccidentPrev: 0,
          zeroAccidentToday: 0,
          notes: ""
        };
      }
      var patrol = day.patrol;
      if (!Array.isArray(patrol.checks) || patrol.checks.length < 20) {
        patrol.checks = root.DayrepCarryover.makeDefaultPatrolChecks();
      }
      if (!Array.isArray(patrol.eduEvents) || patrol.eduEvents.length < 2) {
        patrol.eduEvents = root.DayrepCarryover.DEFAULT_EDU_EVENTS.slice();
      }

      // 1쪽 실시인원 및 현장관리자(직원) 연동
      var eduRes = root.DayrepHeadcount.calcHeadcount(day.eduLog || {}, { type: "init" });
      var totalCount = eduRes.summary.performedTotal;
      var staffCount = 0;
      if (day.eduLog && Array.isArray(day.eduLog.categories)) {
        for (var cIdx = 0; cIdx < day.eduLog.categories.length; cIdx++) {
          if (String(day.eduLog.categories[cIdx].name || "").trim() === "현장관리자") {
            staffCount += Number(day.eduLog.categories[cIdx].count) || 0;
          }
        }
      }
      var hcPatrol = root.DayrepHeadcount.calcPatrolHeadcount({
        total: totalCount,
        staff: staffCount,
        direct: patrol.direct !== undefined ? patrol.direct : 1,
        worker: patrol.worker !== undefined ? patrol.worker : 0
      }, { type: "init" });
      patrol.direct = hcPatrol.state.direct;
      patrol.worker = hcPatrol.state.worker;

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

      var btnAllGood = makeEl("button", "btn-secondary", "18개 항목 모두 양호");
      btnAllGood.type = "button";
      btnAllGood.addEventListener("click", function () {
        for (var i = 0; i < 18; i++) {
          if (patrol.checks[i]) patrol.checks[i].result = "good";
        }
        ctx.onDayChange(day);
        render(container, ctx);
      });
      leftGroup.appendChild(btnAllGood);

      var btnClearAll = makeEl("button", "btn-secondary", "점검결과 전체 해제");
      btnClearAll.type = "button";
      btnClearAll.addEventListener("click", function () {
        for (var i = 0; i < patrol.checks.length; i++) {
          if (patrol.checks[i]) patrol.checks[i].result = "";
        }
        ctx.onDayChange(day);
        render(container, ctx);
      });
      leftGroup.appendChild(btnClearAll);

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

      if (warningText) {
        container.appendChild(makeEl("div", "doc-warning no-print", warningText));
      }

      // 2. A4 시트
      var sheet = makeEl("div", "a4-sheet doc3-sheet");
      var box = makeEl("div", "doc3-frame");

      // [A] 상단 헤더 표 (원본 비율: 회사명 23.26% | 제목·날짜 49.90% | 결재 3.80% | 안전관리자 11.70% | 총괄책임자 11.34%)
      var topTable = makeEl("table", "doc3-table doc3-top-table");
      addColgroup(topTable, ["23.26%", "49.90%", "3.80%", "11.70%", "11.34%"]);

      var rTop1 = document.createElement("tr");
      rTop1.className = "doc3-top-r1";
      var tdComp = makeEl("td", "doc3-company", settings.companyName || "");
      tdComp.rowSpan = 2;
      rTop1.appendChild(tdComp);

      var tdTitle = makeEl("td", "doc3-title-cell", "안전 순회 점검표");
      rTop1.appendChild(tdTitle);

      // 결재 블록을 제목/날짜 행 분할(50:50)과 독립시켜 헤더(26%) : 도장(74%) 비율 유지
      var tdSignWrap = makeEl("td", "doc3-sign-wrap");
      tdSignWrap.colSpan = 3;
      tdSignWrap.rowSpan = 2;

      var signSub = makeEl("table", "doc3-sign-subtable");
      addColgroup(signSub, ["14.16%", "43.59%", "42.25%"]);

      var sr1 = document.createElement("tr");
      sr1.className = "doc3-sign-r1";
      var thGyeol = makeEl("th", "doc3-sign-vert", "결\n재");
      thGyeol.rowSpan = 2;
      sr1.appendChild(thGyeol);
      sr1.appendChild(makeEl("th", "doc3-sign-head", "안전관리자"));
      sr1.appendChild(makeEl("th", "doc3-sign-head", "총괄책임자"));
      signSub.appendChild(sr1);

      var sr2 = document.createElement("tr");
      sr2.className = "doc3-sign-r2";
      var tdStamp1 = makeEl("td", "doc3-stamp-cell");
      var tdStamp2 = makeEl("td", "doc3-stamp-cell");
      function putStamp(cell, obj, alt) {
        if (!showStamps || !obj || !obj.base64) return;
        var img = document.createElement("img");
        var mime = obj.ext === "jpg" ? "jpeg" : obj.ext;
        img.src = "data:image/" + mime + ";base64," + obj.base64;
        img.alt = alt;
        img.className = "doc3-stamp-img";
        cell.appendChild(img);
      }
      putStamp(tdStamp1, stamps.staff, "안전관리자 도장");
      putStamp(tdStamp2, stamps.chief, "총괄책임자 도장");
      sr2.appendChild(tdStamp1);
      sr2.appendChild(tdStamp2);
      signSub.appendChild(sr2);

      tdSignWrap.appendChild(signSub);
      rTop1.appendChild(tdSignWrap);
      topTable.appendChild(rTop1);

      var rTop2 = document.createElement("tr");
      rTop2.className = "doc3-top-r2";
      var tdDateWeather = makeEl("td", "doc3-date-weather");
      var dwWrap = makeEl("div", "doc3-dw-wrap");
      dwWrap.appendChild(makeEl("span", "", formatKoreanDate(day.date)));
      var weatherSpan = makeEl("span", "doc3-weather-wrap");
      weatherSpan.appendChild(document.createTextNode("날씨 : "));
      var selWeather = document.createElement("select");
      selWeather.className = "doc3-weather-select";
      ["맑음", "흐림", "비", "눈"].forEach(function (w) {
        var opt = document.createElement("option");
        opt.value = w;
        opt.textContent = w;
        selWeather.appendChild(opt);
      });
      selWeather.value = patrol.weather || "맑음";
      selWeather.addEventListener("change", function () {
        patrol.weather = selWeather.value;
        ctx.onDayChange(day);
      });
      weatherSpan.appendChild(selWeather);
      dwWrap.appendChild(weatherSpan);
      tdDateWeather.appendChild(dwWrap);
      rTop2.appendChild(tdDateWeather);

      topTable.appendChild(rTop2);
      box.appendChild(topTable);

      // [B] 금주의 중점사항 (8.0% | 92.0%)
      var focusTable = makeEl("table", "doc3-table doc3-focus-table");
      addColgroup(focusTable, ["7.99%", "92.01%"]);
      var rFocus = document.createElement("tr");
      rFocus.className = "doc3-focus-row";
      rFocus.appendChild(makeEl("th", "doc3-side-label", "금 주 의\n중점사항"));
      var tdFocus = makeEl("td", "doc3-focus-cell");
      var inpFocus = document.createElement("input");
      inpFocus.type = "text";
      inpFocus.className = "sheet-text-input center";
      inpFocus.value = patrol.weeklyFocus || "";
      inpFocus.addEventListener("input", function () {
        patrol.weeklyFocus = inpFocus.value;
        ctx.onDayChange(day);
      });
      tdFocus.appendChild(inpFocus);
      rFocus.appendChild(tdFocus);
      focusTable.appendChild(rFocus);
      box.appendChild(focusTable);

      // [C] 안전교육 행사 + 작업인원 (8.0% | 61.28% | 7.81% | 7.81% | 15.10%)
      var eventTable = makeEl("table", "doc3-table doc3-event-table");
      addColgroup(eventTable, ["7.99%", "61.28%", "7.81%", "7.81%", "15.11%"]);

      var rEv1 = document.createElement("tr");
      rEv1.className = "doc3-ev-row";
      var thEvSide = makeEl("th", "doc3-side-label", "안전\n교육\n행사");
      thEvSide.rowSpan = 4;
      rEv1.appendChild(thEvSide);

      var tdEv1 = makeEl("td", "doc3-ev-cell");
      tdEv1.rowSpan = 2;
      var inpEv1 = document.createElement("input");
      inpEv1.type = "text";
      inpEv1.className = "sheet-text-input center";
      inpEv1.value = patrol.eduEvents[0] || "";
      inpEv1.addEventListener("input", function () {
        patrol.eduEvents[0] = inpEv1.value;
        ctx.onDayChange(day);
      });
      tdEv1.appendChild(inpEv1);
      rEv1.appendChild(tdEv1);

      var thWorkSide = makeEl("th", "doc3-side-label", "작\n업\n인\n원");
      thWorkSide.rowSpan = 4;
      rEv1.appendChild(thWorkSide);
      rEv1.appendChild(makeEl("th", "doc3-hc-label", "직 원"));
      rEv1.appendChild(makeEl("td", "doc3-hc-val", "(" + staffCount + ")"));
      eventTable.appendChild(rEv1);

      var rEv2 = document.createElement("tr");
      rEv2.className = "doc3-ev-row";
      rEv2.appendChild(makeEl("th", "doc3-hc-label", "직 영"));
      var tdDirect = makeEl("td", "doc3-hc-val");
      var inpDirect = document.createElement("input");
      inpDirect.type = "number";
      inpDirect.min = "0";
      inpDirect.className = "sheet-num-input";
      inpDirect.value = String(patrol.direct);
      inpDirect.addEventListener("change", function () {
        var res = root.DayrepHeadcount.calcPatrolHeadcount({
          total: totalCount,
          staff: staffCount,
          direct: patrol.direct,
          worker: patrol.worker
        }, { type: "setDirect", value: inpDirect.value });
        if (!res.ok) {
          warningText = res.warning || "작업인원 초과";
          render(container, ctx);
          return;
        }
        warningText = "";
        patrol.direct = res.state.direct;
        patrol.worker = res.state.worker;
        ctx.onDayChange(day);
        render(container, ctx);
      });
      tdDirect.appendChild(inpDirect);
      rEv2.appendChild(tdDirect);
      eventTable.appendChild(rEv2);

      var rEv3 = document.createElement("tr");
      rEv3.className = "doc3-ev-row";
      var tdEv2 = makeEl("td", "doc3-ev-cell");
      tdEv2.rowSpan = 2;
      var inpEv2 = document.createElement("input");
      inpEv2.type = "text";
      inpEv2.className = "sheet-text-input center";
      inpEv2.value = patrol.eduEvents[1] || "";
      inpEv2.addEventListener("input", function () {
        patrol.eduEvents[1] = inpEv2.value;
        ctx.onDayChange(day);
      });
      tdEv2.appendChild(inpEv2);
      rEv3.appendChild(tdEv2);
      rEv3.appendChild(makeEl("th", "doc3-hc-label", "근로자"));
      rEv3.appendChild(makeEl("td", "doc3-hc-val", String(patrol.worker)));
      eventTable.appendChild(rEv3);

      var rEv4 = document.createElement("tr");
      rEv4.className = "doc3-ev-row";
      rEv4.appendChild(makeEl("th", "doc3-hc-label", "계"));
      rEv4.appendChild(makeEl("td", "doc3-hc-val", String(totalCount)));
      eventTable.appendChild(rEv4);
      box.appendChild(eventTable);

      // [D] 안전점검 표 (8.0% | 15.28% | 53.82% | 7.64% | 7.64% | 7.64%)
      var chkTable = makeEl("table", "doc3-table doc3-chk-table");
      addColgroup(chkTable, ["7.99%", "15.28%", "53.81%", "7.64%", "7.64%", "7.64%"]);

      var rChkH1 = document.createElement("tr");
      rChkH1.className = "doc3-chk-head1";
      var thSafeSide = makeEl("th", "doc3-side-label", "안\n전\n점\n검");
      thSafeSide.rowSpan = 22;
      rChkH1.appendChild(thSafeSide);

      var thChecker = makeEl("th", "", "점 검 자");
      thChecker.rowSpan = 2;
      rChkH1.appendChild(thChecker);

      var thItemH = makeEl("th", "", "점   검   사   항");
      thItemH.rowSpan = 2;
      rChkH1.appendChild(thItemH);

      var thResH = makeEl("th", "", "점검결과");
      thResH.colSpan = 3;
      rChkH1.appendChild(thResH);
      chkTable.appendChild(rChkH1);

      var rChkH2 = document.createElement("tr");
      rChkH2.className = "doc3-chk-head2";
      rChkH2.appendChild(makeEl("th", "", "양호"));
      rChkH2.appendChild(makeEl("th", "", "미흡"));
      rChkH2.appendChild(makeEl("th", "", "해당없음"));
      chkTable.appendChild(rChkH2);

      for (var idx = 0; idx < 20; idx++) {
        (function (i) {
          var item = patrol.checks[i] || { text: "", result: "" };
          var tr = document.createElement("tr");
          tr.className = "doc3-chk-row";

          if (i === 0) {
            var thDaily = makeEl("th", "doc3-cat-cell", "일상점검");
            thDaily.rowSpan = 12;
            tr.appendChild(thDaily);
          } else if (i === 12) {
            var thEtc = makeEl("th", "doc3-cat-cell", "기 타");
            thEtc.rowSpan = 8;
            tr.appendChild(thEtc);
          }

          var tdText = makeEl("td", "doc3-item-cell");
          var inpText = document.createElement("input");
          inpText.type = "text";
          inpText.className = "sheet-text-input doc3-item-input";
          inpText.value = item.text || "";
          inpText.addEventListener("input", function () {
            patrol.checks[i].text = inpText.value;
            ctx.onDayChange(day);
          });
          tdText.appendChild(inpText);
          tr.appendChild(tdText);

          ["good", "poor", "na"].forEach(function (val) {
            var tdOpt = makeEl("td", "doc3-opt-cell");
            tdOpt.textContent = item.result === val ? "○" : "";
            tdOpt.title = "클릭하여 선택";
            tdOpt.addEventListener("click", function () {
              patrol.checks[i].result = patrol.checks[i].result === val ? "" : val;
              ctx.onDayChange(day);
              render(container, ctx);
            });
            tr.appendChild(tdOpt);
          });

          chkTable.appendChild(tr);
        })(idx);
      }
      box.appendChild(chkTable);

      // [E] 무재해 목표시간 4칸 (zeroAccidentEnabled 가 켜졌을 때만 표시)
      if (settings.zeroAccidentEnabled) {
        var zeroTable = makeEl("table", "doc3-table doc3-zero-table");
        addColgroup(zeroTable, ["27.08%", "26.91%", "23.09%", "22.92%"]);
        var rZ1 = document.createElement("tr");
        rZ1.className = "doc3-zero-head";
        rZ1.appendChild(makeEl("th", "", "무재해 목표 시간(기간)"));
        rZ1.appendChild(makeEl("th", "", "전일까지 누계"));
        rZ1.appendChild(makeEl("th", "", "금일 진행 시간"));
        rZ1.appendChild(makeEl("th", "", "금일까지 누계"));
        zeroTable.appendChild(rZ1);

        var prevH = Number(patrol.zeroAccidentPrev) || 0;
        var todayH = Number(patrol.zeroAccidentToday) || 0;
        var totalH = prevH + todayH;

        var rZ2 = document.createElement("tr");
        rZ2.className = "doc3-zero-val";
        rZ2.appendChild(makeEl("td", "center", Number(settings.zeroAccidentTarget || 100000).toLocaleString("ko-KR")));

        var tdPrev = makeEl("td", "center");
        var inpPrev = document.createElement("input");
        inpPrev.type = "number";
        inpPrev.min = "0";
        inpPrev.className = "sheet-num-input";
        inpPrev.value = prevH > 0 ? String(prevH) : "";
        inpPrev.placeholder = "-";
        inpPrev.addEventListener("input", function () {
          patrol.zeroAccidentPrev = Math.max(0, Number(inpPrev.value) || 0);
          tdTotal.textContent = (patrol.zeroAccidentPrev + (Number(patrol.zeroAccidentToday) || 0)) > 0
            ? String(patrol.zeroAccidentPrev + (Number(patrol.zeroAccidentToday) || 0))
            : "-";
          ctx.onDayChange(day);
        });
        tdPrev.appendChild(inpPrev);
        rZ2.appendChild(tdPrev);

        var tdToday = makeEl("td", "center");
        var inpToday = document.createElement("input");
        inpToday.type = "number";
        inpToday.min = "0";
        inpToday.className = "sheet-num-input";
        inpToday.value = todayH > 0 ? String(todayH) : "";
        inpToday.placeholder = "-";
        inpToday.addEventListener("input", function () {
          patrol.zeroAccidentToday = Math.max(0, Number(inpToday.value) || 0);
          tdTotal.textContent = ((Number(patrol.zeroAccidentPrev) || 0) + patrol.zeroAccidentToday) > 0
            ? String((Number(patrol.zeroAccidentPrev) || 0) + patrol.zeroAccidentToday)
            : "-";
          ctx.onDayChange(day);
        });
        tdToday.appendChild(inpToday);
        rZ2.appendChild(tdToday);

        var tdTotal = makeEl("td", "center", totalH > 0 ? String(totalH) : "-");
        rZ2.appendChild(tdTotal);

        zeroTable.appendChild(rZ2);
        box.appendChild(zeroTable);
      }

      // [F] 특기사항 (8.0% | 92.0%)
      var noteTable = makeEl("table", "doc3-table doc3-note-table");
      addColgroup(noteTable, ["7.99%", "92.01%"]);
      var rNote = document.createElement("tr");
      rNote.className = "doc3-note-row";
      rNote.appendChild(makeEl("th", "doc3-side-label", "특\n기\n사\n항"));
      var tdNote = makeEl("td", "doc3-note-cell");
      var taNote = document.createElement("textarea");
      taNote.className = "sheet-textarea";
      taNote.value = patrol.notes || "";
      taNote.addEventListener("input", function () {
        patrol.notes = taNote.value;
        ctx.onDayChange(day);
      });
      tdNote.appendChild(taNote);
      rNote.appendChild(tdNote);
      noteTable.appendChild(rNote);
      box.appendChild(noteTable);

      sheet.appendChild(box);
      container.appendChild(sheet);
    }

    return {
      render: render
    };
  }

  root.DayrepDoc3UI = {
    createDoc3Controller: createDoc3Controller
  };
})(window);
