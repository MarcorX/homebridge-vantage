import {
  AccessoryPlugin,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
  CharacteristicEventTypes,
  HAPStatus,
} from "homebridge";

import {
  VantageInfusionController,
  ThermostatIndoorTemperatureChangeEvent,
  ThermostatHeatSetpointChangeEvent,
  ThermostatCoolSetpointChangeEvent,
  ThermostatModeChangeEvent,
  ThermostatHVACStateChangeEvent,
} from "./vantage-infusion-controller";

/**
 * Vantage thermostat mode values (as returned by the InFusion controller).
 */
const enum VantageMode {
  Off  = 0,
  Heat = 1,
  Cool = 2,
  Auto = 3,
}

/**
 * Vantage HVAC operating state values.
 */
const enum VantageHVACState {
  Idle    = 0,
  Heating = 1,
  Cooling = 2,
}

/**
 * Full HomeKit thermostat for a Vantage InFusion HVAC object.
 *
 * Supports:
 *  - Current temperature (indoor sensor)
 *  - Target temperature (heat or cool setpoint depending on mode)
 *  - Heating/cooling threshold temperatures (for Auto mode)
 *  - Target heating/cooling mode (Off / Heat / Cool / Auto)
 *  - Current heating/cooling state (Idle / Heating / Cooling)
 *
 * Temperature unit: Vantage reports temperatures in Fahrenheit.
 * HomeKit always operates in Celsius internally.  Set `fahrenheit: true`
 * in the platform config (the default) to enable automatic conversion.
 */
