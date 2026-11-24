#!/usr/bin/env node
// agentic-web-conformance — the bin.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// No build step: Node 22.18 and later run TypeScript directly by stripping the
// types, and nothing in this tool uses syntax that needs more than that. A
// publisher with Node installed can run it from a copy of this directory, or
// through `npx` once it is published, without installing anything.
//
// Everything is in `src/cli.ts` so that it can be tested. This file is the two
// lines that cannot be: reading the real argv and calling the real exit.

import { cliMain, realIo, reportCrash } from "./src/cli.ts";

cliMain(process.argv.slice(2), realIo).then(
  (code) => process.exit(code),
  (err: unknown) => process.exit(reportCrash(err, realIo)),
);
