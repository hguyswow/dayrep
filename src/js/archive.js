(function (root) {
  "use strict";

  function makeEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function groupByYearMonth(items) {
    var tree = {};
    (items || []).forEach(function (item) {
      var d = String(item.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      var y = d.slice(0, 4);
      var m = d.slice(5, 7);
      if (!tree[y]) tree[y] = {};
      if (!tree[y][m]) tree[y][m] = [];
      tree[y][m].push(item);
    });
    return tree;
  }

  function createArchiveController() {
    var lastKeyword = "";
    var searchTimer = null;

    async function render(container, ctx) {
      if (!container) return;
      container.textContent = "";

      var header = makeEl("div", "archive-header");
      header.appendChild(makeEl("h2", "", "보관함"));

      var searchRow = makeEl("div", "archive-search-row");
      var searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "archive-search-input";
      searchInput.placeholder = "날짜(예: 2026-11) 또는 키워드(교육내용·특기사항·작업구간·현장명)";
      searchInput.value = lastKeyword;

      var btnSearch = makeEl("button", "btn-primary", "검색");
      btnSearch.type = "button";

      var btnReset = makeEl("button", "btn-secondary", "전체");
      btnReset.type = "button";

      var listBox = makeEl("div", "archive-tree");

      async function runQuery(kw) {
        lastKeyword = kw;
        listBox.textContent = "";
        if (!ctx.invoke) {
          listBox.appendChild(makeEl("p", "muted", "Tauri 런타임에서만 보관함 조회가 가능합니다."));
          return;
        }
        try {
          var items = await ctx.invoke("search_days", { keyword: kw });
          if (!items || items.length === 0) {
            listBox.appendChild(makeEl("p", "muted", "저장된 서류 기록이 없습니다."));
            return;
          }

          var tree = groupByYearMonth(items);
          var years = Object.keys(tree).sort().reverse();
          years.forEach(function (year, yIdx) {
            var yDetails = document.createElement("details");
            yDetails.className = "archive-year";
            if (yIdx === 0 || kw.trim()) yDetails.open = true;
            yDetails.appendChild(makeEl("summary", "archive-year-title", year + "년"));

            var months = Object.keys(tree[year]).sort().reverse();
            months.forEach(function (month, mIdx) {
              var mDetails = document.createElement("details");
              mDetails.className = "archive-month";
              if ((yIdx === 0 && mIdx === 0) || kw.trim()) mDetails.open = true;
              mDetails.appendChild(
                makeEl("summary", "archive-month-title", month + "월 (" + tree[year][month].length + "건)")
              );

              var dayList = makeEl("div", "archive-day-list");
              tree[year][month].forEach(function (item) {
                var row = makeEl("div", "archive-day-row");

                var left = makeEl("div", "archive-day-info");
                var dateBtn = makeEl("button", "archive-date-link", item.date);
                dateBtn.type = "button";
                dateBtn.addEventListener("click", function () {
                  ctx.onSelectDate(item.date);
                });
                left.appendChild(dateBtn);

                var pdfBadge = makeEl(
                  "span",
                  item.hasPdf ? "arc-badge ok" : "arc-badge",
                  item.hasPdf ? "PDF 있음" : "PDF 없음"
                );
                left.appendChild(pdfBadge);

                var photoBadge = makeEl("span", "arc-badge", "사진 " + item.photoCount + "장");
                left.appendChild(photoBadge);

                if (item.snippet) {
                  left.appendChild(makeEl("span", "arc-snippet", item.snippet));
                }

                var right = makeEl("div", "archive-day-actions");
                if (item.hasPdf) {
                  var btnPdf = makeEl("button", "btn-secondary", "PDF 열기");
                  btnPdf.type = "button";
                  btnPdf.addEventListener("click", async function () {
                    try {
                      await ctx.invoke("open_pdf", { date: item.date });
                    } catch (err) {
                      ctx.showToast("PDF 열기 실패: " + String(err), true);
                    }
                  });
                  right.appendChild(btnPdf);
                }

                row.appendChild(left);
                row.appendChild(right);
                dayList.appendChild(row);
              });

              mDetails.appendChild(dayList);
              yDetails.appendChild(mDetails);
            });

            listBox.appendChild(yDetails);
          });
        } catch (err) {
          ctx.showToast("보관함 검색 실패: " + String(err), true);
        }
      }

      btnSearch.addEventListener("click", function () {
        runQuery(searchInput.value);
      });
      btnReset.addEventListener("click", function () {
        searchInput.value = "";
        runQuery("");
      });
      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runQuery(searchInput.value);
      });
      searchInput.addEventListener("input", function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          runQuery(searchInput.value);
        }, 300);
      });

      searchRow.appendChild(searchInput);
      searchRow.appendChild(btnSearch);
      searchRow.appendChild(btnReset);

      container.appendChild(header);
      container.appendChild(searchRow);
      container.appendChild(listBox);

      await runQuery(lastKeyword);
    }

    return {
      render: render
    };
  }

  root.DayrepArchiveUI = {
    createArchiveController: createArchiveController
  };
})(window);
