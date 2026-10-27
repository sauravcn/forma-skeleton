import config, { appTheme } from "../src/foundation.config.js";
import { AppFoundationProvider } from "@forma/app-foundation";
import "@forma/app-foundation/styles.css";
import "@forma/ui/styles.css";
import "../src/style.css";
export const metadata = { title: config.name };
export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppFoundationProvider config={config} theme={appTheme}>
          {children}
        </AppFoundationProvider>
      </body>
    </html>
  );
}
