# Neat Translate Free

[Русский](#русский) | [English](#english)

---

# Русский

<a id="ru-description"></a>

## Содержание
- [Описание](#ru-description)
- [Возможности](#ru-features)
- [Установка](#ru-installation)
- [Использование](#ru-usage)
- [Обновление](#ru-update)
- [Ограничения и конфиденциальность](#ru-privacy)
- [Лицензия](#ru-license)

## Описание

**Neat Translate Free** — расширение для Chrome и других браузеров на Chromium, которое переводит текст сайтов, не заменяя HTML-разметку страницы целиком. Это помогает сохранить кнопки, ссылки и оформление сайта.

Для перевода используется бесплатный веб-эндпоинт Google Translate. API-ключ не нужен.

<a id="ru-features"></a>

## Возможности

- Ручной перевод страницы на выбранный язык.
- Автоматический перевод сайтов.
- Переключатель **«Не переводить этот сайт автоматически»**.
- Возврат исходного текста кнопкой **«Вернуть оригинал»**.
- Перевод текста, который появляется после загрузки страницы.
- Кеширование повторяющихся фрагментов.
- Сообщения в окне расширения только при ошибках.

### Исключение сайта из автоперевода

Если включить **«Не переводить этот сайт автоматически»** на странице `https://github.com/users/Flowseal`, автоперевод будет отключён на всех страницах `github.com`.

Исключение действует по **точному доменному имени**: оно не распространяется, например, на `gist.github.com`. Ручной перевод исключённого сайта остаётся доступным.

<a id="ru-installation"></a>

## Установка из GitHub

1. [Скачайте ZIP-архив проекта](https://github.com/BigKerambit/neat-translate-free/archive/refs/heads/main.zip).
2. Распакуйте архив. Получится папка проекта `neat-translate-free-main`.
3. Откройте инструкцию для своего браузера ниже.

<details>
<summary><strong>Google Chrome</strong></summary>

1. Откройте `chrome://extensions`.
2. Включите **«Режим разработчика»**.
3. Нажмите **«Загрузить распакованное расширение»**.
4. Выберите папку проекта, в которую распаковали архив: `neat-translate-free-main`.

</details>

<details>
<summary><strong>Microsoft Edge</strong></summary>

1. Откройте `edge://extensions`.
2. Включите **«Режим разработчика»**.
3. Нажмите **«Загрузить распакованное расширение»**.
4. Выберите папку проекта, в которую распаковали архив: `neat-translate-free-main`.

</details>

<details>
<summary><strong>Brave</strong></summary>

1. Откройте `brave://extensions`.
2. Включите **Developer mode**.
3. Нажмите **Load unpacked**.
4. Выберите папку проекта, в которую распаковали архив: `neat-translate-free-main`.

</details>

<details>
<summary><strong>Opera</strong></summary>

1. Откройте `opera://extensions`.
2. Включите **«Режим разработчика»**.
3. Нажмите **«Загрузить распакованное расширение»** / **Load unpacked**.
4. Выберите папку проекта, в которую распаковали архив: `neat-translate-free-main`.

</details>

После установки при желании закрепите иконку расширения на панели браузера через меню расширений.

<a id="ru-usage"></a>

## Использование

### Перевести страницу вручную

1. Откройте сайт и нажмите на иконку расширения.
2. Выберите язык.
3. Нажмите **«Перевести страницу»**.

Чтобы вернуть исходный текст, нажмите **«Вернуть оригинал»**.

### Включить автоперевод

В окне расширения выберите язык и включите **«Автоперевод»**. При открытии сайтов расширение будет запускать перевод автоматически.

### Исключить сайт

Откройте сайт и включите **«Не переводить этот сайт автоматически»**. Настройка будет действовать на другие страницы этого же доменного имени.

<a id="ru-update"></a>

## Обновление

1. [Скачайте актуальный ZIP-архив](https://github.com/BigKerambit/neat-translate-free/archive/refs/heads/main.zip).
2. Распакуйте новые файлы в папку установленного расширения, заменив старые.
3. Откройте страницу расширений браузера и нажмите кнопку обновления на карточке **Neat Translate Free**.
4. Перезагрузите уже открытые сайты, чтобы на них запустилась новая версия скрипта.

<a id="ru-privacy"></a>

## Ограничения и конфиденциальность

Расширение не переводит текст внутри изображений и служебные страницы браузера, например `chrome://extensions`. Перевод также может изменить высоту отдельных блоков: фразы на разных языках имеют разную длину.

**Текст сайта отправляется в Google Translate для перевода.** Не используйте расширение на страницах с конфиденциальными данными, если не хотите передавать их стороннему сервису.

Используется неофициальный бесплатный веб-эндпоинт. Его доступность, скорость и ограничения могут измениться.

<a id="ru-license"></a>

## Лицензия

Проект распространяется на условиях [Unlicense](https://unlicense.org/). Вы можете использовать, копировать, изменять, распространять и продавать этот код, в том числе в коммерческих проектах.

Расширение создано с помощью нейросети. Указанная лицензия выражает намерение автора предоставить максимально свободные права на ту часть проекта, в отношении которой он вправе это сделать.

---

# English

<a id="en-description"></a>

## Contents
- [Description](#en-description)
- [Features](#en-features)
- [Installation](#en-installation)
- [Usage](#en-usage)
- [Updating](#en-update)
- [Limitations and privacy](#en-privacy)
- [License](#en-license)

## Description

**Neat Translate Free** is an extension for Chrome and other Chromium-based browsers. It translates website text without replacing the page's entire HTML structure, helping preserve buttons, links, and styling.

Translation uses a free Google Translate web endpoint. No API key is required.

<a id="en-features"></a>

## Features

- Manually translate a page into your selected language.
- Automatically translate websites.
- Exclude a website using **“Do not automatically translate this site”**.
- Restore the original text using **“Restore original”**.
- Translate text added after the page loads.
- Cache repeated text fragments.
- Show popup messages only when an error occurs.

### Excluding a website

If you enable **“Do not automatically translate this site”** on `https://github.com/users/Flowseal`, automatic translation will be disabled on all pages of `github.com`.

Exclusions match the **exact hostname**. Excluding `github.com` does not exclude `gist.github.com`. Manual translation remains available on excluded websites.

<a id="en-installation"></a>

## Install from GitHub

1. [Download the project ZIP archive](https://github.com/BigKerambit/neat-translate-free/archive/refs/heads/main.zip).
2. Extract the archive. This creates the project folder `neat-translate-free-main`.
3. Follow the instructions for your browser below.

<details>
<summary><strong>Google Chrome</strong></summary>

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder where you extracted the archive: `neat-translate-free-main`.

</details>

<details>
<summary><strong>Microsoft Edge</strong></summary>

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder where you extracted the archive: `neat-translate-free-main`.

</details>

<details>
<summary><strong>Brave</strong></summary>

1. Open `brave://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder where you extracted the archive: `neat-translate-free-main`.

</details>

<details>
<summary><strong>Opera</strong></summary>

1. Open `opera://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder where you extracted the archive: `neat-translate-free-main`.

</details>

You can optionally pin the extension to your browser toolbar from the extensions menu.

<a id="en-usage"></a>

## Usage

### Translate a page manually

1. Open a website and click the extension icon.
2. Select a language.
3. Click **Translate page**.

Click **Restore original** to bring back the original text.

### Enable automatic translation

Select a language and enable **Auto translate** in the extension popup. The extension will automatically start translating websites as you open them.

### Exclude a website

Open the website and enable **Do not automatically translate this site**. The setting applies to other pages with the same hostname.

<a id="en-update"></a>

## Updating

1. [Download the latest ZIP archive](https://github.com/BigKerambit/neat-translate-free/archive/refs/heads/main.zip).
2. Extract the new files into the installed extension folder, replacing the old ones.
3. Open your browser's extensions page and reload **Neat Translate Free**.
4. Reload already open websites so the updated content script can run.

<a id="en-privacy"></a>

## Limitations and privacy

The extension cannot translate text inside images or browser internal pages such as `chrome://extensions`. Translations may also change the height of some elements because text length differs between languages.

**Website text is sent to Google Translate for translation.** Avoid using the extension on pages containing confidential information if you do not want that text sent to a third-party service.

The extension uses an unofficial free web endpoint. Its availability, speed, and rate limits may change.

<a id="en-license"></a>

## License

This project is released under the [Unlicense](https://unlicense.org/). You may use, copy, modify, distribute, and sell the code, including for commercial purposes.

The extension was created with the help of AI. This license expresses the author's intent to grant the broadest possible permissions for any parts of the project over which they hold rights.
