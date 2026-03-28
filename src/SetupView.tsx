import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FC, useState, useEffect, useRef } from "react";
import { FaHome, FaWifi, FaMobileAlt, FaCheckCircle } from "react-icons/fa";
import { getWebInfo, WebInfo } from "./api";

interface Props {
  onDone: () => void;
  onSkip: () => void;
}

export const SetupView: FC<Props> = ({ onDone, onSkip }) => {
  const [webInfo, setWebInfo] = useState<WebInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const baseVersionRef = useRef<number>(-1);  // фиксируем версию при старте, не меняем
  const doneCalledRef = useRef(false);

  useEffect(() => {
    let active = true;

    // Первый запрос — фиксируем baseline версию
    getWebInfo().then((info) => {
      if (!active) return;
      setWebInfo(info);
      baseVersionRef.current = info.config_version;
    });

    // Единый интервал — обновляем UI и детектим сохранение
    const t = setInterval(async () => {
      if (!active || doneCalledRef.current) return;
      try {
        const info = await getWebInfo();
        if (!active || doneCalledRef.current) return;
        setWebInfo(info);

        // Версия выросла → сохранили через браузер
        if (baseVersionRef.current >= 0 && info.config_version > baseVersionRef.current) {
          doneCalledRef.current = true;
          setSaved(true);
          clearInterval(t);
          // Вызываем onDone без active-проверки — дадим экрану показаться
          setTimeout(onDone, 1500);
        }
      } catch { /* ignore */ }
    }, 2000);

    return () => {
      active = false;
      clearInterval(t);
    };
  }, [onDone]);

  if (saved) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <FaCheckCircle style={{ fontSize: "40px", color: "#6fcf6f", marginBottom: "12px" }} />
            <div style={{ color: "#6fcf6f", fontSize: "16px", fontWeight: "bold" }}>
              Connected!
            </div>
            <div style={{ color: "#aaa", fontSize: "12px", marginTop: "6px" }}>
              Loading your devices...
            </div>
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <div style={{ textAlign: "center", paddingBottom: "4px" }}>
            <FaHome style={{ fontSize: "32px", color: "#4a9eff", marginBottom: "8px" }} />
            <div style={{ fontSize: "16px", fontWeight: "bold", color: "#eee" }}>
              Welcome to HA Deck
            </div>
            <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
              Connect your Steam Deck to Home Assistant
            </div>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="📋 Setup — 3 steps">
        <PanelSectionRow>
          <div style={{
            background: "#1a2744", borderRadius: "8px", padding: "10px 12px",
            borderLeft: "3px solid #4a9eff",
          }}>
            <div style={{ color: "#4a9eff", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>
              Step 1 — Same Wi-Fi
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FaWifi style={{ color: "#aaa", flexShrink: 0 }} />
              <span style={{ color: "#ccc", fontSize: "12px" }}>
                Make sure your phone or PC is on the same Wi-Fi as the Deck
              </span>
            </div>
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <div style={{
            background: "#1a2744", borderRadius: "8px", padding: "10px 12px",
            borderLeft: "3px solid #4a9eff",
          }}>
            <div style={{ color: "#4a9eff", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>
              Step 2 — Open this URL in browser
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FaMobileAlt style={{ color: "#aaa", flexShrink: 0 }} />
              <span style={{
                color: "#fff", fontSize: "14px", fontWeight: "bold",
                background: "#0f3460", padding: "4px 8px", borderRadius: "6px",
                wordBreak: "break-all",
              }}>
                {webInfo?.url ?? "Loading..."}
              </span>
            </div>
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <div style={{
            background: "#1a2744", borderRadius: "8px", padding: "10px 12px",
            borderLeft: "3px solid #4a9eff",
          }}>
            <div style={{ color: "#4a9eff", fontSize: "12px", fontWeight: "bold", marginBottom: "4px" }}>
              Step 3 — Enter credentials & Save
            </div>
            <div style={{ color: "#ccc", fontSize: "12px" }}>
              Fill in your HA URL and long-lived access token, click Save.
              This screen updates automatically.
            </div>
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <div style={{ textAlign: "center", color: "#555", fontSize: "11px", padding: "4px 0" }}>
            ⏳ Waiting for you to save in the browser...
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onSkip}>
            Skip setup →
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};
