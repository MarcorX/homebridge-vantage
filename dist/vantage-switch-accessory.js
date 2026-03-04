"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageSwitch = void 0;
class VantageSwitch {
    constructor(hap, log, name, vid, controller) {
        this.switchOn = false;
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        this.switchService = new hap.Service.Switch(name);
        this.buildSwitchService();
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
            .setCharacteristic(hap.Characteristic.Model, "InFusion Switch")
            .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);
        this.controller.sendGetLoadStatus(this.vid);
    }
    buildSwitchService() {
        this.switchService
            .getCharacteristic(this.hap.Characteristic.On)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Switch ${this.name} get state: ${this.switchOn}`);
            cb(0 /* HAPStatus.SUCCESS */, this.switchOn);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.switchOn = value;
            this.log.debug(`Switch ${this.name} set state: ${this.switchOn}`);
            this.controller.sendLoadDim(this.vid, this.switchOn ? 100 : 0);
            cb();
        });
    }
    loadStatusChange(value) {
        this.log.debug(`Switch ${this.name} status change: ${value}`);
        this.switchOn = value > 0;
        this.switchService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.switchOn);
    }
    identify() {
        this.log.info(`Identify switch: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.switchService];
    }
}
exports.VantageSwitch = VantageSwitch;
//# sourceMappingURL=vantage-switch-accessory.js.map