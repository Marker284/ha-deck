import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  SliderField,
  Field,
} from "@decky/ui";
import { FC, useState, useEffect, useCallback, useRef } from "react";
import {
  HASettings,
  LightState,
  SwitchState,
  SensorState,
  getLightStates,
  getSensorStates,
  getSwitchStates,
  toggleLight,
  toggleSwitch,
  setBrightness,
  setColorTemp,
} from "./api";


interface Props {
  settings: HASettings;
  onOpenSettings: () => void;
}

export const MainView: FC<Props> = ({ settings, onOpenSettings }) => {
  const [lights, setLights] = useState<LightState[]>([]);
  const [switches, setSwitches] = useState<SwitchState[]>([]);
  const [sensors, setSensors] = useState<SensorState[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  // Debounce timers — ключ: "entity_id:type", значение: таймер
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const debounced = useCallback((key: string, fn: () => void, delay = 400) => {
    const existing = debounceTimers.current.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.current.set(key, setTimeout(() => {
      fn();
      debounceTimers.current.delete(key);
    }, delay));
  }, []);

  // Очищаем таймеры при размонтировании
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => { timers.forEach(clearTimeout); };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [ls, ss, sw] = await Promise.all([
        settings.selected_lights.length > 0
          ? getLightStates(settings.selected_lights)
          : Promise.resolve([]),
        settings.selected_sensors.length > 0
          ? getSensorStates(settings.selected_sensors)
          : Promise.resolve([]),
        settings.selected_switches.length > 0
          ? getSwitchStates(settings.selected_switches)
          : Promise.resolve([]),
      ]);
      setLights(ls);
      setSensors(ss);
      setSwitches(sw);
      setLastUpdated(new Date().toLocaleTimeString());
    } finally {
      setRefreshing(false);
    }
  }, [settings]);

  // Рефреш только пока панель открыта — интервал сам умирает при unmount
  // 30с вместо 10с — снижаем нагрузку в 3 раза
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!active) return;
      timer = setTimeout(async () => {
        if (!active) return;
        await refresh();
        schedule(); // цепочка вместо setInterval — не накапливает отставшие вызовы
      }, 30_000);
    };

    refresh(); // мгновенный рефреш при открытии панели
    schedule();

    return () => {
      active = false; // гарантированно глушим всё при закрытии панели
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // ── Light handlers ────────────────────────────────────────────────────────

  const handleToggleLight = async (entity_id: string) => {
    setLights((p) =>
      p.map((l) =>
        l.entity_id === entity_id ? { ...l, state: l.state === "on" ? "off" : "on" } : l
      )
    );
    await toggleLight(entity_id);
    setTimeout(refresh, 700);
  };

  const handleBrightness = (entity_id: string, pct: number) => {
    const raw = Math.round(pct * 2.55);
    // Обновляем UI сразу — слайдер движется плавно
    setLights((p) => p.map((l) => l.entity_id === entity_id ? { ...l, brightness: raw } : l));
    // API вызываем только после остановки (400мс) — не спамим
    debounced(`brightness:${entity_id}`, () => setBrightness(entity_id, raw));
  };

  const handleColorTemp = (entity_id: string, mireds: number) => {
    setLights((p) => p.map((l) => l.entity_id === entity_id ? { ...l, color_temp: mireds } : l));
    debounced(`colortemp:${entity_id}`, () => setColorTemp(entity_id, mireds));
  };

  // ── Switch handlers ───────────────────────────────────────────────────────

  const handleToggleSwitch = async (entity_id: string) => {
    setSwitches((p) =>
      p.map((s) =>
        s.entity_id === entity_id ? { ...s, state: s.state === "on" ? "off" : "on" } : s
      )
    );
    await toggleSwitch(entity_id);
    setTimeout(refresh, 700);
  };

  const noEntities =
    settings.selected_lights.length === 0 &&
    settings.selected_sensors.length === 0 &&
    settings.selected_switches.length === 0;

  return (
    <>
      {/* Header */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={onOpenSettings}
            description={lastUpdated ? (refreshing ? "Updating..." : `Updated: ${lastUpdated}`) : undefined}
          >
            ⚙️ Settings
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* Lights */}
      {lights.length > 0 && (
        <PanelSection title="💡 Lights">
          {lights.map((light) => {
            const bPct = Math.round((light.brightness ?? 0) / 2.55);

            return (
              <div key={light.entity_id}>
                <PanelSectionRow>
                  <ToggleField
                    label={light.name}
                    checked={light.state === "on"}
                    onChange={() => handleToggleLight(light.entity_id)}
                  />
                </PanelSectionRow>

                {light.state === "on" && (
                  <>
                    {/* Brightness */}
                    {light.supports_brightness && (
                      <PanelSectionRow>
                        <SliderField
                          label={`☀️ Brightness: ${bPct}%`}
                          value={bPct}
                          min={1}
                          max={100}
                          step={1}
                          onChange={(v) => handleBrightness(light.entity_id, v)}
                        />
                      </PanelSectionRow>
                    )}

                    {/* Color temperature */}
                    {light.supports_color_temp && light.color_temp !== null && (
                      <PanelSectionRow>
                        <SliderField
                          label={`🌡️ Color Temp: ${light.color_temp ?? light.min_mireds} mireds`}
                          value={light.color_temp ?? light.min_mireds}
                          min={light.min_mireds}
                          max={light.max_mireds}
                          step={5}
                          onChange={(v) => handleColorTemp(light.entity_id, v)}
                        />
                      </PanelSectionRow>
                    )}


                  </>
                )}
              </div>
            );
          })}
        </PanelSection>
      )}

      {/* Switches */}
      {switches.length > 0 && (
        <PanelSection title="🔌 Switches">
          {switches.map((sw) => (
            <PanelSectionRow key={sw.entity_id}>
              <ToggleField
                label={sw.name}
                checked={sw.state === "on"}
                onChange={() => handleToggleSwitch(sw.entity_id)}
              />
            </PanelSectionRow>
          ))}
        </PanelSection>
      )}

      {/* Sensors */}
      {sensors.length > 0 && (
        <PanelSection title="🌡️ Sensors">
          {sensors.map((sensor) => (
            <PanelSectionRow key={sensor.entity_id}>
              <Field label={sensor.name} focusable={true}>
                <span style={{ color: "#4a9eff", fontWeight: "bold" }}>
                  {sensor.state}
                  {sensor.unit ? ` ${sensor.unit}` : ""}
                </span>
              </Field>
            </PanelSectionRow>
          ))}
        </PanelSection>
      )}

      {noEntities && (
        <PanelSection>
          <PanelSectionRow>
            <div style={{ color: "#aaa", fontSize: "12px", padding: "8px 0" }}>
              No devices selected. Open Settings to configure.
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
};
