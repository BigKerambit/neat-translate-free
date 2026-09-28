const target = document.getElementById("target");
const autoTranslate = document.getElementById("autoTranslate");
const showOriginal = document.getElementById("showOriginal");
const themeButton = document.getElementById("themeButton");

const translateButton = document.getElementById("translate");
const selectionButton = document.getElementById("selection");
const restoreButton = document.getElementById("restore");
const errorElement = document.getElementById("error");

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
      darkMode: false
    });

    target.value = settings.target;
    autoTranslate.checked = settings.autoTranslate;
    showOriginal.checked = settings.showOriginal;

    applyTheme(settings.darkMode);

    // Удаляем сохранённый список пауз от предыдущей версии.
    await chrome.storage.local.remove("pausedSites");

    const tab = await activeTab();

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