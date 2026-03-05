import * as net from 'net';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { Logging } from "homebridge";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',    // attributes appear at the same level as child elements
  parseAttributeValue: false, // keep everything as strings to match original behaviour
  allowBooleanAttributes: true,
  isArray: (name) => name === 'Interface' || name === 'Object',
});
import { EventEmitter } from 'events';

/**
 * Returns true when the XML buffer contains a complete root element.
 * The Vantage controller sends self-contained XML messages (<IIntrospection>, <IBackup>),
 * so we simply check that the root tag is closed before attempting to parse.
 */
function isXmlComplete(xml: string): boolean {
  const match = xml.match(/<(\w+)/);
  if (!match) return false;
  return xml.includes(`</${match[1]}>`);
}

const SERVER_CONTROLLER_PORT = 3001;
const SERVER_CONFIGURATION_PORT = 2001;

const INITIAL_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export const LoadStatusChangeEvent = "loadStatusChange";
export const ThermostatOutdoorTemperatureChangeEvent = "thermostatOutdoorTemperatureChange";
export const ThermostatIndoorTemperatureChangeEvent = "thermostatIndoorTemperatureChange";
export const ThermostatHeatSetpointChangeEvent = "thermostatHeatSetpointChange";
export const ThermostatCoolSetpointChangeEvent = "thermostatCoolSetpointChange";
export const ThermostatModeChangeEvent = "thermostatModeChange";
export const ThermostatHVACStateChangeEvent = "thermostatHVACStateChange";
export const EndDownloadConfigurationEvent = "endDownloadConfiguration";
export const IsInterfaceSupportedEvent = (vid: string, interfaceId: string) =>
  `isInterfaceSupportedAnswer-${vid}-${interfaceId}`;

export class VantageInfusionController extends EventEmitter {

  private readonly log: Logging;
  private readonly ipaddress: string;
  private readonly commandIntervalMs: number;
  private readonly configCachePath: string;
  private readonly forceRefresh: boolean;

  private serverDatabase: string;
  private interfaces: Record<string, string>;

  private serverController: net.Socket;
  private serverConfiguration: net.Socket;

  // async command queue — avoids blocking the event loop
  private readonly commandQueue: string[] = [];
  private commandQueueRunning = false;

  // reconnect state
  private controllerReconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private controllerReconnectTimer: NodeJS.Timeout | null = null;
  private configurationDownloadComplete = false;

