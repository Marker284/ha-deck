import { call } from "@decky/api";

export interface HASettings {
  ha_url: string;
  ha_token: string;
  selected_lights: string[];
  selected_sensors: string[];
  selected_switches: string[];
}

export interface LightState {
  entity_id: string;
  name: string;
  state: string;
  brightness: number | null;
  supports_brightness: boolean;
  color_temp: number | null;
  min_mireds: number;
  max_mireds: number;
  hs_color: [number, number] | null;
  rgb_color: [number, number, number] | null;
  supports_color_temp: boolean;
  supports_color: boolean;
}

export interface SwitchState {
  entity_id: string;
  name: string;
  state: string;
}

export interface SensorState {
  entity_id: string;
  name: string;
  state: string;
  unit: string;
}

export interface EntityInfo {
  entity_id: string;
  name: string;
  state: string;
  unit?: string;
}

export interface ConnectionResult {
  success: boolean;
  message: string;
}

export interface WebInfo {
  url: string;
  config_version: number;
  running: boolean;
}

// Settings
export const getSettings = (): Promise<HASettings> =>
  call<[], HASettings>("get_settings");

export const saveCredentials = (ha_url: string, ha_token: string): Promise<boolean> =>
  call<[string, string], boolean>("save_credentials", ha_url, ha_token);

export const saveSelectedEntities = (
  lights: string[],
  sensors: string[],
  switches: string[]
): Promise<boolean> =>
  call<[string[], string[], string[]], boolean>("save_selected_entities", lights, sensors, switches);

export const testConnection = (): Promise<ConnectionResult> =>
  call<[], ConnectionResult>("test_connection");

// Web config
export const getWebInfo = (): Promise<WebInfo> =>
  call<[], WebInfo>("get_web_info");

export const getConfigVersion = (): Promise<number> =>
  call<[], number>("get_config_version");

export const isWebServerRunning = (): Promise<boolean> =>
  call<[], boolean>("is_web_server_running");

export const startWebServerRpc = (): Promise<WebInfo> =>
  call<[], WebInfo>("start_web_server_rpc");

export const stopWebServerRpc = (): Promise<boolean> =>
  call<[], boolean>("stop_web_server_rpc");

export const resetSettings = (): Promise<boolean> =>
  call<[], boolean>("reset_settings");

// Discovery
export const getAllLights = (): Promise<EntityInfo[]> =>
  call<[], EntityInfo[]>("get_all_lights");

export const getAllSensors = (): Promise<EntityInfo[]> =>
  call<[], EntityInfo[]>("get_all_sensors");

export const getAllSwitches = (): Promise<EntityInfo[]> =>
  call<[], EntityInfo[]>("get_all_switches");

// Live state
export const getLightStates = (entity_ids: string[]): Promise<LightState[]> =>
  call<[string[]], LightState[]>("get_light_states", entity_ids);

export const getSensorStates = (entity_ids: string[]): Promise<SensorState[]> =>
  call<[string[]], SensorState[]>("get_sensor_states", entity_ids);

export const getSwitchStates = (entity_ids: string[]): Promise<SwitchState[]> =>
  call<[string[]], SwitchState[]>("get_switch_states", entity_ids);

// Light control
export const toggleLight = (entity_id: string): Promise<boolean> =>
  call<[string], boolean>("toggle_light", entity_id);

export const setBrightness = (entity_id: string, brightness: number): Promise<boolean> =>
  call<[string, number], boolean>("set_brightness", entity_id, brightness);

export const setColorTemp = (entity_id: string, color_temp: number): Promise<boolean> =>
  call<[string, number], boolean>("set_color_temp", entity_id, color_temp);

// Switch control
export const toggleSwitch = (entity_id: string): Promise<boolean> =>
  call<[string], boolean>("toggle_switch", entity_id);
