const APP_STATE_KEY = "appState";
const TAB_STATES_KEY = "tabStates";
const STOPWATCH_STATE_KEY = "stopwatchState";
const DAILY_RESET_ALARM = "daily-reset-check";
const MAX_COUNT = 100;
const DEFAULT_TARGET_COUNT = 10;
const MIN_TARGET_COUNT = 1;
const HISTORY_DAYS = 90;

let mutationQueue = Promise.resolve();

function enqueueMutation(task) {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.catch((error) => {
    console.error("アクティカウンターの状態更新に失敗しました", error);
  });
  return result;
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function getDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function getRecentDateKeys(todayKey = getDateKey()) {
  const baseDate = parseDateKey(todayKey) || new Date();
  const keys = [];

  for (let index = 0; index < HISTORY_DAYS; index += 1) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() - index);
    keys.push(getDateKey(date));
  }

  return keys;
}

function clampCount(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_COUNT, Math.max(0, Math.trunc(value)));
}

function normalizeSettings(rawSettings) {
  const raw = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const targetCount = Number(raw.targetCount);
  return {
    targetCount: Number.isInteger(targetCount) &&
      targetCount >= MIN_TARGET_COUNT &&
      targetCount <= MAX_COUNT
      ? targetCount
      : DEFAULT_TARGET_COUNT
  };
}

function normalizeStopwatchEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => (
      entry &&
      Number.isFinite(entry.stoppedAt) &&
      Number.isFinite(entry.elapsedMs) &&
      entry.stoppedAt >= 0 &&
      entry.elapsedMs >= 0
    ))
    .map((entry) => ({
      stoppedAt: Math.trunc(entry.stoppedAt),
      elapsedMs: Math.trunc(entry.elapsedMs)
    }));
}

function normalizeAppState(rawState, todayKey = getDateKey()) {
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const rawCurrent = raw.current && typeof raw.current === "object" ? raw.current : {};
  const settings = normalizeSettings(raw.settings);
  const rawHistory = raw.history && typeof raw.history === "object" ? raw.history : {};
  const history = {};

  for (const [dateKey, rawRecord] of Object.entries(rawHistory)) {
    if (!parseDateKey(dateKey)) {
      continue;
    }

    const record = rawRecord && typeof rawRecord === "object" ? rawRecord : {};
    history[dateKey] = {
      autoCount: Math.max(0, Math.trunc(Number(record.autoCount) || 0)),
      stopwatchEntries: normalizeStopwatchEntries(record.stopwatchEntries)
    };
  }

  const currentDate = typeof rawCurrent.date === "string" ? rawCurrent.date : todayKey;
  const currentCount = clampCount(Number(rawCurrent.count));

  return {
    schemaVersion: 1,
    current: {
      date: currentDate,
      count: currentCount
    },
    settings,
    history
  };
}

function pruneHistory(state, todayKey = getDateKey()) {
  const keep = new Set(getRecentDateKeys(todayKey));
  let changed = false;

  for (const dateKey of Object.keys(state.history)) {
    if (!keep.has(dateKey)) {
      delete state.history[dateKey];
      changed = true;
    }
  }

  return changed;
}

function normalizeStateForToday(state, todayKey = getDateKey()) {
  let changed = false;

  if (state.current.date !== todayKey) {
    state.current.date = todayKey;
    state.current.count = 0;
    changed = true;
  }

  if (pruneHistory(state, todayKey)) {
    changed = true;
  }

  return changed;
}

function createDefaultStopwatchState() {
  return {
    isRunning: false,
    startedAt: null,
    elapsedMs: 0
  };
}

function normalizeStopwatchState(rawState) {
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const elapsedMs = Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0
    ? Math.trunc(raw.elapsedMs)
    : 0;
  const startedAt = Number.isFinite(raw.startedAt) && raw.startedAt >= 0
    ? Math.trunc(raw.startedAt)
    : null;

  if (raw.isRunning !== true || startedAt === null) {
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

function isTargetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "acti-island.com" &&
      (parsed.pathname === "/typing" || parsed.pathname.startsWith("/typing/"));
  } catch {
    return false;
  }
}

