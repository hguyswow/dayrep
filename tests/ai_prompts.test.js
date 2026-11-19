const assert = require("assert");
const {
  buildEduPrompt,
  parseEduResponse,
  mergeAppendEduContents,
  buildRiskPrompt,
  parseRiskResponse,
  buildToolPrompt,
  parseToolResponse,
  buildRiskRowPrompt,
  parseRiskRowResponse,
  buildMeasurePrompt,
  parseMeasureResponse
} = require("../src/js/ai_prompts.js");

function runTests() {
  // 1. 프롬프트 빌더 및 개인정보 제외 검증
  const prompt = buildEduPrompt(
    {
      siteName: "OO역세권 도시시설물 공사",
      construction: {
        projectName: "OO역세권 보도육교 설치공사",
        overview: "보도육교 기초 및 강재 거더 거치",
        processes: [
          { name: "앙카 설치", progress: 45, equipment: "카고크레인", memo: "협소 구간" }
        ],
        seasonWeatherMemo: "동절기 결빙 주의"
      },
      workers: [{ role: "철근공", name: "홍길동SECRET" }],
      stamps: { director: "BASE64STAMP" }
    },
    {
      date: "2026-11-18",
      weather: "맑음",
      workType: "보도육교 앙카설치",
      siteContext: {
        dailyReportText: "금일 크레인 1대 반입, 앙카볼트 천공 작업",
        workEquipmentMemo: "25톤 크레인, 전동해머드릴"
      },
      prevEduContents: "1. 전날 교육내용"
    }
  );
  assert.ok(prompt.includes("OO역세권 보도육교 설치공사"));
  assert.ok(prompt.includes("앙카 설치 (공정률 45%)"));
  assert.ok(prompt.includes("25톤 크레인"));
  assert.ok(!prompt.includes("홍길동SECRET"), "근로자 성명은 프롬프트에 포함되면 안 됨");
  assert.ok(!prompt.includes("BASE64STAMP"), "도장 데이터는 프롬프트에 포함되면 안 됨");

  // 2. 정상 6줄 응답 파싱
  const r1 = parseEduResponse([
    "1. 동절기 노면 결빙 구간 미끄럼 방지 조치 후 작업 시작",
    "2. 25톤 크레인 작업 반경 내 신호수 배치 및 출입 통제",
    "3. 전동해머드릴 사용 전 절연 상태 및 접지 확인",
    "4. 협소 구간 자재 운반 시 2인 1조 및 유도자 배치",
    "5. 고소 작업 시 안전대 착용 및 2중 안전고리 체결",
    "6. 안전모·안전화 등 개인보호구 착용 철저"
  ].join("\n"));
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.lines.length, 6);

  // 3. 코드펜스 + 머리말 + 글머리(-) 정규화
  const r2 = parseEduResponse([
    "다음은 요청하신 안전교육 내용입니다:",
    "```text",
    "- 첫째 줄 점검",
    "- 둘째 줄 점검",
    "* 셋째 줄 점검",
    "4) 넷째 줄 점검",
    "5. 다섯째 줄 점검",
    "```"
  ].join("\n"));
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.lines.length, 5);
  assert.strictEqual(r2.lines[0], "1. 첫째 줄 점검");
  assert.strictEqual(r2.lines[3], "4. 넷째 줄 점검");

  // 4. 빈 응답 실패
  const rEmpty = parseEduResponse("   \n  ");
  assert.strictEqual(rEmpty.ok, false);
  assert.ok(rEmpty.retryHint);

  // 5. 줄 수 부족(2줄) 실패 + retryHint
  const rShort = parseEduResponse("1. 한 줄\n2. 두 줄");
  assert.strictEqual(rShort.ok, false);
  assert.ok(rShort.retryHint);

  // 6. 너무 긴 줄 경고
  const longLine = "1. " + "가".repeat(105);
  const rLong = parseEduResponse([longLine, "2. b", "3. c", "4. d", "5. e"].join("\n"));
  assert.strictEqual(rLong.ok, true);
  assert.ok(rLong.warnings.length >= 1);

  // 7. buildRiskPrompt 개인정보 제외 및 필수 항목 포함 검증
  const riskPrompt = buildRiskPrompt(
    {
      siteName: "강일 신축공사",
      construction: {
        seasonWeatherMemo: "한파 결빙 주의",
        processes: [{ name: "가시설", progress: 30, equipment: "굴착기", memo: "" }]
      },
      workers: [{ role: "철근공", name: "김비밀WORKER" }],
      stamps: { director: "STAMP_SECRET" }
    },
    {
      date: "2026-11-18",
      weather: "눈",
      workSection: "A구역 토류판 설치",
      workType: "가시설"
    }
  );
  assert.ok(riskPrompt.includes("A구역 토류판 설치"));
  assert.ok(riskPrompt.includes("한파 결빙 주의"));
  assert.ok(!riskPrompt.includes("김비밀WORKER"));
  assert.ok(!riskPrompt.includes("STAMP_SECRET"));

  // 8. parseRiskResponse: 코드펜스 + 앞뒤 잡설 + level 변형 + 표준 외 재해형태 경고
  const rRisk1 = parseRiskResponse([
    "아래는 요청하신 JSON입니다:",
    "```json",
    JSON.stringify([
      { tool: "굴착기", hazard: "회전반경 내 근로자 협착", accident: "협착", level: "높음", measure: "신호수 배치 및 출입 통제" },
      { tool: "고소작업대", hazard: "결빙 노면 미끄러짐", accident: "넘어짐", level: "M", measure: "제설 및 미끄럼방지 조치" },
      { tool: "용접기", hazard: "전선 피복 손상 감전", accident: "감전", level: "low", measure: "절연 확인 및 누전차단기 점검" }
    ]),
    "```",
    "참고로 확인 바랍니다."
  ].join("\n"));
  assert.strictEqual(rRisk1.ok, true);
  assert.strictEqual(rRisk1.rows.length, 3);
  assert.strictEqual(rRisk1.rows[0].level, "상");
  assert.strictEqual(rRisk1.rows[1].level, "중");
  assert.strictEqual(rRisk1.rows[2].level, "하");

  // 9. 잘린 JSON / 빈 응답 실패
  const rRiskBroken = parseRiskResponse('[{"tool":"크레인"');
  assert.strictEqual(rRiskBroken.ok, false);
  assert.ok(rRiskBroken.retryHint);

  const rRiskEmpty = parseRiskResponse("");
  assert.strictEqual(rRiskEmpty.ok, false);

  // 10. HTML/스크립트 문자열 포함 시 크래시 없이 문자열 보존 + 행 수/비표준 경고
  const rRiskXss = parseRiskResponse(JSON.stringify([
    { tool: "<script>alert(1)</script>", hazard: "<b>위험</b>", accident: "특수재해", level: "상", measure: "안전조치" }
  ]));
  assert.strictEqual(rRiskXss.ok, true);
  assert.strictEqual(rRiskXss.rows[0].tool, "<script>alert(1)</script>");
  assert.ok(rRiskXss.warnings.length >= 2);

  // 11. DR-12: buildEduPrompt 모드(improve/append) + aiNote + 참조 체크 + parseEduResponse(append)
  const improvePrompt = buildEduPrompt(
    { siteName: "테스트현장", construction: { overview: "기초공사" }, workers: [{ name: "홍길동SECRET" }] },
    {
      mode: "improve",
      useConstruction: false,
      useDailyContext: true,
      useRecentEdu: false,
      aiNote: "내일 강풍 예보, 굴착기 2대 투입",
      currentContents: "1. 기존 내용",
      prevEduContents: "1. 전일 내용(미포함)",
      siteContext: { dailyReportText: "당일 작업일보" }
    }
  );
  assert.ok(improvePrompt.includes("개선"));
  assert.ok(improvePrompt.includes("내일 강풍 예보"));
  assert.ok(improvePrompt.includes("당일 작업일보"));
  assert.ok(!improvePrompt.includes("기초공사"));
  assert.ok(!improvePrompt.includes("전일 내용(미포함)"));
  assert.ok(!improvePrompt.includes("홍길동SECRET"));

  const appendParsed = parseEduResponse("1. 강풍 시 크레인 작업 중지\n2. 비계 결속 상태 재확인", "append");
  assert.strictEqual(appendParsed.ok, true);
  assert.strictEqual(appendParsed.lines.length, 2);

  const appendTooLong = parseEduResponse("1. a\n2. b\n3. c\n4. d\n5. e", "append");
  assert.strictEqual(appendTooLong.ok, false);

  const merged = mergeAppendEduContents("1. 기존1\n2. 기존2", appendParsed.lines);
  assert.strictEqual(merged, "1. 기존1\n2. 기존2\n3. 강풍 시 크레인 작업 중지\n4. 비계 결속 상태 재확인");

  // 12. DR-13: buildToolPrompt / parseToolResponse (개인정보 제외, 중복 회피)
  const toolPrompt = buildToolPrompt(
    { siteName: "테스트현장", workers: [{ name: "홍길동SECRET" }] },
    { workSection: "A구역", existingTools: ["굴착기"] }
  );
  assert.ok(toolPrompt.includes("굴착기"));
  assert.ok(!toolPrompt.includes("홍길동SECRET"));
  const tParsed = parseToolResponse('```text\n"카고크레인"\n```');
  assert.strictEqual(tParsed.ok, true);
  assert.strictEqual(tParsed.tool, "카고크레인");

  // 13. DR-13: buildRiskRowPrompt / parseRiskRowResponse (장비 포함, 코드펜스/잡설, level 변형, 잘린 JSON, XSS 보존)
  const rowPrompt = buildRiskRowPrompt(
    { siteName: "테스트현장", workers: [{ name: "김비밀WORKER" }], stamps: { d: "STAMP" } },
    { tool: "굴착기", workSection: "B구역" }
  );
  assert.ok(rowPrompt.includes("굴착기"));
  assert.ok(!rowPrompt.includes("김비밀WORKER"));
  assert.ok(!rowPrompt.includes("STAMP"));

  const rowOk = parseRiskRowResponse([
    "설명:",
    "```json",
    '{"hazard":"굴착기 후방 근로자 협착","accident":"협착","level":"높음","measure":"신호수 배치 및 출입 통제"}',
    "```"
  ].join("\n"));
  assert.strictEqual(rowOk.ok, true);
  assert.strictEqual(rowOk.row.level, "상");
  assert.strictEqual(rowOk.row.accident, "협착");

  const rowBroken = parseRiskRowResponse('{"hazard":"잘린 JSON');
  assert.strictEqual(rowBroken.ok, false);
  assert.ok(rowBroken.retryHint);

  const rowXss = parseRiskRowResponse('{"hazard":"<script>alert(1)</script>","accident":"낙하","level":"low","measure":"안전망"}');
  assert.strictEqual(rowXss.ok, true);
  assert.strictEqual(rowXss.row.hazard, "<script>alert(1)</script>");
  assert.strictEqual(rowXss.row.level, "하");

  // 14. DR-14: buildMeasurePrompt / parseMeasureResponse
  const mPrompt = buildMeasurePrompt(
    { siteName: "테스트현장", workers: [{ name: "홍길동SECRET" }] },
    { tool: "굴착기", hazard: "후방 협착", accident: "협착", level: "상", workSection: "A구역" }
  );
  assert.ok(mPrompt.includes("굴착기"));
  assert.ok(mPrompt.includes("후방 협착"));
  assert.ok(mPrompt.includes("관리·감독"));
  assert.ok(!mPrompt.includes("홍길동SECRET"));

  const mJson = parseMeasureResponse('```json\n{"measure":"신호수 배치 및 후방 접근 통제"}\n```');
  assert.strictEqual(mJson.ok, true);
  assert.strictEqual(mJson.measure, "신호수 배치 및 후방 접근 통제");

  const mPlain = parseMeasureResponse("작업 전 안전교육 실시 및 안전대 체결");
  assert.strictEqual(mPlain.ok, true);
  assert.strictEqual(mPlain.measure, "작업 전 안전교육 실시 및 안전대 체결");

  const mEmpty = parseMeasureResponse("  ");
  assert.strictEqual(mEmpty.ok, false);

  const mLong = parseMeasureResponse("가".repeat(65));
  assert.strictEqual(mLong.ok, true);
  assert.strictEqual(mLong.measure.length, 65);
  assert.ok(mLong.warnings.length >= 1);

  const mXss = parseMeasureResponse('{"measure":"<img src=x onerror=alert(1)>"}');
  assert.strictEqual(mXss.ok, true);
  assert.strictEqual(mXss.measure, "<img src=x onerror=alert(1)>");

  // 15. DR-17: buildRiskPrompt scheduleItems 포함/미포함 및 개인정보 없음
  const rpWithSch = buildRiskPrompt(
    { siteName: "테스트현장", workers: [{ name: "홍길동SECRET" }] },
    {
      date: "2026-11-18",
      workSection: "A구역",
      scheduleItems: [{ task: "철근 조립", equipment: "크레인", memo: "강풍 주의" }]
    }
  );
  assert.ok(rpWithSch.includes("- 금일 공정표: 철근 조립(크레인) - 강풍 주의"));
  assert.ok(!rpWithSch.includes("홍길동SECRET"));

  const rpWithoutSch = buildRiskPrompt({ siteName: "테스트현장" }, { date: "2026-11-18" });
  assert.ok(!rpWithoutSch.includes("금일 공정표"));

  // 16. DR-31: libraryExamples 포함/미포함 불변, 길이 상한, 개인정보 없음
  const baseRisk = buildRiskPrompt({ siteName: "테스트현장" }, { date: "2026-11-18", workSection: "골조" });
  const emptyLibRisk = buildRiskPrompt({ siteName: "테스트현장" }, { date: "2026-11-18", workSection: "골조", libraryExamples: [] });
  assert.strictEqual(emptyLibRisk, baseRisk);

  const baseRow = buildRiskRowPrompt({ siteName: "테스트현장" }, { tool: "크레인" });
  assert.strictEqual(buildRiskRowPrompt({ siteName: "테스트현장" }, { tool: "크레인", libraryExamples: [] }), baseRow);
  const baseTool = buildToolPrompt({ siteName: "테스트현장" }, { workSection: "골조" });
  assert.strictEqual(buildToolPrompt({ siteName: "테스트현장" }, { workSection: "골조", libraryExamples: [] }), baseTool);
  const baseMeasure = buildMeasurePrompt({ siteName: "테스트현장" }, { tool: "크레인", hazard: "낙하" });
  assert.strictEqual(buildMeasurePrompt({ siteName: "테스트현장" }, { tool: "크레인", hazard: "낙하", libraryExamples: [] }), baseMeasure);

  const longExamples = Array.from({ length: 12 }, (_, i) => ({
    item: "장비" + i + "_".repeat(40),
    hazard: "유해위험" + i + "_".repeat(120),
    type: "떨어짐",
    level: "상",
    measure: "감소대책" + i + "_".repeat(120),
    workerName: "홍길동SECRET_" + i
  }));
  const withLibRisk = buildRiskPrompt(
    { siteName: "테스트현장" },
    { date: "2026-11-18", workSection: "골조", libraryExamples: longExamples }
  );
  assert.ok(withLibRisk.includes("[이 현장에서 이전에 사용한 항목"));
  assert.ok(!withLibRisk.includes("홍길동SECRET"));
  const blockStart = withLibRisk.indexOf("[이 현장에서 이전에 사용한 항목");
  const blockEnd = withLibRisk.indexOf("\n\n[출력 규칙");
  const blockText = withLibRisk.slice(blockStart, blockEnd);
  assert.ok(blockText.length <= 2000, "libraryExamples block must be <= 2000 chars, got " + blockText.length);
  const itemLines = blockText.split("\n").filter((l) => l.startsWith("- 장비:"));
  assert.ok(itemLines.length <= 8 && itemLines.length >= 1);

  // 17. DR-36: rowCount 자동(불변) / N행 지정 / 초과분 절단 및 경고
  assert.strictEqual(buildRiskPrompt({ siteName: "테스트현장" }, { date: "2026-11-18", workSection: "골조", rowCount: "auto" }), baseRisk);
  const p8 = buildRiskPrompt({ siteName: "테스트현장" }, { date: "2026-11-19", workSection: "골조", rowCount: 8 });
  assert.ok(p8.includes("정확히 8행 출력하세요"));

  const sixRowsJson = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
    tool: "장비" + i,
    hazard: "위험" + i,
    accident: "추락",
    level: "중",
    measure: "대책" + i
  })));
  const autoParsed = parseRiskResponse(sixRowsJson);
  assert.strictEqual(autoParsed.rows.length, 6);
  assert.strictEqual(autoParsed.warnings.length, 0);

  const truncParsed = parseRiskResponse(sixRowsJson, { rowCount: 4 });
  assert.strictEqual(truncParsed.ok, true);
  assert.strictEqual(truncParsed.rows.length, 4);
  assert.ok(truncParsed.warnings.some((w) => w.includes("4행까지만 사용")));

  const shortParsed = parseRiskResponse(sixRowsJson, { rowCount: 8 });
  assert.strictEqual(shortParsed.ok, true);
  assert.strictEqual(shortParsed.rows.length, 6);
  assert.ok(shortParsed.warnings.some((w) => w.includes("8행)와 다릅니다")));

  console.log("ai_prompts.test.js: all tests passed");
}

runTests();
