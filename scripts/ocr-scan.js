import { parseOcrTextToTable } from "./ocr-parse.js";
import {
  getUniqueEmails,
  findEmailColumnIndex,
  extractEmailsFromText,
} from "./csv.js";
import { OCR_SPACE_API_KEY } from "./config.js";
import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";

const ROW_NUMBER_TRIM_PX = 40;
const OCR_VARIANT_MAX_DIMENSION = 2200;
const DEFAULT_SCROLL_STEPS = 25;
const MAX_STAGNANT_SEGMENTS = 3;

async function getScanPlan(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => {
      function getBestRowCount() {
        const candidates = [];
        for (const el of document.querySelectorAll("[aria-rowcount]")) {
          const raw = parseInt(el.getAttribute("aria-rowcount"), 10);
          if (!Number.isNaN(raw) && raw > 0) candidates.push(raw);
        }
        if (candidates.length === 0) return null;
        return Math.max(...candidates);
      }

      const grid =
        document.querySelector("#grid-container [role='grid']") ||
        document.querySelector("#waffle-grid-container [role='grid']") ||
        document.querySelector("[role='grid']") ||
        document.querySelector("#grid-container") ||
        document.querySelector("#waffle-grid-container");

      if (!grid) {
        return {
          suggestedSteps: 25,
          totalRows: null,
          visibleRows: null,
        };
      }

      const rowIndices = new Set();
      const rows = grid.querySelectorAll('[role="row"][aria-rowindex]');
      for (const row of rows) {
        const idx = parseInt(row.getAttribute("aria-rowindex"), 10);
        if (!Number.isNaN(idx) && idx > 1) rowIndices.add(idx);
      }

      if (rowIndices.size === 0) {
        const cells = grid.querySelectorAll('[role="gridcell"][aria-rowindex]');
        for (const cell of cells) {
          const idx = parseInt(cell.getAttribute("aria-rowindex"), 10);
          if (!Number.isNaN(idx) && idx > 1) rowIndices.add(idx);
        }
      }

      const visibleRows = Math.max(1, rowIndices.size || 20);
      const ariaRowCount = getBestRowCount();
      const totalRows = ariaRowCount ? Math.max(0, ariaRowCount - 1) : null;

      if (!totalRows) {
        return {
          suggestedSteps: Math.max(1, Math.min(8, Math.ceil(visibleRows / 8))),
          totalRows: null,
          visibleRows,
        };
      }

      const stride = Math.max(1, Math.floor(visibleRows * 0.8));
      const estimatedSteps = Math.ceil(totalRows / stride);

      return {
        suggestedSteps: Math.max(1, Math.min(300, estimatedSteps)),
        totalRows,
        visibleRows,
      };
    },
  });

  return (
    result?.result || {
      suggestedSteps: DEFAULT_SCROLL_STEPS,
      totalRows: null,
      visibleRows: null,
    }
  );
}

async function callOcrSpaceApi(dataUrl) {
  const base64Image = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");

  const formData = new FormData();
  formData.append("base64Image", "data:image/png;base64," + base64Image);
  formData.append("apikey", OCR_SPACE_API_KEY);
  formData.append("language", "eng");
  formData.append("OCREngine", "2");
  formData.append("isTable", "true");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OCR.space request failed: HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.IsErroredOnProcessing) {
    throw new Error(`OCR.space error: ${json.ErrorMessage?.[0] || "Unknown error"}`);
  }

  const parsed = json.ParsedResults?.[0];
  if (!parsed) {
    throw new Error("OCR.space returned no results.");
  }

  return parsed.ParsedText || "";
}

function isRateLimitError(error) {
  const text = String(error?.message || error || "");
  return /rate limit exceeded|retryafter|free plan/i.test(text);
}

async function callLocalOcr(dataUrl, callbacks = {}) {
  const { onStatus } = callbacks;
  onStatus?.("Running local OCR fallback…");

  const result = await Tesseract.recognize(dataUrl, "eng", {
    logger: (message) => {
      if (message?.status === "recognizing text") {
        const progress = typeof message.progress === "number"
          ? Math.round(message.progress * 100)
          : null;
        onStatus?.(
          progress == null ? "Local OCR in progress…" : `Local OCR in progress… ${progress}%`
        );
      }
    },
  });

  return result?.data?.text || "";
}

function clampCanvasSize(width, height, maxDimension = OCR_VARIANT_MAX_DIMENSION) {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height, scale: 1 };
  }

  const scale = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function createCanvasContext(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) {
    throw new Error("Could not create image processing context.");
  }
  return { canvas, ctx };
}

