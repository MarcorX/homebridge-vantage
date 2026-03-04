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

export type DimmerLoadType = "dimmer" | "rgb";

/** Dimmable (and optionally RGB) light. */
export class VantageDimmer implements AccessoryPlugin, VantageLoadObjectInterface {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;
  private readonly loadType: DimmerLoadType;

  name: string;

  private lightOn = false;
  private brightness = 100; // 0–100
  private hue = 0;
  private saturation = 0;

  private readonly lightService: Service;
  private readonly informationService: Service;

  constructor(
    hap: HAP,
    log: Logging,
    name: string,
    vid: string,
    controller: VantageInfusionController,
    loadType: DimmerLoadType = "dimmer"
  ) {
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

  private buildLightService(): void {
    const { Characteristic } = this.hap;

    // On/Off
    this.lightService
      .getCharacteristic(Characteristic.On)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Dimmer ${this.name} get on: ${this.lightOn}`);
        cb(HAPStatus.SUCCESS, this.lightOn);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.lightOn = value as boolean;
        this.log.debug(`Dimmer ${this.name} set on: ${this.lightOn}`);
        this.controller.sendLoadDim(this.vid, this.lightOn ? this.brightness : 0, 2.5);
        cb();
      });

    // Brightness (dimmer & rgb)
    this.lightService
      .getCharacteristic(Characteristic.Brightness)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        this.log.debug(`Dimmer ${this.name} get brightness: ${this.brightness}`);
        cb(HAPStatus.SUCCESS, this.brightness);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.brightness = value as number;
        this.lightOn = this.brightness > 0;
        this.log.debug(`Dimmer ${this.name} set brightness: ${this.brightness}`);
        this.controller.sendLoadDim(this.vid, this.brightness);
        cb();
      });

    // Hue & Saturation (rgb only)
    if (this.loadType === "rgb") {
      this.lightService
        .getCharacteristic(Characteristic.Hue)
        .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
          cb(HAPStatus.SUCCESS, this.hue);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
          this.hue = value as number;
          this.lightOn = true;
          this.controller.sendRGBLoadDissolveHSL(this.vid, this.hue, this.saturation, this.brightness);
          cb();
        });

      this.lightService
        .getCharacteristic(Characteristic.Saturation)
        .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
          cb(HAPStatus.SUCCESS, this.saturation);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
          this.saturation = value as number;
          this.lightOn = true;
          this.controller.sendRGBLoadDissolveHSL(this.vid, this.hue, this.saturation, this.brightness);
          cb();
        });
    }
  }

  loadStatusChange(value: number): void {
    this.log.debug(`Dimmer ${this.name} status change: ${value}`);
    this.brightness = value;
    this.lightOn = value > 0;

    this.lightService.getCharacteristic(this.hap.Characteristic.On).updateValue(this.lightOn);
    this.lightService.getCharacteristic(this.hap.Characteristic.Brightness).updateValue(this.brightness);
  }

  identify(): void {
    this.log.info(`Identify dimmer: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.lightService];
  }
}
