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

export class VantageFan implements AccessoryPlugin, VantageLoadObjectInterface {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;

  name: string;

  private active = false;
  private rotationSpeed = 100; // 0–100

  private readonly fanService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, vid: string, controller: VantageInfusionController) {
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

  private buildFanService(): void {
    const { Characteristic } = this.hap;

    // Active (0 = off, 1 = on)
    this.fanService
      .getCharacteristic(Characteristic.Active)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Fan ${this.name} get active: ${this.active}`);
        cb(HAPStatus.SUCCESS, this.active ? 1 : 0);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.active = value === 1 || value === true;
        this.log.debug(`Fan ${this.name} set active: ${this.active}`);
        this.controller.sendLoadDim(this.vid, this.active ? this.rotationSpeed : 0);
        cb();
      });

    // Rotation speed (0–100 maps directly to Vantage load level)
    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Fan ${this.name} get speed: ${this.rotationSpeed}`);
        cb(HAPStatus.SUCCESS, this.rotationSpeed);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.rotationSpeed = value as number;
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

  loadStatusChange(value: number): void {
    this.log.debug(`Fan ${this.name} status change: ${value}`);
    this.rotationSpeed = value;
    this.active = value > 0;

    this.fanService.getCharacteristic(this.hap.Characteristic.Active).updateValue(this.active ? 1 : 0);
    this.fanService.getCharacteristic(this.hap.Characteristic.RotationSpeed).updateValue(this.rotationSpeed);
  }

  identify(): void {
    this.log.info(`Identify fan: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.fanService];
  }
}
