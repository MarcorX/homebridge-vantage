"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageBlind = void 0;
const vantage_infusion_controller_1 = require("./vantage-infusion-controller");
class VantageBlind {
    constructor(hap, log, name, vid, controller) {
        // HomeKit: 0 = closed, 100 = fully open (matches Vantage)
        this.currentPosition = 0;
        this.targetPosition = 0;
        this.positionState = 2; // 2 = STOPPED
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        this.windowCoveringService = new hap.Service.WindowCovering(name);
        this.buildWindowCoveringService();
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
            .setCharacteristic(hap.Characteristic.Model, "InFusion Blind")
            .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);
        this.controller.on(vantage_infusion_controller_1.BlindPositionChangeEvent, (vid, position) => {
            if (vid === this.vid)
                this.blindPositionChange(position);
        });
        this.controller.sendGetBlindPosition(this.vid);
    }
    buildWindowCoveringService() {
        const { Characteristic } = this.hap;
        this.windowCoveringService
            .getCharacteristic(Characteristic.CurrentPosition)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.currentPosition);
        });
        this.windowCoveringService
            .getCharacteristic(Characteristic.TargetPosition)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.targetPosition);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.targetPosition = value;
            this.log.debug(`Blind ${this.name} set position: ${this.targetPosition}`);
            if (this.targetPosition === 100) {
                this.controller.sendBlindOpen(this.vid);
            }
            else if (this.targetPosition === 0) {
                this.controller.sendBlindClose(this.vid);
            }
            else {
                this.controller.sendBlindSetPosition(this.vid, this.targetPosition);
            }
            cb();
        });
        this.windowCoveringService
            .getCharacteristic(Characteristic.PositionState)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.positionState);
        });
    }
    blindPositionChange(position) {
        this.log.debug(`Blind ${this.name} position change: ${position}`);
        this.currentPosition = position;
        this.targetPosition = position;
        this.positionState = 2; // STOPPED
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.CurrentPosition)
            .updateValue(this.currentPosition);
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.TargetPosition)
            .updateValue(this.targetPosition);
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.PositionState)
            .updateValue(this.positionState);
    }
    identify() {
        this.log.info(`Identify blind: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.windowCoveringService];
    }
}
exports.VantageBlind = VantageBlind;
//# sourceMappingURL=vantage-blind-accessory.js.map