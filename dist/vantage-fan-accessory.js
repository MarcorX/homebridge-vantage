"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageFan = void 0;
class VantageFan {
    constructor(hap, log, name, vid, controller) {
        this.active = false;
        this.rotationSpeed = 100; // 0–100
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        // Fanv2 supports Active + RotationSpeed (proper HAP fan service)
        this.fanService = new hap.Service.Fanv2(name);
        this.buildFanService();
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
            .setCharacteristic(hap.Characteristic.Model, "InFusion Fan")
            .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);
        this.controller.sendGetLoadStatus(this.vid);
    }
    buildFanService() {
        const { Characteristic } = this.hap;
        // Active (0 = off, 1 = on)
        this.fanService
            .getCharacteristic(Characteristic.Active)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Fan ${this.name} get active: ${this.active}`);
            cb(0 /* HAPStatus.SUCCESS */, this.active ? 1 : 0);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.active = value === 1 || value === true;
            this.log.debug(`Fan ${this.name} set active: ${this.active}`);
            this.controller.sendLoadDim(this.vid, this.active ? this.rotationSpeed : 0);
            cb();
        });
        // Rotation speed (0–100 maps directly to Vantage load level)
        this.fanService
            .getCharacteristic(Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Fan ${this.name} get speed: ${this.rotationSpeed}`);
            cb(0 /* HAPStatus.SUCCESS */, this.rotationSpeed);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.rotationSpeed = value;
            this.active = this.rotationSpeed > 0;
            this.log.debug(`Fan ${this.name} set speed: ${this.rotationSpeed}`);
            this.controller.sendLoadDim(this.vid, this.rotationSpeed);
            // Keep Active characteristic in sync
            this.fanService
                .getCharacteristic(this.hap.Characteristic.Active)
                .updateValue(this.active ? 1 : 0);
            cb();
        });
    }
    loadStatusChange(value) {
        this.log.debug(`Fan ${this.name} status change: ${value}`);
        this.rotationSpeed = value;
        this.active = value > 0;
        this.fanService.getCharacteristic(this.hap.Characteristic.Active).updateValue(this.active ? 1 : 0);
        this.fanService.getCharacteristic(this.hap.Characteristic.RotationSpeed).updateValue(this.rotationSpeed);
    }
    identify() {
        this.log.info(`Identify fan: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.fanService];
    }
}
exports.VantageFan = VantageFan;
//# sourceMappingURL=vantage-fan-accessory.js.map