function isExtensionSender(sender) {
  return typeof sender?.url === "string" &&
    sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

function isContentSender(sender) {
  return Number.isInteger(sender?.tab?.id) &&
    sender.tab.id >= 0 &&
    (!sender.url || isTargetUrl(sender.url));
}

async function loadAppState(todayKey = getDateKey()) {
  const result = await chrome.storage.local.get(APP_STATE_KEY);
  const state = normalizeAppState(result[APP_STATE_KEY], todayKey);
  const dateOrHistoryChanged = normalizeStateForToday(state, todayKey);
  const normalizedJson = JSON.stringify(state);
  const storedJson = result[APP_STATE_KEY] ? JSON.stringify(result[APP_STATE_KEY]) : "";

  if (normalizedJson !== storedJson || dateOrHistoryChanged) {
    await chrome.storage.local.set({ [APP_STATE_KEY]: state });
  }

  return state;
}

async function saveAppState(state) {
  await chrome.storage.local.set({ [APP_STATE_KEY]: state });
}

async function loadStopwatchState() {
  const result = await chrome.storage.session.get(STOPWATCH_STATE_KEY);
  return normalizeStopwatchState(result[STOPWATCH_STATE_KEY]);
}

async function saveStopwatchState(state) {
  await chrome.storage.session.set({
    [STOPWATCH_STATE_KEY]: normalizeStopwatchState(state)
  });
}

async function loadTabStates() {
  const result = await chrome.storage.session.get(TAB_STATES_KEY);
  const states = result[TAB_STATES_KEY];
  return states && typeof states === "object" && !Array.isArray(states) ? states : {};
}

async function saveTabStates(states) {
  await chrome.storage.session.set({ [TAB_STATES_KEY]: states });
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(DAILY_RESET_ALARM);
  if (!alarm) {
    await chrome.alarms.create(DAILY_RESET_ALARM, { periodInMinutes: 1 });
  }
}

async function initializeExtension() {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"
    });
  } catch (error) {
    console.warn("セッションストレージの公開設定に失敗しました", error);
  }

  await ensureAlarm();
  await enqueueMutation(() => loadAppState());
}

