#!/usr/bin/env bun

/**
 * superhuman-cli entry point
 *
 * CLI + MCP server to control Superhuman.app via Chrome DevTools Protocol (CDP)
 *
 * Usage:
 *   superhuman compose --to <email> --subject <subject> --body <body>
 *   superhuman draft --to <email> --subject <subject> --body <body>
 *   superhuman send --to <email> --subject <subject> --body <body>
 *   superhuman status
 *   superhuman --mcp        # Run as MCP server
 */

import { runMcpServer } from "./mcp/server";

const args = process.argv.slice(2);
const isMcpMode = args.includes("--mcp");

if (isMcpMode) {
  // MCP server mode: stdout/stderr must only carry JSON-RPC. Any console.log/error/warn
  // from our code or deps (e.g. token-api) would corrupt the stream and cause "cli json error"
  // in Claude Desktop. Suppress all console output for the lifetime of the process.
  const noop = () => {};
  console.log = console.error = console.warn = console.info = console.debug = noop;
  runMcpServer().catch(() => process.exit(1));
} else {
  // CLI mode - import and run the CLI
  import("./cli").then((cli) => {
    // cli.ts handles everything via its main() function
  });
}
