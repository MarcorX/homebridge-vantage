"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageDimmer = void 0;
/** Dimmable (and optionally RGB) light. */
class VantageDimmer {
    constructor(hap, log, name, vid, controller, loadType = "dimmer") {
        this.lightOn = false;
        this.brightness = 100; // 0–100
        this.hue = 0;
        this.saturation = 0;
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        this.loadType = loadType;
        this.lightService = new hap.Service.Lightbulb(name);
        this.buildLightService();
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
            .setCharacteristic(hap.Characteristic.Model, "InFusion Dimmer")
            .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);
        this.controller.sendGetLoadStatus(this.vid);
    }
    buildLightService() {
        const { Characteristic } = this.hap;
        // On/Off
        this.lightService
            .getCharacteristic(Characteristic.On)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Dimmer ${this.name} get on: ${this.lightOn}`);
            cb(0 /* HAPStatus.SUCCESS */, this.lightOn);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.lightOn = value;
            this.log.debug(`Dimmer ${this.name} set on: ${this.lightOn}`);
            this.controller.sendLoadDim(this.vid, this.lightOn ? this.brightness : 0, 2.5);
            cb();
        });
        // Brightness (dimmer & rgb)
        this.lightService
            .getCharacteristic(Characteristic.Brightness)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Dimmer ${this.name} get brightness: ${this.brightness}`);
            cb(0 /* HAPStatus.SUCCESS */, this.brightness);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.brightness = value;
            this.lightOn = this.brightness > 0;
            this.log.debug(`Dimmer ${this.name} set brightness: ${this.brightness}`);
            this.controller.sendLoadDim(this.vid, this.brightness);
            cb();
        });
        // Hue & Saturation (rgb only)
        if (this.loadType === "rgb") {
            this.lightService
                .getCharacteristic(Characteristic.Hue)
                .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
                cb(0 /* HAPStatus.SUCCESS */, this.hue);
            })
                .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
                this.hue = value;
                this.lightOn = true;
                this.controller.sendRGBLoadDissolveHSL(this.vid, this.hue, this.saturation, this.brightness);
                cb();
            });
            this.lightService
                .getCharacteristic(Characteristic.Saturation)
                .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
                cb(0 /* HAPStatus.SUCCESS */, this.saturation);
            })
                .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
                this.saturation = value;
                this.lightOn = true;
                this.controller.sendRGBLoadDissolveHSL(this.vid, this.hue, this.saturation, this.brightness);
                cb();
            });
        }
    }
    loadStatusChange(value) {
        this.log.debug(`Dimmer ${this.name} status change: ${value}`);
        this.brightness = value;
        this.lightOn = value > 0;
        this.lightService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.lightOn);
        this.lightService.getCharacteristic(this.hap.Characteristic.Brightness).updateValue(this.brightness);
    }
    identify() {
        this.log.info(`Identify dimmer: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.lightService];
    }
}
exports.VantageDimmer = VantageDimmer;
//# sourceMappingURL=vantage-dimmer-accessory.js.map