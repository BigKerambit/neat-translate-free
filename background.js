const ALLOWED_TARGETS = new Set([
  "ru",
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "ja",
  "zh-CN"
]);

const MAX_CONCURRENT_REQUESTS = 8;
const MAX_CACHE_ENTRIES = 5000;

const cache = new Map();
const inFlight = new Map();

const queue = [];
let activeRequests = 0;

function runQueue() {
  while (
    activeRequests < MAX_CONCURRENT_REQUESTS &&
    queue.length > 0
  ) {
    const job = queue.shift();
    activeRequests++;

    job.task().then(
      job.resolve,
      job.reject
    ).finally(() => {
      activeRequests--;
      runQueue();
    });
  }
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({
      task,
      resolve,
      reject
    });

    runQueue();
  });
}

function saveToCache(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  cache.set(key, value);
}

async function requestTranslation(text, target) {
  const url = new URL(
    "https://translate.googleapis.com/translate_a/single"
  );

  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  let response;

  try {
    response = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      throw new Error("Сервис перевода не ответил вовремя.");
    }

    throw new Error("Не удалось подключиться к сервису перевода.");
  }

  if (response.status === 429) {
    throw new Error(
      "Сервис временно ограничил запросы. Попробуй позже."
    );
  }

  if (!response.ok) {
    throw new Error(
      `Ошибка сервиса перевода: HTTP ${response.status}.`
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Сервис перевода вернул ответ в неожиданном формате."
    );
  }

  const pieces = data?.[0];

  if (!Array.isArray(pieces)) {
    throw new Error("Не удалось прочитать ответ сервиса перевода.");
  }

  const translated = pieces
    .map((piece) => {
      return Array.isArray(piece) &&
        typeof piece[0] === "string"
          ? piece[0]
          : "";
    })
    .join("");

  if (!translated) {
    throw new Error("Сервис вернул пустой перевод.");
  }

  return translated;
}

function translateText(text, target) {
  const key = `${target}\n${text}`;

  if (cache.has(key)) {
    return Promise.resolve(cache.get(key));
  }

  // Одинаковый текст, запрошенный одновременно,
  // переводим одним сетевым запросом.
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = enqueue(() => {
    return requestTranslation(text, target);
  }).then((translated) => {
    saveToCache(key, translated);
    return translated;
  }).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);

  return promise;
}

function errorKey(tabId) {
  return `autoError:${tabId}`;
}

async function saveAutoError(tabId, message) {
  await chrome.storage.session.set({
    [errorKey(tabId)]: message
  });

  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#b42318"
  });

  await chrome.action.setBadgeText({
    tabId,
    text: "!"
  });
}

async function clearAutoError(tabId) {
  await chrome.storage.session.remove(errorKey(tabId));

  await chrome.action.setBadgeText({
    tabId,
    text: ""
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(errorKey(tabId)).catch(() => {});
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.action === "translateText") {
      if (!sender.tab) {
        sendResponse({
          ok: false,
          error: "Запрос должен поступать со страницы сайта."
        });

        return;
      }

      if (
        typeof message.text !== "string" ||
        message.text.length === 0 ||
        message.text.length > 800 ||
        !ALLOWED_TARGETS.has(message.target)
      ) {
        sendResponse({
          ok: false,
          error: "Некорректный текст или язык перевода."
        });

        return;
      }

      translateText(
        message.text,
        message.target
      ).then(
        (translated) => {
          sendResponse({
            ok: true,
            translated
          });
        },
        (error) => {
          sendResponse({
            ok: false,
            error: error.message
          });
        }
      );

      return true;
    }

    if (message?.action === "reportAutoError") {
      if (!sender.tab?.id) {
        return;
      }

      const text =
        typeof message.error === "string"
          ? message.error.slice(0, 300)
          : "Ошибка автоперевода.";

      saveAutoError(
        sender.tab.id,
        text
      ).catch(() => {});

      return;
    }

    if (message?.action === "clearAutoError") {
      const tabId = sender.tab?.id ?? message.tabId;

      if (Number.isInteger(tabId)) {
        clearAutoError(tabId).catch(() => {});
      }

      return;
    }

    if (message?.action === "getAutoError") {
      if (!Number.isInteger(message.tabId)) {
        sendResponse({
          error: null
        });

        return;
      }

      chrome.storage.session.get(
        errorKey(message.tabId)
      ).then(
        (data) => {
          sendResponse({
            error: data[errorKey(message.tabId)] || null
          });
        },
        () => {
          sendResponse({
            error: null
          });
        }
      );

      return true;
    }
  }
);