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

export interface VantageLoadObjectInterface {
  loadStatusChange(value: number): void;
}

export function isVantageLoadObject(arg: any): arg is VantageLoadObjectInterface {
  return typeof arg.loadStatusChange === "function";
}

/** Non-dimmable relay light — on/off only. */
export class VantageLight implements AccessoryPlugin, VantageLoadObjectInterface {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;

  name: string;

  private lightOn = false;

  private readonly lightService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, vid: string, controller: VantageInfusionController) {
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

  private buildLightService(): void {
    this.lightService
      .getCharacteristic(this.hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Light ${this.name} get state: ${this.lightOn}`);
        cb(HAPStatus.SUCCESS, this.lightOn);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.lightOn = value as boolean;
        this.log.debug(`Light ${this.name} set state: ${this.lightOn}`);
        this.controller.sendLoadDim(this.vid, this.lightOn ? 100 : 0);
        cb();
      });
  }

  loadStatusChange(value: number): void {
    this.log.debug(`Light ${this.name} status change: ${value}`);
    this.lightOn = value > 0;
    this.lightService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.lightOn);
  }

  identify(): void {
    this.log.info(`Identify light: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.lightService];
  }
}
