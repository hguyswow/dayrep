(function (root) {
  "use strict";

  var STAMP_SLOTS = [
    { slot: "staff", label: "담당 (안전관리자)" },
    { slot: "director", label: "현장소장" },
    { slot: "chief", label: "총괄책임자" },
    { slot: "crane_staff", label: "타워크레인 담당" }
  ];

  var workingCategories = [];
  var workingAbsorbIdx = 0;
  var workingWorkers = [];
  var workingBackupDir = "";
  var workingProcesses = [];
  var workingScheduleItems = [];
  var workingAi = null;
  var workingMaskedSecrets = {};
  var currentCompatEngine = "lmstudio";

  function el(id) {
    return document.getElementById(id);
  }

  function renderAbsorbSelect() {
    var select = el("set-absorb-idx");
    if (!select) return;
    select.textContent = "";
    workingCategories.forEach(function (cat, idx) {
      var opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = cat.name || ("구분 " + (idx + 1));
      select.appendChild(opt);
    });
    if (workingAbsorbIdx < 0 || workingAbsorbIdx >= workingCategories.length) {
      workingAbsorbIdx = Math.max(0, workingCategories.length - 1);
    }
    select.value = String(workingAbsorbIdx);
  }

  function renderCategoryList() {
    var container = el("category-list");
    if (!container) return;
    container.textContent = "";

    workingCategories.forEach(function (cat, idx) {
      var row = document.createElement("div");
      row.className = "category-row";

      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = cat.name;
      nameInput.placeholder = "구분명";
      nameInput.addEventListener("input", function () {
        workingCategories[idx].name = nameInput.value;
        renderAbsorbSelect();
      });

      var countInput = document.createElement("input");
      countInput.type = "number";
      countInput.min = "0";
      countInput.value = String(cat.defaultCount);
      countInput.addEventListener("input", function () {
        var n = parseInt(countInput.value, 10);
        workingCategories[idx].defaultCount = Number.isFinite(n) && n >= 0 ? n : 0;
      });

      var btnUp = document.createElement("button");
      btnUp.type = "button";
      btnUp.className = "btn-icon";
      btnUp.textContent = "▲";
      btnUp.disabled = idx === 0;
      btnUp.addEventListener("click", function () {
        if (idx === 0) return;
        var tmp = workingCategories[idx - 1];
        workingCategories[idx - 1] = workingCategories[idx];
        workingCategories[idx] = tmp;
        if (workingAbsorbIdx === idx) workingAbsorbIdx = idx - 1;
        else if (workingAbsorbIdx === idx - 1) workingAbsorbIdx = idx;
        renderCategoryList();
      });

      var btnDown = document.createElement("button");
      btnDown.type = "button";
      btnDown.className = "btn-icon";
      btnDown.textContent = "▼";
      btnDown.disabled = idx === workingCategories.length - 1;
      btnDown.addEventListener("click", function () {
        if (idx >= workingCategories.length - 1) return;
        var tmp = workingCategories[idx + 1];
        workingCategories[idx + 1] = workingCategories[idx];
        workingCategories[idx] = tmp;
        if (workingAbsorbIdx === idx) workingAbsorbIdx = idx + 1;
        else if (workingAbsorbIdx === idx + 1) workingAbsorbIdx = idx;
        renderCategoryList();
      });

      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-danger";
      btnDel.textContent = "삭제";
      btnDel.disabled = workingCategories.length <= 1;
      btnDel.addEventListener("click", function () {
        if (workingCategories.length <= 1) return;
        workingCategories.splice(idx, 1);
        if (workingAbsorbIdx >= workingCategories.length || workingAbsorbIdx === idx) {
          workingAbsorbIdx = workingCategories.length - 1;
        } else if (idx < workingAbsorbIdx) {
          workingAbsorbIdx -= 1;
        }
        renderCategoryList();
      });

      row.appendChild(nameInput);
      row.appendChild(countInput);
      row.appendChild(btnUp);
      row.appendChild(btnDown);
      row.appendChild(btnDel);
      container.appendChild(row);
    });

    renderAbsorbSelect();
  }

  function renderWorkerList() {
    var container = el("worker-list");
    if (!container) return;
    container.textContent = "";

    workingWorkers.forEach(function (w, idx) {
      var row = document.createElement("div");
      row.className = "category-row";

      var roleInput = document.createElement("input");
      roleInput.type = "text";
      roleInput.value = w.role || "";
      roleInput.placeholder = "직종 (예: 철근공)";
      roleInput.addEventListener("input", function () {
        workingWorkers[idx].role = roleInput.value;
      });

      var nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = w.name || "";
      nameInput.placeholder = "성명";
      nameInput.addEventListener("input", function () {
        workingWorkers[idx].name = nameInput.value;
      });

      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-danger";
      btnDel.textContent = "삭제";
      btnDel.addEventListener("click", function () {
        workingWorkers.splice(idx, 1);
        renderWorkerList();
      });

      row.appendChild(roleInput);
      row.appendChild(nameInput);
      row.appendChild(btnDel);
      container.appendChild(row);
    });
  }

  function renderProcessList() {
    var container = el("process-list");
    if (!container) return;
    container.textContent = "";

    workingProcesses.forEach(function (proc, idx) {
      var row = document.createElement("div");
      row.className = "category-row";

      var nameInp = document.createElement("input");
      nameInp.type = "text";
      nameInp.value = proc.name || "";
      nameInp.placeholder = "공종명 (예: 보도육교 앙카설치)";
      nameInp.addEventListener("input", function () {
        workingProcesses[idx].name = nameInp.value;
      });

      var progInp = document.createElement("input");
      progInp.type = "number";
      progInp.min = "0";
      progInp.max = "100";
      progInp.value = proc.progress || "";
      progInp.placeholder = "공정%";
      progInp.addEventListener("input", function () {
        workingProcesses[idx].progress = progInp.value;
      });

      var equipInp = document.createElement("input");
      equipInp.type = "text";
      equipInp.value = proc.equipment || "";
      equipInp.placeholder = "주요 장비";
      equipInp.addEventListener("input", function () {
        workingProcesses[idx].equipment = equipInp.value;
      });

      var memoInp = document.createElement("input");
      memoInp.type = "text";
      memoInp.value = proc.memo || "";
      memoInp.placeholder = "메모";
      memoInp.addEventListener("input", function () {
        workingProcesses[idx].memo = memoInp.value;
      });

      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-danger";
      btnDel.textContent = "삭제";
      btnDel.addEventListener("click", function () {
        workingProcesses.splice(idx, 1);
        renderProcessList();
      });

      row.appendChild(nameInp);
      row.appendChild(progInp);
      row.appendChild(equipInp);
      row.appendChild(memoInp);
      row.appendChild(btnDel);
      container.appendChild(row);
    });
  }

  function renderScheduleTable() {
    var tbody = el("schedule-tbody");
    if (!tbody) return;
    tbody.textContent = "";

    workingScheduleItems.forEach(function (item, idx) {
      var tr = document.createElement("tr");

      var tdStart = document.createElement("td");
      var inpStart = document.createElement("input");
      inpStart.type = "date";
      inpStart.value = item.start || "";
      inpStart.addEventListener("change", function () {
        workingScheduleItems[idx].start = inpStart.value;
        if (!workingScheduleItems[idx].end || workingScheduleItems[idx].end < inpStart.value) {
          workingScheduleItems[idx].end = inpStart.value;
          inpEnd.value = inpStart.value;
        }
      });
      tdStart.appendChild(inpStart);

      var tdEnd = document.createElement("td");
      var inpEnd = document.createElement("input");
      inpEnd.type = "date";
      inpEnd.value = item.end || "";
      inpEnd.addEventListener("change", function () {
        workingScheduleItems[idx].end = inpEnd.value;
      });
      tdEnd.appendChild(inpEnd);

      var tdTask = document.createElement("td");
      var inpTask = document.createElement("input");
      inpTask.type = "text";
      inpTask.value = item.task || "";
      inpTask.placeholder = "작업내용 (예: 교각 기초 철근 배근)";
      inpTask.addEventListener("input", function () {
        workingScheduleItems[idx].task = inpTask.value;
      });
      tdTask.appendChild(inpTask);

      var tdEquip = document.createElement("td");
      var inpEquip = document.createElement("input");
      inpEquip.type = "text";
      inpEquip.value = item.equipment || "";
      inpEquip.placeholder = "주요장비";
      inpEquip.addEventListener("input", function () {
        workingScheduleItems[idx].equipment = inpEquip.value;
      });
      tdEquip.appendChild(inpEquip);

      var tdMemo = document.createElement("td");
      var inpMemo = document.createElement("input");
      inpMemo.type = "text";
      inpMemo.value = item.memo || "";
      inpMemo.placeholder = "비고";
      inpMemo.addEventListener("input", function () {
        workingScheduleItems[idx].memo = inpMemo.value;
      });
      tdMemo.appendChild(inpMemo);

      var tdDel = document.createElement("td");
      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn-danger";
      btnDel.textContent = "삭제";
      btnDel.addEventListener("click", function () {
        workingScheduleItems.splice(idx, 1);
        renderScheduleTable();
      });
      tdDel.appendChild(btnDel);

      tr.appendChild(tdStart);
      tr.appendChild(tdEnd);
      tr.appendChild(tdTask);
      tr.appendChild(tdEquip);
      tr.appendChild(tdMemo);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function flushCurrentAiFields() {
    if (!workingAi) return;
    var hermesEp = el("set-ai-hermes-ep");
    if (hermesEp) workingAi.hermesEndpoint = hermesEp.value.trim();

    if (currentCompatEngine && workingAi.endpoints[currentCompatEngine]) {
      var baseEl = el("set-ai-baseurl");
      var modelEl = el("set-ai-model");
      if (baseEl) workingAi.endpoints[currentCompatEngine].baseUrl = baseEl.value.trim();
      if (modelEl) workingAi.endpoints[currentCompatEngine].model = modelEl.value.trim();
    }
  }

  var MODEL_PLACEHOLDERS = {
    lmstudio: "local-model",
    opencode: "gpt-4o-mini",
    deepseek: "deepseek-chat",
    gemini: "gemini-2.0-flash",
    openrouter: "google/gemma-2-9b-it:free",
    ollama: "llama3.1",
    claude_cli: "비우면 CLI 기본 모델 사용"
  };

  function renderAiSection() {
    if (!workingAi) return;
    var engine = workingAi.engine || "hermes";
    var sel = el("set-ai-engine");
    if (sel) sel.value = engine;

    var hermesBox = el("ai-hermes-fields");
    var compatBox = el("ai-compat-fields");
    var mcpBox = el("ai-mcp-fields");
    var badge = el("ai-engine-badge");
    var notice = el("ai-privacy-notice");
    var btnModels = el("btn-fetch-models");

    if (hermesBox) hermesBox.classList.add("hidden");
    if (compatBox) compatBox.classList.add("hidden");
    if (mcpBox) mcpBox.classList.add("hidden");
    if (btnModels) btnModels.classList.add("hidden");

    var isExternal = ["opencode", "deepseek", "gemini", "openrouter", "claude_cli"].indexOf(engine) !== -1;
    if (notice) {
      if (engine === "claude_cli") {
        notice.textContent =
          "프롬프트(공사현황·작업내용)가 Anthropic 서비스로 전송됩니다. 근로자 명단·성명·도장은 전송하지 않습니다.";
        notice.className = "ai-notice external";
      } else if (isExternal) {
        notice.textContent =
          "주의: 공사현황 및 작업일보 텍스트가 선택한 외부 AI 서비스로 전송됩니다. (근로자 성명·명단·도장은 전송하지 않습니다.)";
        notice.className = "ai-notice external";
      } else if (engine === "hermes") {
        notice.textContent =
          "로컬 서버 실행 방식입니다. (단, Hermes 경유 외부 모델 사용 가능 — 근로자 성명·도장은 전송하지 않습니다.)";
        notice.className = "ai-notice";
      } else {
        notice.textContent =
          "로컬/자체 서버 실행 방식입니다. 외부 인터넷 서비스로 공사현황이 전송되지 않습니다.";
        notice.className = "ai-notice";
      }
    }

    if (badge) {
      if (engine === "claude_mcp") {
        badge.textContent = "외부 MCP 클라이언트 연동";
        badge.className = "ai-engine-badge active";
      } else {
        badge.textContent = "실동작 가능";
        badge.className = "ai-engine-badge active";
      }
    }

    if (engine === "hermes") {
      if (hermesBox) hermesBox.classList.remove("hidden");
      if (el("set-ai-hermes-ep")) el("set-ai-hermes-ep").value = workingAi.hermesEndpoint || "";
    } else if (engine === "claude_mcp") {
      if (mcpBox) mcpBox.classList.remove("hidden");
    } else {
      currentCompatEngine = engine;
      if (compatBox) compatBox.classList.remove("hidden");
      var ep = workingAi.endpoints[engine] || { baseUrl: "", model: "" };
      var isCli = engine === "claude_cli";
      if (el("ai-baseurl-label")) {
        el("ai-baseurl-label").textContent = isCli ? "실행 경로 (기본: claude)" : "Base URL";
      }
      if (el("set-ai-baseurl")) {
        el("set-ai-baseurl").value = ep.baseUrl || "";
        el("set-ai-baseurl").placeholder = isCli ? "claude (또는 claude.cmd 전체 경로)" : "http://localhost:1234/v1";
      }
      if (el("ai-key-row")) {
        if (isCli) el("ai-key-row").classList.add("hidden");
        else el("ai-key-row").classList.remove("hidden");
      }
      if (el("set-ai-model")) {
        el("set-ai-model").value = ep.model || "";
        el("set-ai-model").placeholder = MODEL_PLACEHOLDERS[engine] || "";
      }
      if (el("ai-model-suggestions")) el("ai-model-suggestions").textContent = "";
      if (btnModels && ["lmstudio", "ollama", "openrouter"].indexOf(engine) !== -1) {
        btnModels.classList.remove("hidden");
      }
      if (el("set-ai-key-masked")) {
        el("set-ai-key-masked").textContent = workingMaskedSecrets[engine] || "미등록";
      }
      if (el("set-ai-key-input")) el("set-ai-key-input").value = "";
    }
  }

  function renderMcpSnippet(dataDir) {
    var box = el("mcp-config-snippet");
    if (!box) return;
    var snippetObj = {
      mcpServers: {
        dayrep: {
          command: "node",
          args: ["E:/dev/dayrep/mcp/dayrep-mcp.js"],
          env: {
            DAYREP_DATA_DIR: dataDir || ""
          }
        }
      }
    };
    box.textContent = JSON.stringify(snippetObj, null, 2);
  }

  function renderSettingsForm(settings, dataDir, maskedSecrets) {
    var cfg = root.DayrepCarryover.createDefaultSettings(settings);
    if (el("set-data-dir")) el("set-data-dir").textContent = dataDir || "-";
    renderMcpSnippet(dataDir);
    workingBackupDir = cfg.backupDir || "";
    if (el("set-backup-dir")) el("set-backup-dir").textContent = workingBackupDir || "미지정";
    el("set-site-name").value = cfg.siteName;
    el("set-company-name").value = cfg.companyName;
    el("set-safety-name").value = cfg.safetyOfficerName;
    el("set-safety-title").value = cfg.safetyOfficerTitle;
    el("set-site-manager").value = cfg.siteManager;
    el("set-general-manager").value = cfg.generalManager;
    el("set-crane-operator").value = cfg.craneOperator;
    el("set-edu-place").value = cfg.defaultEduPlace;
    el("set-zero-enabled").checked = cfg.zeroAccidentEnabled;
    el("set-zero-target").value = String(cfg.zeroAccidentTarget);
    el("set-edu-template").value = cfg.eduTemplate;
    el("set-construction-memo").value = cfg.constructionStatusMemo;
    if (el("set-const-project")) el("set-const-project").value = cfg.construction.projectName;
    if (el("set-const-season")) el("set-const-season").value = cfg.construction.seasonWeatherMemo;
    if (el("set-const-overview")) el("set-const-overview").value = cfg.construction.overview;

    workingProcesses = (cfg.construction.processes || []).map(function (p) {
      return {
        name: p.name || "",
        progress: p.progress || "",
        equipment: p.equipment || "",
        memo: p.memo || ""
      };
    });
    renderProcessList();

    workingScheduleItems = (cfg.schedule && Array.isArray(cfg.schedule.items) ? cfg.schedule.items : []).map(function (it) {
      return {
        id: it.id || "",
        start: it.start || "",
        end: it.end || "",
        task: it.task || "",
        equipment: it.equipment || "",
        memo: it.memo || ""
      };
    });
    renderScheduleTable();

    workingAi = JSON.parse(JSON.stringify(cfg.ai));
    if (maskedSecrets && typeof maskedSecrets === "object") {
      workingMaskedSecrets = Object.assign({}, maskedSecrets);
    }
    renderAiSection();

    workingCategories = cfg.categories.map(function (c) {
      return { name: c.name, defaultCount: c.defaultCount };
    });
    workingAbsorbIdx = cfg.absorbIdx;
    workingWorkers = (cfg.workers || []).map(function (w) {
      return { role: w.role || "", name: w.name || "" };
    });
    renderCategoryList();
    renderWorkerList();

    var pDocs = cfg.printDocs || { doc1: true, doc2: true, doc3: true, doc4: true, doc5: true };
    ["doc1", "doc2", "doc3", "doc4", "doc5"].forEach(function (k) {
      var chk = el("set-print-" + k);
      if (chk) chk.checked = pDocs[k] !== false;
    });

    var patrolDef = cfg.patrolDefaultResult === "blank" ? "blank" : "good";
    document.querySelectorAll('input[name="set-patrol-default"]').forEach(function (r) {
      r.checked = r.value === patrolDef;
    });

    var rlAssistChk = el("set-ai-risklib-assist");
    if (rlAssistChk) {
      rlAssistChk.checked = cfg.riskLibraryAssist !== false;
    }
  }

  function collectSettingsFromForm(prevSettings) {
    var base = root.DayrepCarryover.createDefaultSettings(prevSettings);
    var absorbSelect = el("set-absorb-idx");
    var absorbVal = absorbSelect ? parseInt(absorbSelect.value, 10) : workingAbsorbIdx;
    var targetVal = parseInt(el("set-zero-target").value, 10);
    flushCurrentAiFields();

    return {
      schemaVersion: 1,
      siteName: el("set-site-name").value.trim(),
      companyName: el("set-company-name").value.trim(),
      safetyOfficerName: el("set-safety-name").value.trim(),
      safetyOfficerTitle: el("set-safety-title").value.trim() || "안전관리자",
      siteManager: el("set-site-manager").value.trim(),
      generalManager: el("set-general-manager").value.trim(),
      craneOperator: el("set-crane-operator").value.trim(),
      defaultEduPlace: el("set-edu-place").value.trim() || "현장",
      categories: workingCategories.map(function (c) {
        return {
          name: String(c.name || "").trim() || "구분",
          defaultCount: Number.isFinite(c.defaultCount) && c.defaultCount >= 0 ? c.defaultCount : 0
        };
      }),
      absorbIdx: Number.isInteger(absorbVal) ? absorbVal : 0,
      zeroAccidentEnabled: Boolean(el("set-zero-enabled").checked),
      zeroAccidentTarget: Number.isFinite(targetVal) && targetVal >= 0 ? targetVal : 100000,
      eduTemplate: el("set-edu-template").value,
      constructionStatusMemo: el("set-construction-memo").value,
      construction: {
        projectName: el("set-const-project") ? el("set-const-project").value.trim() : "",
        overview: el("set-const-overview") ? el("set-const-overview").value.trim() : "",
        seasonWeatherMemo: el("set-const-season") ? el("set-const-season").value.trim() : "",
        processes: workingProcesses
          .map(function (p) {
            return {
              name: String(p.name || "").trim(),
              progress: String(p.progress || "").trim(),
              equipment: String(p.equipment || "").trim(),
              memo: String(p.memo || "").trim()
            };
          })
          .filter(function (p) {
            return p.name || p.equipment || p.memo;
          })
      },
      schedule: root.DayrepSchedule
        ? root.DayrepSchedule.normalizeSchedule({ items: workingScheduleItems })
        : { items: [] },
      ai: workingAi || base.ai,
      backupDir: workingBackupDir,
      workers: workingWorkers
        .map(function (w) {
          return {
            role: String(w.role || "").trim(),
            name: String(w.name || "").trim()
          };
        })
        .filter(function (w) {
          return w.role || w.name;
        }),
      printDocs: (function () {
        var rawPrint = {};
        ["doc1", "doc2", "doc3", "doc4", "doc5"].forEach(function (k) {
          var chk = el("set-print-" + k);
          rawPrint[k] = chk ? Boolean(chk.checked) : (base.printDocs ? base.printDocs[k] !== false : true);
        });
        return root.DayrepCarryover.normalizePrintDocs
          ? root.DayrepCarryover.normalizePrintDocs(rawPrint)
          : rawPrint;
      })(),
      patrolDefaultResult: (function () {
        var checked = document.querySelector('input[name="set-patrol-default"]:checked');
        return checked && checked.value === "blank" ? "blank" : "good";
      })(),
      riskLibraryAssist: (function () {
        var chk = el("set-ai-risklib-assist");
        return chk ? Boolean(chk.checked) : true;
      })(),
      stamps: base.stamps
    };
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("파일 읽기 실패"));
      };
      reader.readAsDataURL(file);
    });
  }

  async function renderStampGrid(invoke, showToast) {
    var grid = el("stamp-grid");
    if (!grid) return;
    grid.textContent = "";

    for (var i = 0; i < STAMP_SLOTS.length; i++) {
      (function (item) {
        var card = document.createElement("div");
        card.className = "stamp-card";

        var title = document.createElement("div");
        title.className = "stamp-title";
        title.textContent = item.label;

        var preview = document.createElement("div");
        preview.className = "stamp-preview";
        preview.textContent = "미등록";

        var actions = document.createElement("div");
        actions.className = "stamp-actions";

        var label = document.createElement("label");
        label.className = "stamp-file-label";
        label.textContent = "이미지 선택";

        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".png,.jpg,.jpeg,.webp";
        input.className = "stamp-file-input";
        label.appendChild(input);

        var btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "btn-danger";
        btnDel.textContent = "삭제";

        async function refreshPreview() {
          if (!invoke) return;
          try {
            var data = await invoke("read_stamp", { slot: item.slot });
            preview.textContent = "";
            if (data && data.base64) {
              var img = document.createElement("img");
              var mime = data.ext === "jpg" ? "jpeg" : data.ext;
              img.src = "data:image/" + mime + ";base64," + data.base64;
              img.alt = item.label;
              preview.appendChild(img);
            } else {
              preview.textContent = "미등록";
            }
          } catch (err) {
            preview.textContent = "불러오기 실패";
          }
        }

        input.addEventListener("change", async function () {
          var file = input.files && input.files[0];
          if (!file || !invoke) return;
          var parts = file.name.split(".");
          var ext = parts.length > 1 ? parts.pop().toLowerCase() : "png";
          try {
            var dataUrl = await fileToBase64(file);
            await invoke("save_stamp", {
              slot: item.slot,
              bytesB64: dataUrl,
              ext: ext
            });
            await refreshPreview();
            showToast(item.label + " 도장이 저장되었습니다.", false);
          } catch (err) {
            showToast("도장 저장 실패: " + String(err), true);
          } finally {
            input.value = "";
          }
        });

        btnDel.addEventListener("click", async function () {
          if (!invoke) return;
          try {
            await invoke("delete_stamp", { slot: item.slot });
            await refreshPreview();
            showToast(item.label + " 도장이 삭제되었습니다.", false);
          } catch (err) {
            showToast("도장 삭제 실패: " + String(err), true);
          }
        });

        actions.appendChild(label);
        actions.appendChild(btnDel);
        card.appendChild(title);
        card.appendChild(preview);
        card.appendChild(actions);
        grid.appendChild(card);

        refreshPreview();
      })(STAMP_SLOTS[i]);
    }
  }

  function bindSettingsEvents(opts) {
    var btnAdd = el("btn-add-category");
    if (btnAdd) {
      btnAdd.addEventListener("click", function () {
        workingCategories.push({ name: "새 구분", defaultCount: 0 });
        renderCategoryList();
      });
    }

    var btnAddWorker = el("btn-add-worker");
    if (btnAddWorker) {
      btnAddWorker.addEventListener("click", function () {
        workingWorkers.push({ role: "", name: "" });
        renderWorkerList();
      });
    }

    var absorbSelect = el("set-absorb-idx");
    if (absorbSelect) {
      absorbSelect.addEventListener("change", function () {
        var n = parseInt(absorbSelect.value, 10);
        if (Number.isInteger(n)) workingAbsorbIdx = n;
      });
    }

    var btnSave = el("btn-save-settings");
    if (btnSave) {
      btnSave.addEventListener("click", async function () {
        if (!opts.invoke) return;
        var next = collectSettingsFromForm(opts.getSettings());
        try {
          await opts.invoke("save_settings", { settings: next });
          opts.setSettings(next);
          if (opts.onSaved) opts.onSaved(next);
          opts.showToast("설정이 저장되었습니다.", false);
        } catch (err) {
          opts.showToast("설정 저장 실패: " + String(err), true);
        }
      });
    }

    var btnChangeDir = el("btn-change-data-dir");
    if (btnChangeDir) {
      btnChangeDir.addEventListener("click", async function () {
        if (!opts.invoke) return;
        try {
          var selected = await opts.invoke("set_data_dir");
          if (selected && opts.onDataDirChanged) {
            await opts.onDataDirChanged(selected);
          }
        } catch (err) {
          opts.showToast("폴더 변경 실패: " + String(err), true);
        }
      });
    }

    var btnPickBackup = el("btn-pick-backup-dir");
    if (btnPickBackup) {
      btnPickBackup.addEventListener("click", async function () {
        if (!opts.invoke) return;
        try {
          var picked = await opts.invoke("pick_backup_dir");
          if (picked) {
            workingBackupDir = picked;
            if (el("set-backup-dir")) el("set-backup-dir").textContent = workingBackupDir;
            opts.showToast("백업 폴더가 선택되었습니다. '설정 저장'을 눌러 반영하세요.", false);
          }
        } catch (err) {
          opts.showToast("백업 폴더 선택 실패: " + String(err), true);
        }
      });
    }

    var btnClearBackup = el("btn-clear-backup-dir");
    if (btnClearBackup) {
      btnClearBackup.addEventListener("click", function () {
        workingBackupDir = "";
        if (el("set-backup-dir")) el("set-backup-dir").textContent = "미지정";
      });
    }

    var btnRunBackup = el("btn-run-backup-now");
    if (btnRunBackup) {
      btnRunBackup.addEventListener("click", async function () {
        if (!opts.onRunBackupNow) return;
        await opts.onRunBackupNow(workingBackupDir);
      });
    }

    var btnAddProc = el("btn-add-process");
    if (btnAddProc) {
      btnAddProc.addEventListener("click", function () {
        workingProcesses.push({ name: "", progress: "", equipment: "", memo: "" });
        renderProcessList();
      });
    }

    var btnAddSchedule = el("btn-add-schedule");
    if (btnAddSchedule) {
      btnAddSchedule.addEventListener("click", function () {
        var maxItems = (root.DayrepSchedule && root.DayrepSchedule.MAX_ITEMS) || 200;
        if (workingScheduleItems.length >= maxItems) {
          opts.showToast("공정표는 최대 " + maxItems + "행까지 입력할 수 있습니다.", true);
          return;
        }
        var d = new Date();
        var yyyy = d.getFullYear();
        var mm = String(d.getMonth() + 1).padStart(2, "0");
        var dd = String(d.getDate()).padStart(2, "0");
        var todayStr = yyyy + "-" + mm + "-" + dd;
        workingScheduleItems.push({
          id: "sch_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
          start: todayStr,
          end: todayStr,
          task: "",
          equipment: "",
          memo: ""
        });
        renderScheduleTable();
      });
    }

    var selAiEngine = el("set-ai-engine");
    if (selAiEngine) {
      selAiEngine.addEventListener("change", function () {
        flushCurrentAiFields();
        if (workingAi) workingAi.engine = selAiEngine.value;
        renderAiSection();
      });
    }

    var btnSaveKey = el("btn-save-ai-key");
    if (btnSaveKey) {
      btnSaveKey.addEventListener("click", async function () {
        if (!opts.invoke || !workingAi) return;
        var engine = workingAi.engine;
        var keyInp = el("set-ai-key-input");
        var rawKey = keyInp ? keyInp.value.trim() : "";
        if (!rawKey) {
          opts.showToast("저장할 API 키를 입력해 주세요.", true);
          return;
        }
        try {
          var masked = await opts.invoke("save_secret", { engine: engine, apiKey: rawKey });
          workingMaskedSecrets[engine] = masked;
          if (keyInp) keyInp.value = "";
          if (el("set-ai-key-masked")) el("set-ai-key-masked").textContent = masked || "미등록";
          opts.showToast("API 키가 secrets.json에 저장되었습니다.", false);
        } catch (err) {
          opts.showToast("API 키 저장 실패: " + String(err), true);
        }
      });
    }

    var btnDelKey = el("btn-del-ai-key");
    if (btnDelKey) {
      btnDelKey.addEventListener("click", async function () {
        if (!opts.invoke || !workingAi) return;
        var engine = workingAi.engine;
        try {
          await opts.invoke("delete_secret", { engine: engine });
          delete workingMaskedSecrets[engine];
          if (el("set-ai-key-masked")) el("set-ai-key-masked").textContent = "미등록";
          opts.showToast("API 키가 삭제되었습니다.", false);
        } catch (err) {
          opts.showToast("API 키 삭제 실패: " + String(err), true);
        }
      });
    }

    var btnFetchModels = el("btn-fetch-models");
    if (btnFetchModels) {
      btnFetchModels.addEventListener("click", async function () {
        if (!opts.invoke || !workingAi) return;
        flushCurrentAiFields();
        var engine = workingAi.engine;
        var ep = workingAi.endpoints[engine] || {};
        btnFetchModels.disabled = true;
        try {
          var list = await opts.invoke("ai_list_models", {
            engine: engine,
            options: {
              baseUrl: ep.baseUrl || "",
              endpoint: ep.baseUrl || ""
            }
          });
          var dl = el("ai-model-suggestions");
          if (dl && Array.isArray(list)) {
            dl.textContent = "";
            list.forEach(function (m) {
              var opt = document.createElement("option");
              opt.value = m;
              dl.appendChild(opt);
            });
          }
          if (list && list.length > 0) {
            opts.showToast(list.length + "개 모델을 불러왔습니다.", false);
          }
        } catch (e) {
          // 실패 시 조용히 무시하고 수동 입력 유지
        } finally {
          btnFetchModels.disabled = false;
        }
      });
    }

    var btnTestAi = el("btn-test-ai");
    if (btnTestAi) {
      btnTestAi.addEventListener("click", async function () {
        var resEl = el("ai-test-result");
        if (workingAi) {
          flushCurrentAiFields();
          if (workingAi.engine === "claude_mcp") {
            if (resEl) {
              resEl.style.color = "#4b5563";
              resEl.textContent = "Claude MCP 는 앱이 직접 호출하지 않는 방식입니다. 아래 'Claude MCP 연동 안내'대로 Claude 에 등록한 뒤 Claude 쪽에서 dayrep 도구를 호출해 확인하세요.";
            }
            return;
          }
        }
        if (!opts.invoke || !workingAi) {
          if (resEl) resEl.textContent = "Tauri 런타임에서만 연결 테스트가 가능합니다.";
          return;
        }
        var engine = workingAi.engine;
        var ep = workingAi.endpoints[engine] || {};
        btnTestAi.disabled = true;
        if (resEl) {
          resEl.style.color = "#4b5563";
          resEl.textContent = "연결 테스트 중...";
        }
        try {
          var resp = await opts.invoke("ai_generate", {
            engine: engine,
            prompt: "건설현장 일일 안전교육 핵심 수칙 1줄만 작성해 주세요.",
            options: {
              endpoint: workingAi.hermesEndpoint,
              baseUrl: ep.baseUrl || "",
              model: ep.model || "",
              temperature: 0.3
            }
          });
          if (resEl) {
            resEl.style.color = "#0f766e";
            resEl.textContent = "연결 성공 (" + resp.model + "): " + resp.text.slice(0, 80);
          }
        } catch (err) {
          if (resEl) {
            resEl.style.color = "#b91c1c";
            resEl.textContent = "연결 실패: " + String(err);
          }
        } finally {
          btnTestAi.disabled = false;
        }
      });
    }

    async function copyText(text, okMsg) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          opts.showToast(okMsg, false);
          return;
        }
      } catch (e) {}
      opts.showToast("클립보드 복사를 사용할 수 없습니다. 텍스트를 직접 복사해 주세요.", true);
    }

    var btnCopySnippet = el("btn-copy-mcp-snippet");
    if (btnCopySnippet) {
      btnCopySnippet.addEventListener("click", function () {
        var box = el("mcp-config-snippet");
        if (box) copyText(box.textContent || "", ".mcp.json 스니펫을 복사했습니다.");
      });
    }

    var btnCopyPrompt = el("btn-copy-mcp-prompt");
    if (btnCopyPrompt) {
      btnCopyPrompt.addEventListener("click", function () {
        var pBox = el("mcp-example-prompt");
        if (pBox) copyText(pBox.textContent || "", "예시 프롬프트를 복사했습니다.");
      });
    }

    var printKeys = ["doc1", "doc2", "doc3", "doc4", "doc5"];
    printKeys.forEach(function (k) {
      var chk = el("set-print-" + k);
      if (!chk) return;
      chk.addEventListener("change", function () {
        var anyChecked = printKeys.some(function (pk) {
          var c = el("set-print-" + pk);
          return c && c.checked;
        });
        if (!anyChecked) {
          chk.checked = true;
          if (opts.showToast) opts.showToast("최소 1개 이상의 서류를 선택해야 합니다.", true);
        }
      });
    });

    bindRiskLibraryEvents(opts);
  }

  var riskLibOpts = null;
  var riskLibState = {
    q: "",
    category: "",
    limit: 50,
    editingId: null,
    selectedIds: {}
  };

  function getFilteredRiskEntries(lib) {
    var rl = root.DayrepRiskLibrary;
    if (!rl) return [];
    var rows = rl.query(lib, { q: riskLibState.q });
    if (riskLibState.category === "__uncategorized__") {
      return rows.filter(function (e) { return !e.category; });
    }
    if (riskLibState.category) {
      return rows.filter(function (e) { return e.category === riskLibState.category; });
    }
    return rows;
  }

  async function saveRiskLibChange(nextLib, okMsg) {
    if (!riskLibOpts || typeof riskLibOpts.onSaveRiskLibrary !== "function") return;
    try {
      await riskLibOpts.onSaveRiskLibrary(nextLib);
      if (okMsg && riskLibOpts.showToast) riskLibOpts.showToast(okMsg, false);
    } catch (err) {
      if (riskLibOpts.showToast) riskLibOpts.showToast("라이브러리 저장 실패: " + String(err), true);
    }
  }

  function renderRiskLibrarySection() {
    var summaryEl = el("risklib-summary");
    var catFilter = el("risklib-cat-filter");
    var tbody = el("risklib-tbody");
    var moreBtn = el("btn-risklib-more");
    var checkAll = el("risklib-check-all");
    if (!summaryEl || !catFilter || !tbody || !root.DayrepRiskLibrary) return;

    var rl = root.DayrepRiskLibrary;
    var lib = (riskLibOpts && typeof riskLibOpts.getRiskLibrary === "function" && riskLibOpts.getRiskLibrary()) || rl.normalizeLibrary(null);
    var entries = Array.isArray(lib.entries) ? lib.entries : [];
    var total = entries.length;
    var cats = rl.listCategories(lib);

    if (total === 0) {
      summaryEl.textContent = "전체 0건";
    } else {
      summaryEl.textContent = "전체 " + total + "건 · " + cats.map(function (c) {
        return (c.category || "미분류") + " " + c.count + "건";
      }).join(" / ");
    }

    var prevCat = riskLibState.category;
    catFilter.textContent = "";
    var optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "전체 종류 (" + total + ")";
    catFilter.appendChild(optAll);
    cats.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.category ? c.category : "__uncategorized__";
      opt.textContent = (c.category || "미분류") + " (" + c.count + ")";
      catFilter.appendChild(opt);
    });
    var hasPrev = Array.prototype.some.call(catFilter.options, function (o) { return o.value === prevCat; });
    catFilter.value = hasPrev ? prevCat : "";
    if (!hasPrev) riskLibState.category = "";

    var matched = getFilteredRiskEntries(lib);
    var visible = matched.slice(0, riskLibState.limit);
    tbody.textContent = "";

    if (checkAll) {
      checkAll.checked = visible.length > 0 && visible.every(function (e) {
        return Boolean(riskLibState.selectedIds[e.id]);
      });
    }

    if (visible.length === 0) {
      var emptyTr = document.createElement("tr");
      var emptyTd = document.createElement("td");
      emptyTd.colSpan = 9;
      emptyTd.className = "risklib-empty";
      emptyTd.textContent = total === 0
        ? "아직 보관된 위험성평가 항목이 없습니다."
        : "검색/필터 조건에 맞는 항목이 없습니다.";
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
    } else {
      visible.forEach(function (entry) {
        var tr = document.createElement("tr");
        var tdChk = document.createElement("td");
        var chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = Boolean(riskLibState.selectedIds[entry.id]);
        chk.addEventListener("change", function () {
          if (chk.checked) riskLibState.selectedIds[entry.id] = true;
          else delete riskLibState.selectedIds[entry.id];
          if (checkAll) {
            checkAll.checked = visible.length > 0 && visible.every(function (e) {
              return Boolean(riskLibState.selectedIds[e.id]);
            });
          }
        });
        tdChk.appendChild(chk);
        tr.appendChild(tdChk);

        if (riskLibState.editingId === entry.id) {
          var inpCat = document.createElement("input");
          inpCat.type = "text";
          inpCat.maxLength = 30;
          inpCat.className = "risklib-edit-input";
          inpCat.value = entry.category || "";

          var inpItem = document.createElement("input");
          inpItem.type = "text";
          inpItem.maxLength = 60;
          inpItem.className = "risklib-edit-input";
          inpItem.value = entry.item || "";

          var inpHaz = document.createElement("input");
          inpHaz.type = "text";
          inpHaz.maxLength = 200;
          inpHaz.className = "risklib-edit-input";
          inpHaz.value = entry.hazard || "";

          var inpType = document.createElement("input");
          inpType.type = "text";
          inpType.maxLength = 30;
          inpType.className = "risklib-edit-input";
          inpType.value = entry.type || "";

          var selLvl = document.createElement("select");
          selLvl.className = "risklib-edit-input";
          ["상", "중", "하"].forEach(function (lv) {
            var o = document.createElement("option");
            o.value = lv;
            o.textContent = lv;
            selLvl.appendChild(o);
          });
          selLvl.value = entry.level || "중";

          var inpMeas = document.createElement("input");
          inpMeas.type = "text";
          inpMeas.maxLength = 300;
          inpMeas.className = "risklib-edit-input";
          inpMeas.value = entry.measure || "";

          [inpCat, inpItem, inpHaz, inpType, selLvl, inpMeas].forEach(function (ctrl) {
            var td = document.createElement("td");
            td.appendChild(ctrl);
            tr.appendChild(td);
          });

          var tdCntE = document.createElement("td");
          tdCntE.textContent = String(entry.useCount || 1) + "회";
          tr.appendChild(tdCntE);

          var tdActE = document.createElement("td");
          tdActE.className = "risklib-actions";
          var btnSave = document.createElement("button");
          btnSave.type = "button";
          btnSave.className = "btn-primary risklib-btn-sm";
          btnSave.textContent = "저장";
          btnSave.addEventListener("click", async function () {
            var res = rl.updateEntry(lib, entry.id, {
              category: inpCat.value,
              item: inpItem.value,
              hazard: inpHaz.value,
              type: inpType.value,
              level: selLvl.value,
              measure: inpMeas.value
            });
            if (!res.ok) {
              if (riskLibOpts && riskLibOpts.showToast) {
                riskLibOpts.showToast(res.error || "수정할 수 없습니다.", true);
              }
              return;
            }
            riskLibState.editingId = null;
            await saveRiskLibChange(res.library, "항목을 수정했습니다.");
          });
          var btnCancel = document.createElement("button");
          btnCancel.type = "button";
          btnCancel.className = "btn-secondary risklib-btn-sm";
          btnCancel.textContent = "취소";
          btnCancel.addEventListener("click", function () {
            riskLibState.editingId = null;
            renderRiskLibrarySection();
          });
          tdActE.appendChild(btnSave);
          tdActE.appendChild(btnCancel);
          tr.appendChild(tdActE);
        } else {
          [
            entry.category || "미분류",
            entry.item || "",
            entry.hazard || "",
            entry.type || "",
            entry.level || "중",
            entry.measure || ""
          ].forEach(function (txt) {
            var td = document.createElement("td");
            td.textContent = txt;
            tr.appendChild(td);
          });

          var tdCnt = document.createElement("td");
          tdCnt.textContent = String(entry.useCount || 1) + "회";
          tr.appendChild(tdCnt);

          var tdAct = document.createElement("td");
          tdAct.className = "risklib-actions";
          var btnEdit = document.createElement("button");
          btnEdit.type = "button";
          btnEdit.className = "btn-secondary risklib-btn-sm";
          btnEdit.textContent = "수정";
          btnEdit.addEventListener("click", function () {
            riskLibState.editingId = entry.id;
            renderRiskLibrarySection();
          });
          var btnDel = document.createElement("button");
          btnDel.type = "button";
          btnDel.className = "btn-danger risklib-btn-sm";
          btnDel.textContent = "삭제";
          btnDel.addEventListener("click", async function () {
            delete riskLibState.selectedIds[entry.id];
            var nextLib = rl.deleteEntry(lib, entry.id);
            await saveRiskLibChange(nextLib, "항목을 삭제했습니다.");
          });
          tdAct.appendChild(btnEdit);
          tdAct.appendChild(btnDel);
          tr.appendChild(tdAct);
        }

        tbody.appendChild(tr);
      });
    }

    if (moreBtn) {
      var remaining = matched.length - visible.length;
      if (remaining > 0) {
        moreBtn.classList.remove("hidden");
        moreBtn.textContent = "더 보기 (" + remaining + "건 남음)";
      } else {
        moreBtn.classList.add("hidden");
      }
    }
  }

  function bindRiskLibraryEvents(opts) {
    riskLibOpts = opts;
    var searchEl = el("risklib-search");
    var catFilter = el("risklib-cat-filter");
    var checkAll = el("risklib-check-all");
    var btnBulkCat = el("btn-risklib-bulk-cat");
    var bulkCatInput = el("risklib-bulk-cat");
    var btnClear = el("btn-risklib-clear");
    var moreBtn = el("btn-risklib-more");

    if (searchEl) {
      searchEl.addEventListener("input", function () {
        riskLibState.q = searchEl.value || "";
        riskLibState.limit = 50;
        renderRiskLibrarySection();
      });
    }
    if (catFilter) {
      catFilter.addEventListener("change", function () {
        riskLibState.category = catFilter.value || "";
        riskLibState.limit = 50;
        renderRiskLibrarySection();
      });
    }
    if (checkAll) {
      checkAll.addEventListener("change", function () {
        var lib = (riskLibOpts && typeof riskLibOpts.getRiskLibrary === "function" && riskLibOpts.getRiskLibrary()) || { schemaVersion: 1, entries: [] };
        var visible = getFilteredRiskEntries(lib).slice(0, riskLibState.limit);
        visible.forEach(function (e) {
          if (checkAll.checked) riskLibState.selectedIds[e.id] = true;
          else delete riskLibState.selectedIds[e.id];
        });
        renderRiskLibrarySection();
      });
    }
    if (btnBulkCat) {
      btnBulkCat.addEventListener("click", async function () {
        var ids = Object.keys(riskLibState.selectedIds).filter(function (id) {
          return riskLibState.selectedIds[id];
        });
        if (ids.length === 0) {
          if (opts.showToast) opts.showToast("종류를 변경할 항목을 먼저 선택해 주세요.", true);
          return;
        }
        var nextCat = bulkCatInput ? bulkCatInput.value.trim() : "";
        var lib = (riskLibOpts && typeof riskLibOpts.getRiskLibrary === "function" && riskLibOpts.getRiskLibrary()) || { schemaVersion: 1, entries: [] };
        var nextLib = root.DayrepRiskLibrary.setCategory(lib, ids, nextCat);
        riskLibState.selectedIds = {};
        await saveRiskLibChange(nextLib, ids.length + "건의 종류를 변경했습니다.");
      });
    }
    if (btnClear) {
      btnClear.addEventListener("click", async function () {
        var lib = (riskLibOpts && typeof riskLibOpts.getRiskLibrary === "function" && riskLibOpts.getRiskLibrary()) || { schemaVersion: 1, entries: [] };
        var total = Array.isArray(lib.entries) ? lib.entries.length : 0;
        if (total === 0) {
          if (opts.showToast) opts.showToast("비울 항목이 없습니다.", false);
          return;
        }
        if (!window.confirm("저장된 위험성평가 " + total + "건을 모두 삭제하시겠습니까?")) return;
        riskLibState.selectedIds = {};
        riskLibState.editingId = null;
        await saveRiskLibChange({ schemaVersion: 1, entries: [] }, "위험성평가 라이브러리를 비웠습니다.");
      });
    }
    if (moreBtn) {
      moreBtn.addEventListener("click", function () {
        riskLibState.limit += 50;
        renderRiskLibrarySection();
      });
    }
    renderRiskLibrarySection();
  }

  root.DayrepSettingsUI = {
    renderSettingsForm: renderSettingsForm,
    renderStampGrid: renderStampGrid,
    renderRiskLibrarySection: renderRiskLibrarySection,
    bindSettingsEvents: bindSettingsEvents
  };
})(window);
