const target = document.getElementById("target");
const autoTranslate = document.getElementById("autoTranslate");
const showOriginal = document.getElementById("showOriginal");
const themeButton = document.getElementById("themeButton");

const siteOption = document.getElementById("siteOption");
const siteHost = document.getElementById("siteHost");
const skipSite = document.getElementById("skipSite");

const translateButton = document.getElementById("translate");
const selectionButton = document.getElementById("selection");
const restoreButton = document.getElementById("restore");
const errorElement = document.getElementById("error");

// Домен активной вкладки, к которому относится
// переключатель «Не переводить этот сайт».
let currentHostname = "";

function showError(message) {
  errorElement.textContent = message || "Произошла ошибка.";
}

function clearError() {
  errorElement.textContent = "";
}

function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);

  const description = isDark
    ? "Текущая тема: тёмная. Переключить на светлую"
    : "Текущая тема: светлая. Переключить на тёмную";

  themeButton.title = description;
  themeButton.setAttribute("aria-label", description);
}

function setBusy(busy) {
  target.disabled = busy;
  autoTranslate.disabled = busy;
  showOriginal.disabled = busy;
  skipSite.disabled = busy || !currentHostname;

  translateButton.disabled = busy;
  selectionButton.disabled = busy;
  restoreButton.disabled = busy;

  // Кнопка темы остаётся доступной даже во время перевода.
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("Не удалось найти активную вкладку.");
  }

  return tab;
}

// Сайт определяется доменом целиком: адреса с «www.»
// и без него считаются одним и тем же сайтом,
// а поддомены (например, gist.github.com) — отдельными.
function normalizeHostname(hostname) {
  const lower = hostname.toLowerCase();

  return lower.startsWith("www.")
    ? lower.slice(4)
    : lower;
}

function tabHostname(tab) {
  try {
    const url = new URL(tab.url || "");

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return "";
    }

    return normalizeHostname(url.hostname);
  } catch {
    return "";
  }
}

function syncSkipSite(disabledSites) {
  skipSite.checked =
    currentHostname !== "" &&
    Array.isArray(disabledSites) &&
    disabledSites.includes(currentHostname);
}

async function sendToPage(message) {
  const tab = await activeTab();

  // Для вкладок, которые были открыты до обновления расширения.
  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    files: ["content.js"]
  });

  return chrome.tabs.sendMessage(tab.id, message);
}

async function runAction(message) {
  clearError();
  setBusy(true);

  try {
    const response = await sendToPage(message);

    if (!response?.ok) {
      throw new Error(
        response?.error || "Не удалось выполнить действие."
      );
    }

    if (response.failed > 0) {
      showError(
        response.error || "Часть текста не удалось перевести."
      );
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function initialize() {
  try {
    const settings = await chrome.storage.local.get({
      target: "ru",
      autoTranslate: false,
      showOriginal: true,
      darkMode: false,
      disabledSites: []
    });

    target.value = settings.target;
    autoTranslate.checked = settings.autoTranslate;
    showOriginal.checked = settings.showOriginal;

    applyTheme(settings.darkMode);

    // Удаляем сохранённый список пауз от предыдущей версии.
    await chrome.storage.local.remove("pausedSites");

    const tab = await activeTab();

    currentHostname = tabHostname(tab);

    if (currentHostname) {
      siteHost.textContent = currentHostname;
      syncSkipSite(settings.disabledSites);
    } else {
      // На служебных страницах (chrome://, магазин расширений
      // и т. п.) контентный скрипт не работает,
      // поэтому переключатель недоступен.
      siteHost.textContent =
        "Недоступно на этой странице";
      skipSite.checked = false;
      skipSite.disabled = true;
      siteOption.classList.add("unavailable");
    }

    const response = await chrome.runtime.sendMessage({
      action: "getAutoError",
      tabId: tab.id
    });

    if (response?.error) {
      showError(response.error);
    }
  } catch (error) {
    showError(error.message);
  }
}

target.addEventListener("change", async () => {
  clearError();

  try {
    await chrome.storage.local.set({
      target: target.value
    });
  } catch (error) {
    showError(error.message);
  }
});

autoTranslate.addEventListener("change", async () => {
  clearError();

  try {
    await chrome.storage.local.set({
      autoTranslate: autoTranslate.checked,
      target: target.value
    });
  } catch (error) {
    showError(error.message);
  }
});

showOriginal.addEventListener("change", async () => {
  clearError();

  try {
    await chrome.storage.local.set({
      showOriginal: showOriginal.checked
    });
  } catch (error) {
    showError(error.message);
  }
});

skipSite.addEventListener("change", async () => {
  clearError();

  if (!currentHostname) {
    skipSite.checked = false;
    return;
  }

  try {
    // Читаем свежий список: другие сайты могли быть
    // добавлены на других страницах, пока попап был открыт.
    const data = await chrome.storage.local.get({
      disabledSites: []
    });

    const sites = new Set(
      Array.isArray(data.disabledSites)
        ? data.disabledSites
        : []
    );

    if (skipSite.checked) {
      sites.add(currentHostname);
    } else {
      sites.delete(currentHostname);
    }

    await chrome.storage.local.set({
      disabledSites: [...sites]
    });
  } catch (error) {
    skipSite.checked = !skipSite.checked;
    showError(error.message);
  }
});

themeButton.addEventListener("click", async () => {
  const previousValue = document.body.classList.contains("dark");
  const newValue = !previousValue;

  applyTheme(newValue);

  try {
    await chrome.storage.local.set({
      darkMode: newValue
    });
  } catch (error) {
    applyTheme(previousValue);
    showError(error.message);
  }
});

// Поддерживаем переключатель в актуальном состоянии, если
// список исключений изменился, пока попап был открыт.
chrome.storage.onChanged.addListener(
  (changes, areaName) => {
    if (areaName !== "local" || !currentHostname) {
      return;
    }

    if (changes.disabledSites) {
      syncSkipSite(changes.disabledSites.newValue);
    }
  }
);

translateButton.addEventListener("click", () => {
  runAction({
    action: "translate",
    target: target.value
  });
});

selectionButton.addEventListener("click", () => {
  runAction({
    action: "translateSelection",
    target: target.value
  });
});

restoreButton.addEventListener("click", () => {
  runAction({
    action: "restore"
  });
});

initialize();
