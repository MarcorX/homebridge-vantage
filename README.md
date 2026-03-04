# homebridge-vantage-infusion-controller

A [Homebridge](https://homebridge.io) plugin for [Vantage Controls InFusion](https://www.vantagecontrols.com/) systems.

Connects directly to the InFusion controller over TCP and exposes **all** your Vantage devices to Apple HomeKit — lights, dimmers, fans (with speed control), switches, outlets, and full thermostats with heat/cool/auto modes and setpoints. No device limit.

> **Forked from** [richardpack/homebridge-vantage](https://github.com/richardpack/homebridge-vantage), which forked from [thebeastxdxd/homebridge-vantage](https://github.com/thebeastxdxd/homebridge-vantage).
>
> **Key improvements in this fork:**
> - No device limit — register unlimited accessories from a single bridge
> - All device types work: dimmers, relays, fans (with rotation speed), switches, outlets, thermostats
> - Full thermostat: heat/cool/auto/off modes, separate heat & cool setpoints, current HVAC state
> - Auto-reconnect with exponential backoff when the controller connection drops
> - Async command queue — no more blocking synchronous sleep
> - Zero native dependencies (pure JavaScript)

---

## Requirements

- Vantage InFusion controller, firmware 3.2+ (TCP ports 2001/3001, no encryption or password)
- Homebridge ≥ 1.0.0
- Node.js ≥ 12

---

## Installation

```bash
npm install -g homebridge-vantage-infusion-controller
```

Or install through the Homebridge UI (search **Vantage InFusion Controller**).

---

## Configuration

Minimum config:

```json
{
  "platforms": [
    {
      "platform": "VantageInfusion",
      "name": "VantageInfusion",
      "ipaddress": "192.168.x.x"
    }
  ]
}
```

### All options

| Option | Type | Default | Description |
|---|---|---|---|
| `ipaddress` | string | **required** | IP address of the InFusion controller |
| `whitelist` | string[] | `[]` | If non-empty, only VIDs in this list are registered. Leave empty to include everything. |
| `vidMapping` | object | `{}` | Per-VID overrides for type and/or display name (see below) |
| `fahrenheit` | boolean | `true` | Whether the controller reports temperatures in °F. Set to `false` for °C. |
| `commandIntervalMs` | number | `50` | Milliseconds between commands sent to the controller |
| `forceRefresh` | boolean | `false` | Delete the cached config and re-download from controller on next startup |

### vidMapping

Override the auto-detected type or display name for any VID:

```json
"vidMapping": {
  "217":  { "Type": "fan" },
  "219":  { "Type": "fan" },
  "500":  { "Type": "switch", "Name": "Garden Lights" },
  "1318": { "Type": "fan" }
}
```

Valid `Type` values: `"dimmer"` · `"relay"` · `"switch"` · `"outlet"` · `"fan"` · `"motor"` · `"rgb"`

---

## Device type auto-detection

| Condition | HomeKit accessory |
|---|---|
| HVAC object | Full Thermostat (heat/cool/auto/off + setpoints) |
| Load — dimmable (default) | Dimmable Lightbulb |
| Load — Relay type | On/Off Lightbulb |
| Load — Motor type | Switch |
| Load — name contains "fan" (not "light") | Fan with rotation speed |
| vidMapping Type override | As specified |

Motors (blinds/shades wired as Motor loads) appear as Switches. If your blinds are configured as a dedicated Blind object type in Vantage, open an issue — this can be added.

---

## Migrating from two bridges

If you were running two HOOBS/Homebridge bridges to work around the old 149-device limit, you can now consolidate to one:

1. Merge the `whitelist` arrays from both configs — or remove `whitelist` entirely to expose all devices
2. Merge the `vidMapping` objects from both configs
3. Remove the second bridge

**Example — merged config from two previous bridges:**

```json
{
  "platform": "VantageInfusion",
  "name": "VantageInfusion",
  "ipaddress": "192.168.2.10",
  "vidMapping": {
    "217":  { "Type": "fan" },
    "219":  { "Type": "fan" },
    "1318": { "Type": "fan" },
    "1336": { "Type": "fan" },
    "1337": { "Type": "fan" },
    "1338": { "Type": "fan" },
    "1345": { "Type": "fan" },
    "1346": { "Type": "fan" }
  }
}
```

No `whitelist` needed — all devices are discovered automatically.

---

## Troubleshooting

**Devices not appearing**
- Verify the controller IP and that ports 2001/3001 are reachable
- Enable Homebridge debug logging to see per-device discovery messages
- Try `"forceRefresh": true` once to clear the cached device config

**Wrong accessory type**
- Add a `vidMapping` entry for that VID with the correct `Type`

**Thermostat temperature is off**
- Set `"fahrenheit": false` if your controller reports in Celsius

**Controller seems slow or drops commands**
- Increase `commandIntervalMs` to `100` or `200`

---

## Building from source

```bash
git clone https://github.com/Marcoarz/homebridge-vantage.git
cd homebridge-vantage
npm install
npm run build   # compiles src/ → dist/
```

---

## Connecting to the InFusion controller manually

For debugging or extending the plugin, you can connect directly via telnet:

```bash
telnet <controller-ip> 3001
```

Type `help` for available commands. Useful resources:
- [Vantage protocol forum thread](https://forum.roomieremote.com/t/vantage-controls-infusion-lighting-system/1097/3)

---

## License

MIT — see original plugin by [nfarina](https://github.com/nfarina) and subsequent forks.
