"use client";
import { useState } from "react";
import { Layers } from "lucide-react";
import { useI18n } from "@forma/localization";
import {
  AppNavigation,
  FoundationSessionControls,
} from "@forma/app-foundation";
import config from "./foundation.config.js";
export default function App() {
  const i = useI18n(),
    [active, setActive] = useState(config.navigation[0].id);
  return (
    <div className="domain-workspace">
      <header>
        <h1>{i.t(config.brandLabelKey)}</h1>
        <FoundationSessionControls />
      </header>
      <AppNavigation
        config={config}
        region="top"
        defaultRegion={null}
        icons={{ layers: Layers }}
        active={active}
        onSelect={setActive}
      />
      <div className="workspace-grid">
        <AppNavigation
          config={config}
          region="sidebar"
          defaultRegion={null}
          icons={{ layers: Layers }}
          active={active}
          onSelect={setActive}
        />
        <main id="workspace-main" tabIndex={-1}>
          <h2>
            {i.t(config.navigation.find((item) => item.id === active).labelKey)}
          </h2>
          <p role="status">{i.t(config.id + ".scaffold.pending")}</p>
        </main>
      </div>
    </div>
  );
}
