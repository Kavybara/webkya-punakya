import pino from "pino";
import { redactLogValue, registerLogSecrets } from "../../../packages/shared/observability.mjs";

export function createLogger(config) {
  registerLogSecrets(config);
  return pino({ level: config.logLevel || "info", formatters: { log: redactLogValue }, serializers: { err: redactLogValue }, hooks: {
    logMethod(args, method) { method.apply(this, args.map((arg) => redactLogValue(arg))); },
  } });
}
