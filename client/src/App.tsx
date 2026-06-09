import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { get, type HomeView, type SettingsView } from "./api";
import { KeyScreen } from "./screens/KeyScreen";
import { IngestScreen } from "./screens/IngestScreen";
import { Home } from "./screens/Home";
import { SessionScreen } from "./screens/SessionScreen";
import { SettingsSheet } from "./screens/SettingsSheet";

type Screen = "loading" | "key" | "firstIngest" | "home" | "ingest" | "session";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [home, setHome] = useState<HomeView | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async (goHome = false) => {
    const s = await get<SettingsView>("/api/settings");
    setSettings(s);
    if (!s.hasKey) {
      setScreen("key");
      return;
    }
    const h = await get<HomeView>("/api/home");
    setHome(h);
    setScreen((cur) => {
      if (goHome || cur === "loading" || cur === "key" || cur === "firstIngest" || cur === "ingest") {
        return h.hasItems ? "home" : "firstIngest";
      }
      return cur;
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => setScreen("key"));
  }, [refresh]);

  return (
    <AnimatePresence mode="wait">
      {screen === "loading" && <div key="loading" className="min-h-screen" />}
      {screen === "key" && <KeyScreen key="key" onConnected={() => refresh(true)} />}
      {(screen === "firstIngest" || screen === "ingest") && (
        <IngestScreen
          key="ingest"
          firstRun={screen === "firstIngest"}
          onDone={() => refresh(true)}
          onCancel={screen === "ingest" ? () => setScreen("home") : undefined}
        />
      )}
      {screen === "home" && home && settings && (
        <div key="home">
          <Home
            home={home}
            demoMode={settings.demoMode}
            onStart={() => setScreen("session")}
            onAddMaterial={() => setScreen("ingest")}
            onOpenSettings={() => setShowSettings(true)}
          />
          {showSettings && (
            <SettingsSheet
              settings={settings}
              onClose={() => setShowSettings(false)}
              onChanged={() => refresh()}
            />
          )}
        </div>
      )}
      {screen === "session" && <SessionScreen key="session" onExit={() => refresh(true)} />}
    </AnimatePresence>
  );
}