function drawBaseImage(image, maxDimension) {
  const size = clampCanvasSize(image.width, image.height, maxDimension);
  const { canvas, ctx } = createCanvasContext(size.width, size.height);
  ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, size.width, size.height);
  return { canvas, ctx, scale: size.scale };
}

function convertCanvasToDataUrl(canvas) {
  return canvas.toDataURL("image/png");
}

function applyHighContrast(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    const contrast = gray > 210 ? 255 : gray < 150 ? 0 : gray;
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }

  ctx.putImageData(imageData, 0, 0);
}

async function buildOcrImageVariants(dataUrl) {
  const image = await loadImage(dataUrl);
  const variants = [];

  const base = drawBaseImage(image, OCR_VARIANT_MAX_DIMENSION);
  variants.push({
    label: "base",
    dataUrl: convertCanvasToDataUrl(base.canvas),
  });

  const contrast = drawBaseImage(image, OCR_VARIANT_MAX_DIMENSION);
  applyHighContrast(contrast.ctx, contrast.canvas.width, contrast.canvas.height);
  variants.push({
    label: "contrast",
    dataUrl: convertCanvasToDataUrl(contrast.canvas),
  });

  const enlarged = drawBaseImage(image, Math.max(OCR_VARIANT_MAX_DIMENSION, 3000));
  variants.push({
    label: "enlarged",
    dataUrl: convertCanvasToDataUrl(enlarged.canvas),
  });

  return variants;
}

async function runBestEffortOcr(dataUrl, callbacks = {}) {
  const { onStatus, onProgress } = callbacks;

  // Build variants fresh for this invocation — no module-level state.
  const variants = await buildOcrImageVariants(dataUrl);
  onStatus?.(`Running OCR (${variants.length} variants)…`);

  // Fire all OCR API calls in parallel so no prior variant's result leaks into
  // the next call's closure. Each call is fully independent.
  const settled = await Promise.allSettled(
    variants.map((v) => callOcrSpaceApi(v.dataUrl))
  );

  onProgress?.(1);

  let bestResult = null;
  let firstError = null;
  let needsLocalFallback = false;

  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      if (!firstError) firstError = outcome.reason;
      if (isRateLimitError(outcome.reason)) {
        needsLocalFallback = true;
      }
      continue;
    }

    const text = outcome.value;
    const rawEmails = extractEmailsFromText(text);
    const parsed = parseOcrTextToTable(text);
    const parsedEmails = parsed ? getUniqueEmails(parsed) : [];
    const candidate = {
      parsed,
      rawEmails,
      rawEmailCount: rawEmails.length,
      parsedEmailCount: parsedEmails.length,
      rowCount: parsed?.rows?.length || 0,
    };

    if (
      !bestResult ||
      candidate.rawEmailCount > bestResult.rawEmailCount ||
      (candidate.rawEmailCount === bestResult.rawEmailCount &&
        candidate.parsedEmailCount > bestResult.parsedEmailCount) ||
      (candidate.rawEmailCount === bestResult.rawEmailCount &&
        candidate.parsedEmailCount === bestResult.parsedEmailCount &&
        candidate.rowCount > bestResult.rowCount)
    ) {
      bestResult = candidate;
    }
  }

  if (needsLocalFallback) {
    try {
      for (const variant of variants) {
        const text = await callLocalOcr(variant.dataUrl, { onStatus });
        const rawEmails = extractEmailsFromText(text);
        if (rawEmails.length === 0) continue;

        const parsed = parseOcrTextToTable(text);
        const parsedEmails = parsed ? getUniqueEmails(parsed) : [];

        if (parsed && parsedEmails.length >= Math.max(2, Math.ceil(rawEmails.length * 0.4))) {
          return {
            ...parsed,
            warning: `${parsed.warning || "OCR used a local fallback because the API rate-limited this request."}`,
          };
        }

        return {
          source: "google-sheets-ocr",
          headers: ["email"],
          rows: rawEmails.map((email) => [email]),
          warning:
            "OCR.space rate-limited this request, so the scan used local OCR fallback. Table structure may be less accurate.",
        };
      }
    } catch (fallbackError) {
      firstError = firstError || fallbackError;
    }
  }

  if (bestResult) {
    const { parsed, rawEmails, parsedEmailCount, rawEmailCount } = bestResult;

    // Use table parse when it captures a substantial portion of recognized emails.
    if (parsed && parsedEmailCount >= Math.max(2, Math.ceil(rawEmailCount * 0.4))) {
      return parsed;
    }

    // Fallback: keep email-only rows so OCR hits are not dropped by table parsing.
    if (rawEmails.length > 0) {
      return {
        source: "google-sheets-ocr",
        headers: ["email"],
        rows: rawEmails.map((email) => [email]),
        warning:
          "OCR used email-only fallback because table parsing quality was low. Scroll and scan again for better structure.",
      };
    }
  }

  if (firstError) throw firstError;
  throw new Error(
    "OCR found no emails in the visible sheet area. Scroll so rows are visible and try again."
  );
}

