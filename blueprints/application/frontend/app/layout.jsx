import config from "../src/config.js";
import { themeStyle } from "../src/theme.js";
import { translate } from "../src/i18n.js";
import "../src/styles.css";
export const metadata = {
  title: config.name,
  description: translate("app.description"),
};
export default function RootLayout({ children }) {
  if (
    config.auth.mode !== "none" ||
    config.auth.twoFactor ||
    config.auth.providers.length
  )
    throw new Error(
      "Authentication is not implemented by this development starter",
    );
  return (
    <html lang={config.locale} dir="ltr">
      <body data-theme={config.theme.preset} style={themeStyle(config.theme)}>
        {children}
      </body>
    </html>
  );
}
