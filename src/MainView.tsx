import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  SliderField,
  DropdownItem,
  Field,
} from "@decky/ui";
import { FC, useState, useEffect, useCallback, useRef } from "react";
import {
  HASettings,
  LightState,
  SwitchState,
  SensorState,
  ClimateState,
  FanState,
  getLightStates,
  getSensorStates,
  getSwitchStates,
  getClimateStates,
  getFanStates,
  toggleLight,
  toggleSwitch,
  setBrightness,
  setColorTemp,
  setClimateTemperature,
  setClimateHvacMode,
  toggleFan,
  setFanPercentage,
  setFanPresetMode,
} from "./api";


interface Props {
  settings: HASettings;
  onOpenSettings: () => void;
}

export const MainView: FC<Props> = ({ settings, onOpenSettings }) => {
  const [lights, setLights] = useState<LightState[]>([]);
  const [switches, setSwitches] = useState<SwitchState[]>([]);
  const [sensors, setSensors] = useState<SensorState[]>([]);
  const [climates, setClimates] = useState<ClimateState[]>([]);
  const [fans, setFans] = useState<FanState[]>([]);
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
      const selClimates = settings.selected_climates ?? [];
      const selFans = settings.selected_fans ?? [];
      const [ls, ss, sw, cl, fn] = await Promise.all([
        settings.selected_lights.length > 0
          ? getLightStates(settings.selected_lights)
          : Promise.resolve([]),
        settings.selected_sensors.length > 0
          ? getSensorStates(settings.selected_sensors)
          : Promise.resolve([]),
        settings.selected_switches.length > 0
          ? getSwitchStates(settings.selected_switches)
          : Promise.resolve([]),
        selClimates.length > 0
          ? getClimateStates(selClimates)
          : Promise.resolve([]),
        selFans.length > 0
          ? getFanStates(selFans)
          : Promise.resolve([]),
      ]);
      setLights(ls);
      setSensors(ss);
      setSwitches(sw);
      setClimates(cl);
      setFans(fn);
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

  // ── Climate handlers ──────────────────────────────────────────────────────

  const handleClimateTemp = (entity_id: string, temperature: number) => {
    setClimates((p) => p.map((c) => c.entity_id === entity_id ? { ...c, target_temperature: temperature } : c));
    debounced(`climatetemp:${entity_id}`, () => setClimateTemperature(entity_id, temperature));
  };

  const handleClimateMode = async (entity_id: string, hvac_mode: string) => {
    setClimates((p) => p.map((c) => c.entity_id === entity_id ? { ...c, hvac_mode } : c));
    await setClimateHvacMode(entity_id, hvac_mode);
    setTimeout(refresh, 700);
  };

  // ── Fan handlers ──────────────────────────────────────────────────────────

  const handleToggleFan = async (entity_id: string) => {
    setFans((p) =>
      p.map((f) =>
        f.entity_id === entity_id ? { ...f, state: f.state === "on" ? "off" : "on" } : f
      )
    );
    await toggleFan(entity_id);
    setTimeout(refresh, 700);
  };

  const handleFanPercentage = (entity_id: string, pct: number) => {
    setFans((p) => p.map((f) => f.entity_id === entity_id ? { ...f, percentage: pct } : f));
    debounced(`fanpct:${entity_id}`, () => setFanPercentage(entity_id, pct));
  };

  const handleFanPreset = async (entity_id: string, preset_mode: string) => {
    setFans((p) => p.map((f) => f.entity_id === entity_id ? { ...f, preset_mode } : f));
    await setFanPresetMode(entity_id, preset_mode);
    setTimeout(refresh, 700);
  };

  const noEntities =
    settings.selected_lights.length === 0 &&
    settings.selected_sensors.length === 0 &&
    settings.selected_switches.length === 0 &&
    (settings.selected_climates ?? []).length === 0 &&
    (settings.selected_fans ?? []).length === 0;

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

      {/* Climate */}
      {climates.length > 0 && (
        <PanelSection title="🌡️ Climate">
          {climates.map((cl) => {
            const target = cl.target_temperature ?? cl.min_temp;
            const isOff = cl.hvac_mode === "off" || cl.hvac_mode === "unavailable";
            const modeOptions = cl.hvac_modes.map((m) => ({ data: m, label: m }));
            return (
              <div key={cl.entity_id}>
                <PanelSectionRow>
                  <Field label={cl.name} focusable={true}>
                    <span style={{ color: "#4a9eff", fontWeight: "bold" }}>
                      {cl.current_temperature !== null
                        ? `${cl.current_temperature}${cl.unit}`
                        : cl.hvac_mode}
                      {cl.hvac_action ? ` · ${cl.hvac_action}` : ""}
                    </span>
                  </Field>
                </PanelSectionRow>

                {modeOptions.length > 0 && (
                  <PanelSectionRow>
                    <DropdownItem
                      label="Mode"
                      rgOptions={modeOptions}
                      selectedOption={cl.hvac_mode}
                      onChange={(opt) => handleClimateMode(cl.entity_id, opt.data as string)}
                    />
                  </PanelSectionRow>
                )}

                {!isOff && cl.target_temperature !== null && (
                  <PanelSectionRow>
                    <SliderField
                      label={`🎯 Target: ${target}${cl.unit}`}
                      value={target}
                      min={cl.min_temp}
                      max={cl.max_temp}
                      step={cl.target_temp_step || 0.5}
                      onChange={(v) => handleClimateTemp(cl.entity_id, v)}
                    />
                  </PanelSectionRow>
                )}
              </div>
            );
          })}
        </PanelSection>
      )}

      {/* Fans */}
      {fans.length > 0 && (
        <PanelSection title="💨 Fans">
          {fans.map((fn) => {
            const pct = fn.percentage ?? 0;
            const presetOptions = fn.preset_modes.map((m) => ({ data: m, label: m }));
            return (
              <div key={fn.entity_id}>
                <PanelSectionRow>
                  <ToggleField
                    label={fn.name}
                    checked={fn.state === "on"}
                    onChange={() => handleToggleFan(fn.entity_id)}
                  />
                </PanelSectionRow>

                {fn.state === "on" && fn.supports_speed && (
                  <PanelSectionRow>
                    <SliderField
                      label={`💨 Speed: ${pct}%`}
                      value={pct}
                      min={0}
                      max={100}
                      step={fn.percentage_step || 1}
                      onChange={(v) => handleFanPercentage(fn.entity_id, v)}
                    />
                  </PanelSectionRow>
                )}

                {fn.state === "on" && fn.supports_preset && presetOptions.length > 0 && (
                  <PanelSectionRow>
                    <DropdownItem
                      label="Preset"
                      rgOptions={presetOptions}
                      selectedOption={fn.preset_mode ?? ""}
                      onChange={(opt) => handleFanPreset(fn.entity_id, opt.data as string)}
                    />
                  </PanelSectionRow>
                )}
              </div>
            );
          })}
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
