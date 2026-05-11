#!/usr/bin/env node
import { startServer } from "./server.js";

startServer().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(2);
});
