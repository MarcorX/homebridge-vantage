"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageBlind = void 0;
const vantage_infusion_controller_1 = require("./vantage-infusion-controller");
class VantageBlind {
    constructor(hap, log, name, vid, controller, travelTime = 25) {
        // HomeKit: 0 = closed, 100 = fully open
        this.currentPosition = 0;
        this.targetPosition = 0;
        this.positionState = 2; // 0=DECREASING, 1=INCREASING, 2=STOPPED
        this.moveTimer = null;
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        this.travelTime = travelTime;
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
            const target = value;
            this.log.debug(`Blind ${this.name} set position: ${target} (current: ${this.currentPosition})`);
            this.moveTo(target);
            cb();
        });
        this.windowCoveringService
            .getCharacteristic(Characteristic.PositionState)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.positionState);
        });
    }
    moveTo(target) {
        if (target === this.currentPosition)
            return;
        // Cancel any in-progress move
        if (this.moveTimer) {
            clearTimeout(this.moveTimer);
            this.moveTimer = null;
        }
        const delta = Math.abs(target - this.currentPosition);
        const durationMs = (delta / 100) * this.travelTime * 1000;
        const opening = target > this.currentPosition;
        this.targetPosition = target;
        this.positionState = opening ? 1 : 0; // 1=INCREASING, 0=DECREASING
        this.updateCharacteristics();
        if (opening) {
            this.controller.sendBlindOpen(this.vid);
        }
        else {
            this.controller.sendBlindClose(this.vid);
        }
        // For fully open/close, no stop needed — motor handles it
        if (target === 100 || target === 0) {
            this.log.debug(`Blind ${this.name} moving to ${target}% (full travel, no stop needed)`);
            this.moveTimer = setTimeout(() => {
                this.moveTimer = null;
                this.currentPosition = target;
                this.positionState = 2;
                this.updateCharacteristics();
            }, durationMs + 1000); // +1s buffer for full travel
            return;
        }
        this.log.debug(`Blind ${this.name} moving to ${target}% — stopping in ${(durationMs / 1000).toFixed(1)}s`);
        this.moveTimer = setTimeout(() => {
            this.moveTimer = null;
            this.controller.sendBlindStop(this.vid);
            this.currentPosition = target;
            this.positionState = 2;
            this.updateCharacteristics();
        }, durationMs);
    }
    updateCharacteristics() {
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
    blindPositionChange(position) {
        this.log.debug(`Blind ${this.name} position change from controller: ${position}`);
        // If a timed move is in progress, ignore InFusion status echoes —
        // Somfy RT has no real feedback so InFusion just echoes 0/100 immediately.
        if (this.moveTimer)
            return;
        this.currentPosition = position;
        this.targetPosition = position;
        this.positionState = 2;
        this.updateCharacteristics();
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