function mergeParsedSegments(segments) {
  if (!segments.length) return null;

  const base = segments[0];
  const headers = [...base.headers];
  const mergedRows = [];

  for (const segment of segments) {
    for (const row of segment.rows) {
      const normalized = [...row];
      while (normalized.length < headers.length) normalized.push("");
      mergedRows.push(normalized.slice(0, headers.length));
    }
  }

  const emailColIdx = findEmailColumnIndex(headers, mergedRows);
  const dedupedRows = [];
  const seenEmails = new Set();
  const seenRows = new Set();

  for (const row of mergedRows) {
    const rowKey = row.join("\u0001");
    if (emailColIdx !== -1) {
      const email = (row[emailColIdx] || "").trim().toLowerCase();
      if (email) {
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);
        dedupedRows.push(row);
        continue;
      }
    }
    if (!seenRows.has(rowKey)) {
      seenRows.add(rowKey);
      dedupedRows.push(row);
    }
  }

  return {
    source: "google-sheets-ocr",
    headers,
    rows: dedupedRows,
    warning: `${segments[0].warning} Captured ${segments.length} viewport segment${segments.length === 1 ? "" : "s"}.`,
  };
}

async function scrollSheetDown(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => {
      function uniqueElements(items) {
        const seen = new Set();
        const out = [];
        for (const el of items) {
          if (!el || seen.has(el)) continue;
          seen.add(el);
          out.push(el);
        }
        return out;
      }

      function getScrollableAncestors(el) {
        const list = [];
        let node = el;
        while (node && node !== document.body) {
          if (node instanceof HTMLElement) {
            const canScroll = node.scrollHeight > node.clientHeight + 12;
            if (canScroll) list.push(node);
          }
          node = node.parentElement;
        }
        return list;
      }

      const grid =
        document.querySelector("#grid-container [role='grid']") ||
        document.querySelector("#waffle-grid-container [role='grid']") ||
        document.querySelector("[role='grid']") ||
        document.querySelector("#grid-container") ||
        document.querySelector("#waffle-grid-container");

      if (!grid) {
        return { moved: false, reason: "No sheet grid found." };
      }

      const rect = grid.getBoundingClientRect();
      const cx = Math.floor(rect.left + rect.width / 2);
      const cy = Math.floor(rect.top + rect.height / 2);
      const pointEl = document.elementFromPoint(cx, cy);

      const candidates = uniqueElements([
        ...getScrollableAncestors(pointEl),
        ...getScrollableAncestors(grid),
        grid,
        document.scrollingElement,
      ]);

      let moved = false;
      let usedTarget = "";

      for (const target of candidates) {
        if (!(target instanceof HTMLElement) && target !== document.scrollingElement) continue;

        const before = target.scrollTop;
        const step = Math.max(120, Math.floor((target.clientHeight || window.innerHeight) * 0.9));

        if (target instanceof HTMLElement) {
          target.focus?.({ preventScroll: true });
        }

        target.scrollTop = before + step;

        if (target.scrollTop === before && target instanceof HTMLElement) {
          target.dispatchEvent(
            new WheelEvent("wheel", { deltaY: step, bubbles: true, cancelable: true })
          );
        }

        if (target.scrollTop === before && target instanceof HTMLElement) {
          target.dispatchEvent(
            new KeyboardEvent("keydown", { key: "PageDown", code: "PageDown", bubbles: true })
          );
        }

        if (target.scrollTop > before) {
          moved = true;
          usedTarget = (target.id && `#${target.id}`) || target.className || target.tagName || "unknown";
          break;
        }
      }

      // Final fallback for virtualized panes where scrollTop is not exposed.
      if (!moved && grid instanceof HTMLElement) {
        grid.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true })
        );
        grid.dispatchEvent(
          new KeyboardEvent("keydown", { key: "PageDown", code: "PageDown", bubbles: true })
        );
        moved = true;
        usedTarget = "keyboard-fallback";
      }

      return { moved, usedTarget };
    },
  });

  return result?.result || { moved: false };
}

