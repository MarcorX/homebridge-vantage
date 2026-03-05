"use strict";
const fast_xml_parser_1 = require("fast-xml-parser");
const xmlParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    isArray: (name) => name === 'Object',
});
const vantage_light_accessory_1 = require("./vantage-light-accessory");
const vantage_dimmer_accessory_1 = require("./vantage-dimmer-accessory");
const vantage_fan_accessory_1 = require("./vantage-fan-accessory");
const vantage_switch_accessory_1 = require("./vantage-switch-accessory");
const vantage_outlet_accessory_1 = require("./vantage-outlet-accessory");
const vantage_thermostat_accessory_1 = require("./vantage-thermostat-accessory");
const vantage_infusion_controller_1 = require("./vantage-infusion-controller");
const PLUGIN_NAME = "homebridge-vantage-infusion-controller";
const PLATFORM_NAME = "VantageInfusion";
let hap;
class VantageStaticPlatform {
    constructor(log, config, api) {
        var _a, _b, _c, _d, _e;
        this.accessoriesDict = {};
        this.interfaceSupportRequests = [];
        this.accessoriesCallback = () => { };
        this.log = log;
        this.vidMapping = (_a = config.vidMapping) !== null && _a !== void 0 ? _a : {};
        this.whitelist = (_b = config.whitelist) !== null && _b !== void 0 ? _b : [];
        this.fahrenheit = (_c = config.fahrenheit) !== null && _c !== void 0 ? _c : true;
        // Support legacy controllerSendInterval (µs) and new commandIntervalMs (ms)
        const intervalMs = (_d = config.commandIntervalMs) !== null && _d !== void 0 ? _d : (config.controllerSendInterval != null
            ? Math.round(config.controllerSendInterval / 1000)
            : 50);
        this.vantageController = new vantage_infusion_controller_1.VantageInfusionController(this.log, config.ipaddress, intervalMs, (_e = config.forceRefresh) !== null && _e !== void 0 ? _e : false);
        this.vantageController.on(vantage_infusion_controller_1.EndDownloadConfigurationEvent, this.onEndDownloadConfiguration.bind(this));
        this.vantageController.on(vantage_infusion_controller_1.LoadStatusChangeEvent, this.onLoadStatusChange.bind(this));
        this.vantageController.on(vantage_infusion_controller_1.ThermostatIndoorTemperatureChangeEvent, this.onThermostatTemperature.bind(this));
        this.vantageController.on(vantage_infusion_controller_1.ThermostatOutdoorTemperatureChangeEvent, this.onThermostatTemperature.bind(this));
        this.vantageController.serverConfigurationDownload();
        this.log.info("Vantage InFusion platform initialised — waiting for configuration download.");
    }
    // ─── Accessory registration (called by Homebridge) ──────────────────────────
    accessories(callback) {
        this.accessoriesCallback = callback;
    }
    // ─── Event handlers ──────────────────────────────────────────────────────────
    onLoadStatusChange(vid, value) {
        const accessory = this.accessoriesDict[vid];
        if (accessory && (0, vantage_light_accessory_1.isVantageLoadObject)(accessory)) {
            accessory.loadStatusChange(value);
        }
    }
    onThermostatTemperature(vid, _value) {
        // Temperature updates are handled inside VantageThermostat via its own event subscriptions.
        // This handler exists only to satisfy the original event listener registrations; the
        // thermostat accessory subscribes directly to the controller events it needs.
        void vid;
    }
    onEndDownloadConfiguration(configurationString) {
        var _a, _b, _c;
        this.log.info("Configuration download complete — building accessory list.");
        // The Vantage DC file contains non-standard processing instructions (e.g. <?File /...?>)
        // with embedded scene program code that crash fast-xml-parser. Strip them before parsing.
        const cleanedConfig = configurationString.replace(/<\?(?!xml[\s?>])[\s\S]*?\?>/g, '');
        const configuration = xmlParser.parse(cleanedConfig);
        // Normalise to always be an array (xml2json returns a plain object for single-item lists)
        const objects = (_c = (_b = (_a = configuration.Project) === null || _a === void 0 ? void 0 : _a.Objects) === null || _b === void 0 ? void 0 : _b.Object) !== null && _c !== void 0 ? _c : [];
        const objectArray = Array.isArray(objects) ? objects : [objects];
        for (const objectWrapper of objectArray) {
            const mainKey = Object.keys(objectWrapper)[0];
            const item = objectWrapper[mainKey];
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
    isWhitelisted(vid) {
        return this.whitelist.length === 0 || this.whitelist.includes(vid);
    }
    addItem(item, areaName) {
        if (!this.isWhitelisted(String(item.VID)))
            return;
        if (item.ObjectType === "HVAC") {
            this.addHVACItem(item);
        }
        else if (item.ObjectType === "Load") {
            this.addLoadItem(item, areaName);
        }
        else {
            this.log.debug(`Skipping unsupported object type: ${item.ObjectType} (VID=${item.VID})`);
        }
    }
    addHVACItem(item) {
        // Prefer DName (display name) over Name when available
        if (item.DName && item.DName !== "")
            item.Name = item.DName;
        this.log.debug(`HVAC discovered (VID=${item.VID}, Name=${item.Name})`);
        const promise = this.vantageController
            .isInterfaceSupported(item, "Thermostat")
            .then(({ support, item: resolvedItem }) => {
            if (!support)
                return;
            const name = this.resolveVidName(resolvedItem.VID) || resolvedItem.Name;
            this.log.info(`Added HVAC thermostat: ${name} (VID=${resolvedItem.VID})`);
            this.accessoriesDict[resolvedItem.VID] = new vantage_thermostat_accessory_1.VantageThermostat(hap, this.log, name, resolvedItem.VID, this.vantageController, this.fahrenheit);
        });
        this.interfaceSupportRequests.push(promise);
    }
    addLoadItem(item, areaName) {
        item.Area = areaName;
        this.log.debug(`Load discovered (VID=${item.VID}, Name=${item.Name})`);
        const promise = this.vantageController
            .isInterfaceSupported(item, "Load")
            .then(({ support, item: resolvedItem }) => {
            if (!support)
                return;
            const vid = resolvedItem.VID;
            const name = this.resolveVidName(vid) || `${resolvedItem.Area}-${resolvedItem.Name}`;
            // Determine type: vidMapping override takes precedence over auto-detection
            const type = this.resolveVidType(vid) || this.autoDetectLoadType(resolvedItem, name);
            this.log.info(`Added load: ${name} (VID=${vid}, type=${type})`);
            if (type === "fan") {
                this.accessoriesDict[vid] = new vantage_fan_accessory_1.VantageFan(hap, this.log, name, vid, this.vantageController);
            }
            else if (type === "switch" || type === "motor") {
                this.accessoriesDict[vid] = new vantage_switch_accessory_1.VantageSwitch(hap, this.log, name, vid, this.vantageController);
            }
            else if (type === "outlet") {
                this.accessoriesDict[vid] = new vantage_outlet_accessory_1.VantageOutlet(hap, this.log, name, vid, this.vantageController);
            }
            else if (type === "dimmer" || type === "rgb") {
                this.accessoriesDict[vid] = new vantage_dimmer_accessory_1.VantageDimmer(hap, this.log, name, vid, this.vantageController, type);
            }
            else {
                // relay → non-dimmable Lightbulb
                this.accessoriesDict[vid] = new vantage_light_accessory_1.VantageLight(hap, this.log, name, vid, this.vantageController);
            }
        });
        this.interfaceSupportRequests.push(promise);
    }
    // ─── Type & name resolution ───────────────────────────────────────────────────
    resolveVidName(vid) {
        var _a, _b;
        return (_b = (_a = this.vidMapping[vid]) === null || _a === void 0 ? void 0 : _a.Name) !== null && _b !== void 0 ? _b : "";
    }
    resolveVidType(vid) {
        var _a, _b;
        return (_b = (_a = this.vidMapping[vid]) === null || _a === void 0 ? void 0 : _a.Type) !== null && _b !== void 0 ? _b : "";
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
    autoDetectLoadType(item, name) {
        var _a;
        const nameLower = name.toLowerCase();
        if (nameLower.includes("fan") && !nameLower.includes("light"))
            return "fan";
        const loadType = (_a = item.LoadType) !== null && _a !== void 0 ? _a : "";
        if (loadType.includes("Motor"))
            return "motor";
        if (loadType.includes("Relay"))
            return "relay";
        return "dimmer";
    }
    // ─── Area name resolution ─────────────────────────────────────────────────────
    /**
     * Walk the objects array to find the Area object whose VID matches `areaVid`
     * and return its Name.
     */
    resolveAreaName(objects, areaVid) {
        var _a;
        for (const objectWrapper of objects) {
            const item = objectWrapper[Object.keys(objectWrapper)[0]];
            if (item.ObjectType === "Area" && String(item.VID) === String(areaVid)) {
                return (_a = item.Name) !== null && _a !== void 0 ? _a : "";
            }
        }
        return "";
    }
}
module.exports = (api) => {
    hap = api.hap;
    api.registerPlatform(PLATFORM_NAME, VantageStaticPlatform);
};
//# sourceMappingURL=homebridge-vantage-static.js.map