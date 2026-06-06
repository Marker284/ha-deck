import asyncio
import atexit
import decky_plugin
import aiohttp
import socket
import os
import signal
import json
import threading
import time
import ssl
from http.server import HTTPServer, BaseHTTPRequestHandler
from settings import SettingsManager

settingsDir = os.environ["DECKY_PLUGIN_SETTINGS_DIR"]
settings = SettingsManager(name="settings", settings_directory=settingsDir)

WEB_PORT_DEFAULT = 8765
WEB_PORT_MAX_OFFSET = 20  # пробуем 8765..8785

# ── Module-level state (survives hot-reloads within same process) ─────────────
_config_version = 0
_http_server: "HTTPServer | None" = None
_active_port: int = WEB_PORT_DEFAULT
_ha_session: "aiohttp.ClientSession | None" = None


def _make_ssl_context() -> ssl.SSLContext:
    """Create SSL context with certifi CAs explicitly loaded.

    In PyInstaller bundles (Decky PluginLoader) ssl.create_default_context()
    cannot locate system CA paths, so we must point it at certifi's bundled
    cacert.pem manually.
    """
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
        decky_plugin.logger.info(f"SSL: loaded certifi CAs from {certifi.where()}")
    except Exception as e:
        decky_plugin.logger.warning(f"SSL: could not load certifi, using default context ({e})")
    return ctx


async def _get_session() -> aiohttp.ClientSession:
    """Возвращает переиспользуемую HTTP сессию — не создаём новую на каждый запрос."""
    global _ha_session
    if _ha_session is None or _ha_session.closed:
        connector = aiohttp.TCPConnector(limit=5, ttl_dns_cache=300, ssl=_make_ssl_context())
        _ha_session = aiohttp.ClientSession(connector=connector)
    return _ha_session


async def _close_session():
    global _ha_session
    if _ha_session and not _ha_session.closed:
        await _ha_session.close()
        _ha_session = None


def _is_https_url(url: str) -> bool:
    return url.lower().startswith("https://")


def _is_cert_verify_error(err: Exception) -> bool:
    """Check if the error is likely due to SSL certificate verification failure.

     Checks for common OpenSSL error messages in the exception text, and also
     handles aiohttp's specific ClientConnectorCertificateError which wraps SSL errors.
    """

    # aiohttp wraps SSL verification failures in ClientConnectorCertificateError.
    if isinstance(err, aiohttp.ClientConnectorCertificateError):
        return True

    # Surface OpenSSL verification text in nested exception messages.
    text = str(err).lower()
    markers = (
        "certificate verify failed",
        "unable to get local issuer certificate",
        "self signed certificate",
    )
    return any(marker in text for marker in markers)


async def _ha_request(
    method: str,
    url: str,
    *,
    headers: dict,
    timeout: aiohttp.ClientTimeout,
    json_payload: dict | None = None,
):
    """Run HA HTTP request with verified TLS first, then insecure retry on cert errors for HTTPS."""
    s = await _get_session()
    used_insecure_ssl = False

    try:
        response = await s.request(method, url, headers=headers, timeout=timeout, json=json_payload)
        return response, used_insecure_ssl
    except Exception as e:
        if not (_is_https_url(url) and _is_cert_verify_error(e)):
            raise

        used_insecure_ssl = True
        decky_plugin.logger.warning(f"SSL verify failed for {url}; retrying with insecure SSL ({type(e).__name__}: {e})")
        response = await s.request(
            method,
            url,
            headers=headers,
            timeout=timeout,
            json=json_payload,
            ssl=False,
        )
        return response, used_insecure_ssl

