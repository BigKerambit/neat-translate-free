(() => {
  if (window.__neatTranslateInstalledV2) {
    return;
  }

  window.__neatTranslateInstalledV2 = true;

  const MAX_ITEMS_PER_PASS = 350;
  const MAX_CHUNK_LENGTH = 700;
  const WORKERS = 8;

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
    ".notranslate",
    "[data-neat-translate-ui]"
  ].join(",");

  const ATTRIBUTES = [
    "placeholder",
    "title",
    "alt",
    "aria-label"
  ];

  let session = null;
  let showOriginalEnabled = true;
  let floatingHost = null;

  function currentHost() {
    try {
      return location.hostname;
    } catch {
      return "";
    }
  }

  function allowed(element) {
    let current = element;

    while (current) {
      if (
        current.isContentEditable ||
        current.closest(SKIP_SELECTOR)
      ) {
        return false;
      }

      const root = current.getRootNode();

      current =
        root instanceof ShadowRoot
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
      item.node.setAttribute(item.attribute, value);
    } else {
      item.node.nodeValue = value;
    }
  }

  function recordFor(currentSession, item) {
    return currentSession.records
      .get(item.node)
      ?.get(item.attribute || "#text") || null;
  }

  function saveRecord(
    currentSession,
    item,
    original,
    translated
  ) {
    let nodeRecords = currentSession.records.get(
      item.node
    );

    if (!nodeRecords) {
      nodeRecords = new Map();

      currentSession.records.set(
        item.node,
        nodeRecords
      );
    }

    nodeRecords.set(
      item.attribute || "#text",
      {
        node: item.node,
        attribute: item.attribute,
        original,
        translated
      }
    );
  }

  function useful(value) {
    return (
      typeof value === "string" &&
      /\p{L}/u.test(value)
    );
  }

  function needsTranslation(currentSession, item) {
    const value = read(item);

    if (!useful(value)) {
      return false;
    }

    const previous = recordFor(
      currentSession,
      item
    );

    if (
      previous &&
      previous.translated === value
    ) {
      return false;
    }

    const failed = currentSession.failures.get(
      item.node
    );

    if (
      failed &&
      failed.value === value &&
      failed.attribute === item.attribute &&
      Date.now() - failed.time < 60000
    ) {
      return false;
    }

    return true;
  }

  function roots() {
    if (!document.body) {
      return [];
    }

    const result = [document.body];

    for (
      let index = 0;
      index < result.length;
      index++
    ) {
      for (
        const element of
        result[index].querySelectorAll("*")
      ) {
        if (element.shadowRoot) {
          result.push(element.shadowRoot);
        }
      }
    }

    return result;
  }

  function collect(currentSession, limit) {
    const items = [];

    for (const root of roots()) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT
      );

      while (
        items.length < limit &&
        walker.nextNode()
      ) {
        const node = walker.currentNode;

        const parent =
          node.parentElement ||
          (
            node.parentNode instanceof ShadowRoot
              ? node.parentNode.host
              : null
          );

        if (!allowed(parent)) {
          continue;
        }

        const item = {
          node,
          attribute: null
        };

        if (
          needsTranslation(
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

      for (
        const element of root.querySelectorAll(
          "[placeholder], [title], [alt], [aria-label]"
        )
      ) {
        if (items.length >= limit) {
          break;
        }

        if (!allowed(element)) {
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
            needsTranslation(
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

  function outerWhitespace(text) {
    const match = text.match(
      /^(\s*)([\s\S]*?)(\s*)$/
    );

    return {
      before: match[1],
      middle: match[2],
      after: match[3]
    };
  }

  function chunksOf(text) {
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
        cut >= 250 &&
        candidate[cut] !== "\n"
      ) {
        cut++;
      }

      if (cut < 250) {
        cut = candidate.lastIndexOf(" ");
      }

      if (cut < 250) {
        cut = MAX_CHUNK_LENGTH;
      }

      const previousCode =
        remaining.charCodeAt(cut - 1);

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
    const chunks = chunksOf(text);
    const result = [];

    for (const chunk of chunks) {
      const parts = outerWhitespace(chunk);

      if (!parts.middle) {
        result.push(chunk);
        continue;
      }

      const response =
        await chrome.runtime.sendMessage({
          action: "translateText",
          text: parts.middle,
          target
        });

      if (!response?.ok) {
        throw new Error(
          response?.error ||
          "Не удалось перевести текст."
        );
      }

      result.push(
        parts.before +
        response.translated +
        parts.after
      );
    }

    return result.join("");
  }

  async function translateItem(
    currentSession,
    item
  ) {
    const original = read(item);

    if (!useful(original)) {
      return false;
    }

    const parts = outerWhitespace(original);

    if (!parts.middle) {
      return false;
    }

    const translatedMiddle =
      await translateValue(
        parts.middle,
        currentSession.target
      );

    if (
      !currentSession.active ||
      read(item) !== original
    ) {
      return false;
    }

    const translated =
      parts.before +
      translatedMiddle +
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

  function observeRoot(currentSession, root) {
    if (
      currentSession.observedRoots.has(root)
    ) {
      return;
    }

    currentSession.observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES
    });

    currentSession.observedRoots.add(root);
  }

  function observeRoots(currentSession) {
    if (document.documentElement) {
      observeRoot(
        currentSession,
        document.documentElement
      );
    }

    for (const root of roots()) {
      if (root instanceof ShadowRoot) {
        observeRoot(
          currentSession,
          root
        );
      }
    }
  }

  function ownMutation(
    currentSession,
    mutation
  ) {
    if (mutation.type === "childList") {
      return false;
    }

    const item = {
      node: mutation.target,
      attribute:
        mutation.type === "attributes"
          ? mutation.attributeName
          : null
    };

    const record = recordFor(
      currentSession,
      item
    );

    return Boolean(
      record &&
      read(item) === record.translated
    );
  }

  function reportError(error) {
    chrome.runtime.sendMessage({
      action: "reportAutoError",
      error:
        error?.message ||
        "Ошибка автоперевода."
    }).catch(() => {});
  }

  function clearReportedError() {
    chrome.runtime.sendMessage({
      action: "clearAutoError"
    }).catch(() => {});
  }

  function schedule(
    currentSession,
    delay = 350
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

        scan(currentSession)
          .then((result) => {
            if (!currentSession.automatic) {
              return;
            }

            if (result.failed > 0) {
              reportError(
                new Error(result.error)
              );

              return;
            }

            clearReportedError();

            if (result.hasMore) {
              schedule(currentSession, 80);
            }
          })
          .catch((error) => {
            if (currentSession.automatic) {
              reportError(error);
            }
          });
      },
      delay
    );
  }

  function createSession(target, automatic) {
    const currentSession = {
      target,
      automatic,
      active: true,
      running: false,
      promise: null,
      timer: null,
      scanAfterCurrent: false,
      records: new Map(),
      failures: new WeakMap(),
      observedRoots: new Set(),
      observer: null
    };

    currentSession.observer =
      new MutationObserver((mutations) => {
        if (!currentSession.active) {
          return;
        }

        const externalChange =
          mutations.some(
            (mutation) =>
              !ownMutation(
                currentSession,
                mutation
              )
          );

        if (!externalChange) {
          return;
        }

        observeRoots(currentSession);
        schedule(currentSession);
      });

    observeRoots(currentSession);

    return currentSession;
  }

  function removeFloating() {
    floatingHost?.remove();
    floatingHost = null;
  }

  function restore() {
    if (!session) {
      removeFloating();
      return;
    }

    const old = session;

    old.active = false;

    clearTimeout(old.timer);
    old.observer.disconnect();
    removeFloating();

    for (
      const nodeRecords of
      old.records.values()
    ) {
      for (
        const record of
        nodeRecords.values()
      ) {
        const item = {
          node: record.node,
          attribute: record.attribute
        };

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

    old.records.clear();
    session = null;
  }

  async function scan(currentSession) {
    if (!currentSession.active) {
      return {
        failed: 0,
        hasMore: false,
        error: null
      };
    }

    if (currentSession.running) {
      return currentSession.promise;
    }

    currentSession.running = true;
    currentSession.scanAfterCurrent = false;

    currentSession.promise = (async () => {
      let failed = 0;
      let firstError = null;

      try {
        observeRoots(currentSession);

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
              await translateItem(
                currentSession,
                item
              );
            } catch (error) {
              failed++;

              if (!firstError) {
                firstError = error;
              }

              currentSession.failures.set(
                item.node,
                {
                  value: read(item),
                  attribute: item.attribute,
                  time: Date.now()
                }
              );

              if (
                error.message.includes(
                  "ограничил частоту"
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

        return {
          failed,
          error:
            firstError?.message || null,
          hasMore:
            currentSession.active &&
            collect(
              currentSession,
              1
            ).length > 0
        };
      } finally {
        currentSession.running = false;

        if (
          currentSession.active &&
          currentSession.scanAfterCurrent
        ) {
          schedule(currentSession);
        }
      }
    })();

    return currentSession.promise;
  }

  async function start(target, automatic) {
    if (
      session &&
      session.target !== target
    ) {
      restore();
    }

    if (!session) {
      session = createSession(
        target,
        automatic
      );
    }

    if (automatic) {
      session.automatic = true;
    }

    const currentSession = session;
    const result = await scan(currentSession);

    if (
      automatic &&
      currentSession.active
    ) {
      if (result.failed > 0) {
        reportError(
          new Error(result.error)
        );
      } else {
        clearReportedError();

        if (result.hasMore) {
          schedule(currentSession, 80);
        }
      }
    }

    return result;
  }

  function makeFloating(text, interactive) {
    removeFloating();

    const host = document.createElement("div");

    host.setAttribute(
      "data-neat-translate-ui",
      ""
    );

    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0 auto auto 0",
      "z-index: 2147483647",
      "pointer-events: none"
    ].join(";");

    const shadow = host.attachShadow({
      mode: "open"
    });

    const style = document.createElement("style");

    style.textContent = `
      .box {
        position: fixed;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 28px));
        padding: 12px 14px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 13px;
        background: #192132;
        color: #fff;
        box-shadow: 0 12px 35px rgba(0,0,0,.25);
        font: 13px/1.5 system-ui, sans-serif;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .selection {
        right: 16px;
        bottom: 16px;
        max-height: min(50vh, 350px);
        overflow: auto;
        pointer-events: auto;
      }

      .hint {
        top: 12px;
        left: 12px;
      }

      button {
        float: right;
        margin: -5px -7px 4px 10px;
        padding: 3px 8px;
        border: 0;
        border-radius: 7px;
        background: rgba(255,255,255,.15);
        color: white;
        cursor: pointer;
        font: 16px system-ui, sans-serif;
      }
    `;

    const box = document.createElement("div");

    box.className = interactive
      ? "box selection"
      : "box hint";

    if (interactive) {
      const close = document.createElement("button");

      close.type = "button";
      close.textContent = "×";
      close.setAttribute(
        "aria-label",
        "Закрыть"
      );

      close.addEventListener(
        "click",
        removeFloating
      );

      box.append(close);
    }

    const content = document.createElement("span");
    content.textContent = text;

    box.append(content);
    shadow.append(style, box);
    document.documentElement.append(host);

    floatingHost = host;
  }

  function originalNear(element) {
    if (!session?.active || !element) {
      return null;
    }

    let current = element;
    let depth = 0;

    while (current && depth < 4) {
      for (const node of current.childNodes) {
        if (
          node.nodeType !== Node.TEXT_NODE
        ) {
          continue;
        }

        const item = {
          node,
          attribute: null
        };

        const record = recordFor(
          session,
          item
        );

        if (
          record &&
          record.original !== record.translated &&
          read(item) === record.translated
        ) {
          return record.original.trim();
        }
      }

      current = current.parentElement;
      depth++;
    }

    return null;
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (
        !showOriginalEnabled ||
        !event.altKey ||
        !session?.active
      ) {
        if (
          floatingHost &&
          floatingHost.shadowRoot
            ?.querySelector(".hint")
        ) {
          removeFloating();
        }

        return;
      }

      const original = originalNear(
        event.target
      );

      if (!original) {
        removeFloating();
        return;
      }

      const currentText =
        floatingHost?.shadowRoot
          ?.querySelector(".hint span")
          ?.textContent;

      if (currentText !== original) {
        makeFloating(original, false);
      }

      const box =
        floatingHost?.shadowRoot
          ?.querySelector(".hint");

      if (box) {
        box.style.left =
          `${Math.min(
            event.clientX + 14,
            window.innerWidth - 30
          )}px`;

        box.style.top =
          `${Math.min(
            event.clientY + 16,
            window.innerHeight - 30
          )}px`;

        box.style.transform =
          event.clientY >
          window.innerHeight / 2
            ? "translateY(-110%)"
            : "none";
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      if (event.key === "Alt") {
        const hint =
          floatingHost?.shadowRoot
            ?.querySelector(".hint");

        if (hint) {
          removeFloating();
        }
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message?.action === "restore") {
        restore();

        chrome.runtime.sendMessage({
          action: "clearAutoError"
        }).catch(() => {});

        sendResponse({ ok: true });
        return;
      }

      if (
        message?.action ===
        "translateSelection"
      ) {
        (async () => {
          const selected =
            window.getSelection()
              ?.toString()
              .trim();

          if (!selected) {
            throw new Error(
              "Сначала выдели текст на странице."
            );
          }

          if (selected.length > 10000) {
            throw new Error(
              "Выделено слишком много текста. Выдели фрагмент поменьше."
            );
          }

          const translated =
            await translateValue(
              selected,
              message.target
            );

          makeFloating(
            translated,
            true
          );

          return { ok: true };
        })().then(
          sendResponse,
          (error) => {
            sendResponse({
              ok: false,
              error: error.message
            });
          }
        );

        return true;
      }

      if (message?.action !== "translate") {
        return;
      }

      // Ручная попытка позволяет повторить фрагменты,
      // которые ранее не удалось перевести.
      if (session) {
        session.failures = new WeakMap();
      }

      start(
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

    async function applySettings() {
    const settings = await chrome.storage.local.get({
      autoTranslate: false,
      target: "ru",
      showOriginal: true
    });

    showOriginalEnabled = settings.showOriginal;

    if (!settings.autoTranslate) {
      if (session?.automatic) {
        restore();
      }

      return;
    }

    start(settings.target, true).catch(reportError);
  }

  chrome.storage.onChanged.addListener(
    (changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (
        changes.autoTranslate ||
        changes.target ||
        changes.showOriginal
      ) {
        applySettings().catch(reportError);
      }
    }
  );

  applySettings().catch(reportError);
})();