  constructor(log: Logging, ipaddress: string, commandIntervalMs = 50, forceRefresh = false) {
    super();
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

  private createControllerSocket(): net.Socket {
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

  private createConfigurationSocket(): net.Socket {
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

  private connectController(): void {
    this.serverController.connect({ host: this.ipaddress, port: SERVER_CONTROLLER_PORT }, () => {
      this.log.info("Controller connection established.");
      this.controllerReconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.enqueueCommand("STATUS ALL\n");
      this.enqueueCommand(
        "ELENABLE 1 AUTOMATION ON\n" +
        "ELENABLE 1 EVENT ON\n" +
        "ELENABLE 1 STATUS ON\n" +
        "ELENABLE 1 STATUSEX ON\n" +
        "ELENABLE 1 SYSTEM ON\n" +
        "ELLOG AUTOMATION ON\n" +
        "ELLOG EVENT ON\n" +
        "ELLOG STATUS ON\n" +
        "ELLOG STATUSEX ON\n" +
        "ELLOG SYSTEM ON\n"
      );
    });
  }

  serverConfigurationDownload(): void {
    if (this.forceRefresh && fs.existsSync(this.configCachePath)) {
      fs.unlinkSync(this.configCachePath);
      this.log.info("forceRefresh: deleted configuration cache.");
    }

    this.serverConfiguration = this.createConfigurationSocket();
    this.serverConfiguration.connect({ host: this.ipaddress, port: SERVER_CONFIGURATION_PORT }, () => {
      this.log.info("Configuration connection established.");
      this.serverConfiguration.write(
        "<IIntrospection><GetInterfaces><call></call></GetInterfaces></IIntrospection>\n",
        "ascii"
      );
      if (!fs.existsSync(this.configCachePath)) {
        this.log.debug("Requesting configuration download from controller.");
        this.serverConfiguration.write(
          "<IBackup><GetFile><call>Backup\\Project.dc</call></GetFile></IBackup>\n",
          "ascii"
        );
      }
    });
  }

  private scheduleControllerReconnect(): void {
    if (this.controllerReconnectTimer) return;
    this.controllerReconnectTimer = setTimeout(() => {
      this.controllerReconnectTimer = null;
      this.log.info(`Reconnecting to controller (delay was ${this.controllerReconnectDelay}ms)…`);
      this.serverController = this.createControllerSocket();
      this.connectController();
      this.controllerReconnectDelay = Math.min(
        this.controllerReconnectDelay * 2,
        MAX_RECONNECT_DELAY_MS
      );
    }, this.controllerReconnectDelay);
  }

  // ─── Async command queue ──────────────────────────────────────────────────────

  private enqueueCommand(msg: string): void {
    this.commandQueue.push(msg);
    this.drainQueue();
  }

  private drainQueue(): void {
    if (this.commandQueueRunning || this.commandQueue.length === 0) return;
    this.commandQueueRunning = true;
    const sendNext = (): void => {
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

  private onControllerData(data: Buffer): void {
    const lines = data.toString().split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.log.debug(`RX: ${trimmed}`);
      const parts = trimmed.split(' ');

      // Load level updates (both polling response and live event)
      if (trimmed.startsWith("S:LOAD ") || trimmed.startsWith("R:GETLOAD ")) {
        this.emit(LoadStatusChangeEvent, parts[1], parseInt(parts[2]));
        continue;
      }

      // EL event stream — temperatures are in milli-degrees (divide by 1000)
      if (trimmed.startsWith("EL: ")) {
        const vid   = parts[2];
        const method = parts[3];
        const raw   = parts[4] !== undefined ? parseFloat(parts[4]) : 0;

        switch (method) {
          case "Thermostat.SetOutdoorTemperatureSW":
            this.emit(ThermostatOutdoorTemperatureChangeEvent, vid, raw / 1000);
            break;
          case "Thermostat.SetIndoorTemperatureSW":
            this.emit(ThermostatIndoorTemperatureChangeEvent, vid, raw / 1000);
            break;
          case "Thermostat.SetHeatPointSW":
            this.emit(ThermostatHeatSetpointChangeEvent, vid, raw / 1000);
            break;
          case "Thermostat.SetCoolPointSW":
            this.emit(ThermostatCoolSetpointChangeEvent, vid, raw / 1000);
            break;
          case "Thermostat.SetMode":
            this.emit(ThermostatModeChangeEvent, vid, parseInt(parts[4] ?? "0"));
            break;
          case "Thermostat.GetHVACState":
            this.emit(ThermostatHVACStateChangeEvent, vid, parseInt(parts[4] ?? "0"));
            break;
        }
        continue;
      }

      // R:INVOKE responses — temperatures are in degrees directly (no /1000)
      if (trimmed.startsWith("R:INVOKE")) {
        const vid    = parts[1];
        const retVal = parts[2];
        const method = parts[3];

        switch (method) {
          case "Thermostat.GetOutdoorTemperature":
            this.emit(ThermostatOutdoorTemperatureChangeEvent, vid, parseFloat(retVal));
            break;
          case "Thermostat.GetIndoorTemperature":
            this.emit(ThermostatIndoorTemperatureChangeEvent, vid, parseFloat(retVal));
            break;
          case "Thermostat.GetHeatPoint":
            this.emit(ThermostatHeatSetpointChangeEvent, vid, parseFloat(retVal));
            break;
          case "Thermostat.GetCoolPoint":
            this.emit(ThermostatCoolSetpointChangeEvent, vid, parseFloat(retVal));
            break;
          case "Thermostat.GetMode":
            this.emit(ThermostatModeChangeEvent, vid, parseInt(retVal));
            break;
          case "Thermostat.GetHVACState":
            this.emit(ThermostatHVACStateChangeEvent, vid, parseInt(retVal));
            break;
          case "Object.IsInterfaceSupported":
            this.emit(
              IsInterfaceSupportedEvent(parts[1].trim(), parts[4].trim()),
              parseInt(retVal)
            );
            break;
        }
      }
    }
  }

  // ─── Configuration data parser ────────────────────────────────────────────────

  private onConfigurationData(data: Buffer): void {
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
      const ifaces: any[] = parsedDatabase.IIntrospection.GetInterfaces.return.Interface ?? [];
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
      this.emit(EndDownloadConfigurationEvent, configuration);
    } else if (fs.existsSync(this.configCachePath)) {
      this.log.info("Loading configuration from cache.");
      const cached = fs.readFileSync(this.configCachePath, 'utf8');
      this.configurationDownloadComplete = true;
      this.emit(EndDownloadConfigurationEvent, cached);
    } else {
      this.log.error("No configuration received and no cache found. Check controller connectivity.");
    }
  }

  // ─── Public commands ──────────────────────────────────────────────────────────

  sendGetLoadStatus(vid: string): void {
    this.enqueueCommand(`GETLOAD ${vid}\n`);
  }

  sendLoadDim(vid: string, level: number, time = 1): void {
    if (level > 0) {
      this.enqueueCommand(`INVOKE ${vid} Load.Ramp 6 ${time} ${level}\n`);
    } else {
      this.enqueueCommand(`INVOKE ${vid} Load.SetLevel 0\n`);
    }
  }

  sendRGBLoadDissolveHSL(vid: string, h: number, s: number, l: number, time = 500): void {
    this.enqueueCommand(`INVOKE ${vid} RGBLoad.DissolveHSL ${h} ${s} ${l * 1000} ${time}\n`);
  }

  sendThermostatGetIndoorTemperature(vid: string): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.GetIndoorTemperature\n`);
  }

  sendThermostatGetOutdoorTemperature(vid: string): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.GetOutdoorTemperature\n`);
  }

  sendThermostatGetHeatPoint(vid: string): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.GetHeatPoint\n`);
  }

  sendThermostatGetCoolPoint(vid: string): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.GetCoolPoint\n`);
  }

  sendThermostatGetMode(vid: string): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.GetMode\n`);
  }

  sendThermostatGetHVACState(vid: string): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.GetHVACState\n`);
  }

  sendThermostatSetHeatPoint(vid: string, milliDegrees: number): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.SetHeatPoint ${milliDegrees}\n`);
  }

  sendThermostatSetCoolPoint(vid: string, milliDegrees: number): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.SetCoolPoint ${milliDegrees}\n`);
  }

  sendThermostatSetMode(vid: string, mode: number): void {
    this.enqueueCommand(`INVOKE ${vid} Thermostat.SetMode ${mode}\n`);
  }

  sendIsInterfaceSupported(vid: string, interfaceId: string): void {
    this.enqueueCommand(`INVOKE ${vid} Object.IsInterfaceSupported ${interfaceId}\n`);
  }

  isInterfaceSupported(
    item: any,
    interfaceName: string
  ): Promise<{ item: any; interface: string; support: boolean }> {
    if (this.interfaces[interfaceName] === undefined) {
      return Promise.resolve({ item, interface: interfaceName, support: false });
    }
    const interfaceId = String(this.interfaces[interfaceName]);
    return new Promise((resolve) => {
      this.once(
        IsInterfaceSupportedEvent(String(item.VID).trim(), interfaceId.trim()),
        (support) => resolve({ item, interface: interfaceName, support: Boolean(support) })
      );
      this.sendIsInterfaceSupported(item.VID, interfaceId);
    });
  }
}
