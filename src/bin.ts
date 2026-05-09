#!/usr/bin/env node
import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error("FATAL", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(2);
  },
);
