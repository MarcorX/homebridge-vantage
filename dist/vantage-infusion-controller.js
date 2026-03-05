"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageInfusionController = exports.IsInterfaceSupportedEvent = exports.EndDownloadConfigurationEvent = exports.ThermostatHVACStateChangeEvent = exports.ThermostatModeChangeEvent = exports.ThermostatCoolSetpointChangeEvent = exports.ThermostatHeatSetpointChangeEvent = exports.ThermostatIndoorTemperatureChangeEvent = exports.ThermostatOutdoorTemperatureChangeEvent = exports.LoadStatusChangeEvent = void 0;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const fast_xml_parser_1 = require("fast-xml-parser");
const xmlParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    isArray: (name) => name === 'Interface' || name === 'Object',
});
const events_1 = require("events");
/**
 * Returns true when the XML buffer contains a complete root element.
 * The Vantage controller sends self-contained XML messages (<IIntrospection>, <IBackup>),
 * so we simply check that the root tag is closed before attempting to parse.
 */
function isXmlComplete(xml) {
    const match = xml.match(/<(\w+)/);
    if (!match)
        return false;
    return xml.includes(`</${match[1]}>`);
}
const SERVER_CONTROLLER_PORT = 3001;
const SERVER_CONFIGURATION_PORT = 2001;
const INITIAL_RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
exports.LoadStatusChangeEvent = "loadStatusChange";
exports.ThermostatOutdoorTemperatureChangeEvent = "thermostatOutdoorTemperatureChange";
exports.ThermostatIndoorTemperatureChangeEvent = "thermostatIndoorTemperatureChange";
exports.ThermostatHeatSetpointChangeEvent = "thermostatHeatSetpointChange";
exports.ThermostatCoolSetpointChangeEvent = "thermostatCoolSetpointChange";
exports.ThermostatModeChangeEvent = "thermostatModeChange";
exports.ThermostatHVACStateChangeEvent = "thermostatHVACStateChange";
exports.EndDownloadConfigurationEvent = "endDownloadConfiguration";
const IsInterfaceSupportedEvent = (vid, interfaceId) => `isInterfaceSupportedAnswer-${vid}-${interfaceId}`;
exports.IsInterfaceSupportedEvent = IsInterfaceSupportedEvent;
class VantageInfusionController extends events_1.EventEmitter {
    constructor(log, ipaddress, commandIntervalMs = 50, forceRefresh = false) {
        super();
        // async command queue — avoids blocking the event loop
        this.commandQueue = [];
        this.commandQueueRunning = false;
        // reconnect state
        this.controllerReconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        this.controllerReconnectTimer = null;
        this.configurationDownloadComplete = false;
        this.log = log;
        this.ipaddress = ipaddress;
        // Support legacy controllerSendInterval (microseconds): if > 1000 assume µs and convert
        this.commandIntervalMs = commandIntervalMs > 1000
            ? Math.round(commandIntervalMs / 1000)
            : commandIntervalMs;
        this.forceRefresh = forceRefresh;
        this.configCachePath = `/tmp/vantage-${ipaddress.replace(/\./g, '_')}.dc`;
        this.serverDatabase = "";
        this.interfaces = {};
        this.serverController = this.createControllerSocket();
        this.serverConfiguration = this.createConfigurationSocket();
        this.log.info(`Connecting to Vantage InFusion Controller at ${ipaddress}`);
        this.connectController();
    }
    // ─── Socket factories ────────────────────────────────────────────────────────
    createControllerSocket() {
        const socket = new net.Socket();
        socket.setEncoding("ascii");
        socket.on('data', this.onControllerData.bind(this));
        socket.on('close', () => {
            this.log.warn("Controller connection closed — scheduling reconnect.");
            this.scheduleControllerReconnect();
        });
        socket.on('error', (err) => {
            this.log.error(`Controller socket error: ${err.message}`);
        });
        return socket;
    }
    createConfigurationSocket() {
        const socket = new net.Socket();
        socket.setEncoding("ascii");
        socket.on('data', this.onConfigurationData.bind(this));
        socket.on('close', () => {
            if (!this.configurationDownloadComplete) {
                this.log.warn("Configuration connection closed before download completed — retrying.");
                this.serverConfigurationDownload();
            }
        });
        socket.on('error', (err) => {
            this.log.error(`Configuration socket error: ${err.message}`);
        });
        return socket;
    }
    // ─── Connection management ────────────────────────────────────────────────────
    connectController() {
        this.serverController.connect({ host: this.ipaddress, port: SERVER_CONTROLLER_PORT }, () => {
            this.log.info("Controller connection established.");
            this.controllerReconnectDelay = INITIAL_RECONNECT_DELAY_MS;
            this.enqueueCommand("STATUS ALL\n");
            this.enqueueCommand("ELENABLE 1 AUTOMATION ON\n" +
                "ELENABLE 1 EVENT ON\n" +
                "ELENABLE 1 STATUS ON\n" +
                "ELENABLE 1 STATUSEX ON\n" +
                "ELENABLE 1 SYSTEM ON\n" +
                "ELLOG AUTOMATION ON\n" +
                "ELLOG EVENT ON\n" +
                "ELLOG STATUS ON\n" +
                "ELLOG STATUSEX ON\n" +
                "ELLOG SYSTEM ON\n");
        });
    }
    serverConfigurationDownload() {
        if (this.forceRefresh && fs.existsSync(this.configCachePath)) {
            fs.unlinkSync(this.configCachePath);
            this.log.info("forceRefresh: deleted configuration cache.");
        }
        this.serverConfiguration = this.createConfigurationSocket();
        this.serverConfiguration.connect({ host: this.ipaddress, port: SERVER_CONFIGURATION_PORT }, () => {
            this.log.info("Configuration connection established.");
            this.serverConfiguration.write("<IIntrospection><GetInterfaces><call></call></GetInterfaces></IIntrospection>\n", "ascii");
            if (!fs.existsSync(this.configCachePath)) {
                this.log.debug("Requesting configuration download from controller.");
                this.serverConfiguration.write("<IBackup><GetFile><call>Backup\\Project.dc</call></GetFile></IBackup>\n", "ascii");
            }
        });
    }
    scheduleControllerReconnect() {
        if (this.controllerReconnectTimer)
            return;
        this.controllerReconnectTimer = setTimeout(() => {
            this.controllerReconnectTimer = null;
            this.log.info(`Reconnecting to controller (delay was ${this.controllerReconnectDelay}ms)…`);
            this.serverController = this.createControllerSocket();
            this.connectController();
            this.controllerReconnectDelay = Math.min(this.controllerReconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
        }, this.controllerReconnectDelay);
    }
    // ─── Async command queue ──────────────────────────────────────────────────────
    enqueueCommand(msg) {
        this.commandQueue.push(msg);
        this.drainQueue();
    }
    drainQueue() {
        if (this.commandQueueRunning || this.commandQueue.length === 0)
            return;
        this.commandQueueRunning = true;
        const sendNext = () => {
            const msg = this.commandQueue.shift();
            if (!msg) {
                this.commandQueueRunning = false;
                return;
            }
            this.log.debug(`TX: ${msg.trim()}`);
            this.serverController.write(msg, "ascii");
            setTimeout(sendNext, this.commandIntervalMs);
        };
        sendNext();
    }
    // ─── Controller data parser ───────────────────────────────────────────────────
    onControllerData(data) {
        var _a, _b;
        const lines = data.toString().split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            this.log.debug(`RX: ${trimmed}`);
            const parts = trimmed.split(' ');
            // Load level updates (both polling response and live event)
            if (trimmed.startsWith("S:LOAD ") || trimmed.startsWith("R:GETLOAD ")) {
                this.emit(exports.LoadStatusChangeEvent, parts[1], parseInt(parts[2]));
                continue;
            }
            // EL event stream — temperatures are in milli-degrees (divide by 1000)
            if (trimmed.startsWith("EL: ")) {
                const vid = parts[2];
                const method = parts[3];
                const raw = parts[4] !== undefined ? parseFloat(parts[4]) : 0;
                switch (method) {
                    case "Thermostat.SetOutdoorTemperatureSW":
                        this.emit(exports.ThermostatOutdoorTemperatureChangeEvent, vid, raw / 1000);
                        break;
                    case "Thermostat.SetIndoorTemperatureSW":
                        this.emit(exports.ThermostatIndoorTemperatureChangeEvent, vid, raw / 1000);
                        break;
                    case "Thermostat.SetHeatPointSW":
                        this.emit(exports.ThermostatHeatSetpointChangeEvent, vid, raw / 1000);
                        break;
                    case "Thermostat.SetCoolPointSW":
                        this.emit(exports.ThermostatCoolSetpointChangeEvent, vid, raw / 1000);
                        break;
                    case "Thermostat.SetMode":
                        this.emit(exports.ThermostatModeChangeEvent, vid, parseInt((_a = parts[4]) !== null && _a !== void 0 ? _a : "0"));
                        break;
                    case "Thermostat.GetHVACState":
                        this.emit(exports.ThermostatHVACStateChangeEvent, vid, parseInt((_b = parts[4]) !== null && _b !== void 0 ? _b : "0"));
                        break;
                }
                continue;
            }
            // R:INVOKE responses — temperatures are in degrees directly (no /1000)
            if (trimmed.startsWith("R:INVOKE")) {
                const vid = parts[1];
                const retVal = parts[2];
                const method = parts[3];
                switch (method) {
                    case "Thermostat.GetOutdoorTemperature":
                        this.emit(exports.ThermostatOutdoorTemperatureChangeEvent, vid, parseFloat(retVal));
                        break;
                    case "Thermostat.GetIndoorTemperature":
                        this.emit(exports.ThermostatIndoorTemperatureChangeEvent, vid, parseFloat(retVal));
                        break;
                    case "Thermostat.GetHeatPoint":
                        this.emit(exports.ThermostatHeatSetpointChangeEvent, vid, parseFloat(retVal));
                        break;
                    case "Thermostat.GetCoolPoint":
                        this.emit(exports.ThermostatCoolSetpointChangeEvent, vid, parseFloat(retVal));
                        break;
                    case "Thermostat.GetMode":
                        this.emit(exports.ThermostatModeChangeEvent, vid, parseInt(retVal));
                        break;
                    case "Thermostat.GetHVACState":
                        this.emit(exports.ThermostatHVACStateChangeEvent, vid, parseInt(retVal));
                        break;
                    case "Object.IsInterfaceSupported":
                        this.emit((0, exports.IsInterfaceSupportedEvent)(parts[1].trim(), parts[4].trim()), parseInt(retVal));
                        break;
                }
            }
        }
    }
    // ─── Configuration data parser ────────────────────────────────────────────────
    onConfigurationData(data) {
        var _a;
        this.serverDatabase += data.toString().replace("\ufeff", "");
        // Normalize the Base64 file wrapper that the controller sends
        this.serverDatabase = this.serverDatabase
            .replace('<?File Encode="Base64" /', '<File>')
            .replace('?>', '</File>');
        if (!isXmlComplete(this.serverDatabase)) {
            return; // XML not yet complete, wait for more data
        }
        const parsedDatabase = xmlParser.parse(this.serverDatabase);
        this.serverDatabase = "";
        // Parse interface list (sent in response to GetInterfaces)
        if (parsedDatabase.IIntrospection !== undefined) {
            this.log.debug("Parsing interface list.");
            // isArray config ensures Interface is always an array
            const ifaces = (_a = parsedDatabase.IIntrospection.GetInterfaces.return.Interface) !== null && _a !== void 0 ? _a : [];
            for (const iface of ifaces) {
                this.log.debug(`  Interface: ${iface.Name} = ${iface.IID}`);
                this.interfaces[iface.Name] = iface.IID;
            }
        }
        // Parse device configuration (sent in response to GetFile)
        if (parsedDatabase.IBackup !== undefined) {
            this.log.info("Configuration download complete — saving to cache.");
            const configuration = Buffer
                .from(parsedDatabase.IBackup.GetFile.return.File, 'base64')
                .toString("ascii");
            fs.writeFileSync(this.configCachePath, configuration);
            this.configurationDownloadComplete = true;
            this.emit(exports.EndDownloadConfigurationEvent, configuration);
        }
        else if (fs.existsSync(this.configCachePath)) {
            this.log.info("Loading configuration from cache.");
            const cached = fs.readFileSync(this.configCachePath, 'utf8');
            this.configurationDownloadComplete = true;
            this.emit(exports.EndDownloadConfigurationEvent, cached);
        }
        else {
            this.log.error("No configuration received and no cache found. Check controller connectivity.");
        }
    }
    // ─── Public commands ──────────────────────────────────────────────────────────
    sendGetLoadStatus(vid) {
        this.enqueueCommand(`GETLOAD ${vid}\n`);
    }
    sendLoadDim(vid, level, time = 1) {
        if (level > 0) {
            this.enqueueCommand(`INVOKE ${vid} Load.Ramp 6 ${time} ${level}\n`);
        }
        else {
            this.enqueueCommand(`INVOKE ${vid} Load.SetLevel 0\n`);
        }
    }
    sendRGBLoadDissolveHSL(vid, h, s, l, time = 500) {
        this.enqueueCommand(`INVOKE ${vid} RGBLoad.DissolveHSL ${h} ${s} ${l * 1000} ${time}\n`);
    }
    sendThermostatGetIndoorTemperature(vid) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.GetIndoorTemperature\n`);
    }
    sendThermostatGetOutdoorTemperature(vid) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.GetOutdoorTemperature\n`);
    }
    sendThermostatGetHeatPoint(vid) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.GetHeatPoint\n`);
    }
    sendThermostatGetCoolPoint(vid) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.GetCoolPoint\n`);
    }
    sendThermostatGetMode(vid) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.GetMode\n`);
    }
    sendThermostatGetHVACState(vid) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.GetHVACState\n`);
    }
    sendThermostatSetHeatPoint(vid, milliDegrees) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.SetHeatPoint ${milliDegrees}\n`);
    }
    sendThermostatSetCoolPoint(vid, milliDegrees) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.SetCoolPoint ${milliDegrees}\n`);
    }
    sendThermostatSetMode(vid, mode) {
        this.enqueueCommand(`INVOKE ${vid} Thermostat.SetMode ${mode}\n`);
    }
    sendIsInterfaceSupported(vid, interfaceId) {
        this.enqueueCommand(`INVOKE ${vid} Object.IsInterfaceSupported ${interfaceId}\n`);
    }
    isInterfaceSupported(item, interfaceName) {
        if (this.interfaces[interfaceName] === undefined) {
            return Promise.resolve({ item, interface: interfaceName, support: false });
        }
        const interfaceId = String(this.interfaces[interfaceName]);
        return new Promise((resolve) => {
            this.once((0, exports.IsInterfaceSupportedEvent)(String(item.VID).trim(), interfaceId.trim()), (support) => resolve({ item, interface: interfaceName, support: Boolean(support) }));
            this.sendIsInterfaceSupported(item.VID, interfaceId);
        });
    }
}
exports.VantageInfusionController = VantageInfusionController;
//# sourceMappingURL=vantage-infusion-controller.js.map