const initialization = initializeExtension().catch((error) => {
  console.error("アクティカウンターの初期化に失敗しました", error);
});

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => {
    console.error("アクティカウンターの再初期化に失敗しました", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch((error) => {
    console.error("アクティカウンターの起動処理に失敗しました", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DAILY_RESET_ALARM) {
    return;
  }

  enqueueMutation(() => loadAppState()).catch((error) => {
    console.error("日次リセットの確認に失敗しました", error);
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0 || isTargetUrl(details.url)) {
    return;
  }

  enqueueMutation(async () => {
    const states = await loadTabStates();
    const tabKey = String(details.tabId);
    if (Object.prototype.hasOwnProperty.call(states, tabKey)) {
      delete states[tabKey];
      await saveTabStates(states);
    }
  }).catch((error) => {
    console.error("タブ状態のクリアに失敗しました", error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueMutation(async () => {
    const states = await loadTabStates();
    const tabKey = String(tabId);
    if (Object.prototype.hasOwnProperty.call(states, tabKey)) {
      delete states[tabKey];
      await saveTabStates(states);
    }
  }).catch((error) => {
    console.error("終了タブの状態削除に失敗しました", error);
  });
});

async function getStateResponse() {
  const appState = await loadAppState();
  const stopwatchState = await loadStopwatchState();
  return {
    ok: true,
    count: appState.current.count,
    date: appState.current.date,
    settings: appState.settings,
    stopwatchState
  };
}

async function handlePageReady(message, sender) {
  if (!isContentSender(sender) || typeof message.isResult !== "boolean") {
    throw new Error("不正なページ状態通知です");
  }

  const tabId = sender.tab.id;
  return enqueueMutation(async () => {
    const eventTime = Date.now();
    const todayKey = getDateKey(new Date(eventTime));
    const appState = await loadAppState(todayKey);
    const tabStates = await loadTabStates();
    const tabKey = String(tabId);
    const previousState = tabStates[tabKey] || "other";
    const nextState = message.isResult ? "result" : "other";
    let counted = false;

    if (message.isResult && previousState !== "result" && appState.current.count < MAX_COUNT) {
      appState.current.count += 1;
      const record = appState.history[todayKey] || {
        autoCount: 0,
        stopwatchEntries: []
      };
      record.autoCount += 1;
      appState.history[todayKey] = record;
      await saveAppState(appState);
      counted = true;
    }

    if (tabStates[tabKey] !== nextState) {
      tabStates[tabKey] = nextState;
      await saveTabStates(tabStates);
    }

    const stopwatchState = await loadStopwatchState();
    return {
      ok: true,
      count: appState.current.count,
      date: appState.current.date,
      counted,
      settings: appState.settings,
      stopwatchState
    };
  });
}

async function handleSaveSettings(message, sender) {
  if (!isContentSender(sender)) {
    throw new Error("設定の変更元が不正です");
  }

  const settings = message.settings;
  const targetCount = settings?.targetCount;
  if (!settings ||
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    !Number.isInteger(targetCount) ||
    targetCount < MIN_TARGET_COUNT ||
    targetCount > MAX_COUNT) {
    throw new Error("目標回数は1〜100の整数で指定してください");
  }

  return enqueueMutation(async () => {
    const appState = await loadAppState();
    appState.settings = { targetCount };
    await saveAppState(appState);
    return { ok: true, settings: appState.settings };
  });
}

async function handleSetStartCount(message, sender) {
  if (!isExtensionSender(sender)) {
    throw new Error("開始回数の変更元が不正です");
  }

  const count = Number(message.count);
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new Error("開始回数は0〜100の整数で指定してください");
  }

  return enqueueMutation(async () => {
    const appState = await loadAppState();
    appState.current.count = count;
    await saveAppState(appState);
    return {
      ok: true,
      count,
      date: appState.current.date
    };
  });
}

async function getHistoryResponse() {
  return enqueueMutation(async () => {
    const appState = await loadAppState();
    const dates = getRecentDateKeys(getDateKey());
    const history = dates.map((date) => {
      const record = appState.history[date] || {};
      return {
        date,
        autoCount: Math.max(0, Math.trunc(Number(record.autoCount) || 0)),
        stopwatchEntries: normalizeStopwatchEntries(record.stopwatchEntries).sort(
          (left, right) => right.stoppedAt - left.stoppedAt
        )
      };
    });

    return { ok: true, history };
  });
}

async function getStopwatchResponse() {
  return enqueueMutation(async () => ({
    ok: true,
    stopwatchState: await loadStopwatchState()
  }));
}

async function startStopwatch(sender) {
  if (!isContentSender(sender)) {
    throw new Error("ストップウォッチの操作元が不正です");
  }

  return enqueueMutation(async () => {
    const state = await loadStopwatchState();
    if (!state.isRunning) {
      state.isRunning = true;
      state.startedAt = Date.now();
      await saveStopwatchState(state);
    }
    return { ok: true, stopwatchState: state };
  });
}

async function stopStopwatch(sender) {
  if (!isContentSender(sender)) {
    throw new Error("ストップウォッチの操作元が不正です");
  }

  return enqueueMutation(async () => {
    const stopwatchState = await loadStopwatchState();
    if (!stopwatchState.isRunning || stopwatchState.startedAt === null) {
      return { ok: true, stopwatchState };
    }

    const now = Date.now();
    const stopDate = getDateKey(new Date(now));
    const elapsedSinceStart = Math.max(0, now - stopwatchState.startedAt);
    const elapsedMs = stopwatchState.elapsedMs + elapsedSinceStart;
    const nextState = {
      isRunning: false,
      startedAt: null,
      elapsedMs
    };
    const appState = await loadAppState(stopDate);
    const record = appState.history[stopDate] || {
      autoCount: 0,
      stopwatchEntries: []
    };
    record.stopwatchEntries.push({
      stoppedAt: now,
      elapsedMs
    });
    appState.history[stopDate] = record;

    await saveAppState(appState);
    await saveStopwatchState(nextState);
    return { ok: true, stopwatchState: nextState };
  });
}

async function resetStopwatch(sender) {
  if (!isContentSender(sender)) {
    throw new Error("ストップウォッチの操作元が不正です");
  }

  return enqueueMutation(async () => {
    const state = await loadStopwatchState();
    if (!state.isRunning) {
      const nextState = createDefaultStopwatchState();
      await saveStopwatchState(nextState);
      return { ok: true, stopwatchState: nextState };
    }
    return { ok: true, stopwatchState: state };
  });
}

async function routeMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    throw new Error("メッセージ形式が不正です");
  }

  await initialization;

  switch (message.type) {
    case "PAGE_READY":
      return handlePageReady(message, sender);
    case "GET_STATE":
      return enqueueMutation(getStateResponse);
    case "SET_START_COUNT":
      return handleSetStartCount(message, sender);
    case "SAVE_SETTINGS":
      return handleSaveSettings(message, sender);
    case "GET_HISTORY":
      if (!isContentSender(sender)) {
        throw new Error("履歴の取得元が不正です");
      }
      return getHistoryResponse();
    case "GET_STOPWATCH_STATE":
      if (!isContentSender(sender)) {
        throw new Error("ストップウォッチ状態の取得元が不正です");
      }
      return getStopwatchResponse();
    case "START_STOPWATCH":
      return startStopwatch(sender);
    case "STOP_STOPWATCH":
      return stopStopwatch(sender);
    case "RESET_STOPWATCH":
      return resetStopwatch(sender);
    default:
      throw new Error("未対応のメッセージです");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  routeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || "処理に失敗しました" });
    });
  return true;
});