async function getGridBounds(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ["scripts/grid-bounds.js"],
  });

  const [result] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => window.__gridBounds ?? null,
  });

  return result?.result ?? null;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load screenshot image."));
    img.src = dataUrl;
  });
}

async function cropScreenshot(dataUrl, bounds) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const dpr = bounds?.dpr || 1;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const trimLeft = Math.min(ROW_NUMBER_TRIM_PX * dpr, bounds.width * dpr * 0.15);
    sx = Math.max(0, Math.floor(bounds.x * dpr + trimLeft));
    sy = Math.max(0, Math.floor(bounds.y * dpr));
    sw = Math.min(img.width - sx, Math.floor(bounds.width * dpr - trimLeft));
    sh = Math.min(img.height - sy, Math.floor(bounds.height * dpr));
  }

  if (sw < 10 || sh < 10) {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  } else {
    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  return canvas.toDataURL("image/png");
}

export async function runOcrScan(tabId, callbacks = {}) {
  const { onStatus, onProgress, scrollSteps } = callbacks;
  const tab = await chrome.tabs.get(tabId);
  const plan = await getScanPlan(tabId);
  const explicitSteps = parseInt(scrollSteps, 10);
  const maxSteps =
    Number.isFinite(explicitSteps) && explicitSteps > 0
      ? explicitSteps
      : plan.suggestedSteps || DEFAULT_SCROLL_STEPS;

  onStatus?.(
    plan.totalRows
      ? `Estimated rows: ${plan.totalRows}, visible per view: ${plan.visibleRows || "?"}, planned captures: ${maxSteps}.`
      : `Could not read total row count. Planned captures: ${maxSteps}.`
  );

  const segments = [];
  const seenEmails = new Set();
  let stagnantSegments = 0;
  const stagnantLimit = Math.max(MAX_STAGNANT_SEGMENTS, Math.min(10, Math.ceil(maxSteps * 0.15)));

  for (let step = 0; step < maxSteps; step++) {
    onStatus?.(`Capture ${step + 1}/${maxSteps}: getting bounds…`);
    const bounds = await getGridBounds(tabId);

    onStatus?.(`Capture ${step + 1}/${maxSteps}: screenshot…`);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

    onStatus?.(`Capture ${step + 1}/${maxSteps}: preparing image…`);
    const croppedDataUrl = await cropScreenshot(dataUrl, bounds);

    try {
      const parsed = await runBestEffortOcr(croppedDataUrl, {
        onStatus: (msg) => onStatus?.(`Capture ${step + 1}/${maxSteps}: ${msg}`),
      });
      if (parsed) {
        segments.push(parsed);
        const emails = getUniqueEmails(parsed);
        let newEmailCount = 0;
        for (const email of emails) {
          if (!seenEmails.has(email)) {
            seenEmails.add(email);
            newEmailCount += 1;
          }
        }
        if (newEmailCount === 0) {
          stagnantSegments += 1;
        } else {
          stagnantSegments = 0;
        }
        onStatus?.(
          `Capture ${step + 1}/${maxSteps}: +${newEmailCount} new email${newEmailCount === 1 ? "" : "s"} (${seenEmails.size} total).`
        );
      } else {
        stagnantSegments += 1;
      }
    } catch {
      // Continue to next segment so partial OCR still works.
      stagnantSegments += 1;
    }

    onProgress?.((step + 1) / maxSteps);

    if (step < maxSteps - 1) {
      if (stagnantSegments >= stagnantLimit) {
        onStatus?.(
          `Capture ${step + 1}/${maxSteps}: stopping after ${stagnantSegments} segments with no new emails.`
        );
        break;
      }
      onStatus?.(`Capture ${step + 1}/${maxSteps}: scrolling down…`);
      const scroll = await scrollSheetDown(tabId);
      if (!scroll.moved) {
        onStatus?.(`Capture ${step + 1}/${maxSteps}: reached end of visible sheet.`);
        break;
      }
      if (scroll.usedTarget) {
        onStatus?.(`Capture ${step + 1}/${maxSteps}: scrolled via ${scroll.usedTarget}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  const parsed = mergeParsedSegments(segments);
  if (!parsed || !parsed.rows.length) {
    throw new Error(
      "OCR found no emails in the visible sheet area. Scroll so rows are visible and try again."
    );
  }

  const emails = getUniqueEmails(parsed);

  return {
    success: true,
    data: {
      source: parsed.source,
      sourceLabel: "Google Sheets (OCR)",
      headers: parsed.headers,
      rows: parsed.rows,
      emailCount: emails.length,
      rowCount: parsed.rows.length,
      warning: parsed.warning,
    },
  };
}
