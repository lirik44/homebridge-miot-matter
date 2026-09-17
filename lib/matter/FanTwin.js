const MatterTwin = require('./MatterTwin.js');


/** The fan modes Matter counts in. */
const FAN_MODE = { OFF: 0, LOW: 1, MEDIUM: 2, HIGH: 3, ON: 4, AUTO: 5 };

/** Off, low, medium, high - the sequence a controller offers when it draws the fan. */
const FAN_MODE_SEQUENCE_OFF_LOW_MED_HIGH = 0;


/**
 * Anything that moves air, as a Matter controller sees it: a fan, an air purifier, a humidifier.
 *
 * Matter has no device type for an air purifier that controllers render, and a purifier is a fan
 * with a filter in front of it - so that is what it is published as, and the speed a controller
 * sets is the speed the device runs at.
 */
class FanTwin extends MatterTwin {

  supported() {
    return typeof this.device.isOn === 'function';
  }

  deviceType() {
    return this.api.matter.deviceTypes.Fan;
  }

  state() {
    const on = this.device.isOn() === true;
    const percent = on ? this._speed() : 0;

    return {
      fanControl: {
        fanMode: this._modeFor(on, percent),
        fanModeSequence: FAN_MODE_SEQUENCE_OFF_LOW_MED_HIGH,
        percentSetting: percent,
        percentCurrent: percent,
      },
    };
  }

  handlers() {
    return {
      fanControl: {
        fanModeChange: async (request) => {
          const fanMode = request && request.fanMode;
          if (this.isOwnUpdate('fanControl', 'fanMode', fanMode)) {
            return;
          }

          if (fanMode === FAN_MODE.OFF) {
            await this.device.setOn(false);
            return;
          }

          // A controller that asks for a named speed rather than a percentage is asking for the
          // device to be running; the percentage that comes with it arrives separately.
          if (this.device.isOn() !== true) {
            await this.device.setOn(true);
          }
        },

        percentSettingChange: async (request) => {
          const percent = request && request.percentSetting;
          if (percent === null || percent === undefined || this.isOwnUpdate('fanControl', 'percentSetting', percent)) {
            return;
          }

          if (percent === 0) {
            await this.device.setOn(false);
            return;
          }

          if (this.device.isOn() !== true) {
            await this.device.setOn(true);
          }
          if (this._canSetSpeed()) {
            await this.device.setRotationSpeedPercentage(percent);
          }
        },
      },
    };
  }


  /*----------========== HELPERS ==========----------*/

  _canSetSpeed() {
    return typeof this.device.supportsRotationSpeed === 'function'
      && this.device.supportsRotationSpeed()
      && typeof this.device.setRotationSpeedPercentage === 'function';
  }

  _speed() {
    if (!this._canSetSpeed()) {
      // A device with one speed is either running or it is not.
      return 100;
    }

    const percent = Math.round(Number(this.device.getRotationSpeedPercentage()) || 0);
    return Math.max(0, Math.min(100, percent));
  }

  _modeFor(on, percent) {
    if (!on || percent === 0) {
      return FAN_MODE.OFF;
    }
    if (percent <= 33) {
      return FAN_MODE.LOW;
    }
    if (percent <= 66) {
      return FAN_MODE.MEDIUM;
    }
    return FAN_MODE.HIGH;
  }

}


module.exports = FanTwin;
module.exports.FAN_MODE = FAN_MODE;
