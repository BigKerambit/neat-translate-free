const targetSelect = document.getElementById("target");
const autoCheckbox = document.getElementById("autoTranslate");
const translateButton = document.getElementById("translate");
const restoreButton = document.getElementById("restore");
const errorElement = document.getElementById("error");

function showError(message) {
  errorElement.textContent = message || "Произошла ошибка.";
}

function clearError() {
  errorElement.textContent = "";
}

function setBusy(busy) {
  targetSelect.disabled = busy;
  autoCheckbox.disabled = busy;
  translateButton.disabled = busy;
  restoreButton.disabled = busy;
}

async function getActiveTab() {
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
  const tab = await getActiveTab();

  // На обычных сайтах content.js уже установлен через manifest.
  // Внедрение здесь также помогает для вкладок, открытых до обновления
  // расширения. Защита в content.js не создаст второй обработчик.
  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    files: ["content.js"]
  });

  return chrome.tabs.sendMessage(tab.id, message);
}

async function showSavedAutoError() {
  try {
    const tab = await getActiveTab();

    const response = await chrome.runtime.sendMessage({
      action: "getAutoError",
      tabId: tab.id
    });

    if (response?.error) {
      showError(response.error);
    }
  } catch {
    // Открытие popup само по себе не должно показывать ошибку
    // для служебных вкладок Chrome.
  }
}

async function initialize() {
  try {
    const settings = await chrome.storage.local.get({
      target: "ru",
      autoTranslate: false
    });

    targetSelect.value = settings.target;
    autoCheckbox.checked = settings.autoTranslate;

    await showSavedAutoError();
  } catch (error) {
    showError(error.message);
  }
}

targetSelect.addEventListener("change", async () => {
  clearError();

  try {
    await chrome.storage.local.set({
      target: targetSelect.value
    });
  } catch (error) {
    showError(error.message);
  }
});

autoCheckbox.addEventListener("change", async () => {
  clearError();

  const enabled = autoCheckbox.checked;

  try {
    await chrome.storage.local.set({
      autoTranslate: enabled,
      target: targetSelect.value
    });

    // Запускаем автоперевод и на текущей вкладке, не дожидаясь
    // перехода пользователя на другой сайт.
    if (enabled) {
      const response = await sendToPage({
        action: "translate",
        target: targetSelect.value
      });

      if (!response?.ok) {
        throw new Error(
          response?.error || "Не удалось перевести текущую страницу."
        );
      }
    }
  } catch (error) {
    showError(error.message);
  }
});

translateButton.addEventListener("click", async () => {
  clearError();
  setBusy(true);

  try {
    const response = await sendToPage({
      action: "translate",
      target: targetSelect.value
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Не удалось перевести страницу."
      );
    }

    if (response.failed > 0) {
      showError(
        response.error ||
        "Некоторые фрагменты не удалось перевести."
      );
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

restoreButton.addEventListener("click", async () => {
  clearError();
  setBusy(true);

  try {
    const response = await sendToPage({
      action: "restore"
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Не удалось восстановить оригинал."
      );
    }

    const tab = await getActiveTab();

    await chrome.runtime.sendMessage({
      action: "clearAutoError",
      tabId: tab.id
    });
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

initialize();