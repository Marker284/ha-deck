# Как написать Decky Loader плагин с нуля

> Гайд на примере плагина `ha-deck`. Тестовый плагин делает одну кнопку, которая вызывает Python-бэкенд и показывает ответ.

---

## Что такое Decky Loader

[Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) — это менеджер плагинов для Steam Deck (Quick Access Menu). Плагины состоят из:
- **Python-бэкенда** (`main.py`) — запускается на устройстве, может делать всё что угодно
- **TypeScript/React-фронтенда** (`src/index.tsx`) — рисует UI в Quick Access Menu

---

## Требования

На машине разработчика (не Steam Deck):
- **Node.js** v16.14+
- **pnpm** v9: `sudo npm i -g pnpm@9`
- **Docker** — нужен только если у тебя кастомный скомпилированный бэкенд (бинарники, C/Go и т.д.)

На Steam Deck:
- Установленный [Decky Loader](https://decky.xyz)
- Включён **Developer Mode** в настройках Decky (Settings → General → Developer Mode)

---

## Шаг 1: Получить шаблон

Самый простой способ — форкнуть официальный шаблон:

```
https://github.com/SteamDeckHomebrew/decky-plugin-template
```

Нажми **"Use this template"** → создай свой репо → клонируй.

Либо просто скопируй структуру из этого гайда вручную.

---

## Шаг 2: Структура проекта

```
ha-deck/
├── src/
│   └── index.tsx       # React UI (TypeScript)
├── main.py             # Python бэкенд
├── plugin.json         # Метаданные плагина
├── package.json        # npm метаданные + скрипты сборки
└── README.md
```

---

## Шаг 3: plugin.json

```json
{
  "name": "HA Deck",
  "author": "Mark",
  "flags": ["debug"],
  "publish": {
    "tags": ["home-assistant"],
    "description": "Control Home Assistant from your Steam Deck"
  }
}
```

`"debug"` в flags — включает авто-релоад при разработке. Убери перед релизом.

---

## Шаг 4: Python бэкенд (main.py)

```python
import decky_plugin

class Plugin:
    async def _main(self):
        """Живёт пока плагин загружен"""
        decky_plugin.logger.info("Plugin loaded!")

    async def _unload(self):
        """Вызывается при выгрузке"""
        pass

    # Твои методы — доступны из фронтенда
    async def say_hello(self, name: str) -> str:
        return f"Hello, {name}!"
```

**Важно:** все публичные методы класса `Plugin` становятся вызываемыми с фронтенда.

---

## Шаг 5: TypeScript фронтенд (src/index.tsx)

```tsx
import { definePlugin, PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { callable } from "@decky/api";
import { FaHome } from "react-icons/fa";
import { useState } from "react";

// Привязка к Python-методу
const sayHello = callable<[name: string], string>("say_hello");

function Content() {
  const [result, setResult] = useState("");

  return (
    <PanelSection title="Test">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={async () => {
          const r = await sayHello("World");
          setResult(r);
        }}>
          Call Backend
        </ButtonItem>
      </PanelSectionRow>
      {result && <PanelSectionRow><div>{result}</div></PanelSectionRow>}
    </PanelSection>
  );
}

export default definePlugin(() => ({
  name: "HA Deck",
  content: <Content />,
  icon: <FaHome />,
}));
```

---

## Шаг 6: Установить зависимости и собрать

```bash
cd ha-deck
pnpm i
pnpm run build
```

После сборки появится папка `dist/` с `index.js` — это и есть скомпилированный фронтенд.

---

## Шаг 7: Деплой на Steam Deck

### Вариант А — через scp (SSH)

```bash
# Включи SSH на Steam Deck: Settings → Enable SSH
# Пароль задаётся через: passwd (в desktop mode terminal)

# Скопировать плагин
scp -r ./ha-deck deck@<STEAM_DECK_IP>:/home/deck/homebrew/plugins/

# Перезапустить Decky
ssh deck@<STEAM_DECK_IP> "sudo systemctl restart plugin_loader"
```

### Вариант Б — через VS Code Remote SSH

1. Установи расширение Remote - SSH
2. Подключись к Steam Deck
3. Работай с файлами напрямую
4. Запускай build + deploy команды через терминал VS Code

### Вариант В — ручной (USB/файловый менеджер)

1. Переключись в Desktop Mode на Steam Deck
2. Скопируй папку плагина в `/home/deck/homebrew/plugins/ha-deck`
3. В Decky: Settings → Reload Plugin

---

## Шаг 8: Проверить работу

1. В Gaming Mode жмёшь `...` (три точки) → иконка плагина (розетка)
2. Находишь HA Deck в списке
3. Тыкаешь кнопку "Test Backend Call"
4. Должен появиться тост с ответом от Python

Если что-то не работает — смотри логи:

```bash
ssh deck@<IP>
cat /tmp/plugin_loader/ha-deck.log
# или
journalctl -u plugin_loader -f
```

---

## Следующий шаг: подключение Home Assistant

В `main.py` добавляешь HTTP-вызовы к HA REST API:

```python
import aiohttp

HA_URL = "http://192.168.1.82:8123"
HA_TOKEN = "your_token_here"

async def get_states(self) -> list:
    headers = {"Authorization": f"Bearer {HA_TOKEN}"}
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{HA_URL}/api/states", headers=headers) as r:
            return await r.json()
```

`aiohttp` уже доступен в окружении Decky — устанавливать не надо.

---

## Полезные ссылки

- [Официальный шаблон](https://github.com/SteamDeckHomebrew/decky-plugin-template)
- [decky-frontend-lib (UI компоненты)](https://github.com/SteamDeckHomebrew/decky-frontend-lib)
- [Документация](https://wiki.deckbrew.xyz/en/plugin-dev/getting-started)
- [Примеры плагинов](https://github.com/SteamDeckHomebrew/decky-plugin-database)
