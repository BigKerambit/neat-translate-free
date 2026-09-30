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
const MAX_TEXT_LENGTH = 700;

// Постоянный кэш переводов. Ограничен количеством записей
// и временем жизни, поэтому не занимает больше нескольких
// мегабайт на диске даже при долгом использовании.
const MAX_CACHE_ENTRIES = 15000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const CACHE_STORAGE_KEY = "translationCacheV1";
const CACHE_FLUSH_DELAY = 8000;

// Репозиторий для проверки обновлений.
const GITHUB_REPO = "BigKerambit/neat-translate-free";
const REPO_URL = `https://github.com/${GITHUB_REPO}`;
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RAW_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json`;
const UPDATE_ALARM = "neatTranslateUpdateCheck";
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Ключ кэша -> { t: перевод, ts: время сохранения }
const cache = new Map();
const inFlight = new Map();

let cacheDirty = false;
let cacheFlushTimer = null;

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

        // Бурная активность закончилась — хороший момент
        // сбросить кэш на диск.
        if (activeRequests === 0 && queue.length === 0) {
          scheduleCacheFlush(1500);
        }
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

async function loadCache() {
  try {
    const data = await chrome.storage.local.get(
      CACHE_STORAGE_KEY
    );

    const entries = data[CACHE_STORAGE_KEY];

    if (!Array.isArray(entries)) {
      return;
    }

    const now = Date.now();
    let dropped = false;

    // При переполнении оставляем хвост — самые свежие записи.
    for (const item of entries.slice(-MAX_CACHE_ENTRIES)) {
      if (!Array.isArray(item)) {
        dropped = true;
        continue;
      }

      const [key, text, ts] = item;

      if (
        typeof key !== "string" ||
        typeof text !== "string"
      ) {
        dropped = true;
        continue;
      }

      if (
        typeof ts === "number" &&
        now - ts > CACHE_TTL_MS
      ) {
        dropped = true;
        continue;
      }

      cache.set(key, {
        t: text,
        ts: typeof ts === "number" ? ts : now
      });
    }

    // Подчистить хранилище от просроченного.
    if (dropped) {
      cacheDirty = true;
      scheduleCacheFlush();
    }
  } catch {}
}

const cacheReady = loadCache();

function scheduleCacheFlush(
  delay = CACHE_FLUSH_DELAY
) {
  clearTimeout(cacheFlushTimer);

  cacheFlushTimer = setTimeout(() => {
    flushCache().catch(() => {});
  }, delay);
}

async function flushCache() {
  if (!cacheDirty) {
    return;
  }

  cacheDirty = false;
  clearTimeout(cacheFlushTimer);
  cacheFlushTimer = null;

  const now = Date.now();
  let entries = [];

  for (const [key, entry] of cache) {
    if (now - entry.ts <= CACHE_TTL_MS) {
      entries.push([key, entry.t, entry.ts]);
    }
  }

  try {
    await chrome.storage.local.set({
      [CACHE_STORAGE_KEY]: entries
    });
  } catch {
    // Крайний случай: не влезли в квоту (10 МБ) —
    // оставляем свежую половину и пробуем ещё раз.
    entries = entries.slice(Math.floor(entries.length / 2));

    try {
      await chrome.storage.local.set({
        [CACHE_STORAGE_KEY]: entries
      });
    } catch {}
  }
}

function saveCache(key, value) {
  // LRU: существующая запись переставляется в конец,
  // самые старые вытесняются первыми.
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }

  cache.set(key, {
    t: value,
    ts: Date.now()
  });

  cacheDirty = true;
  scheduleCacheFlush();
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

  const cached = cache.get(key);

  if (cached) {
    // LRU: попадание в кэш переставляет запись в конец.
    cache.delete(key);
    cache.set(key, cached);

    return Promise.resolve(cached.t);
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

function normalizeVersion(value) {
  return String(value)
    .trim()
    .replace(/^[vв]/iu, "");
}

function compareVersions(a, b) {
  const partsA = normalizeVersion(a).split(".");
  const partsB = normalizeVersion(b).split(".");
  const length = Math.max(partsA.length, partsB.length);

  for (let index = 0; index < length; index++) {
    const partA = parseInt(partsA[index], 10) || 0;
    const partB = parseInt(partsB[index], 10) || 0;

    if (partA !== partB) {
      return partA > partB ? 1 : -1;
    }
  }

  return 0;
}

// Возвращает {version, url} или выбрасывает ошибку, если
// версию узнать не удалось (нет сети, GitHub недоступен).
async function fetchLatestVersion() {
  // 1) Релизы GitHub: если они публикуются, кнопка
  //    «Обновить» ведёт на страницу релиза со списком изменений.
  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
      const data = await response.json();

      if (data?.tag_name) {
        return {
          version: normalizeVersion(data.tag_name),
          url: data.html_url || `${REPO_URL}/releases`
        };
      }
    }
  } catch {}

  // 2) manifest.json из ветки main: работает и без релизов —
  //    достаточно поднять поле version в репозитории.
  try {
    const response = await fetch(RAW_MANIFEST_URL, {
      signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
      const data = await response.json();

      if (data?.version) {
        return {
          version: normalizeVersion(data.version),
          url: REPO_URL
        };
      }
    }
  } catch {}

  throw new Error("Не удалось проверить обновления.");
}

async function applyUpdateInfo(info) {
  if (info) {
    await chrome.storage.local.set({
      updateInfo: {
        version: info.version,
        url: info.url,
        checkedAt: Date.now()
      }
    });

    await chrome.action.setBadgeBackgroundColor({
      color: "#2f9e44"
    });

    await chrome.action.setBadgeText({ text: "↑" });

    await chrome.action.setTitle({
      title: `Neat Translate — доступна версия ${info.version}`
    });
  } else {
    await chrome.storage.local.remove("updateInfo");
    await chrome.action.setBadgeText({ text: "" });

    await chrome.action.setTitle({
      title: "Neat Translate Free"
    });
  }
}

let updateCheckRunning = null;

function checkForUpdates(force = false) {
  if (updateCheckRunning) {
    return updateCheckRunning;
  }

  updateCheckRunning = (async () => {
    try {
      const data = await chrome.storage.local.get([
        "updateInfo",
        "updateCheckedAt"
      ]);

      // Не дёргаем GitHub чаще, чем раз в 12 часов,
      // если проверка не запрошена вручную.
      if (
        !force &&
        typeof data.updateCheckedAt === "number" &&
        Date.now() - data.updateCheckedAt <
          UPDATE_CHECK_INTERVAL_MS
      ) {
        return {
          checked: false,
          update: data.updateInfo ?? null
        };
      }

      await chrome.storage.local.set({
        updateCheckedAt: Date.now()
      });

      const latest = await fetchLatestVersion();

      const currentVersion =
        chrome.runtime.getManifest().version;

      if (
        compareVersions(latest.version, currentVersion) > 0
      ) {
        await applyUpdateInfo(latest);

        const stored = await chrome.storage.local.get(
          "updateInfo"
        );

        return {
          checked: true,
          update: stored.updateInfo
        };
      }

      await applyUpdateInfo(null);

      return { checked: true, update: null };
    } finally {
      updateCheckRunning = null;
    }
  })();

  return updateCheckRunning;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60
  });

  checkForUpdates().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  checkForUpdates().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) {
    checkForUpdates().catch(() => {});
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

      // Ждём загрузку постоянного кэша, чтобы не слать
      // лишние запросы к сервису перевода после
      // пробуждения service worker'а.
      cacheReady
        .then(() =>
          translate(message.text, message.target)
        )
        .then(
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

    if (message?.action === "checkForUpdates") {
      checkForUpdates(message.force === true).then(
        (result) => {
          sendResponse({
            ok: true,
            ...result
          });
        },
        () => {
          sendResponse({
            ok: false,
            error:
              "Не удалось проверить обновления. Попробуй позже."
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
