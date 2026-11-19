const assert = require("assert");
const rl = require("../src/js/risk_library");

function runTests() {
  // 1. 키 정규화 및 완성 행 검사
  assert.strictEqual(rl.makeKey("25톤 크레인!", "인양물 낙하 (줄걸이)"), "25톤크레인|인양물낙하줄걸이");
  assert.strictEqual(rl.isCompleteRow({ item: "크레인", hazard: "낙하", measure: "출입통제" }), true);
  assert.strictEqual(rl.isCompleteRow({ item: "", hazard: "낙하", measure: "출입통제" }), false);
  assert.strictEqual(rl.isCompleteRow({ item: "크레인", hazard: "낙하", measure: "" }), false);

  // 2. 정규화: 길이 제한, level 보정, XSS 문자열 보존
  const longEntry = rl.normalizeEntry({
    category: "가".repeat(40),
    item: "<script>alert(1)</script>" + "A".repeat(60),
    hazard: "위험".repeat(120),
    type: "추락",
    level: "이상한값",
    measure: "대책"
  });
  assert.strictEqual(longEntry.category.length, 30);
  assert.strictEqual(longEntry.item.length, 60);
  assert.ok(longEntry.item.startsWith("<script>alert(1)</script>"));
  assert.strictEqual(longEntry.hazard.length, 200);
  assert.strictEqual(longEntry.level, "중");

  // 3. addRows: 완성 행만 추가, 중복 병합(useCount+1)
  const emptyLib = rl.normalizeLibrary({});
  const r1 = rl.addRows(
    emptyLib,
    [
      { item: "25톤 크레인", hazard: "줄걸이 파단", type: "낙하", level: "상", measure: "와이어 점검" },
      { item: "", hazard: "빈 행", measure: "무시" }
    ],
    { category: "토목공사", source: "ai", now: "2026-11-18T01:00:00Z" }
  );
  assert.strictEqual(r1.added, 1);
  assert.strictEqual(r1.merged, 0);
  assert.strictEqual(r1.library.entries.length, 1);
  assert.strictEqual(r1.library.entries[0].useCount, 1);

  const r2 = rl.addRows(
    r1.library,
    [{ item: "25톤 크레인!", hazard: "줄걸이-파단", type: "낙하", level: "상", measure: "새 대책" }],
    { category: "다른공종", source: "ai", now: "2026-11-18T02:00:00Z" }
  );
  assert.strictEqual(r2.added, 0);
  assert.strictEqual(r2.merged, 1);
  assert.strictEqual(r2.library.entries.length, 1);
  assert.strictEqual(r2.library.entries[0].useCount, 2);
  assert.strictEqual(r2.library.entries[0].lastUsedAt, "2026-11-18T02:00:00Z");
  assert.strictEqual(r2.library.entries[0].measure, "와이어 점검");

  // 4. query / listCategories / updateEntry / setCategory / deleteEntry
  const r3 = rl.addRows(
    r2.library,
    [
      { item: "용접기", hazard: "감전 위험", type: "감전", level: "중", measure: "접지 확인" },
      { item: "전동드릴", hazard: "회전체 끼임", type: "협착", level: "하", measure: "장갑 주의" }
    ],
    { category: "철골공사", source: "manual", now: "2026-11-18T03:00:00Z" }
  );
  const cats = rl.listCategories(r3.library);
  assert.strictEqual(cats[0].category, "철골공사");
  assert.strictEqual(cats[0].count, 2);

  const qRes = rl.query(r3.library, { category: "전체", q: "감전" });
  assert.strictEqual(qRes.length, 1);
  assert.strictEqual(qRes[0].item, "용접기");

  const qItemBoost = rl.query(r3.library, { item: "크레인" });
  assert.strictEqual(qItemBoost[0].item, "25톤 크레인");

  const dupFail = rl.updateEntry(r3.library, r3.library.entries[1].id, {
    item: "25톤 크레인",
    hazard: "줄걸이 파단"
  });
  assert.strictEqual(dupFail.ok, false);

  const updated = rl.updateEntry(r3.library, r3.library.entries[1].id, {
    measure: "누전차단기 점검"
  });
  assert.strictEqual(updated.ok, true);
  assert.strictEqual(updated.library.entries[1].measure, "누전차단기 점검");

  const reCat = rl.setCategory(updated.library, [r3.library.entries[1].id, r3.library.entries[2].id], "기계설비");
  assert.strictEqual(reCat.entries.filter((e) => e.category === "기계설비").length, 2);

  const deleted = rl.deleteEntry(reCat, r3.library.entries[1].id);
  assert.strictEqual(deleted.entries.length, 2);

  // 5. 상한 5000건 초과 시 오래되고 적게 쓰인 항목 정리 확인
  const manyEntries = [];
  for (let i = 0; i < 5000; i++) {
    manyEntries.push({
      id: "id_" + i,
      category: "테스트",
      item: "장비" + i,
      hazard: "위험" + i,
      type: "추락",
      level: "중",
      measure: "대책" + i,
      source: "ai",
      useCount: i === 0 ? 1 : 5,
      createdAt: "2026-01-01T00:00:00Z",
      lastUsedAt: i === 0 ? "2025-01-01T00:00:00Z" : "2026-11-01T00:00:00Z"
    });
  }
  const overRes = rl.addRows(
    { schemaVersion: 1, entries: manyEntries },
    [{ item: "신규장비", hazard: "신규위험", measure: "신규대책" }],
    { category: "테스트", source: "ai", now: "2026-11-18T05:00:00Z" }
  );
  assert.strictEqual(overRes.library.entries.length, 5000);
  assert.ok(!overRes.library.entries.some((e) => e.id === "id_0"));
  assert.ok(overRes.library.entries.some((e) => e.item === "신규장비"));

  // Rust <-> JS IPC parameter key contract check
  const fs = require("fs");
  const path = require("path");
  const libRs = fs.readFileSync(path.join(__dirname, "..", "src-tauri", "src", "lib.rs"), "utf8");
  const appJs = fs.readFileSync(path.join(__dirname, "..", "src", "js", "app.js"), "utf8");
  const saveSig = libRs.match(/fn\s+save_risk_library\s*\(([^)]*)\)/);
  assert.ok(saveSig, "save_risk_library signature should exist in lib.rs");
  assert.ok(/\blibrary\s*:\s*Value\b/.test(saveSig[1]), "save_risk_library Rust param must be library: Value");
  assert.ok(/invoke\(\s*["']save_risk_library["']\s*,\s*\{\s*library\s*:/.test(appJs), "app.js must invoke save_risk_library with { library: ... }");

  const loadSig = libRs.match(/fn\s+load_risk_library\s*\(([^)]*)\)/);
  assert.ok(loadSig, "load_risk_library signature should exist in lib.rs");
  assert.strictEqual(loadSig[1].trim(), "app: tauri::AppHandle", "load_risk_library must take only app: tauri::AppHandle");
  assert.ok(/invoke\(\s*["']load_risk_library["']\s*\)/.test(appJs), "app.js must invoke load_risk_library with no payload args");

  // DR-31: pickExamples scoring (category > tool > workSection keywords > useCount/lastUsedAt) & bumpUsage
  assert.deepStrictEqual(rl.pickExamples({ schemaVersion: 1, entries: [] }, { category: "철골", tool: "크레인" }), []);
  const pickLib = {
    schemaVersion: 1,
    entries: [
      { id: "p1", category: "토공", item: "굴착기", hazard: "협착", type: "끼임", level: "상", measure: "신호수 배치", useCount: 10, lastUsedAt: "2026-11-18T01:00:00Z" },
      { id: "p2", category: "철골", item: "이동식크레인", hazard: "인양물 낙하", type: "떨어짐", level: "상", measure: "하부 출입통제", useCount: 2, lastUsedAt: "2026-11-18T02:00:00Z" },
      { id: "p3", category: "철골", item: "용접기", hazard: "화재", type: "화재", level: "중", measure: "소화기 비치", useCount: 5, lastUsedAt: "2026-11-18T03:00:00Z" },
      { id: "p4", category: "철골", item: "그라인더", hazard: "비래", type: "맞음", level: "중", measure: "보안경 착용", useCount: 1, lastUsedAt: "2026-11-18T04:00:00Z" }
    ]
  };
  const picked = rl.pickExamples(pickLib, { category: "철골", tool: "이동식크레인", workSection: "철골 양중 및 용접", limit: 20 });
  assert.strictEqual(picked.length, 4);
  assert.strictEqual(picked[0].item, "이동식크레인"); // category + tool exact match highest
  assert.strictEqual(picked[1].item, "용접기"); // category + workSection keyword + higher useCount
  assert.deepStrictEqual(Object.keys(picked[0]).sort(), ["hazard", "item", "level", "measure", "type"]);

  // cap at 8
  const manyPickLib = {
    schemaVersion: 1,
    entries: Array.from({ length: 12 }, (_, idx) => ({
      id: "m" + idx, category: "공통", item: "장비" + idx, hazard: "위험" + idx, type: "떨어짐", level: "중", measure: "대책" + idx, useCount: idx + 1, lastUsedAt: "2026-11-18T00:00:00Z"
    }))
  };
  assert.strictEqual(rl.pickExamples(manyPickLib, { limit: 12 }).length, 8);

  const bumped = rl.bumpUsage(pickLib, ["p2"], "2026-11-18T09:00:00Z");
  const bumpedP2 = bumped.entries.find((e) => e.id === "p2");
  assert.strictEqual(bumpedP2.useCount, 3);
  assert.strictEqual(bumpedP2.lastUsedAt, "2026-11-18T09:00:00Z");

  // DR-34: diffChangedCompleteRows (only changed complete rows, skip unchanged & incomplete)
  const initialRows = [
    { item: "크레인", hazard: "낙하", type: "떨어짐", level: "상", measure: "통제" },
    { item: "비계", hazard: "", type: "", level: "중", measure: "" }
  ];
  const baseSet = rl.collectCompleteSignatures(initialRows);
  assert.strictEqual(baseSet.size, 1);

  const unchangedDiff = rl.diffChangedCompleteRows(initialRows, baseSet);
  assert.strictEqual(unchangedDiff.changedRows.length, 0);

  const editedRows = [
    { item: "크레인", hazard: "낙하", type: "떨어짐", level: "상", measure: "통제" },
    { item: "비계", hazard: "전도", type: "넘어짐", level: "중", measure: "아웃트리거 고정" },
    { item: "용접기", hazard: "화재", type: "화재", level: "중", measure: "" } // incomplete
  ];
  const editedDiff = rl.diffChangedCompleteRows(editedRows, baseSet);
  assert.strictEqual(editedDiff.changedRows.length, 1);
  assert.strictEqual(editedDiff.changedRows[0].item, "비계");
  const repeatDiff = rl.diffChangedCompleteRows(editedRows, editedDiff.nextBaseline);
  assert.strictEqual(repeatDiff.changedRows.length, 0);

  console.log("risk_library.test.js: all tests passed");
}

runTests();
