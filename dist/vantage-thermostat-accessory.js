"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageThermostat = void 0;
const vantage_infusion_controller_1 = require("./vantage-infusion-controller");
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
class VantageThermostat {
    constructor(hap, log, name, vid, controller, fahrenheit = true) {
        // Internal state (all stored in Celsius)
        this.currentTemp = 20;
        this.heatSetpoint = 20;
        this.coolSetpoint = 25;
        this.targetMode = 0 /* VantageMode.Off */;
        this.hvacState = 0 /* VantageHVACState.Idle */;
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
        this.controller.on(vantage_infusion_controller_1.ThermostatIndoorTemperatureChangeEvent, this.onIndoorTempChange.bind(this));
        this.controller.on(vantage_infusion_controller_1.ThermostatHeatSetpointChangeEvent, this.onHeatSetpointChange.bind(this));
        this.controller.on(vantage_infusion_controller_1.ThermostatCoolSetpointChangeEvent, this.onCoolSetpointChange.bind(this));
        this.controller.on(vantage_infusion_controller_1.ThermostatModeChangeEvent, this.onModeChange.bind(this));
        this.controller.on(vantage_infusion_controller_1.ThermostatHVACStateChangeEvent, this.onHVACStateChange.bind(this));
        // Request initial state from controller
        this.controller.sendThermostatGetIndoorTemperature(vid);
        this.controller.sendThermostatGetHeatPoint(vid);
        this.controller.sendThermostatGetCoolPoint(vid);
        this.controller.sendThermostatGetMode(vid);
        this.controller.sendThermostatGetHVACState(vid);
    }
    // ─── Temperature conversion ────────────────────────────────────────────────
    /** Convert from the controller's native unit to Celsius for HomeKit. */
    toCelsius(value) {
        return this.useFahrenheit ? (value - 32) * 5 / 9 : value;
    }
    /** Convert from Celsius (HomeKit) to milli-degrees in the controller's native unit. */
    toControllerMilliDegrees(celsius) {
        const native = this.useFahrenheit ? celsius * 9 / 5 + 32 : celsius;
        return Math.round(native * 1000);
    }
    // ─── HomeKit service setup ─────────────────────────────────────────────────
    buildThermostatService() {
        const { Characteristic } = this.hap;
        // Current temperature (read-only)
        this.thermostatService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.currentTemp);
        });
        // Current heating/cooling state (read-only — driven by the controller)
        this.thermostatService
            .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.hvacState);
        });
        // Target heating/cooling mode (Off/Heat/Cool/Auto)
        this.thermostatService
            .getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.targetMode);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.targetMode = value;
            this.controller.sendThermostatSetMode(this.vid, this.targetMode);
            cb();
        });
        // Target temperature — maps to heat or cool setpoint depending on active mode
        this.thermostatService
            .getCharacteristic(Characteristic.TargetTemperature)
            .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            const target = this.targetMode === 2 /* VantageMode.Cool */
                ? this.coolSetpoint
                : this.heatSetpoint;
            cb(0 /* HAPStatus.SUCCESS */, target);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            const celsius = value;
            if (this.targetMode === 2 /* VantageMode.Cool */) {
                this.coolSetpoint = celsius;
                this.controller.sendThermostatSetCoolPoint(this.vid, this.toControllerMilliDegrees(celsius));
            }
            else {
                this.heatSetpoint = celsius;
                this.controller.sendThermostatSetHeatPoint(this.vid, this.toControllerMilliDegrees(celsius));
            }
            cb();
        });
        // Heating threshold temperature (lower bound for Auto mode)
        this.thermostatService
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.heatSetpoint);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.heatSetpoint = value;
            this.controller.sendThermostatSetHeatPoint(this.vid, this.toControllerMilliDegrees(this.heatSetpoint));
            cb();
        });
        // Cooling threshold temperature (upper bound for Auto mode)
        this.thermostatService
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 10, maxValue: 38, minStep: 0.5 })
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.coolSetpoint);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.coolSetpoint = value;
            this.controller.sendThermostatSetCoolPoint(this.vid, this.toControllerMilliDegrees(this.coolSetpoint));
            cb();
        });
        // Display units (always Celsius in HomeKit internally; this is cosmetic only)
        this.thermostatService
            .getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.useFahrenheit
                ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT
                : Characteristic.TemperatureDisplayUnits.CELSIUS);
        });
    }
    // ─── Controller event handlers ─────────────────────────────────────────────
    onIndoorTempChange(vid, value) {
        if (vid !== this.vid)
            return;
        this.currentTemp = this.toCelsius(value);
        this.log.debug(`Thermostat ${this.name} indoor temp: ${value}° → ${this.currentTemp.toFixed(1)}°C`);
        this.thermostatService
            .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
            .updateValue(this.currentTemp);
    }
    onHeatSetpointChange(vid, value) {
        if (vid !== this.vid)
            return;
        this.heatSetpoint = this.toCelsius(value);
        this.log.debug(`Thermostat ${this.name} heat setpoint: ${value}° → ${this.heatSetpoint.toFixed(1)}°C`);
        this.thermostatService
            .getCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature)
            .updateValue(this.heatSetpoint);
        if (this.targetMode !== 2 /* VantageMode.Cool */) {
            this.thermostatService
                .getCharacteristic(this.hap.Characteristic.TargetTemperature)
                .updateValue(this.heatSetpoint);
        }
    }
    onCoolSetpointChange(vid, value) {
        if (vid !== this.vid)
            return;
        this.coolSetpoint = this.toCelsius(value);
        this.log.debug(`Thermostat ${this.name} cool setpoint: ${value}° → ${this.coolSetpoint.toFixed(1)}°C`);
        this.thermostatService
            .getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature)
            .updateValue(this.coolSetpoint);
        if (this.targetMode === 2 /* VantageMode.Cool */) {
            this.thermostatService
                .getCharacteristic(this.hap.Characteristic.TargetTemperature)
                .updateValue(this.coolSetpoint);
        }
    }
    onModeChange(vid, mode) {
        if (vid !== this.vid)
            return;
        this.targetMode = mode;
        this.log.debug(`Thermostat ${this.name} mode: ${mode}`);
        this.thermostatService
            .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
            .updateValue(this.targetMode);
    }
    onHVACStateChange(vid, state) {
        if (vid !== this.vid)
            return;
        this.hvacState = state;
        this.log.debug(`Thermostat ${this.name} HVAC state: ${state}`);
        this.thermostatService
            .getCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState)
            .updateValue(this.hvacState);
    }
    // ─── AccessoryPlugin ──────────────────────────────────────────────────────
    identify() {
        this.log.info(`Identify thermostat: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.thermostatService];
    }
}
exports.VantageThermostat = VantageThermostat;
//# sourceMappingURL=vantage-thermostat-accessory.js.map