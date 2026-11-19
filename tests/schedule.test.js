const assert = require("assert");
const {
  isValidDate,
  formatWeekdayKo,
  normalizeSchedule,
  itemsForDate,
  enumerateDates,
  workSectionFromItems
} = require("../src/js/schedule.js");

function runTests() {
  // 1. 날짜 검증 및 요일
  assert.strictEqual(isValidDate("2024-02-29"), true);
  assert.strictEqual(isValidDate("2026-02-29"), false);
  assert.strictEqual(formatWeekdayKo("2026-11-18"), "수");

  // 2. normalizeSchedule: 잘못된 날짜 제외, 역전 기간 보정, 길이 제한
  const norm = normalizeSchedule({
    items: [
      { id: "1", start: "2026-11-18", end: "2026-11-15", task: "가".repeat(250), equipment: "나".repeat(120), memo: "다".repeat(250) },
      { id: "2", start: "bad-date", end: "2026-11-20", task: "제외됨" },
      { id: "3", start: "2026-11-20", end: "", task: "당일 작업", equipment: "굴착기", memo: "" }
    ]
  });
  assert.strictEqual(norm.items.length, 2);
  assert.strictEqual(norm.warnings.length, 2);
  assert.strictEqual(norm.items[0].end, "2026-11-18");
  assert.strictEqual(norm.items[0].task.length, 200);
  assert.strictEqual(norm.items[0].equipment.length, 100);
  assert.strictEqual(norm.items[0].memo.length, 200);
  assert.strictEqual(norm.items[1].end, "2026-11-20");

  // 3. itemsForDate 경계 (시작일/종료일 포함)
  const sch = {
    items: [
      { id: "a", start: "2026-11-17", end: "2026-11-19", task: "철근 가공", equipment: "절곡기", memo: "" },
      { id: "b", start: "2026-11-19", end: "2026-11-21", task: "거푸집 설치", equipment: "크레인", memo: "" }
    ]
  };
  assert.strictEqual(itemsForDate(sch, "2026-11-16").length, 0);
  assert.strictEqual(itemsForDate(sch, "2026-11-17").length, 1);
  assert.strictEqual(itemsForDate(sch, "2026-11-19").length, 2);
  assert.strictEqual(itemsForDate(sch, "2026-11-21").length, 1);

  // 4. enumerateDates: 7일/30일, 월말/연말/윤년
  const w = enumerateDates("2026-11-28", "week");
  assert.strictEqual(w.length, 7);
  assert.strictEqual(w[0], "2026-11-28");
  assert.strictEqual(w[2], "2026-11-30");
  assert.strictEqual(w[3], "2026-12-01");
  assert.strictEqual(w[6], "2026-12-04");

  const yEnd = enumerateDates("2026-12-29", "week");
  assert.strictEqual(yEnd[3], "2027-01-01");

  const leap = enumerateDates("2024-02-28", "month");
  assert.strictEqual(leap.length, 30);
  assert.strictEqual(leap[1], "2024-02-29");
  assert.strictEqual(leap[2], "2024-03-01");

  // 5. workSectionFromItems
  const ws = workSectionFromItems([
    { task: "철근 가공" },
    { task: "거푸집 설치" },
    { task: "철근 가공" }
  ]);
  assert.strictEqual(ws, "철근 가공 / 거푸집 설치");
  assert.strictEqual(workSectionFromItems([{ task: "A".repeat(250) }]).length, 200);

  // 6. addDays (DR-24 달력 경계)
  const { addDays } = require("../src/js/schedule");
  assert.strictEqual(addDays("2026-11-30", 1), "2026-12-01");
  assert.strictEqual(addDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(addDays("2026-02-28", 1), "2026-03-01");
  assert.strictEqual(addDays("2024-02-28", 1), "2024-02-29");
  assert.strictEqual(addDays("2024-02-29", 1), "2024-03-01");
  assert.strictEqual(addDays("2026-11-18", -7), "2026-11-11");
  assert.strictEqual(addDays("2026-11-18", 31), "2026-12-19");
  assert.strictEqual(addDays("2026-11-18", 0), "2026-11-18");
  assert.strictEqual(addDays("2026-11-18", "abc"), "2026-11-18");

  console.log("schedule.test.js: all tests passed");
}

runTests();
