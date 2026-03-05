import {
  AccessoryPlugin,
  API,
  HAP,
  Logging,
  PlatformConfig,
  StaticPlatformPlugin,
} from "homebridge";
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  isArray: (name) => name === 'Object',
});

import { VantageLight, isVantageLoadObject } from "./vantage-light-accessory";
import { VantageBlind } from "./vantage-blind-accessory";
import { VantageDimmer } from "./vantage-dimmer-accessory";
import { VantageFan } from "./vantage-fan-accessory";
import { VantageSwitch } from "./vantage-switch-accessory";
import { VantageOutlet } from "./vantage-outlet-accessory";
import { VantageThermostat } from "./vantage-thermostat-accessory";
import {
  VantageInfusionController,
  EndDownloadConfigurationEvent,
  LoadStatusChangeEvent,
  ThermostatIndoorTemperatureChangeEvent,
  ThermostatOutdoorTemperatureChangeEvent,
} from "./vantage-infusion-controller";

const PLUGIN_NAME  = "homebridge-vantage-infusion-controller";
const PLATFORM_NAME = "VantageInfusion";

let hap: HAP;

export = (api: API) => {
  hap = api.hap;
  api.registerPlatform(PLATFORM_NAME, VantageStaticPlatform);
};

/**
 * VID mapping entry — lets you override the name or force a specific accessory type
 * for any Vantage device that can't be reliably auto-detected.
 *
 * Example:
 *   "vidMapping": {
 *     "217": { "Type": "fan" },
 *     "500": { "Type": "switch", "Name": "Garden Lights" }
 *   }
 *
 * Valid Type values: "dimmer" | "relay" | "switch" | "outlet" | "fan" | "motor" | "rgb"
 */
interface VidMappingEntry {
  Name?: string;
  Type?: string;
}

class VantageStaticPlatform implements StaticPlatformPlugin {

  private readonly log: Logging;
  private readonly vantageController: VantageInfusionController;

  private readonly vidMapping: Record<string, VidMappingEntry>;
  private readonly whitelist: string[];
  private readonly fahrenheit: boolean;
  private readonly blindTravelTime: number;

  private readonly accessoriesDict: Record<string, AccessoryPlugin> = {};
  private readonly interfaceSupportRequests: Array<Promise<void>> = [];
  private accessoriesCallback: (found: AccessoryPlugin[]) => void = () => { };

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.vidMapping      = config.vidMapping      ?? {};
    this.whitelist       = config.whitelist       ?? [];
    this.fahrenheit      = config.fahrenheit      ?? true;
    this.blindTravelTime = config.blindTravelTime ?? 25;

    // Support legacy controllerSendInterval (µs) and new commandIntervalMs (ms)
    const intervalMs: number = config.commandIntervalMs
      ?? (config.controllerSendInterval != null
        ? Math.round(config.controllerSendInterval / 1000)
        : 50);

    this.vantageController = new VantageInfusionController(
      this.log,
      config.ipaddress,
      intervalMs,
      config.forceRefresh ?? false
    );

    this.vantageController.on(EndDownloadConfigurationEvent, this.onEndDownloadConfiguration.bind(this));
    this.vantageController.on(LoadStatusChangeEvent, this.onLoadStatusChange.bind(this));
    this.vantageController.on(ThermostatIndoorTemperatureChangeEvent, this.onThermostatTemperature.bind(this));
    this.vantageController.on(ThermostatOutdoorTemperatureChangeEvent, this.onThermostatTemperature.bind(this));

