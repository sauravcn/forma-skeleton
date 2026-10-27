import config from "../src/config.js";
import { assertProfile } from "../src/identity-server.mjs";
import { IdentityProvider } from "../src/identity-client.jsx";
import { themeStyle } from "../src/theme.js";
import { translate } from "../src/i18n.js";
import "../src/styles.css";
export const metadata = {
  title: config.name,
  description: translate("app.description"),
};
export default function RootLayout({ children }) {
  assertProfile(config);
  return (
    <html lang={config.locale} dir="ltr">
      <body data-theme={config.theme.preset} style={themeStyle(config.theme)}>
        <IdentityProvider>{children}</IdentityProvider>
      </body>
    </html>
  );
}
