"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const core = require("./dayrep-core");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

function makeTempDataDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dayrep_mcp_test_"));
  fs.mkdirSync(path.join(root, "stamps"), { recursive: true });
  fs.writeFileSync(path.join(root, "stamps", "director.png"), "PNG_SECRET", "utf8");
  fs.writeFileSync(
    path.join(root, "secrets.json"),
    JSON.stringify({ gemini: "AIza-SECRET-KEY" }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "settings.json"),
    JSON.stringify({
      schemaVersion: 1,
      siteName: "테스트 신축공사",
      workers: [{ role: "철근공", name: "홍길동SECRET" }],
      construction: {
        projectName: "테스트 보도육교",
        overview: "기초 및 철골",
        processes: [{ name: "앙카 설치", progress: "50", equipment: "크레인", memo: "" }],
        seasonWeatherMemo: "동절기"
      },
      schedule: {
        items: [
          {
            id: "sch_1",
            start: "2026-11-18",
            end: "2026-11-22",
            task: "교각 기초 철근 배근",
            equipment: "크레인",
            memo: "추락 주의"
          }
        ]
      }
    }),
    "utf8"
  );

  const dayDir = path.join(root, "days", "2026", "11", "2026-11-18");
  fs.mkdirSync(path.join(dayDir, "photos"), { recursive: true });
  fs.writeFileSync(path.join(dayDir, "photos", "01.jpg"), "PHOTO_BYTES", "utf8");
  fs.writeFileSync(
    path.join(dayDir, "data.json"),
    JSON.stringify({
      schemaVersion: 1,
      date: "2026-11-18",
      eduLog: { workType: "앙카설치", contents: "1. 기존 교육내용" },
      patrol: { weather: "맑음", weeklyFocus: "안전모 착용" },
      tbmLog: {
        workSection: "A구역",
        riskRows: [{ item: "기존", hazard: "기존", type: "협착", level: "중", measure: "기존" }],
        workers: [{ role: "철근공", name: "홍길동SECRET" }]
      },
      siteContext: { dailyReportText: "일보 내용", workEquipmentMemo: "크레인" }
    }),
    "utf8"
  );
  return root;
}

async function runTests() {
  const tmpDir = makeTempDataDir();
  try {
    // 1. 날짜 검증 및 경로 이탈 차단
    assert.throws(() => core.validateDate("2026-02-30"));
    assert.throws(() => core.validateDate("../2026-11-18"));
    assert.throws(() => core.getDay(tmpDir, "../evil"));

    // 2. 개인정보/도장/secrets/사진 비노출 확인
    const siteCtx = core.getSiteContext(tmpDir, 5);
    const siteStr = JSON.stringify(siteCtx);
    assert.ok(siteStr.includes("테스트 보도육교"));
    assert.ok(Array.isArray(siteCtx.schedule && siteCtx.schedule.items));
    assert.strictEqual(siteCtx.schedule.items.length, 1);
    assert.strictEqual(siteCtx.schedule.items[0].task, "교각 기초 철근 배근");
    assert.ok(!siteStr.includes("홍길동SECRET"));
    assert.ok(!siteStr.includes("AIza-SECRET-KEY"));
    assert.ok(!siteStr.includes("PNG_SECRET"));

    const dayView = core.getDay(tmpDir, "2026-11-18");
    const dayStr = JSON.stringify(dayView);
    assert.strictEqual(dayView.exists, true);
    assert.ok(!dayStr.includes("홍길동SECRET"));
    assert.ok(!dayStr.includes("PHOTO_BYTES"));

    // 3. 화이트리스트 쓰기 + 백업 필드 보존 확인
    core.setEduContents(tmpDir, "2026-11-18", "1. 새 교육내용");
    core.setWorkSection(tmpDir, "2026-11-18", "B구역 교량");
    const riskRes = core.setRiskRows(tmpDir, "2026-11-18", [
      { tool: "크레인", hazard: "줄걸이 파단", accident: "낙하", level: "높음", measure: "와이어 점검" },
      { tool: "용접기", hazard: "감전 위험", accident: "감전", level: "M", measure: "접지 확인" },
      { tool: "고소대", hazard: "미끄러짐", accident: "커스텀재해", level: "low", measure: "미끄럼방지" }
    ]);
    assert.strictEqual(riskRes.count, 3);
    assert.strictEqual(riskRes.warnings.length, 1);

    const rawAfter = JSON.parse(
      fs.readFileSync(core.dayJsonPath(tmpDir, "2026-11-18"), "utf8")
    );
    assert.strictEqual(rawAfter.eduLog.contents, "1. 새 교육내용");
    assert.strictEqual(rawAfter.eduLog.contentsBackup, "1. 기존 교육내용");
    assert.strictEqual(rawAfter.tbmLog.workSection, "B구역 교량");
    assert.strictEqual(rawAfter.tbmLog.riskRows[0].level, "상");
    assert.strictEqual(rawAfter.tbmLog.riskRows[1].level, "중");
    assert.strictEqual(rawAfter.tbmLog.riskRows[2].level, "하");
    assert.strictEqual(rawAfter.tbmLog.riskRowsBackup.length, 1);
    // 화이트리스트 외 필드(workers) 보존 확인
    assert.strictEqual(rawAfter.tbmLog.workers[0].name, "홍길동SECRET");

    // 4. 손상된 JSON 파일 덮어쓰기 거부
    const corruptDate = "2026-11-19";
    const corruptPath = core.dayJsonPath(tmpDir, corruptDate);
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, "{ broken json", "utf8");
    assert.throws(() => core.setEduContents(tmpDir, corruptDate, "1. 덮어쓰기 시도"));
    assert.strictEqual(fs.readFileSync(corruptPath, "utf8"), "{ broken json");

    // 5. MCP SDK 프로토콜 통합 테스트 (initialize -> tools/list -> get_day)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, "dayrep-mcp.js")],
      env: { ...process.env, DAYREP_DATA_DIR: tmpDir }
    });
    const client = new Client({ name: "dayrep-mcp-test-client", version: "0.1.0" });
    await client.connect(transport);
    try {
      const toolsResp = await client.listTools();
      const toolNames = toolsResp.tools.map((t) => t.name);
      assert.ok(toolNames.includes("get_site_context"));
      assert.ok(toolNames.includes("get_day"));
      assert.ok(toolNames.includes("set_edu_contents"));
      assert.ok(toolNames.includes("set_risk_rows"));
      assert.ok(toolNames.includes("set_work_section"));

      const callResp = await client.callTool({
        name: "get_day",
        arguments: { date: "2026-11-18" }
      });
      const parsed = JSON.parse(callResp.content[0].text);
      assert.strictEqual(parsed.eduLog.contents, "1. 새 교육내용");
      assert.strictEqual(parsed.tbmLog.workSection, "B구역 교량");
    } finally {
      await client.close();
    }

    console.log("dayrep-mcp.test.js: all unit and MCP protocol tests passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
