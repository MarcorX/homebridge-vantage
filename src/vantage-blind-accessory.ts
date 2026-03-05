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

import { VantageInfusionController, BlindPositionChangeEvent } from "./vantage-infusion-controller";

export class VantageBlind implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly hap: HAP;
  private readonly vid: string;
  private readonly controller: VantageInfusionController;

  name: string;

  // HomeKit: 0 = closed, 100 = fully open (matches Vantage)
  private currentPosition = 0;
  private targetPosition = 0;
  private positionState = 2; // 2 = STOPPED

  private readonly windowCoveringService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, vid: string, controller: VantageInfusionController) {
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

    this.controller.on(BlindPositionChangeEvent, (vid: string, position: number) => {
      if (vid === this.vid) this.blindPositionChange(position);
    });

    this.controller.sendGetBlindPosition(this.vid);
  }

  private buildWindowCoveringService(): void {
    const { Characteristic } = this.hap;

    this.windowCoveringService
      .getCharacteristic(Characteristic.CurrentPosition)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.currentPosition);
      });

    this.windowCoveringService
      .getCharacteristic(Characteristic.TargetPosition)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.targetPosition);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, cb: CharacteristicSetCallback) => {
        this.targetPosition = value as number;
        this.log.debug(`Blind ${this.name} set position: ${this.targetPosition}`);

        if (this.targetPosition === 100) {
          this.controller.sendBlindOpen(this.vid);
        } else if (this.targetPosition === 0) {
          this.controller.sendBlindClose(this.vid);
        } else {
          this.controller.sendBlindSetPosition(this.vid, this.targetPosition);
        }
        cb();
      });

    this.windowCoveringService
      .getCharacteristic(Characteristic.PositionState)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.positionState);
      });
  }

  blindPositionChange(position: number): void {
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

  identify(): void {
    this.log.info(`Identify blind: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.windowCoveringService];
  }
}
