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
  private readonly travelTime: number; // seconds for full 0→100 travel

  name: string;

  // HomeKit: 0 = closed, 100 = fully open
  private currentPosition = 0;
  private targetPosition = 0;
  private positionState = 2; // 0=DECREASING, 1=INCREASING, 2=STOPPED

  private moveTimer: NodeJS.Timeout | null = null;

  private readonly windowCoveringService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, vid: string, controller: VantageInfusionController, travelTime = 25) {
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
        const target = value as number;
        this.log.debug(`Blind ${this.name} set position: ${target} (current: ${this.currentPosition})`);
        this.moveTo(target);
        cb();
      });

    this.windowCoveringService
      .getCharacteristic(Characteristic.PositionState)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, this.positionState);
      });

    this.windowCoveringService
      .addCharacteristic(Characteristic.ObstructionDetected)
      .on(CharacteristicEventTypes.GET, (cb: CharacteristicGetCallback) => {
        cb(HAPStatus.SUCCESS, false);
      });
  }

  private moveTo(target: number): void {
    if (target === this.currentPosition) return;

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
    } else {
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

  private updateCharacteristics(): void {
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

  blindPositionChange(position: number): void {
    this.log.debug(`Blind ${this.name} position change from controller: ${position}`);
    // If a timed move is in progress, ignore InFusion status echoes —
    // Somfy RT has no real feedback so InFusion just echoes 0/100 immediately.
    if (this.moveTimer) return;
    this.currentPosition = position;
    this.targetPosition = position;
    this.positionState = 2;
    this.updateCharacteristics();
  }

  identify(): void {
    this.log.info(`Identify blind: ${this.name} (VID ${this.vid})`);
  }

  getServices(): Service[] {
    return [this.informationService, this.windowCoveringService];
  }
}