# ── HTML config page ───────────────────────────────────────────────────────────
HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HA Deck — Setup</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#16213e;border-radius:16px;padding:32px;width:100%;max-width:480px;
          box-shadow:0 8px 32px rgba(0,0,0,.4)}
    .logo{display:flex;align-items:center;gap:12px;margin-bottom:28px}
    .logo-icon{font-size:32px}
    h1{font-size:22px;font-weight:700;color:#fff}
    .subtitle{font-size:13px;color:#888;margin-top:2px}
    label{display:block;font-size:13px;color:#aaa;margin-bottom:6px;margin-top:20px}
    input{width:100%;background:#0f3460;border:1px solid #1e4080;border-radius:8px;
          color:#fff;padding:12px 14px;font-size:15px;outline:none;transition:border-color .2s}
    input:focus{border-color:#4a9eff}
    .hint{font-size:11px;color:#555;margin-top:5px}
    .btn{width:100%;padding:14px;border:none;border-radius:8px;font-size:15px;font-weight:600;
         cursor:pointer;margin-top:12px;transition:opacity .2s}
    .btn:disabled{opacity:.5;cursor:default}
    .btn-primary{background:#4a9eff;color:#fff}
    .btn-secondary{background:#1e4080;color:#aaa}
    .status{margin-top:16px;padding:12px 14px;border-radius:8px;font-size:13px;display:none}
    .status.ok{background:#1a3a1a;color:#6fcf6f;border:1px solid #2d6a2d}
    .status.err{background:#3a1a1a;color:#cf6f6f;border:1px solid #6a2d2d}
    .divider{height:1px;background:#1e4080;margin:24px 0}
    .footer{font-size:11px;color:#444;text-align:center}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <span class="logo-icon">🏠</span>
    <div><h1>HA Deck</h1><div class="subtitle">Home Assistant setup for Steam Deck</div></div>
  </div>
  <label>Home Assistant URL</label>
  <input type="url" id="url" placeholder="http://192.168.1.82:8123" />
  <label>Long-lived Access Token</label>
  <input type="text" id="token" placeholder="Paste your HA token here..." />
  <div class="hint">HA → Profile → Security → Long-lived access tokens → Create token</div>
  <button class="btn btn-secondary" id="testBtn" onclick="testConn()">Test Connection</button>
  <button class="btn btn-primary" id="saveBtn" onclick="saveConfig()">Save Configuration</button>
  <div class="status" id="status"></div>
  <div class="divider"></div>
  <div class="footer">After saving, return to your Steam Deck — config loads automatically</div>
</div>
<script>
  fetch('/api/config').then(r=>r.json()).then(d=>{
    if(d.ha_url) document.getElementById('url').value=d.ha_url;
    if(d.ha_token) document.getElementById('token').value=d.ha_token;
  }).catch(()=>{});

  function show(msg,type){
    const el=document.getElementById('status');
    el.textContent=msg; el.className='status '+type; el.style.display='block';
  }

  async function testConn(){
    const url=document.getElementById('url').value.trim();
    const token=document.getElementById('token').value.trim();
    if(!url||!token){show('Fill in URL and token first','err');return;}
    document.getElementById('testBtn').disabled=true;
    try{
      const r=await fetch('/api/test',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ha_url:url,ha_token:token})});
      const d=await r.json();
      show((d.success?'✅ ':'❌ ')+d.message, d.success?'ok':'err');
    }catch(e){show('❌ '+e,'err');}
    finally{document.getElementById('testBtn').disabled=false;}
  }

  async function saveConfig(){
    const url=document.getElementById('url').value.trim();
    const token=document.getElementById('token').value.trim();
    if(!url||!token){show('Fill in URL and token first','err');return;}
    document.getElementById('saveBtn').disabled=true;
    try{
      const r=await fetch('/api/config',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ha_url:url,ha_token:token})});
      const d=await r.json();
      show(d.success?'✅ Saved! You can close this page.':'❌ '+d.message, d.success?'ok':'err');
    }catch(e){show('❌ '+e,'err');}
    finally{document.getElementById('saveBtn').disabled=false;}
  }
</script>
</body>
</html>"""


async def _test_ha_connection_async(ha_url: str, ha_token: str) -> dict:
    """One-shot connection test using a temporary aiohttp session."""
    url = ha_url.rstrip("/") + "/api/"
    headers = {"Authorization": f"Bearer {ha_token}"}
    connector = aiohttp.TCPConnector(ssl=_make_ssl_context())
    async with aiohttp.ClientSession(connector=connector) as session:
        used_insecure = False
        try:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as r:
                status = r.status
        except Exception as e:
            if not (_is_https_url(url) and _is_cert_verify_error(e)):
                raise
            used_insecure = True
            decky_plugin.logger.warning(f"SSL verify failed for {url}; retrying with insecure SSL")
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5), ssl=False) as r:
                status = r.status
        if status == 200:
            msg = "Connected!" + (" (SSL verification disabled for self-signed cert)" if used_insecure else "")
            return {"success": True, "message": msg}
        return {"success": False, "message": f"HTTP {status}"}


# ── Web server (module-level, survives plugin hot-reloads) ────────────────────

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence access logs

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        if self.path == "/":
            body = HTML_PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/config":
            self._send_json({
                "ha_url": settings.getSetting("ha_url", ""),
                "ha_token": settings.getSetting("ha_token", ""),
            })
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global _config_version, _http_server
        if self.path == "/api/config":
            try:
                data = self._read_json()
                settings.setSetting("ha_url", data.get("ha_url", ""))
                settings.setSetting("ha_token", data.get("ha_token", ""))
                settings.commit()
                _config_version += 1
                decky_plugin.logger.info(f"Config saved via web, version={_config_version}")
                self._send_json({"success": True})
                # Выключаем сервер после успешного сохранения
                threading.Thread(target=_stop_web_server_sync, daemon=True).start()
            except Exception as e:
                self._send_json({"success": False, "message": str(e)})

        elif self.path == "/api/test":
            try:
                data = self._read_json()
                result = asyncio.run(_test_ha_connection_async(
                    data.get("ha_url", ""), data.get("ha_token", "")
                ))
                self._send_json(result)
            except Exception as e:
                self._send_json({"success": False, "message": str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


class _ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except (AttributeError, OSError):
            pass
        super().server_bind()


def _start_web_server_if_needed():
    global _http_server, _active_port
    if _http_server is not None:
        decky_plugin.logger.info("Web server already running")
        return
    preferred = settings.getSetting("web_port", WEB_PORT_DEFAULT)
    try:
        preferred = int(preferred)
    except (ValueError, TypeError):
        preferred = WEB_PORT_DEFAULT
    for port in range(preferred, preferred + WEB_PORT_MAX_OFFSET + 1):
        try:
            server = _ReusableHTTPServer(("0.0.0.0", port), _Handler)
            _http_server = server
            _active_port = port
            t = threading.Thread(target=server.serve_forever, daemon=True)
            t.start()
            if port != preferred:
                decky_plugin.logger.info(f"Port {preferred} busy — using {port}")
            decky_plugin.logger.info(f"Web config server started on :{port}")
            return
        except OSError as e:
            decky_plugin.logger.warning(f"Port {port} busy ({e}), trying next...")
    decky_plugin.logger.error(f"No free port found in range {preferred}–{preferred + WEB_PORT_MAX_OFFSET}")


def _stop_web_server_sync():
    global _http_server
    if _http_server:
        srv = _http_server
        _http_server = None  # зануляем до shutdown чтобы не было гонок
        try:
            srv.shutdown()      # останавливает serve_forever()
            srv.server_close()  # закрывает сокет — без этого порт остаётся занят!
        except Exception as e:
            decky_plugin.logger.warning(f"stop_web_server: {e}")
        decky_plugin.logger.info("Web config server stopped")


def _graceful_exit(signum=None, frame=None):
    """Чистый выход: закрываем сервер перед смертью процесса."""
    _stop_web_server_sync()


# Регистрируем cleanup при любом завершении процесса
atexit.register(_graceful_exit)          # нормальный выход
signal.signal(signal.SIGTERM, _graceful_exit)  # systemctl stop / kill


def _migrate_legacy_categories():
    """Однократная миграция: до v1.3.0 climate.* лежал в selected_sensors,
    а fan.* в selected_switches. Перетаскиваем их в свои новые категории."""
    sensors = settings.getSetting("selected_sensors", []) or []
    switches = settings.getSetting("selected_switches", []) or []
    climates = settings.getSetting("selected_climates", []) or []
    fans = settings.getSetting("selected_fans", []) or []

    moved_climates = [e for e in sensors if e.startswith("climate.")]
    moved_fans = [e for e in switches if e.startswith("fan.")]
    if not moved_climates and not moved_fans:
        return

    if moved_climates:
        settings.setSetting("selected_sensors", [e for e in sensors if not e.startswith("climate.")])
        settings.setSetting("selected_climates", list(dict.fromkeys(climates + moved_climates)))
    if moved_fans:
        settings.setSetting("selected_switches", [e for e in switches if not e.startswith("fan.")])
        settings.setSetting("selected_fans", list(dict.fromkeys(fans + moved_fans)))
    settings.commit()
    decky_plugin.logger.info(
        f"Migrated {len(moved_climates)} climate(s) and {len(moved_fans)} fan(s) to new categories"
    )


# ── Plugin class ───────────────────────────────────────────────────────────────

class Plugin:
    api_version = 1

    async def _main(self):
        settings.read()
        _migrate_legacy_categories()
        # Запускаем веб-сервер только если ещё не настроено
        if not settings.getSetting("ha_url", "") or not settings.getSetting("ha_token", ""):
            _start_web_server_if_needed()
        decky_plugin.logger.info("HA Deck loaded!")

    async def _unload(self):
        await asyncio.to_thread(_stop_web_server_sync)
        await _close_session()
        decky_plugin.logger.info("HA Deck unloaded!")

    # ── Web info ──────────────────────────────────────────────────────────────

    async def get_web_info(self) -> dict:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
        except Exception:
            ip = "127.0.0.1"
        return {
            "url": f"http://{ip}:{_active_port}",
            "port": _active_port,
            "preferred_port": settings.getSetting("web_port", WEB_PORT_DEFAULT),
            "config_version": _config_version,
            "running": _http_server is not None,
        }

    async def get_config_version(self) -> int:
        return _config_version

    async def is_web_server_running(self) -> bool:
        return _http_server is not None

    async def start_web_server_rpc(self) -> dict:
        """Запустить веб-сервер для перенастройки"""
        _start_web_server_if_needed()
        return await self.get_web_info()

    async def stop_web_server_rpc(self) -> bool:
        """Остановить веб-сервер вручную."""
        await asyncio.to_thread(_stop_web_server_sync)
        return True



    async def reset_settings(self) -> bool:
        """Полный сброс всех настроек"""
        global _config_version
        STRING_KEYS = ("ha_url", "ha_token")
        LIST_KEYS = ("selected_lights", "selected_sensors", "selected_switches",
                     "selected_climates", "selected_fans")
        for key in STRING_KEYS:
            settings.setSetting(key, "")
        for key in LIST_KEYS:
            settings.setSetting(key, [])
        settings.commit()
        _config_version = 0
        _start_web_server_if_needed()  # после сброса сразу поднимаем веб для перенастройки
        decky_plugin.logger.info("Settings reset")
        return True

    # ── Settings ──────────────────────────────────────────────────────────────

    async def get_settings(self) -> dict:
        return {
            "ha_url": settings.getSetting("ha_url", ""),
            "ha_token": settings.getSetting("ha_token", ""),
            "selected_lights": settings.getSetting("selected_lights", []),
            "selected_sensors": settings.getSetting("selected_sensors", []),
            "selected_switches": settings.getSetting("selected_switches", []),
            "selected_climates": settings.getSetting("selected_climates", []),
            "selected_fans": settings.getSetting("selected_fans", []),
        }

    async def save_credentials(self, ha_url: str, ha_token: str) -> bool:
        global _config_version
        settings.setSetting("ha_url", ha_url)
        settings.setSetting("ha_token", ha_token)
        settings.commit()
        _config_version += 1
        return True

    async def save_selected_entities(
        self,
        lights: list,
        sensors: list,
        switches: list,
        climates: list | None = None,
        fans: list | None = None,
    ) -> bool:
        settings.setSetting("selected_lights", lights)
        settings.setSetting("selected_sensors", sensors)
        settings.setSetting("selected_switches", switches)
        if climates is not None:
            settings.setSetting("selected_climates", climates)
        if fans is not None:
            settings.setSetting("selected_fans", fans)
        settings.commit()
        return True

    # ── Connection test ───────────────────────────────────────────────────────

    async def test_connection(self) -> dict:
        try:
            url = settings.getSetting("ha_url", "").rstrip("/")
            token = settings.getSetting("ha_token", "")
            headers = {"Authorization": f"Bearer {token}"}
            response, used_insecure_ssl = await _ha_request(
                "GET",
                f"{url}/api/",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=5),
            )
            async with response as r:
                if r.status == 200:
                    msg = "Connected!"
                    if used_insecure_ssl:
                        msg += " (SSL verification disabled for self-signed cert)"
                    return {"success": True, "message": msg}
                return {"success": False, "message": f"HTTP {r.status}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _headers(self):
        return {
            "Authorization": f"Bearer {settings.getSetting('ha_token', '')}",
            "Content-Type": "application/json",
        }

    def _base_url(self):
        return settings.getSetting("ha_url", "").rstrip("/")

    async def _all_states(self):
        response, _used_insecure_ssl = await _ha_request(
            "GET",
            f"{self._base_url()}/api/states",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        )
        async with response as r:
            r.raise_for_status()
            return await r.json()

    # ── Entity discovery ──────────────────────────────────────────────────────

    async def get_all_lights(self) -> list:
        try:
            states = await self._all_states()
            return [{"entity_id": s["entity_id"],
                     "name": s["attributes"].get("friendly_name", s["entity_id"]),
                     "state": s["state"]}
                    for s in states if s["entity_id"].startswith("light.")]
        except Exception as e:
            decky_plugin.logger.error(f"get_all_lights: {e}")
            return []

    async def get_all_switches(self) -> list:
        """Возвращает все переключаемые энтити: switch, input_boolean, automation, script.
        fan.* вынесен в отдельную категорию (get_all_fans)."""
        try:
            states = await self._all_states()
            DOMAINS = ("switch.", "input_boolean.", "automation.", "script.")
            return [{"entity_id": s["entity_id"],
                     "name": s["attributes"].get("friendly_name", s["entity_id"]),
                     "state": s["state"]}
                    for s in states
                    if any(s["entity_id"].startswith(d) for d in DOMAINS)]
        except Exception as e:
            decky_plugin.logger.error(f"get_all_switches: {e}")
            return []

    async def get_all_sensors(self) -> list:
        """sensor.* + binary_sensor.*. climate.* вынесен в отдельную категорию."""
        try:
            states = await self._all_states()
            return [{"entity_id": s["entity_id"],
                     "name": s["attributes"].get("friendly_name", s["entity_id"]),
                     "state": s["state"],
                     "unit": s["attributes"].get("unit_of_measurement", "")}
                    for s in states
                    if s["entity_id"].startswith(("sensor.", "binary_sensor."))]
        except Exception as e:
            decky_plugin.logger.error(f"get_all_sensors: {e}")
            return []

    async def get_all_climates(self) -> list:
        try:
            states = await self._all_states()
            return [{"entity_id": s["entity_id"],
                     "name": s["attributes"].get("friendly_name", s["entity_id"]),
                     "state": s["state"]}
                    for s in states if s["entity_id"].startswith("climate.")]
        except Exception as e:
            decky_plugin.logger.error(f"get_all_climates: {e}")
            return []

    async def get_all_fans(self) -> list:
        try:
            states = await self._all_states()
            return [{"entity_id": s["entity_id"],
                     "name": s["attributes"].get("friendly_name", s["entity_id"]),
                     "state": s["state"]}
                    for s in states if s["entity_id"].startswith("fan.")]
        except Exception as e:
            decky_plugin.logger.error(f"get_all_fans: {e}")
            return []

    # ── Live state ────────────────────────────────────────────────────────────

    async def get_light_states(self, entity_ids: list) -> list:
        if not entity_ids:
            return []
        try:
            state_map = {s["entity_id"]: s for s in await self._all_states()}
            result = []
            for eid in entity_ids:
                if eid not in state_map:
                    continue
                s = state_map[eid]
                a = s["attributes"]
                modes = a.get("supported_color_modes", [])
                # Яркость поддерживается если режим не просто on/off
                BRIGHTNESS_MODES = {"brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy", "white"}
                COLOR_MODES = {"hs", "rgb", "rgbw", "rgbww", "xy"}
                result.append({
                    "entity_id": eid,
                    "name": a.get("friendly_name", eid),
                    "state": s["state"],
                    "brightness": a.get("brightness"),
                    "supports_brightness": any(m in BRIGHTNESS_MODES for m in modes),
                    "color_temp": a.get("color_temp"),
                    "min_mireds": a.get("min_mireds", 153),
                    "max_mireds": a.get("max_mireds", 500),
                    "hs_color": a.get("hs_color"),
                    "rgb_color": a.get("rgb_color"),
                    "supports_color_temp": "color_temp" in modes,
                    "supports_color": any(m in COLOR_MODES for m in modes),
                })
            return result
        except Exception as e:
            decky_plugin.logger.error(f"get_light_states: {e}")
            return []

    async def get_switch_states(self, entity_ids: list) -> list:
        if not entity_ids:
            return []
        try:
            state_map = {s["entity_id"]: s for s in await self._all_states()}
            return [{"entity_id": eid,
                     "name": state_map[eid]["attributes"].get("friendly_name", eid),
                     "state": state_map[eid]["state"]}
                    for eid in entity_ids if eid in state_map]
        except Exception as e:
            decky_plugin.logger.error(f"get_switch_states: {e}")
            return []

    async def get_sensor_states(self, entity_ids: list) -> list:
        if not entity_ids:
            return []
        try:
            state_map = {s["entity_id"]: s for s in await self._all_states()}
            return [{"entity_id": eid,
                     "name": state_map[eid]["attributes"].get("friendly_name", eid),
                     "state": state_map[eid]["state"],
                     "unit": state_map[eid]["attributes"].get("unit_of_measurement", "")}
                    for eid in entity_ids if eid in state_map]
        except Exception as e:
            decky_plugin.logger.error(f"get_sensor_states: {e}")
            return []

    async def get_climate_states(self, entity_ids: list) -> list:
        if not entity_ids:
            return []
        try:
            state_map = {s["entity_id"]: s for s in await self._all_states()}
            result = []
            for eid in entity_ids:
                if eid not in state_map:
                    continue
                s = state_map[eid]
                a = s["attributes"]
                result.append({
                    "entity_id": eid,
                    "name": a.get("friendly_name", eid),
                    "hvac_mode": s["state"],
                    "hvac_modes": a.get("hvac_modes", []) or [],
                    "current_temperature": a.get("current_temperature"),
                    "target_temperature": a.get("temperature"),
                    "min_temp": a.get("min_temp", 7),
                    "max_temp": a.get("max_temp", 35),
                    "target_temp_step": a.get("target_temp_step", 0.5),
                    "unit": a.get("unit_of_measurement", "°C"),
                    "hvac_action": a.get("hvac_action"),
                })
            return result
        except Exception as e:
            decky_plugin.logger.error(f"get_climate_states: {e}")
            return []

    async def get_fan_states(self, entity_ids: list) -> list:
        if not entity_ids:
            return []
        try:
            state_map = {s["entity_id"]: s for s in await self._all_states()}
            result = []
            for eid in entity_ids:
                if eid not in state_map:
                    continue
                s = state_map[eid]
                a = s["attributes"]
                # FanEntityFeature: 1=SET_SPEED, 2=OSCILLATE, 4=DIRECTION, 8=PRESET_MODE
                features = a.get("supported_features", 0)
                result.append({
                    "entity_id": eid,
                    "name": a.get("friendly_name", eid),
                    "state": s["state"],
                    "percentage": a.get("percentage"),
                    "percentage_step": a.get("percentage_step", 1),
                    "supports_speed": bool(features & 1),
                    "preset_mode": a.get("preset_mode"),
                    "preset_modes": a.get("preset_modes", []) or [],
                    "supports_preset": bool(features & 8),
                })
            return result
        except Exception as e:
            decky_plugin.logger.error(f"get_fan_states: {e}")
            return []

    # ── Light control ─────────────────────────────────────────────────────────

    async def _post_service(self, domain: str, service: str, payload: dict) -> bool:
        """Переиспользуемый хелпер для вызова сервисов HA."""
        try:
            response, _used_insecure_ssl = await _ha_request(
                "POST",
                f"{self._base_url()}/api/services/{domain}/{service}",
                headers=self._headers(),
                timeout=aiohttp.ClientTimeout(total=5),
                json_payload=payload,
            )
            async with response as r:
                return r.status in (200, 201)
        except Exception as e:
            decky_plugin.logger.error(f"{domain}/{service}: {e}")
            return False

    async def toggle_light(self, entity_id: str) -> bool:
        return await self._post_service("light", "toggle", {"entity_id": entity_id})

    async def set_brightness(self, entity_id: str, brightness: int) -> bool:
        return await self._post_service("light", "turn_on",
                                        {"entity_id": entity_id, "brightness": brightness})

    async def set_color_temp(self, entity_id: str, color_temp: int) -> bool:
        return await self._post_service("light", "turn_on",
                                        {"entity_id": entity_id, "color_temp": color_temp})

    async def toggle_switch(self, entity_id: str) -> bool:
        return await self._post_service("homeassistant", "toggle", {"entity_id": entity_id})

    # ── Climate control ───────────────────────────────────────────────────────

    async def set_climate_temperature(self, entity_id: str, temperature: float) -> bool:
        return await self._post_service("climate", "set_temperature",
                                        {"entity_id": entity_id, "temperature": temperature})

    async def set_climate_hvac_mode(self, entity_id: str, hvac_mode: str) -> bool:
        return await self._post_service("climate", "set_hvac_mode",
                                        {"entity_id": entity_id, "hvac_mode": hvac_mode})

    # ── Fan control ───────────────────────────────────────────────────────────

    async def toggle_fan(self, entity_id: str) -> bool:
        return await self._post_service("fan", "toggle", {"entity_id": entity_id})

    async def set_fan_percentage(self, entity_id: str, percentage: int) -> bool:
        return await self._post_service("fan", "set_percentage",
                                        {"entity_id": entity_id, "percentage": percentage})

    async def set_fan_preset_mode(self, entity_id: str, preset_mode: str) -> bool:
        return await self._post_service("fan", "set_preset_mode",
                                        {"entity_id": entity_id, "preset_mode": preset_mode})
