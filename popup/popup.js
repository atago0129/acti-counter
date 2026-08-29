(function () {
  "use strict";

  const countElement = document.getElementById("current-count");
  const form = document.getElementById("start-count-form");
  const input = document.getElementById("start-count");
  const message = document.getElementById("message");

  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
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

  function renderCount(count) {
    const safeCount = Number.isFinite(count)
      ? Math.min(100, Math.max(0, Math.trunc(count)))
      : 0;
    countElement.textContent = String(safeCount);
    input.value = String(safeCount);
  }

  async function loadState() {
    try {
      const response = await sendMessage({ type: "GET_STATE" });
      renderCount(response.count);
    } catch (error) {
      message.textContent = error.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const count = Number(input.value);
    if (!Number.isInteger(count) || count < 0 || count > 100) {
      message.textContent = "0〜100の整数を入力してください";
      return;
    }

    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const response = await sendMessage({ type: "SET_START_COUNT", count });
      renderCount(response.count);
      message.textContent = "保存しました";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.appState?.newValue?.current) {
      renderCount(changes.appState.newValue.current.count);
    }
  });

  loadState();
})();
