#!/usr/bin/env node
// The `artemis` command (see electron/core/cli.js).
require("../electron/core/cli").main(process.argv.slice(2)).catch((e) => { process.stderr.write((e && e.message ? e.message : String(e)) + "\n"); process.exit(1); });
