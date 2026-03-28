import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  Field,
} from "@decky/ui";
import { FC, useState, useEffect, useRef } from "react";
import { FaArrowLeft, FaTrash } from "react-icons/fa";
import {
  HASettings,
  EntityInfo,
  WebInfo,
  saveSelectedEntities,
  getAllLights,
  getAllSensors,
  getAllSwitches,
  getWebInfo,
  getSettings,
  startWebServerRpc,
  stopWebServerRpc,
  resetSettings,
} from "./api";

// ── Settings view ─────────────────────────────────────────────────────────────

type Page = "main" | "pick-lights" | "pick-sensors" | "pick-switches";

interface Props {
  settings: HASettings | null;
  onBack: () => void;
}

export const SettingsView: FC<Props> = ({ settings: init, onBack }) => {
  const [page, setPage] = useState<Page>("main");

  const [selLights, setSelLights] = useState<string[]>(init?.selected_lights ?? []);
  const [selSensors, setSelSensors] = useState<string[]>(init?.selected_sensors ?? []);
  const [selSwitches, setSelSwitches] = useState<string[]>(init?.selected_switches ?? []);

  const [allLights, setAllLights] = useState<EntityInfo[]>([]);
  const [allSensors, setAllSensors] = useState<EntityInfo[]>([]);
  const [allSwitches, setAllSwitches] = useState<EntityInfo[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);

  // Web config state
  const [webInfo, setWebInfo] = useState<WebInfo | null>(null);
  const [webStatus, setWebStatus] = useState<"idle" | "waiting" | "saved">("idle");
  const [webLoading, setWebLoading] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const lastVersionRef = useRef<number>(-1);

  // Единый полинг: статус сервера + детект сохранения конфига
  useEffect(() => {
    let active = true;

    // Первый запрос — инициализируем baseline версию
    getWebInfo().then((info) => {
      if (!active) return;
      lastVersionRef.current = info.config_version;
      setWebInfo(info);
    }).catch(() => {});

    const t = setInterval(async () => {
      if (!active) return;
      try {
        const info = await getWebInfo();
        if (!active) return;

        // Конфиг сохранён через браузер — версия выросла
        if (lastVersionRef.current >= 0 && info.config_version > lastVersionRef.current) {
          lastVersionRef.current = info.config_version;
          setWebInfo(info);          // running уже false (сервер сам выключился)
          setWebStatus("saved");
          setTimeout(() => { if (active) onBack(); }, 1500);
          return;
        }

        // Обычное обновление статуса сервера
        setWebInfo(info);
      } catch { /* ignore */ }
    }, 2000);

    return () => { active = false; clearInterval(t); };
  }, [onBack]);

  const handleWebServerToggle = async () => {
    setWebLoading(true);
    try {
      if (webInfo?.running) {
        await stopWebServerRpc();
      } else {
        await startWebServerRpc();
      }
      // Небольшая пауза и читаем актуальный статус
      await new Promise((r) => setTimeout(r, 600));
      const info = await getWebInfo();
      setWebInfo(info);
    } finally {
      setWebLoading(false);
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    await resetSettings();
    setConfirmReset(false);
    // После сброса сервер поднимется автоматически — обновим инфо
    const info = await getWebInfo();
    setWebInfo(info);
    setWebStatus("waiting");
  };

  // ── Entity pickers ──────────────────────────────────────────────────────────

  const openLightPicker = async () => {
    setLoadingEntities(true);
    try {
      const s = await getSettings();
      if (!s.ha_url || !s.ha_token) {
        alert("Configure HA connection first");
        return;
      }
      setAllLights(await getAllLights());
      setPage("pick-lights");
    } finally {
      setLoadingEntities(false);
    }
  };

  const openSensorPicker = async () => {
    setLoadingEntities(true);
    try {
      const s = await getSettings();
      if (!s.ha_url || !s.ha_token) {
        alert("Configure HA connection first");
        return;
      }
      setAllSensors(await getAllSensors());
      setPage("pick-sensors");
    } finally {
      setLoadingEntities(false);
    }
  };

  const openSwitchPicker = async () => {
    setLoadingEntities(true);
    try {
      const s = await getSettings();
      if (!s.ha_url || !s.ha_token) return;
      setAllSwitches(await getAllSwitches());
      setPage("pick-switches");
    } finally {
      setLoadingEntities(false);
    }
  };

  const goBack = () => setPage("main");

  // Auto-save helpers — сохраняем при каждом тогgle, не надо жать Save
  const toggleAndSave = async (
    id: string,
    list: string[],
    setList: (v: string[]) => void,
    type: "lights" | "sensors" | "switches"
  ) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    setList(next);
    const lights   = type === "lights"   ? next : selLights;
    const sensors  = type === "sensors"  ? next : selSensors;
    const switches = type === "switches" ? next : selSwitches;
    await saveSelectedEntities(lights, sensors, switches);
  };

  // ── Light picker ────────────────────────────────────────────────────────────

  if (page === "pick-lights") {
    return (
      <PanelSection title="💡 Lights — tap to toggle, changes save instantly">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={goBack}>
            <FaArrowLeft style={{ marginRight: "6px" }} /> Back
          </ButtonItem>
        </PanelSectionRow>
        {allLights.length === 0 ? (
          <PanelSectionRow>
            <div style={{ color: "#aaa", fontSize: "12px" }}>No lights found</div>
          </PanelSectionRow>
        ) : allLights.map((l) => (
          <PanelSectionRow key={l.entity_id}>
            <ToggleField
              label={l.name}
              checked={selLights.includes(l.entity_id)}
              onChange={() => toggleAndSave(l.entity_id, selLights, setSelLights, "lights")}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>
    );
  }

  // ── Sensor picker ───────────────────────────────────────────────────────────

  if (page === "pick-sensors") {
    return (
      <PanelSection title="🌡️ Sensors — tap to toggle, changes save instantly">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={goBack}>
            <FaArrowLeft style={{ marginRight: "6px" }} /> Back
          </ButtonItem>
        </PanelSectionRow>
        {allSensors.length === 0 ? (
          <PanelSectionRow>
            <div style={{ color: "#aaa", fontSize: "12px" }}>No sensors found</div>
          </PanelSectionRow>
        ) : allSensors.map((s) => (
          <PanelSectionRow key={s.entity_id}>
            <ToggleField
              label={s.name}
              checked={selSensors.includes(s.entity_id)}
              onChange={() => toggleAndSave(s.entity_id, selSensors, setSelSensors, "sensors")}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>
    );
  }

  // ── Switch picker ───────────────────────────────────────────────────────────

  if (page === "pick-switches") {
    return (
      <PanelSection title="🔌 Switches — tap to toggle, changes save instantly">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={goBack}>
            <FaArrowLeft style={{ marginRight: "6px" }} /> Back
          </ButtonItem>
        </PanelSectionRow>
        {allSwitches.length === 0 ? (
          <PanelSectionRow>
            <div style={{ color: "#aaa", fontSize: "12px" }}>No switches found</div>
          </PanelSectionRow>
        ) : allSwitches.map((s) => (
          <PanelSectionRow key={s.entity_id}>
            <ToggleField
              label={s.name}
              checked={selSwitches.includes(s.entity_id)}
              onChange={() => toggleAndSave(s.entity_id, selSwitches, setSelSwitches, "switches")}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>
    );
  }

  // ── Main settings ───────────────────────────────────────────────────────────

  return (
    <>
      {/* Back button — первым делом */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onBack}>
            <FaArrowLeft style={{ marginRight: "6px" }} /> Back to Main
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* Web config section */}
      <PanelSection title="🌐 Web Configuration">
        {webStatus === "saved" ? (
          <PanelSectionRow>
            <div style={{ color: "#6fcf6f", fontSize: "13px" }}>
              ✅ Config saved! Returning...
            </div>
          </PanelSectionRow>
        ) : (
          <>
            <PanelSectionRow>
              <ToggleField
                label="Web Server"
                description={webInfo?.running ? webInfo.url : "Off — toggle to configure via browser"}
                checked={webInfo?.running ?? false}
                onChange={handleWebServerToggle}
                disabled={webLoading}
              />
            </PanelSectionRow>
            {webInfo?.running && (
              <PanelSectionRow>
                <div style={{ fontSize: "11px", color: "#888", padding: "2px 0" }}>
                  Open URL above on phone/PC (same Wi-Fi) → save → server stops automatically
                </div>
              </PanelSectionRow>
            )}
          </>
        )}
      </PanelSection>

      {/* Device selection */}
      <PanelSection title="🔌 Devices">
        <PanelSectionRow>
          <Field label="Lights" focusable={false}>
            <span style={{ color: "#aaa" }}>{selLights.length} selected</span>
          </Field>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openLightPicker} disabled={loadingEntities}>
            {loadingEntities ? "Loading..." : "Choose Lights →"}
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <Field label="Sensors" focusable={false}>
            <span style={{ color: "#aaa" }}>{selSensors.length} selected</span>
          </Field>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openSensorPicker} disabled={loadingEntities}>
            {loadingEntities ? "Loading..." : "Choose Sensors →"}
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <Field label="Switches" focusable={false}>
            <span style={{ color: "#aaa" }}>{selSwitches.length} selected</span>
          </Field>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openSwitchPicker} disabled={loadingEntities}>
            {loadingEntities ? "Loading..." : "Choose Switches →"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* Danger zone */}
      <PanelSection title="⚠️ Danger Zone">
        {confirmReset ? (
          <>
            <PanelSectionRow>
              <div style={{ fontSize: "12px", color: "#cf6f6f" }}>
                This will clear all credentials and device selections!
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={handleReset}>
                <FaTrash style={{ marginRight: "6px" }} /> Confirm Reset
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={() => setConfirmReset(false)}>
                Cancel
              </ButtonItem>
            </PanelSectionRow>
          </>
        ) : (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={handleReset}>
              <FaTrash style={{ marginRight: "6px" }} /> Reset All Settings
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
};
