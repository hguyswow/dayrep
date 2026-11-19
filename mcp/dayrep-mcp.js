"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const core = require("./dayrep-core");

function textResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
  };
}

function errorResult(err) {
  return {
    isError: true,
    content: [{ type: "text", text: String(err && err.message ? err.message : err) }]
  };
}

function createServer() {
  const server = new McpServer({
    name: "dayrep-mcp",
    version: "0.1.0"
  });

  server.tool(
    "get_site_context",
    "설정의 공사현황과 최근 N일(기본 5) 교육내용·작업구간 요약을 조회합니다. 근로자 명단·도장·API키는 반환하지 않습니다.",
    { recentDays: z.number().int().min(1).max(30).optional() },
    async ({ recentDays }) => {
      try {
        const dataDir = core.resolveDataDir();
        return textResult(core.getSiteContext(dataDir, recentDays));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "get_day",
    "특정 날짜(YYYY-MM-DD)의 안전교육·순회점검·TBM·공사현황 데이터를 조회합니다. 사진·서명·명단은 제외됩니다.",
    { date: z.string() },
    async ({ date }) => {
      try {
        const dataDir = core.resolveDataDir();
        return textResult(core.getDay(dataDir, date));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_days",
    "저장된 일자 목록(날짜, PDF 유무, 사진 수)을 최신순으로 조회합니다.",
    {},
    async () => {
      try {
        const dataDir = core.resolveDataDir();
        return textResult(core.listDays(dataDir));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "set_edu_contents",
    "특정 날짜의 안전교육일지 교육내용(eduLog.contents)을 수정합니다. 기존 내용은 contentsBackup에 보관됩니다.",
    {
      date: z.string(),
      text: z.string().min(1).max(3000)
    },
    async ({ date, text }) => {
      try {
        const dataDir = core.resolveDataDir();
        return textResult(core.setEduContents(dataDir, date, text));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "set_risk_rows",
    "특정 날짜의 TBM 일지 위험성평가 표(tbmLog.riskRows, 3~8행)를 수정합니다. 기존 행은 riskRowsBackup에 보관됩니다.",
    {
      date: z.string(),
      rows: z
        .array(
          z.object({
            tool: z.string(),
            hazard: z.string(),
            accident: z.string(),
            level: z.string(),
            measure: z.string()
          })
        )
        .min(3)
        .max(8)
    },
    async ({ date, rows }) => {
      try {
        const dataDir = core.resolveDataDir();
        return textResult(core.setRiskRows(dataDir, date, rows));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "set_work_section",
    "특정 날짜의 TBM 일지 금일 작업구간 및 내용(tbmLog.workSection)을 수정합니다.",
    {
      date: z.string(),
      text: z.string().min(1).max(3000)
    },
    async ({ date, text }) => {
      try {
        const dataDir = core.resolveDataDir();
        return textResult(core.setWorkSection(dataDir, date, text));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`dayrep-mcp fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}

module.exports = { createServer };