export class VantageThermostat implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;
  private readonly useFahrenheit: boolean;

  name: string;

  // Internal state (all stored in Celsius)
  private currentTemp = 20;
  private heatSetpoint = 20;
  private coolSetpoint = 25;
  private targetMode: number = VantageMode.Off;
  private hvacState: number = VantageHVACState.Idle;

  private readonly thermostatService: Service;
  private readonly informationService: Service;

  constructor(
    hap: HAP,
    log: Logging,
    name: string,
    vid: string,
    controller: VantageInfusionController,
    fahrenheit = true
  ) {
    this.log = log;
    this.hap = hap;
    this.name = name;
    this.vid = vid;
    this.controller = controller;
    this.useFahrenheit = fahrenheit;

    this.thermostatService = new hap.Service.Thermostat(name);
    this.buildThermostatService();

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
      .setCharacteristic(hap.Characteristic.Model, "InFusion Thermostat")
      .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);

    // Subscribe to controller events
    this.controller.on(ThermostatIndoorTemperatureChangeEvent, this.onIndoorTempChange.bind(this));
    this.controller.on(ThermostatHeatSetpointChangeEvent, this.onHeatSetpointChange.bind(this));
    this.controller.on(ThermostatCoolSetpointChangeEvent, this.onCoolSetpointChange.bind(this));
    this.controller.on(ThermostatModeChangeEvent, this.onModeChange.bind(this));
    this.controller.on(ThermostatHVACStateChangeEvent, this.onHVACStateChange.bind(this));

    // Request initial state from controller
    this.controller.sendThermostatGetIndoorTemperature(vid);
    this.controller.sendThermostatGetHeatPoint(vid);
    this.controller.sendThermostatGetCoolPoint(vid);
    this.controller.sendThermostatGetMode(vid);
    this.controller.sendThermostatGetHVACState(vid);
  }

  // ─── Temperature conversion ────────────────────────────────────────────────

  /** Convert from the controller's native unit to Celsius for HomeKit. */
  private toCelsius(value: number): number {
    return this.useFahrenheit ? (value - 32) * 5 / 9 : value;
  }

  /** Convert from Celsius (HomeKit) to milli-degrees in the controller's native unit. */
  private toControllerMilliDegrees(celsius: number): number {
    const native = this.useFahrenheit ? celsius * 9 / 5 + 32 : celsius;
    return Math.round(native * 1000);
  }

  // ─── HomeKit service setup ─────────────────────────────────────────────────

  private buildThermostatService(): void {
    const { Characteristic } = this.hap;

    // Current temperature (read-only)
    this.thermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.currentTemp);
      });

    // Current heating/cooling state (read-only — driven by the controller)
    this.thermostatService
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.hvacState);
      });

    // Target heating/cooling mode (Off/Heat/Cool/Auto)
    this.thermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.targetMode);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.targetMode = value as number;
        this.controller.sendThermostatSetMode(this.vid, this.targetMode);
        cb();
      });

    // Target temperature — maps to heat or cool setpoint depending on active mode
    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        const target = this.targetMode === VantageMode.Cool
          ? this.coolSetpoint
          : this.heatSetpoint;
        cb(HAPStatus.SUCCESS, target);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        const celsius = value as number;
        if (this.targetMode === VantageMode.Cool) {
          this.coolSetpoint = celsius;
          this.controller.sendThermostatSetCoolPoint(this.vid, this.toControllerMilliDegrees(celsius));
        } else {
          this.heatSetpoint = celsius;
          this.controller.sendThermostatSetHeatPoint(this.vid, this.toControllerMilliDegrees(celsius));
        }
        cb();
      });

    // Heating threshold temperature (lower bound for Auto mode)
    this.thermostatService
      .getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.heatSetpoint);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.heatSetpoint = value as number;
        this.controller.sendThermostatSetHeatPoint(this.vid, this.toControllerMilliDegrees(this.heatSetpoint));
        cb();
      });

    // Cooling threshold temperature (upper bound for Auto mode)
    this.thermostatService
      .getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.coolSetpoint);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.coolSetpoint = value as number;
        this.controller.sendThermostatSetCoolPoint(this.vid, this.toControllerMilliDegrees(this.coolSetpoint));
        cb();
      });

    // Display units (always Celsius in HomeKit internally; this is cosmetic only)
    this.thermostatService
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS,
          this.useFahrenheit
            ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT
            : Characteristic.TemperatureDisplayUnits.CELSIUS
        );
      });
  }

  // ─── Controller event handlers ─────────────────────────────────────────────

  private onIndoorTempChange(vid: string, value: number): void {
    if (vid !== this.vid) return;
    this.currentTemp = this.toCelsius(value);
    this.log.debug(`Thermostat ${this.name} indoor temp: ${value}° → ${this.currentTemp.toFixed(1)}°C`);
    this.thermostatService
      .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
      .updateValue(this.currentTemp);
  }

  private onHeatSetpointChange(vid: string, value: number): void {
    if (vid !== this.vid) return;
    this.heatSetpoint = this.toCelsius(value);
    this.log.debug(`Thermostat ${this.name} heat setpoint: ${value}° → ${this.heatSetpoint.toFixed(1)}°C`);
    this.thermostatService
      .getCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature)
      .updateValue(this.heatSetpoint);
    if (this.targetMode !== VantageMode.Cool) {
      this.thermostatService
        .getCharacteristic(this.hap.Characteristic.TargetTemperature)
        .updateValue(this.heatSetpoint);
    }
  }

  private onCoolSetpointChange(vid: string, value: number): void {
    if (vid !== this.vid) return;
    this.coolSetpoint = this.toCelsius(value);
    this.log.debug(`Thermostat ${this.name} cool setpoint: ${value}° → ${this.coolSetpoint.toFixed(1)}°C`);
    this.thermostatService
      .getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature)
      .updateValue(this.coolSetpoint);
    if (this.targetMode === VantageMode.Cool) {
      this.thermostatService
        .getCharacteristic(this.hap.Characteristic.TargetTemperature)
        .updateValue(this.coolSetpoint);
    }
  }

  private onModeChange(vid: string, mode: number): void {
    if (vid !== this.vid) return;
    this.targetMode = mode;
    this.log.debug(`Thermostat ${this.name} mode: ${mode}`);
    this.thermostatService
      .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
      .updateValue(this.targetMode);
  }

  private onHVACStateChange(vid: string, state: number): void {
    if (vid !== this.vid) return;
    this.hvacState = state;
    this.log.debug(`Thermostat ${this.name} HVAC state: ${state}`);
    this.thermostatService
      .getCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState)
      .updateValue(this.hvacState);
  }

  // ─── AccessoryPlugin ──────────────────────────────────────────────────────

  identify(): void {
    this.log.info(`Identify thermostat: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.thermostatService];
  }
}
