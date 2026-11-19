const assert = require("assert");
const { calcHeadcount, calcPatrolHeadcount, calcAbsent } = require("../src/js/headcount.js");

function makeBaseState() {
  return {
    categories: [
      { name: "장비기사", count: 1 },
      { name: "기공", count: 4 },
      { name: "일반공", count: 1 },
      { name: "현장관리자", count: 9 }
    ],
    mode: "sum",
    absorbIdx: 2, // 일반공
    performed: 15,
    femaleCount: 0
  };
}

function runTests() {
  // 1. sum, 구분 1/4/1/9 초기 -> 실시 15, 교육대상 15, 미실시 0
  const r1 = calcHeadcount(makeBaseState(), { type: "init" });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.summary.performedTotal, 15);
  assert.strictEqual(r1.summary.targetTotal, 15);
  assert.strictEqual(r1.summary.absentTotal, 0);
  assert.strictEqual(r1.summary.performedMale, 15);
  assert.strictEqual(r1.summary.performedFemale, 0);

  // 2. sum, 일반공 1->3 -> 실시 17
  const r2 = calcHeadcount(r1.state, { type: "updateCategory", index: 2, count: 3 });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.summary.performedTotal, 17);
  assert.strictEqual(r2.summary.targetTotal, 17);

  // 3. fixed 실시=15, absorb=일반공, 기공 4->6 -> 일반공 -1 -> 0으로 막고 경고(기공은 5까지만 허용)
  const fixedBase = { ...makeBaseState(), mode: "fixed", performed: 15 };
  const r3 = calcHeadcount(fixedBase, { type: "updateCategory", index: 1, count: 6 });
  assert.strictEqual(r3.ok, false);
  assert.ok(r3.warning && r3.warning.includes("5"));
  assert.strictEqual(r3.state.categories[1].count, 4);
  assert.strictEqual(r3.state.categories[2].count, 1);

  // 4. fixed 실시=15, absorb=일반공(1), 기공 4->3 -> 일반공 2, 합 15
  const r4 = calcHeadcount(fixedBase, { type: "updateCategory", index: 1, count: 3 });
  assert.strictEqual(r4.ok, true);
  assert.strictEqual(r4.state.categories[1].count, 3);
  assert.strictEqual(r4.state.categories[2].count, 2);
  assert.strictEqual(r4.summary.targetTotal, 15);
  assert.strictEqual(r4.summary.performedTotal, 15);

  // 5. sum, 실시인원 직접 14 입력 -> mode=fixed, absorb 구분 보정해 합 14, 미실시 0
  const r5 = calcHeadcount(makeBaseState(), { type: "setPerformed", value: 14 });
  assert.strictEqual(r5.ok, true);
  assert.strictEqual(r5.state.mode, "fixed");
  assert.strictEqual(r5.state.performed, 14);
  assert.strictEqual(r5.state.categories[2].count, 0);
  assert.strictEqual(r5.summary.targetTotal, 14);
  assert.strictEqual(r5.summary.absentTotal, 0);

  // 6. fixed -> "합산으로 되돌리기" -> mode=sum, 실시=Σ
  const r6 = calcHeadcount(r5.state, { type: "revertToSum" });
  assert.strictEqual(r6.ok, true);
  assert.strictEqual(r6.state.mode, "sum");
  assert.strictEqual(r6.summary.performedTotal, 14);

  // 7. absorb 구분 삭제 -> absorb 자동으로 마지막 구분으로 이동
  const r7 = calcHeadcount(makeBaseState(), { type: "deleteCategory", index: 2 });
  assert.strictEqual(r7.ok, true);
  assert.strictEqual(r7.state.categories.length, 3);
  assert.strictEqual(r7.state.absorbIdx, 2); // 마지막 구분(현장관리자)

  // 8. 순회점검 계=15, 직원9 직영1 근로자5 -> 직영 1->3 -> 근로자 3
  const pBase = { total: 15, staff: 9, direct: 1, worker: 5 };
  const r8 = calcPatrolHeadcount(pBase, { type: "setDirect", value: 3 });
  assert.strictEqual(r8.ok, true);
  assert.strictEqual(r8.state.direct, 3);
  assert.strictEqual(r8.state.worker, 3);

  // 9. 순회점검 계=15, 직원9 -> 직영 입력으로 합 초과(직영 7) -> 근로자 0에서 막고 경고
  const r9 = calcPatrolHeadcount(pBase, { type: "setDirect", value: 7 });
  assert.strictEqual(r9.ok, false);
  assert.ok(r9.warning);
  assert.strictEqual(r9.state.direct, 1);
  assert.strictEqual(r9.state.worker, 5);

  // 10. DR-11: 교육대상 계 직접 입력 (sum 모드 15->18 -> 흡수 구분 일반공 1->4, 실시 18)
  const r10 = calcHeadcount(makeBaseState(), { type: "setTargetTotal", value: 18 });
  assert.strictEqual(r10.ok, true);
  assert.strictEqual(r10.state.categories[2].count, 4);
  assert.strictEqual(r10.summary.targetTotal, 18);
  assert.strictEqual(r10.summary.performedTotal, 18);

  // 11. DR-11: 교육대상 계 입력 시 나머지 합보다 작아 음수 방지
  const r11 = calcHeadcount(makeBaseState(), { type: "setTargetTotal", value: 10 });
  assert.strictEqual(r11.ok, false);
  assert.ok(r11.warning);
  assert.strictEqual(r11.summary.targetTotal, 15);

  // 12. DR-11: fixed 모드(실시=15)에서 교육대상 계 17 입력 -> 실시 15 유지, 일반공 3, 미실시 2
  const r12 = calcHeadcount(fixedBase, { type: "setTargetTotal", value: 17 });
  assert.strictEqual(r12.ok, true);
  assert.strictEqual(r12.summary.performedTotal, 15);
  assert.strictEqual(r12.state.categories[2].count, 3);
  assert.strictEqual(r12.summary.absentTotal, 2);

  // fixed 모드(실시=15)에서 교육대상 계 14 입력 -> 실시보다 작으므로 모순 경고 후 막음
  const r12Bad = calcHeadcount(fixedBase, { type: "setTargetTotal", value: 14 });
  assert.strictEqual(r12Bad.ok, false);
  assert.ok(r12Bad.warning);
  assert.strictEqual(r12Bad.summary.targetTotal, 15);

  // 13. DR-11: calcAbsent 독립 입력 및 자동 되돌리기
  const aAuto = calcAbsent(undefined, { absentTotal: 2, absentMale: 2, absentFemale: 0 }, { type: "init" });
  assert.strictEqual(aAuto.state.manual, false);
  assert.strictEqual(aAuto.state.total, 2);

  const aManual = calcAbsent(aAuto.state, { absentTotal: 2, absentMale: 2, absentFemale: 0 }, { type: "setTotal", value: 5 });
  assert.strictEqual(aManual.state.manual, true);
  assert.strictEqual(aManual.state.total, 5);
  assert.strictEqual(aManual.state.male, 5);

  // 이후 summary가 바뀌어도 manual=true면 독립 유지
  const aPersist = calcAbsent(aManual.state, { absentTotal: 0, absentMale: 0, absentFemale: 0 }, { type: "init" });
  assert.strictEqual(aPersist.state.manual, true);
  assert.strictEqual(aPersist.state.total, 5);

  const aReset = calcAbsent(aPersist.state, { absentTotal: 1, absentMale: 1, absentFemale: 0 }, { type: "resetAuto" });
  assert.strictEqual(aReset.state.manual, false);
  assert.strictEqual(aReset.state.total, 1);

  console.log("headcount.test.js: all 13 tests passed");
}

runTests();
