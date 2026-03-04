"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VantageOutlet = void 0;
class VantageOutlet {
    constructor(hap, log, name, vid, controller) {
        this.outletOn = false;
        this.log = log;
        this.hap = hap;
        this.name = name;
        this.vid = vid;
        this.controller = controller;
        this.outletService = new hap.Service.Outlet(name);
        this.buildOutletService();
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Vantage Controls")
            .setCharacteristic(hap.Characteristic.Model, "InFusion Outlet")
            .setCharacteristic(hap.Characteristic.SerialNumber, `VID ${this.vid}`);
        this.controller.sendGetLoadStatus(this.vid);
    }
    buildOutletService() {
        this.outletService
            .getCharacteristic(this.hap.Characteristic.On)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            this.log.debug(`Outlet ${this.name} get state: ${this.outletOn}`);
            cb(0 /* HAPStatus.SUCCESS */, this.outletOn);
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, cb) => {
            this.outletOn = value;
            this.log.debug(`Outlet ${this.name} set state: ${this.outletOn}`);
            this.controller.sendLoadDim(this.vid, this.outletOn ? 100 : 0);
            cb();
        });
        // OutletInUse is required by HAP; report it as always in-use when on
        this.outletService
            .getCharacteristic(this.hap.Characteristic.OutletInUse)
            .on("get" /* CharacteristicEventTypes.GET */, (cb) => {
            cb(0 /* HAPStatus.SUCCESS */, this.outletOn);
        });
    }
    loadStatusChange(value) {
        this.log.debug(`Outlet ${this.name} status change: ${value}`);
        this.outletOn = value > 0;
        this.outletService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.outletOn);
        this.outletService.getCharacteristic(this.hap.Characteristic.OutletInUse).updateValue(this.outletOn);
    }
    identify() {
        this.log.info(`Identify outlet: ${this.name} (VID ${this.vid})`);
    }
    getServices() {
        return [this.informationService, this.outletService];
    }
}
exports.VantageOutlet = VantageOutlet;
//# sourceMappingURL=vantage-outlet-accessory.js.map