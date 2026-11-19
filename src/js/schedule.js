(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DayrepSchedule = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_ITEMS = 200;
  var WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

  function isValidDate(dateStr) {
    if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return false;
    }
    var parts = dateStr.split("-").map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return (
      dt.getUTCFullYear() === parts[0] &&
      dt.getUTCMonth() + 1 === parts[1] &&
      dt.getUTCDate() === parts[2]
    );
  }

  function formatWeekdayKo(dateStr) {
    if (!isValidDate(dateStr)) return "";
    var parts = dateStr.split("-").map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return WEEKDAYS_KO[dt.getUTCDay()];
  }

  function normalizeSchedule(raw) {
    var srcList = [];
    if (Array.isArray(raw)) {
      srcList = raw;
    } else if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
      srcList = raw.items;
    }

    var warnings = [];
    var items = [];
    if (srcList.length > MAX_ITEMS) {
      warnings.push("공정표 항목은 최대 " + MAX_ITEMS + "행까지만 저장됩니다.");
    }

    var limit = Math.min(srcList.length, MAX_ITEMS);
    for (var i = 0; i < limit; i++) {
      var row = srcList[i] && typeof srcList[i] === "object" ? srcList[i] : null;
      if (!row) continue;

      var start = typeof row.start === "string" ? row.start.trim() : "";
      if (!isValidDate(start)) {
        warnings.push((i + 1) + "행: 시작일 형식이 올바르지 않아 제외되었습니다.");
        continue;
      }

      var end = typeof row.end === "string" ? row.end.trim() : "";
      if (!end || !isValidDate(end)) {
        end = start;
      } else if (end < start) {
        warnings.push((i + 1) + "행: 종료일이 시작일보다 빨라 시작일로 보정했습니다.");
        end = start;
      }

      var task = String(row.task || "").trim().slice(0, 200);
      var equipment = String(row.equipment || "").trim().slice(0, 100);
      var memo = String(row.memo || "").trim().slice(0, 200);
      var id = typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : ("sch_" + (i + 1));

      items.push({
        id: id,
        start: start,
        end: end,
        task: task,
        equipment: equipment,
        memo: memo
      });
    }

    return { items: items, warnings: warnings };
  }

  function itemsForDate(schedule, date) {
    if (!isValidDate(date)) return [];
    var list = Array.isArray(schedule)
      ? schedule
      : (schedule && Array.isArray(schedule.items) ? schedule.items : []);

    var matched = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !isValidDate(it.start) || !isValidDate(it.end)) continue;
      if (it.start <= date && date <= it.end) {
        matched.push(it);
      }
    }
    return matched;
  }

  function enumerateDates(startDate, mode) {
    if (!isValidDate(startDate)) return [];
    var count = mode === "month" ? 30 : 7;
    var parts = startDate.split("-").map(Number);
    var out = [];
    for (var i = 0; i < count; i++) {
      var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + i));
      var y = dt.getUTCFullYear();
      var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      var d = String(dt.getUTCDate()).padStart(2, "0");
      out.push(y + "-" + m + "-" + d);
    }
    return out;
  }

  function workSectionFromItems(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    var tasks = [];
    for (var i = 0; i < items.length; i++) {
      var t = String((items[i] && items[i].task) || "").trim();
      if (t && tasks.indexOf(t) === -1) {
        tasks.push(t);
      }
    }
    var joined = tasks.join(" / ");
    return joined.length > 200 ? joined.slice(0, 200) : joined;
  }

  function addDays(dateStr, offsetDays) {
    if (!isValidDate(dateStr)) return dateStr || "";
    var n = Number(offsetDays);
    if (!Number.isFinite(n)) n = 0;
    n = Math.trunc(n);
    var parts = dateStr.split("-").map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + n));
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    var d = String(dt.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  return {
    MAX_ITEMS: MAX_ITEMS,
    isValidDate: isValidDate,
    formatWeekdayKo: formatWeekdayKo,
    addDays: addDays,
    normalizeSchedule: normalizeSchedule,
    itemsForDate: itemsForDate,
    enumerateDates: enumerateDates,
    workSectionFromItems: workSectionFromItems
  };
});
