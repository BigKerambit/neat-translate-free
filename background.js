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
const MAX_TEXT_LENGTH = 700;

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

    job.task()
      .then(job.resolve, job.reject)
      .finally(() => {
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

function saveCache(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
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
  } catch {
    throw new Error(
      "Не удалось подключиться к сервису перевода."
    );
  }

  if (response.status === 429) {
    throw new Error(
      "Сервис перевода ограничил частоту запросов. Попробуй позже."
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
      "Сервис перевода вернул некорректный ответ."
    );
  }

  if (!Array.isArray(data?.[0])) {
    throw new Error(
      "Не удалось прочитать ответ сервиса перевода."
    );
  }

  const translated = data[0]
    .map((part) => (
      Array.isArray(part) &&
      typeof part[0] === "string"
        ? part[0]
        : ""
    ))
    .join("");

  if (!translated) {
    throw new Error("Сервис вернул пустой перевод.");
  }

  return translated;
}

function translate(text, target) {
  const key = `${target}\n${text}`;

  if (cache.has(key)) {
    return Promise.resolve(cache.get(key));
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = enqueue(
    () => requestTranslation(text, target)
  )
    .then((result) => {
      saveCache(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);

  return promise;
}

function errorKey(tabId) {
  return `autoError:${tabId}`;
}

async function setAutoError(tabId, error) {
  await chrome.storage.session.set({
    [errorKey(tabId)]: error
  });

  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#c83232"
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
  chrome.storage.session
    .remove(errorKey(tabId))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearAutoError(tabId).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.action === "translateText") {
      if (
        !sender.tab ||
        typeof message.text !== "string" ||
        message.text.length === 0 ||
        message.text.length > MAX_TEXT_LENGTH ||
        !ALLOWED_TARGETS.has(message.target)
      ) {
        sendResponse({
          ok: false,
          error: "Некорректный запрос на перевод."
        });

        return;
      }

      translate(message.text, message.target).then(
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
      if (sender.tab?.id) {
        const error =
          typeof message.error === "string"
            ? message.error.slice(0, 300)
            : "Ошибка автоперевода.";

        setAutoError(sender.tab.id, error)
          .catch(() => {});
      }

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
        sendResponse({ error: null });
        return;
      }

      chrome.storage.session
        .get(errorKey(message.tabId))
        .then(
          (data) => {
            sendResponse({
              error:
                data[errorKey(message.tabId)] ||
                null
            });
          },
          () => {
            sendResponse({ error: null });
          }
        );

      return true;
    }
  }
);