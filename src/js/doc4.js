(function (root) {
  "use strict";

  var CRANE_ITEMS = [
    "운전원 자격은 적정한가? (건설기계조종사 면허 소지자)",
    "운전 상태는 양호한가?",
    "전후 회전반경 리미트 스위치 작동 상태는 양호한가?",
    "권과방지 장치는 설치되어 있는가?",
    "과부하 방지 장치는 작동하는가?",
    "비상정지장치 및 브레이크 장치는 양호한가?",
    "HOOK의 해지 장치는 양호한가?",
    "슬링바(와이어 로프) 상태는 양호한가?",
    "배선, 집전장치, 배전반, 개폐기, 컨트롤의 이상은 없는가?",
    "와이어 드럼의 감긴 상태 및 길이의 이상은 없는가?",
    "제한 하중을 준수하고 있는가?",
    "회전 반경내 근로자 및 가설전기등 위험물은 없는가?",
    "신호수는 배치되어 있는가?",
    "신호방법은 적당한가?",
    "각종 핀은 이상이 없는가?",
    "그리스 주입 상태는 양호한가?",
    "접지 및 피뢰침 상태는 양호한가?",
    "항공 장해등 상태는 양호한가?",
    "각종 부착물 낙하 위험이 없는가?",
    "풍속에 따른 작업위험은 없는가? (15m/s 이하)"
  ];

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

  function createDoc4Controller() {
    var showStamps = true;

    function render(container, ctx) {
      if (!container) return;
      container.textContent = "";

      var day = ctx.dayData;
      var settings = root.DayrepCarryover.createDefaultSettings(ctx.settings);
      var stamps = ctx.stamps || {};

      if (!day.crane) {
        day.crane = {
          checks: root.DayrepCarryover.makeDefaultCraneChecks(),
          actionNotes: ""
        };
      }
      var crane = day.crane;
      if (!Array.isArray(crane.checks) || crane.checks.length < 20) {
        crane.checks = root.DayrepCarryover.makeDefaultCraneChecks();
      }

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

      var btnAllGood = makeEl("button", "btn-secondary", "20항목 모두 양호");
      btnAllGood.type = "button";
      btnAllGood.addEventListener("click", function () {
        for (var i = 0; i < 20; i++) {
          if (crane.checks[i]) crane.checks[i].result = "good";
        }
        ctx.onDayChange(day);
        render(container, ctx);
      });
      leftGroup.appendChild(btnAllGood);

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

      // 2. A4 시트
      var sheet = makeEl("div", "a4-sheet doc4-sheet");

      var title = makeEl("div", "doc4-title", "무인 타워크레인 점검일지");
      sheet.appendChild(title);

      var topRow = makeEl("div", "doc4-top-row");
      var infoBox = makeEl("div", "doc4-info-box");
      infoBox.appendChild(makeEl("div", "doc4-info-line", "■ 공사명: " + (settings.siteName || "")));
      infoBox.appendChild(makeEl("div", "doc4-info-line", "■ 점검일자 : " + formatKoreanDate(day.date)));
      infoBox.appendChild(makeEl("div", "doc4-info-line", "■ 운 전 자 : " + (settings.craneOperator || "")));

      var signTable = makeEl("table", "doc4-sign-table");
      var sHead = document.createElement("tr");
      var thGyeol = makeEl("th", "doc4-sign-vert", "결\n\n재");
      thGyeol.rowSpan = 2;
      sHead.appendChild(thGyeol);
      sHead.appendChild(makeEl("th", "doc4-sign-col", "담당자"));
      sHead.appendChild(makeEl("th", "doc4-sign-col", "안 전"));
      sHead.appendChild(makeEl("th", "doc4-sign-col", "소 장"));
      signTable.appendChild(sHead);

      var sBody = document.createElement("tr");
      var tdS1 = makeEl("td", "doc4-stamp-cell");
      var tdS2 = makeEl("td", "doc4-stamp-cell");
      var tdS3 = makeEl("td", "doc4-stamp-cell");
      function putStamp(cell, obj, alt) {
        if (!showStamps || !obj || !obj.base64) return;
        var img = document.createElement("img");
        var mime = obj.ext === "jpg" ? "jpeg" : obj.ext;
        img.src = "data:image/" + mime + ";base64," + obj.base64;
        img.alt = alt;
        img.className = "doc4-stamp-img";
        cell.appendChild(img);
      }
      putStamp(tdS1, stamps.crane_staff || stamps.staff, "담당자 도장");
      putStamp(tdS2, stamps.staff, "안전 도장");
      putStamp(tdS3, stamps.director, "소장 도장");
      sBody.appendChild(tdS1);
      sBody.appendChild(tdS2);
      sBody.appendChild(tdS3);
      signTable.appendChild(sBody);

      topRow.appendChild(infoBox);
      topRow.appendChild(signTable);
      sheet.appendChild(topRow);

      // 메인 점검표 (원본 574px 기준: 73 | 318 | 61 | 61 | 61)
      var mainTable = makeEl("table", "doc4-main-table");
      var cg = document.createElement("colgroup");
      ["12.72%", "55.40%", "10.63%", "10.63%", "10.62%"].forEach(function (w) {
        var col = document.createElement("col");
        col.style.width = w;
        cg.appendChild(col);
      });
      mainTable.appendChild(cg);

      var rH1 = document.createElement("tr");
      rH1.className = "doc4-head1";
      var thNo = makeEl("th", "", "NO");
      thNo.rowSpan = 2;
      var thItem = makeEl("th", "", "세 부 점 검 사 항");
      thItem.rowSpan = 2;
      var thState = makeEl("th", "", "상 태");
      thState.colSpan = 2;
      var thNote = makeEl("th", "", "비고");
      rH1.appendChild(thNo);
      rH1.appendChild(thItem);
      rH1.appendChild(thState);
      rH1.appendChild(thNote);
      mainTable.appendChild(rH1);

      var rH2 = document.createElement("tr");
      rH2.className = "doc4-head2";
      rH2.appendChild(makeEl("th", "", "양 호"));
      rH2.appendChild(makeEl("th", "", "불 량"));
      rH2.appendChild(makeEl("th", "", ""));
      mainTable.appendChild(rH2);

      for (var i = 0; i < 20; i++) {
        (function (idx) {
          var chk = crane.checks[idx] || { result: "good", note: "" };
          var tr = document.createElement("tr");
          tr.className = "doc4-item-row";

          tr.appendChild(makeEl("td", "center", String(idx + 1)));
          tr.appendChild(makeEl("td", "doc4-item-text", CRANE_ITEMS[idx]));

          var tdGood = makeEl("td", "doc4-opt-cell", chk.result === "good" ? "○" : "");
          tdGood.addEventListener("click", function () {
            crane.checks[idx].result = "good";
            ctx.onDayChange(day);
            render(container, ctx);
          });

          var tdBad = makeEl("td", "doc4-opt-cell", chk.result === "bad" ? "○" : "");
          tdBad.addEventListener("click", function () {
            crane.checks[idx].result = "bad";
            ctx.onDayChange(day);
            render(container, ctx);
          });

          var tdNote = makeEl("td", "doc4-note-cell");
          var inpNote = document.createElement("input");
          inpNote.type = "text";
          inpNote.className = "sheet-text-input center";
          inpNote.value = chk.note || "";
          inpNote.addEventListener("input", function () {
            crane.checks[idx].note = inpNote.value;
            ctx.onDayChange(day);
          });
          tdNote.appendChild(inpNote);

          tr.appendChild(tdGood);
          tr.appendChild(tdBad);
          tr.appendChild(tdNote);
          mainTable.appendChild(tr);
        })(i);
      }

      // 조치 사항 헤더 + 입력란
      var rActH = document.createElement("tr");
      rActH.className = "doc4-act-head";
      rActH.appendChild(makeEl("th", "", "조치 사항"));
      var tdActGuide = makeEl("td", "center", "타워 크레인 운전자가 운전전 점검실시 후 기재");
      tdActGuide.colSpan = 4;
      rActH.appendChild(tdActGuide);
      mainTable.appendChild(rActH);

      var rActBody = document.createElement("tr");
      rActBody.className = "doc4-act-body";
      var tdActBody = makeEl("td", "doc4-act-cell");
      tdActBody.colSpan = 5;
      var taAct = document.createElement("textarea");
      taAct.className = "sheet-textarea";
      taAct.value = crane.actionNotes !== undefined ? crane.actionNotes : "";
      taAct.addEventListener("input", function () {
        crane.actionNotes = taAct.value;
        ctx.onDayChange(day);
      });
      tdActBody.appendChild(taAct);
      rActBody.appendChild(tdActBody);
      mainTable.appendChild(rActBody);

      sheet.appendChild(mainTable);
      container.appendChild(sheet);
    }

    return {
      render: render
    };
  }

  root.DayrepDoc4UI = {
    createDoc4Controller: createDoc4Controller,
    CRANE_ITEMS: CRANE_ITEMS
  };
})(window);
