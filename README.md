# openclaw-pair

Pair your iPhone with [OpenClaw](https://github.com/openclaw/openclaw) in one scan.

## Install

```bash
npm i -g openclaw-pair
```

## Use

```bash
openclaw-pair
```

That's it. A QR code appears. Scan it with the OpenClaw iOS app. You're connected.

## What it does

1. Reads your OpenClaw gateway config
2. Checks that your gateway is running
3. Auto-detects [Tailscale](https://tailscale.com) (for anywhere-access) or falls back to local network
4. Generates a QR code your phone can scan

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) installed with gateway running
- The OpenClaw iOS app (TestFlight)
- **For anywhere-access:** Tailscale on both your Mac and iPhone
- **For local-only:** Mac and iPhone on the same WiFi

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Config not found" | Install OpenClaw: `npm i -g openclaw` then `openclaw configure` |
| "Gateway is not running" | Run `openclaw gateway start` |
| "Could not detect a way to reach this Mac" | Connect to WiFi, or install [Tailscale](https://tailscale.com) |
| QR code won't scan | Use the backup code shown below the QR |

## License

MIT
