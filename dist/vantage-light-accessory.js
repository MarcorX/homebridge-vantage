"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageLight = exports.isVantageLoadObject = void 0;
function isVantageLoadObject(arg) {
    return typeof arg.loadStatusChange === "function";
}
exports.isVantageLoadObject = isVantageLoadObject;
/** Non-dimmable relay light — on/off only. */
class VantageLight {
    constructor(hap, log, name, vid, controller) {
        this.lightOn = false;
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        this.lightService = new hap.Service.Lightbulb(name);
        this.buildLightService();
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
            .setCharacteristic(hap.Characteristic.Model, "InFusion Relay Light")
            .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);
        this.controller.sendGetLoadStatus(this.vid);
    }
    buildLightService() {
        this.lightService
            .getCharacteristic(this.hap.Characteristic.On)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Light ${this.name} get state: ${this.lightOn}`);
            cb(0 /* HAPStatus.SUCCESS */, this.lightOn);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.lightOn = value;
            this.log.debug(`Light ${this.name} set state: ${this.lightOn}`);
            this.controller.sendLoadDim(this.vid, this.lightOn ? 100 : 0);
            cb();
        });
    }
    loadStatusChange(value) {
        this.log.debug(`Light ${this.name} status change: ${value}`);
        this.lightOn = value > 0;
        this.lightService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.lightOn);
    }
    identify() {
        this.log.info(`Identify light: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.lightService];
    }
}
exports.VantageLight = VantageLight;
//# sourceMappingURL=vantage-light-accessory.js.map