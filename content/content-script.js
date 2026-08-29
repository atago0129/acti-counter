(function () {
  "use strict";

  const RESULT_TITLE = "今回のタイピング結果";
  const APP_STATE_KEY = "appState";
  const PANEL_POSITION_KEY = "panelPosition";
  const STOPWATCH_STATE_KEY = "stopwatchState";
  const MAX_COUNT = 100;
  const DEFAULT_TARGET_COUNT = 10;

  function isTargetPath(pathname) {
    return pathname === "/typing" || pathname.startsWith("/typing/");
  }

  if (!isTargetPath(window.location.pathname)) {
    return;
  }

  if (document.querySelector("[data-acti-counter-root]")) {
    return;
  }

  const DEFAULT_STOPWATCH_STATE = Object.freeze({
    isRunning: false,
    startedAt: null,
    elapsedMs: 0
  });

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response) {
          reject(new Error("拡張機能から応答がありません"));
          return;
        }
        if (response.ok === false) {
          reject(new Error(response.error || "処理に失敗しました"));
          return;
        }
        resolve(response);
      });
    });
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || !element.getClientRects().length) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }

  function detectResultPage() {
    const preferred = Array.from(document.querySelectorAll(".title_text-result"));
    const fallback = Array.from(document.querySelectorAll("h1, h2, h3"));
    return preferred.concat(fallback).some((element) => (
      isVisible(element) && normalizeText(element.textContent).includes(RESULT_TITLE)
    ));
  }

  function normalizeStopwatchState(state) {
    if (!state || typeof state !== "object") {
      return { ...DEFAULT_STOPWATCH_STATE };
    }

    const elapsedMs = Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0
      ? Math.trunc(state.elapsedMs)
      : 0;
    const startedAt = Number.isFinite(state.startedAt) && state.startedAt >= 0
      ? Math.trunc(state.startedAt)
      : null;

    if (state.isRunning !== true || startedAt === null) {
      return {
        isRunning: false,
        startedAt: null,
        elapsedMs
      };
    }

    return {
      isRunning: true,
      startedAt,
      elapsedMs
    };
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function getElapsedMs(state, now = Date.now()) {
    if (!state.isRunning || state.startedAt === null) {
      return state.elapsedMs;
    }
    return state.elapsedMs + Math.max(0, now - state.startedAt);
  }

  function createInterface() {
    const host = document.createElement("div");
    host.dataset.actiCounterRoot = "true";
    document.documentElement.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .panel,
        .panel *,
        .dialog,
        .dialog * {
          box-sizing: border-box;
        }

        .panel {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          width: 238px;
          color: #42210B;
          background: rgba(255, 250, 239, 0.97);
          border: 3px solid #8E610D;
          border-radius: 18px;
          box-shadow: 0 4px 16px rgba(66, 33, 11, 0.24);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 14px;
          line-height: 1.4;
          overflow: hidden;
          pointer-events: auto;
        }

        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 12px;
          color: #fff;
          background: #8E610D;
          cursor: grab;
          font-weight: 900;
          touch-action: none;
          user-select: none;
        }

        .panel.dragging .panel-header {
          cursor: grabbing;
        }

        .brand {
          letter-spacing: 0.04em;
        }

        button {
          appearance: none;
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          font: inherit;
          font-weight: 800;
          transition: filter 0.15s ease, opacity 0.15s ease;
        }

        button:hover:not(:disabled) {
          filter: brightness(0.94);
        }

        button:focus-visible {
          outline: 3px solid #38A9FF;
          outline-offset: 2px;
        }

        button:disabled {
          cursor: not-allowed;
          opacity: 0.42;
        }

        .settings-button {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          padding: 5px;
          color: #42210B;
          background: #FFF8EA;
        }

        .settings-button svg {
          width: 18px;
          height: 18px;
          fill: none;
          stroke: currentColor;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-width: 2;
        }

        .counter-section,
        .stopwatch-section {
          padding: 12px 14px;
        }

        .counter-section {
          border-bottom: 1px solid rgba(142, 97, 13, 0.28);
          text-align: center;
        }

        .section-label {
          display: block;
          margin-bottom: 2px;
          color: #8E610D;
          font-size: 12px;
          font-weight: 900;
        }

        .count {
          font-size: 30px;
          font-weight: 900;
        }

        .count-limit {
          margin-left: 4px;
          color: #8E610D;
          font-size: 12px;
          font-weight: 800;
        }

        .stopwatch-section {
          background: rgba(255, 255, 255, 0.52);
        }

        .stopwatch-time {
          display: block;
          margin: 4px 0 10px;
          color: #42210B;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: 0.03em;
          text-align: center;
        }

        .stopwatch-controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .start-button {
          color: #42210B;
          background: #FFEF00;
          border: 2px solid #C69600;
          padding: 7px 4px;
        }

        .stop-button {
          color: #fff;
          background: #F37853;
          border: 2px solid #C85B3A;
          padding: 7px 4px;
        }

        .reset-button {
          grid-column: 1 / -1;
          color: #42210B;
          background: #E8F3FF;
          border: 2px solid #38A9FF;
          padding: 5px 4px;
          font-size: 12px;
        }

        .status {
          min-height: 18px;
          margin: 6px 0 0;
          color: #8E610D;
          font-size: 11px;
          text-align: center;
        }

        .overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          place-items: center;
          padding: 16px;
          background: rgba(66, 33, 11, 0.42);
        }

        .overlay[hidden],
        .hidden {
          display: none !important;
        }

        .dialog {
          width: min(560px, calc(100vw - 32px));
          max-height: min(78vh, 680px);
          overflow: auto;
          padding: 18px;
          color: #42210B;
          background: #FFF8EA;
          border: 3px solid #8E610D;
          border-radius: 20px;
          box-shadow: 0 8px 24px rgba(66, 33, 11, 0.32);
        }

        .dialog h2 {
          margin: 0 0 14px;
          color: #8E610D;
          font-size: 20px;
        }

        .dialog h3 {
          margin: 0 0 10px;
          color: #8E610D;
          font-size: 16px;
        }

        .dialog p {
          margin: 0 0 16px;
        }

        .dialog-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .close-button {
          width: 30px;
          height: 30px;
          color: #fff;
          background: #8E610D;
          font-size: 18px;
          line-height: 1;
        }

        .settings-form {
          margin-bottom: 18px;
          padding: 14px;
          background: rgba(255, 255, 255, 0.58);
          border: 2px solid rgba(142, 97, 13, 0.3);
          border-radius: 14px;
        }

        .setting-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 100px;
          align-items: center;
          gap: 12px;
          font-weight: 800;
        }

        .target-count-input {
          min-width: 0;
          width: 100%;
          padding: 7px 9px;
          color: #42210B;
          background: #fff;
          border: 2px solid #8E610D;
          border-radius: 8px;
          font: inherit;
          font-weight: 800;
        }

        .target-count-input:focus-visible {
          outline: 3px solid #38A9FF;
          outline-offset: 2px;
        }

        .settings-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 12px;
        }

        .dialog .settings-status {
          flex: 1;
          margin: 0;
          color: #8E610D;
          font-size: 12px;
        }

        .save-settings-button {
          padding: 8px 14px;
          color: #42210B;
          background: #FFEF00;
          border: 2px solid #C69600;
        }

        .history-section {
          padding-top: 2px;
          border-top: 2px solid rgba(142, 97, 13, 0.28);
        }

        .history-section h3 {
          margin-top: 16px;
        }

        .history-day {
          padding: 10px 0;
          border-top: 1px solid rgba(142, 97, 13, 0.28);
        }

        .dialog .history-empty {
          margin: 18px 0 6px;
          color: #8E610D;
          font-weight: 800;
          text-align: center;
        }

        .history-day-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }

        .history-date {
          font-weight: 900;
        }

        .history-count {
          color: #8E610D;
          font-weight: 800;
        }

        .stopwatch-entries {
          display: grid;
          gap: 4px;
          margin: 7px 0 0;
          padding: 0 0 0 14px;
          color: #5F4517;
          font-size: 12px;
        }

        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .cancel-button {
          padding: 8px 14px;
          color: #42210B;
          background: #D8ECFF;
        }

        .confirm-button {
          padding: 8px 14px;
          color: #fff;
          background: #F37853;
        }
      </style>
      <section class="panel" role="region" aria-label="アクティカウンター">
        <div class="panel-header">
          <span class="brand">アクティカウンター</span>
          <button class="settings-button" type="button" aria-label="設定・履歴" title="設定・履歴">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path>
            </svg>
          </button>
        </div>
        <div class="counter-section">
          <span class="section-label">今日の回数</span>
          <strong class="count">0</strong><span class="count-limit">/ <span class="target-count">10</span>回</span>
        </div>
        <div class="stopwatch-section">
          <span class="section-label">ストップウォッチ</span>
          <time class="stopwatch-time" aria-label="経過時間">00:00:00</time>
          <div class="stopwatch-controls">
            <button class="start-button" type="button">開始</button>
            <button class="stop-button" type="button" disabled>停止</button>
            <button class="reset-button" type="button" disabled>リセット</button>
          </div>
          <p class="status" role="status" aria-live="polite"></p>
        </div>
      </section>
      <div class="overlay settings-history-overlay" hidden>
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-history-title">
          <div class="dialog-header">
            <h2 id="settings-history-title">設定・履歴</h2>
            <button class="close-button settings-history-close" type="button" aria-label="設定・履歴を閉じる">×</button>
          </div>
          <form class="settings-form">
            <h3>設定</h3>
            <label class="setting-row">
              <span>1日の目標回数</span>
              <input class="target-count-input" type="number" min="1" max="100" step="1" required>
            </label>
            <div class="settings-actions">
              <p class="settings-status" role="status" aria-live="polite"></p>
              <button class="save-settings-button" type="submit">設定を保存</button>
            </div>
          </form>
          <section class="history-section" aria-labelledby="history-title">
            <h3 id="history-title">過去90日の記録</h3>
            <div class="history-list"></div>
          </section>
        </section>
      </div>
      <div class="overlay confirm-overlay" hidden>
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <h2 id="reset-title">計測時間をリセットしますか？</h2>
          <p>現在のストップウォッチ表示を00:00:00に戻します。保存済みの履歴は残ります。</p>
          <div class="confirm-actions">
            <button class="cancel-button confirm-cancel" type="button">キャンセル</button>
            <button class="confirm-button confirm-reset" type="button">リセットする</button>
          </div>
        </section>
      </div>
    `;

    return {
      host,
      shadowRoot,
      panel: shadowRoot.querySelector(".panel"),
      panelHeader: shadowRoot.querySelector(".panel-header"),
      count: shadowRoot.querySelector(".count"),
      targetCount: shadowRoot.querySelector(".target-count"),
      stopwatchTime: shadowRoot.querySelector(".stopwatch-time"),
      startButton: shadowRoot.querySelector(".start-button"),
      stopButton: shadowRoot.querySelector(".stop-button"),
      resetButton: shadowRoot.querySelector(".reset-button"),
      settingsButton: shadowRoot.querySelector(".settings-button"),
      status: shadowRoot.querySelector(".status"),
      settingsHistoryOverlay: shadowRoot.querySelector(".settings-history-overlay"),
      settingsHistoryClose: shadowRoot.querySelector(".settings-history-close"),
      settingsForm: shadowRoot.querySelector(".settings-form"),
      targetCountInput: shadowRoot.querySelector(".target-count-input"),
      settingsStatus: shadowRoot.querySelector(".settings-status"),
      saveSettingsButton: shadowRoot.querySelector(".save-settings-button"),
      historyList: shadowRoot.querySelector(".history-list"),
      confirmOverlay: shadowRoot.querySelector(".confirm-overlay"),
      confirmCancel: shadowRoot.querySelector(".confirm-cancel"),
      confirmReset: shadowRoot.querySelector(".confirm-reset")
    };
  }

  const ui = createInterface();
  let stopwatchState = { ...DEFAULT_STOPWATCH_STATE };
  let tickerId = null;
  let requestInProgress = false;
  let lastFocusedElement = null;
  let isDraggingPanel = false;

  function normalizePanelPosition(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return {
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  function clampPanelPosition(position) {
    const rect = ui.panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    return {
      left: Math.min(maxLeft, Math.max(0, position.left)),
      top: Math.min(maxTop, Math.max(0, position.top))
    };
  }

  function currentPanelPosition() {
    const rect = ui.panel.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    };
  }

  function applyPanelPosition(position) {
    const nextPosition = clampPanelPosition(position);
    ui.panel.style.right = "auto";
    ui.panel.style.left = `${nextPosition.left}px`;
    ui.panel.style.top = `${nextPosition.top}px`;
    return nextPosition;
  }

  function savePanelPosition(position) {
    chrome.storage.local.set({
      [PANEL_POSITION_KEY]: normalizePanelPosition(position)
    }, () => {
      void chrome.runtime.lastError;
    });
  }

  function restorePanelPosition() {
    chrome.storage.local.get(PANEL_POSITION_KEY, (stored) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        return;
      }

      const savedPosition = normalizePanelPosition(stored[PANEL_POSITION_KEY]);
      if (savedPosition) {
        const appliedPosition = applyPanelPosition(savedPosition);
        if (appliedPosition.left !== savedPosition.left || appliedPosition.top !== savedPosition.top) {
          savePanelPosition(appliedPosition);
        }
      }
    });
  }

  function enablePanelDragging() {
    let activePointerId = null;
    let pointerStart = null;
    let panelStart = null;

    function finishDragging(event) {
      if (!isDraggingPanel || event.pointerId !== activePointerId) {
        return;
      }

      isDraggingPanel = false;
      ui.panel.classList.remove("dragging");
      if (ui.panelHeader.hasPointerCapture(activePointerId)) {
        ui.panelHeader.releasePointerCapture(activePointerId);
      }
      activePointerId = null;
      pointerStart = null;
      panelStart = null;
      savePanelPosition(currentPanelPosition());
      event.preventDefault();
      event.stopPropagation();
    }

    ui.panelHeader.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || event.target.closest("button")) {
        return;
      }

      const rect = ui.panel.getBoundingClientRect();
      isDraggingPanel = true;
      activePointerId = event.pointerId;
      pointerStart = { x: event.clientX, y: event.clientY };
      panelStart = { left: rect.left, top: rect.top };
      ui.panel.classList.add("dragging");
      ui.panelHeader.setPointerCapture(activePointerId);
      event.preventDefault();
      event.stopPropagation();
    });

    ui.panelHeader.addEventListener("pointermove", (event) => {
      if (!isDraggingPanel || event.pointerId !== activePointerId) {
        return;
      }

      applyPanelPosition({
        left: panelStart.left + event.clientX - pointerStart.x,
        top: panelStart.top + event.clientY - pointerStart.y
      });
      event.preventDefault();
      event.stopPropagation();
    });

    ui.panelHeader.addEventListener("pointerup", finishDragging);
    ui.panelHeader.addEventListener("pointercancel", finishDragging);
    ui.panelHeader.addEventListener("lostpointercapture", finishDragging);
  }

  function setStatus(message) {
    ui.status.textContent = message || "";
  }

  function renderCount(count) {
    const safeCount = Number.isFinite(count)
      ? Math.min(MAX_COUNT, Math.max(0, Math.trunc(count)))
      : 0;
    ui.count.textContent = String(safeCount);
  }

  function normalizeTargetCount(value) {
    const targetCount = Number(value);
    return Number.isInteger(targetCount) && targetCount >= 1 && targetCount <= MAX_COUNT
      ? targetCount
      : DEFAULT_TARGET_COUNT;
  }

  function renderTargetCount(targetCount) {
    ui.targetCount.textContent = String(normalizeTargetCount(targetCount));
  }

  function renderStopwatch() {
    const elapsedMs = getElapsedMs(stopwatchState);
    ui.stopwatchTime.textContent = formatDuration(elapsedMs);
    ui.stopwatchTime.setAttribute("aria-label", `経過時間 ${formatDuration(elapsedMs)}`);
    ui.startButton.textContent = stopwatchState.elapsedMs > 0 ? "再開" : "開始";
    ui.startButton.disabled = stopwatchState.isRunning || requestInProgress;
    ui.stopButton.disabled = !stopwatchState.isRunning || requestInProgress;
    ui.resetButton.disabled = stopwatchState.isRunning || requestInProgress;
  }

  function stopTicker() {
    if (tickerId !== null) {
      window.clearInterval(tickerId);
      tickerId = null;
    }
  }

  function startTicker() {
    if (tickerId !== null) {
      return;
    }
    tickerId = window.setInterval(renderStopwatch, 1000);
  }

  function syncStopwatch(nextState) {
    stopwatchState = normalizeStopwatchState(nextState);
    if (stopwatchState.isRunning) {
      startTicker();
    } else {
      stopTicker();
    }
    renderStopwatch();
  }

  function dateLabel(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    return match ? `${match[1]}/${match[2]}/${match[3]}` : dateKey;
  }

  function formatStopTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "--:--:--";
    }
    return date.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  function renderHistory(history) {
    ui.historyList.replaceChildren();
    const visibleDays = Array.isArray(history)
      ? history.filter((day) => Number(day?.autoCount) >= 1)
      : [];

    if (visibleDays.length === 0) {
      const emptyMessage = document.createElement("p");
      emptyMessage.className = "history-empty";
      emptyMessage.textContent = "履歴はありません";
      ui.historyList.appendChild(emptyMessage);
      return;
    }

    for (const day of visibleDays) {
      const dayElement = document.createElement("article");
      dayElement.className = "history-day";

      const header = document.createElement("div");
      header.className = "history-day-header";
      const date = document.createElement("span");
      date.className = "history-date";
      date.textContent = dateLabel(day.date);
      const count = document.createElement("span");
      count.className = "history-count";
      count.textContent = `自動カウント: ${day.autoCount}回`;
      header.append(date, count);
      dayElement.appendChild(header);

      if (Array.isArray(day.stopwatchEntries) && day.stopwatchEntries.length > 0) {
        const entries = document.createElement("ul");
        entries.className = "stopwatch-entries";
        for (const entry of day.stopwatchEntries) {
          const item = document.createElement("li");
          item.textContent = `${formatStopTime(entry.stoppedAt)} 停止 — 累積 ${formatDuration(entry.elapsedMs)}`;
          entries.appendChild(item);
        }
        dayElement.appendChild(entries);
      }

      ui.historyList.appendChild(dayElement);
    }
  }

  function closeSettingsHistory() {
    ui.settingsHistoryOverlay.hidden = true;
    ui.settingsStatus.textContent = "";
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  async function openSettingsHistory() {
    try {
      const [stateResponse, historyResponse] = await Promise.all([
        sendMessage({ type: "GET_STATE" }),
        sendMessage({ type: "GET_HISTORY" })
      ]);
      const targetCount = normalizeTargetCount(stateResponse.settings?.targetCount);
      renderTargetCount(targetCount);
      ui.targetCountInput.value = String(targetCount);
      ui.settingsStatus.textContent = "";
      renderHistory(historyResponse.history || []);
      lastFocusedElement = ui.shadowRoot.activeElement || document.activeElement;
      ui.settingsHistoryOverlay.hidden = false;
      ui.settingsHistoryClose.focus();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function saveSettings() {
    const targetCount = Number(ui.targetCountInput.value);
    ui.settingsStatus.textContent = "";
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > MAX_COUNT) {
      ui.settingsStatus.textContent = "1〜100の整数を入力してください";
      return;
    }

    ui.saveSettingsButton.disabled = true;
    try {
      const response = await sendMessage({
        type: "SAVE_SETTINGS",
        settings: { targetCount }
      });
      const savedTargetCount = normalizeTargetCount(response.settings?.targetCount);
      renderTargetCount(savedTargetCount);
      ui.targetCountInput.value = String(savedTargetCount);
      ui.settingsStatus.textContent = "設定を保存しました";
    } catch (error) {
      ui.settingsStatus.textContent = error.message;
    } finally {
      ui.saveSettingsButton.disabled = false;
    }
  }

  function closeConfirm() {
    ui.confirmOverlay.hidden = true;
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  function openConfirm() {
    lastFocusedElement = ui.shadowRoot.activeElement || document.activeElement;
    ui.confirmOverlay.hidden = false;
    ui.confirmCancel.focus();
  }

  async function performAction(type) {
    if (requestInProgress) {
      return;
    }

    requestInProgress = true;
    renderStopwatch();
    setStatus("");
    try {
      const response = await sendMessage({ type });
      if (response.stopwatchState) {
        syncStopwatch(response.stopwatchState);
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      requestInProgress = false;
      renderStopwatch();
    }
  }

  async function notifyPageReady() {
    try {
      const response = await sendMessage({
        type: "PAGE_READY",
        isResult: detectResultPage()
      });
      renderCount(response.count);
      renderTargetCount(response.settings?.targetCount);
      if (response.stopwatchState) {
        syncStopwatch(response.stopwatchState);
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  function addSafeClickListener(element, handler) {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    });
  }

  addSafeClickListener(ui.settingsButton, () => {
    openSettingsHistory();
  });
  addSafeClickListener(ui.settingsHistoryClose, closeSettingsHistory);
  addSafeClickListener(ui.startButton, () => performAction("START_STOPWATCH"));
  addSafeClickListener(ui.stopButton, () => performAction("STOP_STOPWATCH"));
  addSafeClickListener(ui.resetButton, openConfirm);
  addSafeClickListener(ui.confirmCancel, closeConfirm);
  addSafeClickListener(ui.confirmReset, async () => {
    await performAction("RESET_STOPWATCH");
    if (!requestInProgress) {
      closeConfirm();
    }
  });

  ui.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    saveSettings();
  });

  ui.shadowRoot.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === ui.settingsHistoryOverlay) {
      closeSettingsHistory();
    }
    if (event.target === ui.confirmOverlay) {
      closeConfirm();
    }
  });

  ui.shadowRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!ui.settingsHistoryOverlay.hidden) {
      closeSettingsHistory();
    }
    if (!ui.confirmOverlay.hidden) {
      closeConfirm();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[APP_STATE_KEY]?.newValue?.current) {
      renderCount(changes[APP_STATE_KEY].newValue.current.count);
    }

    if (areaName === "local" && changes[APP_STATE_KEY]?.newValue?.settings) {
      renderTargetCount(changes[APP_STATE_KEY].newValue.settings.targetCount);
    }

    if (areaName === "local" && changes[PANEL_POSITION_KEY] && !isDraggingPanel) {
      const savedPosition = normalizePanelPosition(changes[PANEL_POSITION_KEY].newValue);
      if (savedPosition) {
        applyPanelPosition(savedPosition);
      }
    }

    if (areaName === "session" && changes[STOPWATCH_STATE_KEY]) {
      syncStopwatch(changes[STOPWATCH_STATE_KEY].newValue);
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) {
      return;
    }
    notifyPageReady();
    sendMessage({ type: "GET_STOPWATCH_STATE" })
      .then((response) => syncStopwatch(response.stopwatchState))
      .catch(() => {});
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      stopTicker();
    }
  });

  window.addEventListener("resize", () => {
    if (isDraggingPanel) {
      return;
    }

    const currentPosition = currentPanelPosition();
    const appliedPosition = applyPanelPosition(currentPosition);
    if (appliedPosition.left !== currentPosition.left || appliedPosition.top !== currentPosition.top) {
      savePanelPosition(appliedPosition);
    }
  });

  renderCount(0);
  renderTargetCount(DEFAULT_TARGET_COUNT);
  syncStopwatch(DEFAULT_STOPWATCH_STATE);
  enablePanelDragging();
  restorePanelPosition();
  notifyPageReady();
})();