    this.vantageController.serverConfigurationDownload();
    this.log.info("Vantage InFusion platform initialised — waiting for configuration download.");
  }

  // ─── Accessory registration (called by Homebridge) ──────────────────────────

  accessories(callback: (found: AccessoryPlugin[]) => void): void {
    this.accessoriesCallback = callback;
  }

  // ─── Event handlers ──────────────────────────────────────────────────────────

  private onLoadStatusChange(vid: string, value: number): void {
    const accessory = this.accessoriesDict[vid];
    if (accessory && isVantageLoadObject(accessory)) {
      accessory.loadStatusChange(value);
    }
  }

  private onThermostatTemperature(vid: string, _value: number): void {
    // Temperature updates are handled inside VantageThermostat via its own event subscriptions.
    // This handler exists only to satisfy the original event listener registrations; the
    // thermostat accessory subscribes directly to the controller events it needs.
    void vid;
  }

  private onEndDownloadConfiguration(configurationString: string): void {
    this.log.info("Configuration download complete — building accessory list.");

    // The Vantage DC file contains non-standard processing instructions (e.g. <?File /...?>)
    // with embedded scene program code that crash fast-xml-parser. Strip them before parsing.
    const cleanedConfig = configurationString.replace(/<\?(?!xml[\s?>])[\s\S]*?\?>/g, '');
    const configuration = xmlParser.parse(cleanedConfig);

    // Normalise to always be an array (xml2json returns a plain object for single-item lists)
    const objects: any[] = configuration.Project?.Objects?.Object ?? [];
    const objectArray = Array.isArray(objects) ? objects : [objects];

    for (const objectWrapper of objectArray) {
      const mainKey = Object.keys(objectWrapper)[0];
      const item    = objectWrapper[mainKey];
      const areaName = item.Area
        ? this.resolveAreaName(objectArray, item.Area)
        : "";
      this.addItem(item, areaName);
    }

    // Wait for all IsInterfaceSupported queries to complete before calling the callback
    Promise.all(this.interfaceSupportRequests).then(() => {
      const accessories = Object.values(this.accessoriesDict);
      this.log.info(`Registering ${accessories.length} accessories with Homebridge.`);
      this.accessoriesCallback(accessories);
    });
  }

  // ─── Item classification ──────────────────────────────────────────────────────

  private isWhitelisted(vid: string): boolean {
    return this.whitelist.length === 0 || this.whitelist.includes(vid);
  }

  private addItem(item: any, areaName: string): void {
    if (!this.isWhitelisted(String(item.VID))) return;

    if (item.ObjectType === "HVAC") {
      this.addHVACItem(item);
    } else if (item.ObjectType === "Load") {
      this.addLoadItem(item, areaName);
    } else if (item.ObjectType === "Blind") {
      this.addBlindItem(item);
    } else {
      this.log.debug(`Skipping unsupported object type: ${item.ObjectType} (VID=${item.VID})`);
    }
  }

  private addHVACItem(item: any): void {
    // Prefer DName (display name) over Name when available
    if (item.DName && item.DName !== "") item.Name = item.DName;

    this.log.debug(`HVAC discovered (VID=${item.VID}, Name=${item.Name})`);

    const promise = this.vantageController
      .isInterfaceSupported(item, "Thermostat")
      .then(({ support, item: resolvedItem }) => {
        if (!support) return;
        const name = this.resolveVidName(resolvedItem.VID) || resolvedItem.Name;
        this.log.info(`Added HVAC thermostat: ${name} (VID=${resolvedItem.VID})`);
        this.accessoriesDict[resolvedItem.VID] = new VantageThermostat(
          hap, this.log, name, resolvedItem.VID, this.vantageController, this.fahrenheit
        );
      });

    this.interfaceSupportRequests.push(promise);
  }

  private addLoadItem(item: any, areaName: string): void {
    item.Area = areaName;
    this.log.debug(`Load discovered (VID=${item.VID}, Name=${item.Name})`);

    const promise = this.vantageController
      .isInterfaceSupported(item, "Load")
      .then(({ support, item: resolvedItem }) => {
        if (!support) return;

        const vid  = resolvedItem.VID;
        const name = this.resolveVidName(vid) || `${resolvedItem.Area}-${resolvedItem.Name}`;

        // Determine type: vidMapping override takes precedence over auto-detection
        const type = this.resolveVidType(vid) || this.autoDetectLoadType(resolvedItem, name);

        this.log.info(`Added load: ${name} (VID=${vid}, type=${type})`);

        if (type === "fan") {
          this.accessoriesDict[vid] = new VantageFan(hap, this.log, name, vid, this.vantageController);
        } else if (type === "switch" || type === "motor") {
          this.accessoriesDict[vid] = new VantageSwitch(hap, this.log, name, vid, this.vantageController);
        } else if (type === "outlet") {
          this.accessoriesDict[vid] = new VantageOutlet(hap, this.log, name, vid, this.vantageController);
        } else if (type === "dimmer" || type === "rgb") {
          this.accessoriesDict[vid] = new VantageDimmer(
            hap, this.log, name, vid, this.vantageController, type as "dimmer" | "rgb"
          );
        } else {
          // relay → non-dimmable Lightbulb
          this.accessoriesDict[vid] = new VantageLight(hap, this.log, name, vid, this.vantageController);
        }
      });

    this.interfaceSupportRequests.push(promise);
  }

  private addBlindItem(item: any): void {
    if (item.DName && item.DName !== "") item.Name = item.DName;
    this.log.debug(`Blind discovered (VID=${item.VID}, Name=${item.Name}, Type=${item.ObjectType})`);

    const promise = this.vantageController
      .isInterfaceSupported(item, "Blind")
      .then(({ support, item: resolvedItem }) => {
        if (!support) return;
        const baseName = this.resolveVidName(resolvedItem.VID) || resolvedItem.Name;
        // Append VID to guarantee unique accessory UUIDs — duplicate names cause HAP compliance failures
        const name = `${baseName} ${resolvedItem.VID}`;
        this.log.info(`Added blind: ${name} (VID=${resolvedItem.VID}, type=${resolvedItem.ObjectType})`);
        this.accessoriesDict[resolvedItem.VID] = new VantageBlind(
          hap, this.log, name, resolvedItem.VID, this.vantageController, this.blindTravelTime
        );
      });

    this.interfaceSupportRequests.push(promise);
  }

  // ─── Type & name resolution ───────────────────────────────────────────────────

  private resolveVidName(vid: string): string {
    return this.vidMapping[vid]?.Name ?? "";
  }

  private resolveVidType(vid: string): string {
    return this.vidMapping[vid]?.Type ?? "";
  }

  /**
   * Auto-detect the load type from the Vantage LoadType field and the device name.
   *
   * Priority:
   *  1. "fan" — name contains "fan/Fan" (and not "light/Light")
   *  2. "motor" — LoadType contains "Motor"
   *  3. "relay" — LoadType contains "Relay"
   *  4. "dimmer" — everything else (dimmable)
   */
  private autoDetectLoadType(item: any, name: string): string {
    const nameLower = name.toLowerCase();
    if (nameLower.includes("fan") && !nameLower.includes("light")) return "fan";

    const loadType: string = item.LoadType ?? "";
    if (loadType.includes("Motor")) return "motor";
    if (loadType.includes("Relay")) return "relay";
    return "dimmer";
  }

  // ─── Area name resolution ─────────────────────────────────────────────────────

  /**
   * Walk the objects array to find the Area object whose VID matches `areaVid`
   * and return its Name.
   */
  private resolveAreaName(objects: any[], areaVid: string): string {
    for (const objectWrapper of objects) {
      const item = objectWrapper[Object.keys(objectWrapper)[0]];
      if (item.ObjectType === "Area" && String(item.VID) === String(areaVid)) {
        return item.Name ?? "";
      }
    }
    return "";
  }
}
