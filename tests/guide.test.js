const assert = require("assert");
const fs = require("fs");
const path = require("path");
const guide = require("../src/js/guide");

function countMdItems(mdText) {
  const lines = mdText.split(/\r?\n/);
  const h2 = lines.filter((l) => /^##\s+/.test(l)).length;
  const h3 = lines.filter((l) => /^###\s+/.test(l)).length;
  const qa = lines.filter((l) => /^\*\*Q\./.test(l)).length;
  const tableRows = lines.filter((l) => /^\|[^-]/.test(l)).length - 1; // exclude header
  return { h2, h3, qa, tableRows };
}

function runTests() {
  // 1. 문의처 문자열 고정 테스트
  assert.strictEqual(guide.CONTACT_TEXT, "문의 : hguyswow@gmail.com");
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
  assert.ok(indexHtml.includes('id="sidebar-contact"'), "sidebar-contact element missing");
  assert.ok(indexHtml.includes("문의 : hguyswow@gmail.com"), "contact text missing in index.html");
  assert.ok(!indexHtml.includes("mailto:"), "mailto link must not be present");

  // 2. docs/사용가이드.md <-> GUIDE_SECTIONS 항목 수 대조
  const mdText = fs.readFileSync(path.join(__dirname, "..", "docs", "사용가이드.md"), "utf8");
  const mdCounts = countMdItems(mdText);
  const secCount = guide.GUIDE_SECTIONS.length;
  const subCount = guide.GUIDE_SECTIONS.reduce((acc, s) => acc + (s.subsections ? s.subsections.length : 0), 0);
  const qaCount = guide.GUIDE_SECTIONS[5].blocks.filter((b) => b.type === "qa").length;
  const engineRows = guide.GUIDE_SECTIONS[3].subsections[1].blocks.find((b) => b.type === "table").rows.length;

  assert.strictEqual(secCount, mdCounts.h2, "h2 section count mismatch");
  assert.strictEqual(subCount, mdCounts.h3, "h3 subsection count mismatch");
  assert.strictEqual(qaCount, mdCounts.qa, "FAQ count mismatch");
  assert.strictEqual(engineRows, mdCounts.tableRows, "engine table row count mismatch");

  // 3. XSS 안전 변환 테스트 (mock DOM)
  const nodes = [];
  global.document = {
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    createElement: (tag) => ({ tagName: tag.toUpperCase(), textContent: "" })
  };
  const mockParent = {
    appendChild: (n) => nodes.push(n)
  };
  guide.appendInlineSafe(mockParent, '<script>alert(1)</script>**굵게**`코드`');
  delete global.document;

  assert.ok(!nodes.some((n) => n.tagName === "SCRIPT"), "script element must not be created");
  assert.strictEqual(nodes[0].textContent, "<script>alert(1)</script>");
  assert.strictEqual(nodes[1].tagName, "STRONG");
  assert.strictEqual(nodes[1].textContent, "굵게");
  assert.strictEqual(nodes[2].tagName, "CODE");
  assert.strictEqual(nodes[2].textContent, "코드");

  console.log("guide.test.js: all tests passed", mdCounts);
}

runTests();
