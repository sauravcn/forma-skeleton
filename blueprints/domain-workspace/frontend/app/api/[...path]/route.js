import config from "../../../src/foundation.config.js";
import { proxyApplication } from "@forma/standalone-identity/next";
export const dynamic = "force-dynamic";
const proxy = (request, context) => proxyApplication(request, context, config);
export const GET = proxy,
  POST = proxy,
  PATCH = proxy;
