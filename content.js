(() => {
  if (window.__neatTranslateFreeInstalled) {
    return;
  }

  window.__neatTranslateFreeInstalled = true;

  const MAX_ITEMS_PER_PASS = 600;
  const WORKERS = 8;
  const MAX_CHUNK_LENGTH = 800;

  const SKIP_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "code",
    "pre",
    "kbd",
    "samp",
    "svg",
    "math",
    "textarea",
    "select",
    "option",
    "[contenteditable]",
    '[translate="no"]',
    ".notranslate"
  ].join(",");

  const ATTRIBUTES = [
    "placeholder",
    "title",
    "alt",
    "aria-label"
  ];

  let session = null;

  function isAllowed(element) {
    let current = element;

    while (current) {
      if (
        current.isContentEditable ||
        current.closest(SKIP_SELECTOR)
      ) {
        return false;
      }

      const root = current.getRootNode();

      current = root instanceof ShadowRoot
        ? root.host
        : null;
    }

    return true;
  }

  function read(item) {
    return item.attribute
      ? item.node.getAttribute(item.attribute)
      : item.node.nodeValue;
  }

  function write(item, value) {
    if (item.attribute) {
      item.node.setAttribute(
        item.attribute,
        value
      );
    } else {
      item.node.nodeValue = value;
    }
  }

  function getRecord(currentSession, item) {
    const records = currentSession.records.get(
      item.node
    );

    if (!records) {
      return null;
    }

    return records.get(
      item.attribute || "#text"
    ) || null;
  }

  function saveRecord(
    currentSession,
    item,
    original,
    translated
  ) {
    let records = currentSession.records.get(
      item.node
    );

    if (!records) {
      records = new Map();

      currentSession.records.set(
        item.node,
        records
      );
    }

    records.set(
      item.attribute || "#text",
      {
        node: item.node,
        attribute: item.attribute,
        original,
        translated
      }
    );
  }

  function isUsefulText(value) {
    return (
      typeof value === "string" &&
      /\p{L}/u.test(value)
    );
  }

  function shouldTranslate(currentSession, item) {
    const value = read(item);

    if (!isUsefulText(value)) {
      return false;
    }

    const record = getRecord(
      currentSession,
      item
    );

    return !record ||
      record.translated !== value;
  }

  function getRoots() {
    if (!document.body) {
      return [];
    }

    const roots = [
      document.body
    ];

    // Дополнительно обходим открытые shadow DOM.
    for (
      let index = 0;
      index < roots.length;
      index++
    ) {
      const root = roots[index];

      for (
        const element of root.querySelectorAll("*")
      ) {
        if (element.shadowRoot) {
          roots.push(
            element.shadowRoot
          );
        }
      }
    }

    return roots;
  }

  function collect(currentSession, limit) {
    const items = [];

    for (const root of getRoots()) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

      while (
        items.length < limit &&
        walker.nextNode()
      ) {
        const node = walker.currentNode;

        if (!isAllowed(node.parentElement)) {
          continue;
        }

        const item = {
          node,
          attribute: null
        };

        if (
          shouldTranslate(
            currentSession,
            item
          )
        ) {
          items.push(item);
        }
      }

      if (items.length >= limit) {
        break;
      }

      const elements = root.querySelectorAll(
        "[placeholder], [title], [alt], [aria-label]"
      );

      for (const element of elements) {
        if (items.length >= limit) {
          break;
        }

        if (!isAllowed(element)) {
          continue;
        }

        for (const attribute of ATTRIBUTES) {
          if (items.length >= limit) {
            break;
          }

          if (!element.hasAttribute(attribute)) {
            continue;
          }

          const item = {
            node: element,
            attribute
          };

          if (
            shouldTranslate(
              currentSession,
              item
            )
          ) {
            items.push(item);
          }
        }
      }
    }

    return items;
  }

  function splitOuterWhitespace(value) {
    const match = value.match(
      /^(\s*)([\s\S]*?)(\s*)$/
    );

    return {
      before: match[1],
      text: match[2],
      after: match[3]
    };
  }

  function splitLongText(text) {
    const chunks = [];
    let remaining = text;

    while (
      remaining.length > MAX_CHUNK_LENGTH
    ) {
      const candidate = remaining.slice(
        0,
        MAX_CHUNK_LENGTH
      );

      let cut = Math.max(
        candidate.lastIndexOf(". "),
        candidate.lastIndexOf("! "),
        candidate.lastIndexOf("? "),
        candidate.lastIndexOf("\n")
      );

      if (
        cut >= 300 &&
        candidate[cut] !== "\n"
      ) {
        cut++;
      }

      if (cut < 300) {
        cut = candidate.lastIndexOf(" ");
      }

      if (cut < 300) {
        cut = MAX_CHUNK_LENGTH;
      }

      const previousCode =
        remaining.charCodeAt(cut - 1);

      // Не разрываем суррогатную пару Unicode.
      if (
        previousCode >= 0xD800 &&
        previousCode <= 0xDBFF
      ) {
        cut--;
      }

      chunks.push(
        remaining.slice(0, cut)
      );

      remaining = remaining.slice(cut);
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  async function translateValue(text, target) {
    const chunks = splitLongText(text);
    const translatedChunks = [];

    for (const chunk of chunks) {
      // Пробелы на границах частей оставляем как есть.
      // Иначе предложения могут склеиться.
      const parts = splitOuterWhitespace(chunk);

      if (!parts.text) {
        translatedChunks.push(chunk);
        continue;
      }

      const response = await chrome.runtime.sendMessage({
        action: "translateText",
        text: parts.text,
        target
      });

      if (!response?.ok) {
        throw new Error(
          response?.error ||
          "Не удалось перевести текст."
        );
      }

      translatedChunks.push(
        parts.before +
        response.translated +
        parts.after
      );
    }

    return translatedChunks.join("");
  }

  async function translateItem(
    currentSession,
    item
  ) {
    if (!currentSession.active) {
      return false;
    }

    const original = read(item);

    if (!isUsefulText(original)) {
      return false;
    }

    const parts = splitOuterWhitespace(
      original
    );

    if (!parts.text) {
      return false;
    }

    const translatedText =
      await translateValue(
        parts.text,
        currentSession.target
      );

    if (!currentSession.active) {
      return false;
    }

    // Сайт мог обновить этот текст за время запроса.
    if (read(item) !== original) {
      return false;
    }

    const translated =
      parts.before +
      translatedText +
      parts.after;

    saveRecord(
      currentSession,
      item,
      original,
      translated
    );

    if (translated === original) {
      return false;
    }

    write(item, translated);

    return true;
  }

  function observeRoot(
    currentSession,
    root
  ) {
    if (
      currentSession.observedRoots.has(root)
    ) {
      return;
    }

    currentSession.observer.observe(
      root,
      {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRIBUTES
      }
    );

    currentSession.observedRoots.add(root);
  }

  function observeAllRoots(currentSession) {
    if (document.documentElement) {
      observeRoot(
        currentSession,
        document.documentElement
      );
    }

    for (const root of getRoots()) {
      if (root instanceof ShadowRoot) {
        observeRoot(
          currentSession,
          root
        );
      }
    }
  }

  function isOwnMutation(
    currentSession,
    mutation
  ) {
    if (
      mutation.type === "characterData"
    ) {
      const item = {
        node: mutation.target,
        attribute: null
      };

      const record = getRecord(
        currentSession,
        item
      );

      return Boolean(
        record &&
        read(item) === record.translated
      );
    }

    if (mutation.type === "attributes") {
      const item = {
        node: mutation.target,
        attribute: mutation.attributeName
      };

      const record = getRecord(
        currentSession,
        item
      );

      return Boolean(
        record &&
        read(item) === record.translated
      );
    }

    return false;
  }

  function scheduleScan(
    currentSession,
    delay = 500
  ) {
    if (!currentSession.active) {
      return;
    }

    clearTimeout(currentSession.timer);

    currentSession.timer = setTimeout(
      () => {
        if (!currentSession.active) {
          return;
        }

        if (currentSession.running) {
          currentSession.scanAfterCurrent = true;
          return;
        }

        translatePage(
          currentSession
        ).then(
          (result) => {
            handleAutomaticResult(
              currentSession,
              result
            );
          },
          (error) => {
            reportAutoError(
              currentSession,
              error.message
            );
          }
        );
      },
      delay
    );
  }

  function createSession(
    target,
    automatic
  ) {
    const currentSession = {
      target,
      automatic,
      active: true,
      running: false,
      scanAfterCurrent: false,
      timer: null,
      records: new Map(),
      observedRoots: new Set(),
      observer: null
    };

    currentSession.observer =
      new MutationObserver(
        (mutations) => {
          if (!currentSession.active) {
            return;
          }

          const externalChange =
            mutations.some(
              (mutation) =>
                !isOwnMutation(
                  currentSession,
                  mutation
                )
            );

          if (!externalChange) {
            return;
          }

          observeAllRoots(
            currentSession
          );

          scheduleScan(
            currentSession
          );
        }
      );

    observeAllRoots(
      currentSession
    );

    return currentSession;
  }

  function stopSession() {
    if (!session) {
      return;
    }

    const oldSession = session;

    oldSession.active = false;

    clearTimeout(
      oldSession.timer
    );

    oldSession.observer.disconnect();

    for (
      const records of
      oldSession.records.values()
    ) {
      for (
        const record of
        records.values()
      ) {
        const item = {
          node: record.node,
          attribute: record.attribute
        };

        // Не затираем изменения самого сайта.
        if (
          read(item) ===
          record.translated
        ) {
          write(
            item,
            record.original
          );
        }
      }
    }

    oldSession.records.clear();
    session = null;
  }

  async function translatePage(
    currentSession
  ) {
    if (!currentSession.active) {
      return {
        count: 0,
        failed: 0,
        hasMore: false,
        error: null
      };
    }

    if (currentSession.running) {
      currentSession.scanAfterCurrent = true;

      return {
        count: 0,
        failed: 0,
        hasMore: false,
        error: null
      };
    }

    currentSession.running = true;
    currentSession.scanAfterCurrent = false;

    let count = 0;
    let failed = 0;
    let firstError = null;

    try {
      observeAllRoots(
        currentSession
      );

      const items = collect(
        currentSession,
        MAX_ITEMS_PER_PASS
      );

      let nextIndex = 0;

      async function worker() {
        while (
          currentSession.active &&
          nextIndex < items.length
        ) {
          const item = items[nextIndex++];

          try {
            const changed =
              await translateItem(
                currentSession,
                item
              );

            if (changed) {
              count++;
            }
          } catch (error) {
            failed++;

            if (!firstError) {
              firstError = error;
            }

            if (
              error.message.includes(
                "ограничил запросы"
              )
            ) {
              nextIndex = items.length;
              break;
            }
          }
        }
      }

      await Promise.all(
        Array.from(
          {
            length: Math.min(
              WORKERS,
              items.length
            )
          },
          () => worker()
        )
      );

      const hasMore =
        currentSession.active &&
        collect(
          currentSession,
          1
        ).length > 0;

      return {
        count,
        failed,
        hasMore,
        error: firstError?.message || null
      };
    } finally {
      currentSession.running = false;

      if (
        currentSession.active &&
        currentSession.scanAfterCurrent
      ) {
        scheduleScan(
          currentSession
        );
      }
    }
  }

  function reportAutoError(
    currentSession,
    message
  ) {
    if (
      !currentSession.active ||
      !currentSession.automatic
    ) {
      return;
    }

    chrome.runtime.sendMessage({
      action: "reportAutoError",
      error: message
    }).catch(() => {});
  }

  function handleAutomaticResult(
    currentSession,
    result
  ) {
    if (
      !currentSession.active ||
      !currentSession.automatic
    ) {
      return;
    }

    if (result.failed > 0) {
      reportAutoError(
        currentSession,
        result.error ||
        "Не удалось перевести часть страницы."
      );

      // При ошибке не запускаем бесконечные повторы.
      return;
    }

    chrome.runtime.sendMessage({
      action: "clearAutoError"
    }).catch(() => {});

    // Страница может содержать больше 600 фрагментов.
    // Автоперевод продолжит обработку самостоятельно.
    if (result.hasMore) {
      scheduleScan(
        currentSession,
        100
      );
    }
  }

  async function startTranslation(
    target,
    automatic
  ) {
    if (
      session &&
      session.target !== target
    ) {
      stopSession();
    }

    if (!session) {
      session = createSession(
        target,
        automatic
      );
    } else if (automatic) {
      session.automatic = true;
    }

    const currentSession = session;

    const result = await translatePage(
      currentSession
    );

    if (automatic) {
      handleAutomaticResult(
        currentSession,
        result
      );
    }

    return result;
  }

  chrome.runtime.onMessage.addListener(
    (
      message,
      _sender,
      sendResponse
    ) => {
      if (
        message?.action === "restore"
      ) {
        stopSession();

        sendResponse({
          ok: true
        });

        return;
      }

      if (
        message?.action !== "translate"
      ) {
        return;
      }

      startTranslation(
        message.target,
        false
      ).then(
        (result) => {
          sendResponse({
            ok: true,
            ...result
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
  );

  chrome.storage.onChanged.addListener(
    (changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (
        !changes.autoTranslate &&
        !changes.target
      ) {
        return;
      }

      chrome.storage.local.get({
        autoTranslate: false,
        target: "ru"
      }).then(
        (settings) => {
          if (
            !settings.autoTranslate
          ) {
            // Выключение автоперевода останавливает
            // автоматическую сессию, но не ручную.
            if (
              session?.automatic
            ) {
              stopSession();
            }

            return;
          }

          startTranslation(
            settings.target,
            true
          ).catch(
            (error) => {
              if (session) {
                reportAutoError(
                  session,
                  error.message
                );
              }
            }
          );
        }
      );
    }
  );

  // Автоматический запуск при открытии сайта.
  chrome.storage.local.get({
    autoTranslate: false,
    target: "ru"
  }).then(
    (settings) => {
      if (
        settings.autoTranslate
      ) {
        startTranslation(
          settings.target,
          true
        ).catch(
          (error) => {
            if (session) {
              reportAutoError(
                session,
                error.message
              );
            }
          }
        );
      }
    }
  );
})();