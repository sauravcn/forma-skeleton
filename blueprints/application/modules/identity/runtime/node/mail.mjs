import nodemailer from "nodemailer";
import { mailMessages, renderMail } from "./mail-messages.mjs";
export function smtpMail(env = process.env, { appName, messages } = {}) {
  const catalog = mailMessages(messages);
  renderMail(
    "verification",
    { appName, url: "https://validation.invalid" },
    catalog,
  );
  const names = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ];
  for (const name of names)
    if (
      typeof env[name] !== "string" ||
      !env[name].trim() ||
      /^(?:change[-_ ]?me|replace[-_ ]?me|your[-_]|example\.)/i.test(env[name])
    )
      throw new Error("Explicit non-placeholder SMTP configuration required");
  const port = Number(env.SMTP_PORT);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    env.SMTP_SECURE !== "true" ||
    /[\r\n]/.test(env.SMTP_FROM)
  )
    throw new Error(
      "SMTP requires explicit secure TLS transport and valid sender/port",
    );
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    logger: false,
    debug: false,
    connectionTimeout: 5000,
    socketTimeout: 10000,
  });
  return {
    sendMail: async ({ kind, to, url }) => {
      await transport.sendMail({
        from: env.SMTP_FROM,
        to,
        ...renderMail(kind, { appName, url }, catalog),
      });
    },
    onDeliveryFailure: async () => {
      process.stderr.write(
        "Mail request accepted; delivery requires operator attention.\n",
      );
    },
    close: () => transport.close(),
  };
}
