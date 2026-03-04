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

export class VantageSwitch implements AccessoryPlugin, VantageLoadObjectInterface {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;

  name: string;

  private switchOn = false;

  private readonly switchService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, vid: string, controller: VantageInfusionController) {
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

  private buildSwitchService(): void {
    this.switchService
      .getCharacteristic(this.hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Switch ${this.name} get state: ${this.switchOn}`);
        cb(HAPStatus.SUCCESS, this.switchOn);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.switchOn = value as boolean;
        this.log.debug(`Switch ${this.name} set state: ${this.switchOn}`);
        this.controller.sendLoadDim(this.vid, this.switchOn ? 100 : 0);
        cb();
      });
  }

  loadStatusChange(value: number): void {
    this.log.debug(`Switch ${this.name} status change: ${value}`);
    this.switchOn = value > 0;
    this.switchService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.switchOn);
  }

  identify(): void {
    this.log.info(`Identify switch: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.switchService];
  }
}
