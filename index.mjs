#!/usr/bin/env node

/**
 * openclaw-pair — Pair your iPhone with OpenClaw in one scan.
 *
 * Usage:
 *   npx openclaw-pair          # or after global install: openclaw-pair
 *   openclaw-pair --relay      # force relay mode (coming soon)
 *   openclaw-pair --help
 */

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import { networkInterfaces } from "os";

// ─── Helpers ────────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function die(msg) {
  console.error(`\n${RED}✘ ${msg}${RESET}\n`);
  process.exit(1);
}

function info(msg) {
  console.log(`${CYAN}${msg}${RESET}`);
}

function success(msg) {
  console.log(`${GREEN}${BOLD}${msg}${RESET}`);
}

function dim(msg) {
  console.log(`${DIM}${msg}${RESET}`);
}

// ─── Step 1: Find OpenClaw config ───────────────────────────────────────────

function findConfig() {
  // Check for --profile flag or OPENCLAW_STATE_DIR
  const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw");
  const configPath = process.env.OPENCLAW_CONFIG_PATH || join(stateDir, "openclaw.json");

  if (!existsSync(configPath)) {
    die(
      `OpenClaw config not found at ${configPath}\n\n` +
      `  Make sure OpenClaw is installed and configured.\n` +
      `  Run: ${BOLD}npm i -g openclaw${RESET}${RED} and then: ${BOLD}openclaw configure${RESET}`
    );
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (e) {
    die(`Failed to read config at ${configPath}: ${e.message}`);
  }
}

// ─── Step 2: Get gateway token ──────────────────────────────────────────────

function getToken(config) {
  const token = config?.gateway?.auth?.token;
  if (!token) {
    die(
      `No gateway token found in config.\n\n` +
      `  Run: ${BOLD}openclaw configure${RESET} to set up your gateway.`
    );
  }
  return token;
}

// ─── Step 3: Check if gateway is running ────────────────────────────────────

function checkGateway(port) {
  // Try multiple detection methods — lsof may fail without elevated perms
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: "pipe" });
    return true;
  } catch {}
  // Fallback: try to hit the gateway HTTP endpoint
  try {
    execSync(`curl -sf -o /dev/null --max-time 2 http://127.0.0.1:${port}/`, { stdio: "pipe" });
    return true;
  } catch {}
  return false;
}

// ─── Step 4: Detect best connection method ──────────────────────────────────

function getTailscaleHostname() {
  try {
    const result = execSync("tailscale status --json", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const status = JSON.parse(result.toString());
    const dnsName = status?.Self?.DNSName || "";
    return dnsName.replace(/\.$/, ""); // strip trailing dot
  } catch {
    return null;
  }
}

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

// ─── Step 5: Generate QR ────────────────────────────────────────────────────

async function generateQR(url) {
  const require = createRequire(import.meta.url);
  const qrcode = require("qrcode-terminal");

  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (code) => {
      resolve(code);
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
${BOLD}openclaw-pair${RESET} — Pair your iPhone with OpenClaw

${BOLD}Usage:${RESET}
  openclaw-pair              Generate a QR code to scan with the iOS app

${BOLD}What it does:${RESET}
  1. Reads your OpenClaw config
  2. Detects Tailscale (preferred) or falls back to local network
  3. Shows a QR code — scan it with the OpenClaw iOS app
  4. You're connected!

${BOLD}Requirements:${RESET}
  • OpenClaw installed and gateway running (openclaw gateway start)
  • For anywhere-access: Tailscale on both devices (tailscale.com)
  • For local-only: Mac and iPhone on same WiFi network
`);
    process.exit(0);
  }

  console.log(`\n${BOLD}📱 OpenClaw Pairing${RESET}\n`);

  // Step 1: Read config
  const config = findConfig();
  const token = getToken(config);
  const port = config?.gateway?.port || 18789;

  // Step 2: Check gateway
  dim("  Checking gateway...");
  if (!checkGateway(port)) {
    die(
      `Gateway is not running on port ${port}.\n\n` +
      `  Start it with: ${BOLD}openclaw gateway start${RESET}\n` +
      `  Then run this command again.`
    );
  }
  info("  ✓ Gateway is running");

  // Step 3: Detect connection method
  dim("  Detecting connection method...");

  const tailscaleHost = getTailscaleHostname();
  const localIP = getLocalIP();

  let host, connectionType, pairingPort;

  if (tailscaleHost) {
    host = tailscaleHost;
    // Check if Tailscale Serve is proxying on 443, otherwise use gateway port directly
    let serveOn443 = false;
    try {
      const serveResult = execSync("tailscale serve status", { stdio: ["pipe", "pipe", "pipe"], timeout: 3000 });
      const serveOutput = serveResult.toString();
      const portPattern = new RegExp(`\\b${port}\\b`);
      // Tailscale Serve on 443 shows as "https://hostname" (no :443) or ":443"
      const servesHTTPS = serveOutput.includes("https://") || serveOutput.includes(":443");
      if (servesHTTPS && portPattern.test(serveOutput)) serveOn443 = true;
    } catch {}
    if (serveOn443) {
      pairingPort = 443;
      connectionType = "tailscale";
      info(`  ✓ Tailscale detected: ${host} (via Tailscale Serve)`);
    } else {
      // No Tailscale Serve — need to set it up so the gateway is reachable
      console.log(`\n${YELLOW}  ⚠ Tailscale is running but Tailscale Serve is not set up.${RESET}`);
      console.log(`${YELLOW}    Your gateway isn't reachable from your phone yet.${RESET}\n`);
      console.log(`  Run this once to expose it:\n`);
      console.log(`    ${BOLD}tailscale serve --bg ${port}${RESET}\n`);
      console.log(`  Then run ${BOLD}openclaw-pair${RESET} again.\n`);
      process.exit(1);
    }
  } else if (localIP) {
    host = localIP;
    pairingPort = port;
    connectionType = "local";
    info(`  ✓ Local network: ${host}:${pairingPort}`);
    console.log(`${YELLOW}    ⚠ Make sure your iPhone is on the same WiFi network${RESET}`);
  } else {
    die(
      `Could not detect a way to reach this Mac.\n\n` +
      `  Option 1: Install Tailscale (${BOLD}https://tailscale.com${RESET}${RED}) on both devices\n` +
      `  Option 2: Make sure this Mac is connected to WiFi`
    );
  }

  // Step 4: Build pairing URL
  const params = new URLSearchParams({
    host,
    port: String(pairingPort),
    token,
    mode: connectionType,
  });
  const pairingURL = `openclaw://connect?${params.toString()}`;

  // Step 5: Show QR code
  console.log("");
  const qr = await generateQR(pairingURL);
  console.log(qr);

  // Step 6: Instructions
  console.log(`${BOLD}  Next steps:${RESET}`);
  console.log(`  1. Open the ${BOLD}OpenClaw${RESET} app on your iPhone`);
  console.log(`  2. Scan this QR code`);
  console.log(`  3. That's it!\n`);

  if (connectionType === "local") {
    dim("  ───────────────────────────────────────────");
    dim("  💡 For access outside your home network,");
    dim("     install Tailscale on both devices.");
    dim("     https://tailscale.com");
    dim("  ───────────────────────────────────────────\n");
  }
}

main().catch((e) => die(e.message));
