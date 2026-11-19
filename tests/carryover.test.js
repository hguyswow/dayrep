const assert = require("assert");
const {
  DEFAULT_EDU_TEMPLATE,
  createDefaultSettings,
  findNearestPreviousDate,
  buildDayFromCarryover
} = require("../src/js/carryover.js");

function runTests() {
  // 1. 가장 가까운 이전 날짜 탐색
  const days = [
    { date: "2026-11-20", hasPdf: false, photoCount: 0 },
    { date: "2026-11-15", hasPdf: true, photoCount: 6 },
    { date: "2026-11-17", hasPdf: true, photoCount: 4 },
    { date: "2026-11-18", hasPdf: false, photoCount: 0 }
  ];
  assert.strictEqual(findNearestPreviousDate("2026-11-18", days), "2026-11-17");
  assert.strictEqual(findNearestPreviousDate("2026-11-16", ["2026-11-15", "2026-11-18"]), "2026-11-15");
  assert.strictEqual(findNearestPreviousDate("2026-11-15", days), null);
  assert.strictEqual(findNearestPreviousDate("invalid", days), null);

  // 2. 전일 데이터 이월 및 사진/점검체크 초기화 확인
  const settings = createDefaultSettings({
    siteName: "OO역세권 공사",
    safetyOfficerName: "강민호",
    defaultEduPlace: "현장"
  });
  const prevDay = {
    schemaVersion: 1,
    date: "2026-11-17",
    eduLog: {
      categories: [
        { name: "장비기사", count: 2 },
        { name: "기공", count: 5 },
        { name: "일반공", count: 3 },
        { name: "현장관리자", count: 8 }
      ],
      mode: "sum",
      absorbIdx: 2,
      performed: 18,
      femaleCount: 1,
      workType: "보도육교 앙카설치",
      contents: "1. 커스텀 교육내용",
      duration: "20분",
      materials: "-",
      place: "현장",
      instructorRole: "안전관리자",
      instructorName: "강민호",
      absentReason: "전날 병가 1명",
      extraEduCheck: "완료"
    },
    tbmPhotos: {
      place: "현장내",
      photos: ["01.jpg", "02.jpg"]
    },
    patrol: {
      weather: "비",
      weeklyFocus: "장비 협착 예방",
      checks: ["미흡", "양호"],
      zeroAccidentPrev: 1200,
      zeroAccidentToday: 8,
      notes: "전날 특이사항"
    },
    crane: {
      checks: ["불량"],
      actionNotes: "전날 조치사항"
    },
    tbmLog: {
      workSection: "A구간",
      riskRows: [{ no: 1 }],
      workers: [{ name: "홍길동" }],
      opinion: "의견 있음"
    }
  };

  const carried = buildDayFromCarryover("2026-11-18", prevDay, settings);
  assert.strictEqual(carried.date, "2026-11-18");
  assert.strictEqual(carried.carriedFrom, "2026-11-17");
  // 이월 항목 검증
  assert.strictEqual(carried.eduLog.workType, "보도육교 앙카설치");
  assert.strictEqual(carried.eduLog.contents, "1. 커스텀 교육내용");
  assert.strictEqual(carried.eduLog.performed, 18);
  assert.strictEqual(carried.eduLog.categories[0].count, 2);
  assert.strictEqual(carried.patrol.weeklyFocus, "장비 협착 예방");
  assert.strictEqual(carried.patrol.zeroAccidentPrev, 1208);

  // 초기화 항목 검증
  assert.deepStrictEqual(carried.tbmPhotos.photos, []);
  assert.strictEqual(carried.patrol.checks.length, 20);
  assert.strictEqual(carried.patrol.checks[0].result, "good");
  assert.strictEqual(carried.patrol.zeroAccidentToday, 0);
  assert.strictEqual(carried.patrol.notes, "");
  assert.strictEqual(carried.crane.checks.length, 20);
  assert.strictEqual(carried.crane.checks[0].result, "good");
  assert.strictEqual(carried.tbmLog.workers.length, 30);
  assert.strictEqual(carried.tbmLog.workers[0].name, "");
  assert.strictEqual(carried.tbmLog.riskRows.length, 4);
  assert.strictEqual(carried.eduLog.absentReason, "");

  // 4. settings.workers 명단 기본값 및 유지
  assert.deepStrictEqual(settings.workers, []);
  const sWithWorkers = createDefaultSettings({
    workers: [{ role: "철근공", name: "김철수" }]
  });
  assert.strictEqual(sWithWorkers.workers.length, 1);
  assert.strictEqual(sWithWorkers.workers[0].name, "김철수");

  // 5. siteContext 이월 (작업일보 초기화, 장비메모 이월) 및 ai/construction 기본값
  assert.strictEqual(settings.ai.engine, "hermes");
  assert.strictEqual(settings.ai.hermesEndpoint, "http://127.0.0.1:7860/api/generate");
  assert.strictEqual(settings.ai.endpoints.lmstudio.baseUrl, "http://localhost:1234/v1");
  const prevWithCtx = {
    ...prevDay,
    siteContext: {
      dailyReportText: "어제 작업일보 내용(이월 안됨)",
      workEquipmentMemo: "25톤 크레인(이월됨)"
    }
  };
  const carriedCtx = buildDayFromCarryover("2026-11-18", {
    ...prevWithCtx,
    eduLog: { ...prevWithCtx.eduLog, absent: { total: 3, male: 3, female: 0, manual: true } }
  }, settings);
  assert.strictEqual(carriedCtx.siteContext.dailyReportText, "");
  assert.strictEqual(carriedCtx.siteContext.workEquipmentMemo, "25톤 크레인(이월됨)");
  assert.deepStrictEqual(carriedCtx.eduLog.absent, { total: 0, male: 0, female: 0, manual: false });

  // 3. 전일 데이터가 없을 때 settings 기본값 적용
  const fresh = buildDayFromCarryover("2026-11-10", null, settings);
  assert.strictEqual(fresh.carriedFrom, null);
  assert.strictEqual(fresh.eduLog.performed, 15);
  assert.strictEqual(fresh.eduLog.contents, DEFAULT_EDU_TEMPLATE);
  assert.strictEqual(fresh.eduLog.instructorName, "강민호");

  // 4. printDocs 정규화 (DR-21)
  assert.deepStrictEqual(settings.printDocs, {
    doc1: true,
    doc2: true,
    doc3: true,
    doc4: true,
    doc5: true
  });
  const partialPrint = createDefaultSettings({ printDocs: { doc4: false, doc2: "invalid" } });
  assert.deepStrictEqual(partialPrint.printDocs, {
    doc1: true,
    doc2: true,
    doc3: true,
    doc4: false,
    doc5: true
  });
  const allFalsePrint = createDefaultSettings({
    printDocs: { doc1: false, doc2: false, doc3: false, doc4: false, doc5: false }
  });
  assert.deepStrictEqual(allFalsePrint.printDocs, {
    doc1: true,
    doc2: true,
    doc3: true,
    doc4: true,
    doc5: true
  });

  // 5. patrolDefaultResult (DR-26)
  assert.strictEqual(settings.patrolDefaultResult, "good");
  const invalidPatrolDef = createDefaultSettings({ patrolDefaultResult: "unknown" });
  assert.strictEqual(invalidPatrolDef.patrolDefaultResult, "good");
  const blankPatrolSettings = createDefaultSettings({ patrolDefaultResult: "blank" });
  assert.strictEqual(blankPatrolSettings.patrolDefaultResult, "blank");
  const blankDay = buildDayFromCarryover("2026-11-19", prevDay, blankPatrolSettings);
  assert.strictEqual(blankDay.patrol.checks.length, 20);
  assert.ok(blankDay.patrol.checks.every((c) => c.result === ""));
  const goodDay = buildDayFromCarryover("2026-11-19", prevDay, settings);
  assert.strictEqual(goodDay.patrol.checks.filter((c) => c.result === "good").length, 18);

  // 6. riskLibraryAssist (DR-31)
  assert.strictEqual(settings.riskLibraryAssist, true);
  assert.strictEqual(createDefaultSettings({ riskLibraryAssist: false }).riskLibraryAssist, false);

  console.log("carryover.test.js: all tests passed");
}

runTests();
