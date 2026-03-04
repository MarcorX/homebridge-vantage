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

import { VantageInfusionController } from "./vantage-infusion-controller";
import { VantageLoadObjectInterface } from "./vantage-light-accessory";

export class VantageOutlet implements AccessoryPlugin, VantageLoadObjectInterface {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;

  name: string;

  private outletOn = false;

  private readonly outletService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, vid: string, controller: VantageInfusionController) {
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

  private buildOutletService(): void {
    this.outletService
      .getCharacteristic(this.hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Outlet ${this.name} get state: ${this.outletOn}`);
        cb(HAPStatus.SUCCESS, this.outletOn);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.outletOn = value as boolean;
        this.log.debug(`Outlet ${this.name} set state: ${this.outletOn}`);
        this.controller.sendLoadDim(this.vid, this.outletOn ? 100 : 0);
        cb();
      });

    // OutletInUse is required by HAP; report it as always in-use when on
    this.outletService
      .getCharacteristic(this.hap.Characteristic.OutletInUse)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.outletOn);
      });
  }

  loadStatusChange(value: number): void {
    this.log.debug(`Outlet ${this.name} status change: ${value}`);
    this.outletOn = value > 0;
    this.outletService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.outletOn);
    this.outletService.getCharacteristic(this.hap.Characteristic.OutletInUse).updateValue(this.outletOn);
  }

  identify(): void {
    this.log.info(`Identify outlet: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.outletService];
  }
}
