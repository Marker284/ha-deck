import { definePlugin, staticClasses } from "@decky/ui";
import { FC, useState, useEffect } from "react";
import { FaHome } from "react-icons/fa";
import { HASettings, getSettings } from "./api";
import { MainView } from "./MainView";
import { SettingsView } from "./SettingsView";
import { SetupView } from "./SetupView";

const Content: FC = () => {
  const [view, setView] = useState<"loading" | "setup" | "main" | "settings">("loading");
  const [settings, setSettings] = useState<HASettings | null>(null);

  const loadSettings = async () => {
    try {
      const s = await getSettings();
      setSettings(s);
      if (!s.ha_url || !s.ha_token) {
        setView("setup");    // первый запуск → онбординг
      } else {
        setView("main");
      }
    } catch {
      setView("setup");
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  if (view === "loading") {
    return (
      <div style={{ padding: "16px", color: "#888", fontSize: "13px" }}>
        Loading HA Deck...
      </div>
    );
  }

  if (view === "setup") {
    return (
      <SetupView onDone={() => loadSettings()} />
    );
  }

  if (view === "settings") {
    return (
      <SettingsView
        settings={settings}
        onBack={async () => {
          await loadSettings();
        }}
      />
    );
  }

  return (
    <MainView
      settings={settings!}
      onOpenSettings={() => setView("settings")}
    />
  );
};

export default definePlugin(() => ({
  name: "HA Deck",
  titleView: <div className={staticClasses.Title}>HA Deck</div>,
  content: <Content />,
  icon: <FaHome />,
  onDismount() {},
}));
