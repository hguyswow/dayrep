(function (root) {
  "use strict";

  var MAX_BYTES = 20 * 1024 * 1024;
  var ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp"];
  var MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp"
  };

  function formatKoreanDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return dateStr || "";
    var p = dateStr.split("-");
    return p[0] + "년 " + p[1] + "월 " + p[2] + "일";
  }

  function makeEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function resolveFileExt(file) {
    if (!file) return null;
    if (file.type && MIME_TO_EXT[file.type.toLowerCase()]) {
      return MIME_TO_EXT[file.type.toLowerCase()];
    }
    var name = String(file.name || "");
    var parts = name.split(".");
    if (parts.length > 1) {
      var ext = parts.pop().toLowerCase();
      if (ALLOWED_EXTS.indexOf(ext) !== -1) return ext;
    }
    return null;
  }

  function fileToDataUrl(file) {
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

  function createDoc2Controller() {
    // slot 1..6 -> { filename, ext, base64 } | null
    var slotMap = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
    var loadedDate = null;
    var lastCtx = null;
    var lastContainer = null;
    var busy = false;

    function getEmptySlots() {
      var list = [];
      for (var i = 1; i <= 6; i++) {
        if (!slotMap[i]) list.push(i);
      }
      return list;
    }

    function syncDayPhotoList(day) {
      if (!day.tbmPhotos) day.tbmPhotos = { place: "현장내", photos: [] };
      var arr = [];
      for (var i = 1; i <= 6; i++) {
        if (slotMap[i] && slotMap[i].filename) {
          arr.push(slotMap[i].filename);
        }
      }
      day.tbmPhotos.photos = arr;
    }

    async function loadAllPhotos(ctx) {
      var date = ctx.dayData.date;
      if (loadedDate === date) return;
      loadedDate = date;
      for (var i = 1; i <= 6; i++) {
        slotMap[i] = null;
      }
      if (!ctx.invoke) return;
      for (var idx = 1; idx <= 6; idx++) {
        try {
          var data = await ctx.invoke("read_photo", { date: date, idx: idx });
          if (data && data.base64) {
            slotMap[idx] = data;
          }
        } catch (err) {
          // skip unreadable slot
        }
      }
      syncDayPhotoList(ctx.dayData);
    }

    async function saveOnePhoto(ctx, idx, file) {
      var ext = resolveFileExt(file);
      if (!ext) {
        ctx.showToast("지원하지 않는 이미지 형식입니다. (jpg/jpeg/png/webp만 가능)", true);
        return false;
      }
      if (file.size > MAX_BYTES) {
        ctx.showToast("사진 크기가 20MB를 초과합니다: " + (file.name || ""), true);
        return false;
      }
      var dataUrl = await fileToDataUrl(file);
      var b64Payload = dataUrl.indexOf(";base64,") !== -1
        ? dataUrl.split(";base64,")[1]
        : dataUrl;

      if (ctx.invoke) {
        var filename = await ctx.invoke("save_photo", {
          date: ctx.dayData.date,
          idx: idx,
          bytesB64: dataUrl,
          ext: ext
        });
        slotMap[idx] = { filename: filename, ext: ext, base64: b64Payload };
      } else {
        slotMap[idx] = {
          filename: String(idx).padStart(2, "0") + "." + ext,
          ext: ext,
          base64: b64Payload
        };
      }
      syncDayPhotoList(ctx.dayData);
      ctx.onDayChange(ctx.dayData);
      return true;
    }

    async function fillEmptySlots(ctx, fileList) {
      if (busy) return;
      var files = Array.prototype.slice.call(fileList || []);
      if (files.length === 0) return;

      busy = true;
      try {
        var empties = getEmptySlots();
        if (empties.length === 0) {
          ctx.showToast("빈 사진 칸이 없습니다. 기존 칸을 삭제하거나 클릭해 교체하세요.", true);
          return;
        }
        var limit = Math.min(files.length, empties.length);
        var savedCount = 0;
        for (var i = 0; i < limit; i++) {
          try {
            var ok = await saveOnePhoto(ctx, empties[i], files[i]);
            if (ok) savedCount += 1;
          } catch (err) {
            ctx.showToast(empties[i] + "번 칸 저장 실패: " + String(err), true);
          }
        }
        if (files.length > empties.length) {
          ctx.showToast(
            "빈 칸(" + empties.length + "개) 초과분은 무시하고 " + savedCount + "장 등록했습니다.",
            false
          );
        } else if (savedCount > 0) {
          ctx.showToast(savedCount + "장의 사진이 등록되었습니다.", false);
        }
      } finally {
        busy = false;
        if (lastContainer && lastCtx) renderSheetOnly(lastContainer, lastCtx);
      }
    }

    async function swapSlots(ctx, srcIdx, dstIdx) {
      if (busy || srcIdx === dstIdx) return;
      if (!slotMap[srcIdx]) return;
      busy = true;
      try {
        var date = ctx.dayData.date;
        if (ctx.invoke) {
          var srcData = await ctx.invoke("read_photo", { date: date, idx: srcIdx });
          var dstData = await ctx.invoke("read_photo", { date: date, idx: dstIdx });
          if (!srcData) return;

          await ctx.invoke("save_photo", {
            date: date,
            idx: dstIdx,
            bytesB64: srcData.base64,
            ext: srcData.ext
          });
          if (dstData) {
            await ctx.invoke("save_photo", {
              date: date,
              idx: srcIdx,
              bytesB64: dstData.base64,
              ext: dstData.ext
            });
          } else {
            await ctx.invoke("delete_photo", { date: date, idx: srcIdx });
          }
          slotMap[dstIdx] = await ctx.invoke("read_photo", { date: date, idx: dstIdx });
          slotMap[srcIdx] = dstData
            ? await ctx.invoke("read_photo", { date: date, idx: srcIdx })
            : null;
        } else {
          var tmp = slotMap[dstIdx];
          slotMap[dstIdx] = slotMap[srcIdx];
          slotMap[srcIdx] = tmp;
        }
        syncDayPhotoList(ctx.dayData);
        ctx.onDayChange(ctx.dayData);
        ctx.showToast(srcIdx + "번과 " + dstIdx + "번 사진 위치를 변경했습니다.", false);
      } catch (err) {
        ctx.showToast("사진 위치 변경 실패: " + String(err), true);
      } finally {
        busy = false;
        if (lastContainer && lastCtx) renderSheetOnly(lastContainer, lastCtx);
      }
    }

    async function removeSlot(ctx, idx) {
      if (busy) return;
      busy = true;
      try {
        if (ctx.invoke) {
          await ctx.invoke("delete_photo", { date: ctx.dayData.date, idx: idx });
        }
        slotMap[idx] = null;
        syncDayPhotoList(ctx.dayData);
        ctx.onDayChange(ctx.dayData);
        ctx.showToast(idx + "번 칸 사진이 삭제되었습니다.", false);
      } catch (err) {
        ctx.showToast("사진 삭제 실패: " + String(err), true);
      } finally {
        busy = false;
        if (lastContainer && lastCtx) renderSheetOnly(lastContainer, lastCtx);
      }
    }

    function renderSheetOnly(container, ctx) {
      container.textContent = "";
      var day = ctx.dayData;
      if (!day.tbmPhotos) day.tbmPhotos = { place: "현장내", photos: [] };

      // 1. 툴바 (.no-print)
      var toolbar = makeEl("div", "doc-toolbar no-print");
      var leftGroup = makeEl("div", "toolbar-group");

      var multiLabel = makeEl("label", "btn-primary");
      multiLabel.textContent = "사진 6개 넣기";
      var multiInput = document.createElement("input");
      multiInput.type = "file";
      multiInput.multiple = true;
      multiInput.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
      multiInput.className = "hidden";
      multiInput.addEventListener("change", function () {
        if (multiInput.files && multiInput.files.length > 0) {
          fillEmptySlots(ctx, multiInput.files);
          multiInput.value = "";
        }
      });
      multiLabel.appendChild(multiInput);
      leftGroup.appendChild(multiLabel);

      var hint = makeEl(
        "span",
        "muted-inline",
        "칸 클릭: 개별 교체 · Ctrl+V: 빈 칸 붙여넣기 · 드래그: 파일 추가/위치 교환"
      );
      leftGroup.appendChild(hint);

      var rightGroup = makeEl("div", "toolbar-group");
      var btnPrint = makeEl("button", "btn-secondary", "이 서류 인쇄");
      btnPrint.type = "button";
      btnPrint.addEventListener("click", function () {
        if (root.DayrepExport && typeof root.DayrepExport.printCurrentSheet === "function") {
          root.DayrepExport.printCurrentSheet(container.querySelector(".a4-sheet"));
        } else {
          window.print();
        }
      });
      rightGroup.appendChild(btnPrint);

      toolbar.appendChild(leftGroup);
      toolbar.appendChild(rightGroup);
      container.appendChild(toolbar);

      // 2. A4 시트
      var sheet = makeEl("div", "a4-sheet doc2-sheet");
      sheet.addEventListener("dragover", function (e) {
        e.preventDefault();
      });
      sheet.addEventListener("drop", function (e) {
        if (e.target && e.target.closest && e.target.closest(".doc2-photo-cell")) return;
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          fillEmptySlots(ctx, e.dataTransfer.files);
        }
      });

      var title = makeEl("div", "doc2-title", "T.B.M 사진대지");
      sheet.appendChild(title);

      var metaBox = makeEl("div", "doc2-meta");
      var rowDate = makeEl("div", "doc2-meta-row");
      rowDate.appendChild(makeEl("span", "doc2-meta-label", "일  시 :"));
      rowDate.appendChild(makeEl("span", "doc2-meta-val", formatKoreanDate(day.date)));

      var rowPlace = makeEl("div", "doc2-meta-row");
      rowPlace.appendChild(makeEl("span", "doc2-meta-label", "장  소 :"));
      var placeInput = document.createElement("input");
      placeInput.type = "text";
      placeInput.className = "doc2-place-input";
      placeInput.value = day.tbmPhotos.place !== undefined ? day.tbmPhotos.place : "현장내";
      placeInput.addEventListener("input", function () {
        day.tbmPhotos.place = placeInput.value;
        ctx.onDayChange(day);
      });
      rowPlace.appendChild(placeInput);

      metaBox.appendChild(rowDate);
      metaBox.appendChild(rowPlace);
      sheet.appendChild(metaBox);

      // 2열 x 3행 사진 표
      var gridTable = makeEl("table", "doc2-photo-table");
      for (var r = 0; r < 3; r++) {
        var tr = document.createElement("tr");
        for (var c = 0; c < 2; c++) {
          (function (idx) {
            var td = makeEl("td", "doc2-photo-cell");
            var slotBox = makeEl("div", "doc2-slot-box");
            var photo = slotMap[idx];

            var fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
            fileInput.className = "hidden";
            fileInput.addEventListener("change", async function () {
              var f = fileInput.files && fileInput.files[0];
              fileInput.value = "";
              if (!f) return;
              busy = true;
              try {
                var ok = await saveOnePhoto(ctx, idx, f);
                if (ok) ctx.showToast(idx + "번 칸 사진이 저장되었습니다.", false);
              } catch (err) {
                ctx.showToast(idx + "번 칸 저장 실패: " + String(err), true);
              } finally {
                busy = false;
                renderSheetOnly(container, ctx);
              }
            });

            if (photo && photo.base64) {
              slotBox.draggable = true;
              slotBox.addEventListener("dragstart", function (e) {
                if (e.dataTransfer) {
                  e.dataTransfer.setData("text/x-dayrep-slot", String(idx));
                  e.dataTransfer.effectAllowed = "move";
                }
              });

              var img = document.createElement("img");
              var mime = photo.ext === "jpg" ? "jpeg" : photo.ext;
              img.src = "data:image/" + mime + ";base64," + photo.base64;
              img.alt = "TBM 사진 " + idx;
              img.className = "photo-slot-img";
              slotBox.appendChild(img);

              var overlay = makeEl("div", "slot-overlay no-print");
              var badge = makeEl("span", "slot-num-badge", String(idx));
              var btnDel = makeEl("button", "slot-del-btn", "삭제");
              btnDel.type = "button";
              btnDel.addEventListener("click", function (ev) {
                ev.stopPropagation();
                removeSlot(ctx, idx);
              });
              overlay.appendChild(badge);
              overlay.appendChild(btnDel);
              slotBox.appendChild(overlay);
            } else {
              var emptyHint = makeEl("div", "slot-empty-hint no-print", idx + "번 사진 클릭/드롭");
              slotBox.appendChild(emptyHint);
            }

            slotBox.addEventListener("click", function () {
              fileInput.click();
            });
            slotBox.addEventListener("dragover", function (e) {
              e.preventDefault();
              slotBox.classList.add("drag-over");
            });
            slotBox.addEventListener("dragleave", function () {
              slotBox.classList.remove("drag-over");
            });
            slotBox.addEventListener("drop", async function (e) {
              e.preventDefault();
              e.stopPropagation();
              slotBox.classList.remove("drag-over");
              if (!e.dataTransfer) return;

              var srcSlotStr = e.dataTransfer.getData("text/x-dayrep-slot");
              if (srcSlotStr) {
                var srcIdx = parseInt(srcSlotStr, 10);
                if (srcIdx >= 1 && srcIdx <= 6) {
                  await swapSlots(ctx, srcIdx, idx);
                }
                return;
              }
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                var firstFile = e.dataTransfer.files[0];
                busy = true;
                try {
                  var ok = await saveOnePhoto(ctx, idx, firstFile);
                  if (ok) ctx.showToast(idx + "번 칸 사진이 저장되었습니다.", false);
                } catch (err) {
                  ctx.showToast(idx + "번 칸 저장 실패: " + String(err), true);
                } finally {
                  busy = false;
                  renderSheetOnly(container, ctx);
                }
              }
            });

            slotBox.appendChild(fileInput);
            td.appendChild(slotBox);
            tr.appendChild(td);
          })(r * 2 + c + 1);
        }
        gridTable.appendChild(tr);
      }

      sheet.appendChild(gridTable);
      container.appendChild(sheet);
    }

    async function render(container, ctx) {
      lastContainer = container;
      lastCtx = ctx;
      await loadAllPhotos(ctx);
      renderSheetOnly(container, ctx);
    }

    function handlePaste(e) {
      if (!lastCtx || !lastContainer) return;
      if (!e.clipboardData) return;
      var files = [];
      if (e.clipboardData.files && e.clipboardData.files.length > 0) {
        for (var i = 0; i < e.clipboardData.files.length; i++) {
          var f = e.clipboardData.files[i];
          if (resolveFileExt(f)) files.push(f);
        }
      } else if (e.clipboardData.items) {
        for (var j = 0; j < e.clipboardData.items.length; j++) {
          var item = e.clipboardData.items[j];
          if (item.kind === "file" && item.type && item.type.indexOf("image/") === 0) {
            var file = item.getAsFile();
            if (file && resolveFileExt(file)) files.push(file);
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        fillEmptySlots(lastCtx, files);
      }
    }

    function resetDateCache() {
      loadedDate = null;
    }

    return {
      render: render,
      handlePaste: handlePaste,
      resetDateCache: resetDateCache
    };
  }

  root.DayrepDoc2UI = {
    createDoc2Controller: createDoc2Controller
  };
})(window);
