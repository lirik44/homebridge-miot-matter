const Events = require('../constants/Events.js');


/** How long after reporting a value a command carrying it is taken for an echo of the report. */
const ECHO_WINDOW_MS = 5000;

/** The Matter level scale, which runs 1..254 where this plugin works in percent. */
const MATTER_LEVEL_MAX = 254;

/** What the Matter spec allows for a bridged device's name. A longer one is refused outright. */
const NAME_MAX = 32;


/**
 * One device, published over Matter alongside HomeKit rather than instead of it.
 *
 * The two ecosystems ask for state in opposite ways: HomeKit reads a characteristic whenever it
 * wants one, while a Matter controller keeps its own copy and only learns of a change when the
 * node reports it. So a twin does two things - send what a controller asks for to the same device
 * object HomeKit drives, and report every change back, whoever made it.
 *
 * The one trap is that reporting a value can reach these handlers as though a controller had
 * commanded it. Acted on, the two halves then take turns telling each other the value they were
 * each told a moment ago, and the device flickers. Hence `isOwnUpdate`.
 */
class MatterTwin {

  /**
   * @param {object} device The device object, the same one the HomeKit accessory drives.
   * @param {object} config The device's configuration.
   * @param {object} api The Homebridge API.
   * @param {object} logger Where to say what happened.
   */
  constructor(device, config, api, logger) {
    this.device = device;
    this.config = config || {};
    this.api = api;
    this.logger = logger;

    this.pushed = {};
    this.pushedAt = {};
    this.uuid = null;
  }


  /*----------========== TO IMPLEMENT ==========----------*/

  /** @returns {boolean} Whether this device has anything to show over Matter. */
  supported() {
    return false;
  }

  /** @returns {object} The Matter device type to publish it as. */
  deviceType() {
    return this.api.matter.deviceTypes.OnOffOutlet;
  }

  /** @returns {object} The cluster state as it stands right now. */
  state() {
    return {};
  }

  /** @returns {object} The handlers a controller's commands arrive at. */
  handlers() {
    return {};
  }


  /*----------========== PUBLIC ==========----------*/

  /**
   * @param {string} uuid The accessory UUID to publish under.
   * @param {string} name The name to show in the controller app.
   * @returns {object} The accessory descriptor Homebridge registers.
   */
  descriptor(uuid, name) {
    this.uuid = uuid;
    this.name = String(name).slice(0, NAME_MAX);

    const state = this.state();
    // What was published is what a command carrying the same value is measured against.
    Object.keys(state).forEach(cluster => this._remember(cluster, state[cluster]));

    return {
      UUID: uuid,
      displayName: this.name,
      deviceType: this.deviceType(),
      manufacturer: 'Xiaomi',
      model: this.device.getDeviceName ? this.device.getDeviceName() : 'MIoT device',
      serialNumber: this._serialNumber(),
      clusters: state,
      handlers: this.handlers(),
      context: { deviceId: this._deviceId(), twin: this.constructor.name },
    };
  }

  /**
   * Listens to the device, so a change made anywhere - HomeKit, the Mi Home app, a button on the
   * device itself - reaches the Matter controllers.
   *
   * @returns {void}
   */
  follow() {
    const miotDevice = this.device.getMiotDevice ? this.device.getMiotDevice() : null;
    if (!miotDevice || typeof miotDevice.on !== 'function') {
      return;
    }

    miotDevice.on(Events.MIOT_DEVICE_ALL_PROPERTIES_UPDATED, () => this.report());
    miotDevice.on(Events.MIOT_DEVICE_PROPERTY_VALUE_SET, () => this.report());
  }

  /**
   * Reports whatever has changed since the last time.
   *
   * @returns {void}
   */
  report() {
    if (!this.uuid || !this.api.matter || typeof this.api.matter.updateAccessoryState !== 'function') {
      return;
    }

    const state = this.state();
    Object.keys(state).forEach((cluster) => {
      const changed = this._changedAttributes(cluster, state[cluster]);
      if (Object.keys(changed).length === 0) {
        return;
      }

      this._remember(cluster, state[cluster]);
      Promise.resolve(this.api.matter.updateAccessoryState(this.uuid, cluster, changed))
        .catch(err => this.logger.debug(`Could not report ${cluster} over Matter: ${err.message || err}`));
      this.logger.debug(`Matter: ${cluster} = ${JSON.stringify(changed)}`);
    });
  }

  /**
   * @param {string} cluster The cluster a command landed on.
   * @param {string} key The attribute it carries.
   * @param {*} value What it asks for.
   * @returns {boolean} Whether this is the value this plugin reported a moment ago, rather than
   *   something a person did.
   */
  isOwnUpdate(cluster, key, value) {
    const pushed = this.pushed[cluster];
    const at = this.pushedAt[cluster] || 0;

    if (!pushed || !(key in pushed) || pushed[key] !== value || Date.now() - at > ECHO_WINDOW_MS) {
      return false;
    }

    this.logger.debug(`Matter: ignoring ${cluster}.${key}=${value}, it is the value this plugin just reported`);
    return true;
  }


  /*----------========== SCALES ==========----------*/

  /**
   * @param {number} percent 0..100.
   * @returns {number} 1..254. Level 0 means "off" in Matter, so the dimmest lit value is 1.
   */
  toMatterLevel(percent) {
    const level = Math.round((Number(percent) || 0) * (MATTER_LEVEL_MAX / 100));
    return Math.max(1, Math.min(MATTER_LEVEL_MAX, level));
  }

  /**
   * @param {number} level 1..254.
   * @returns {number} 0..100.
   */
  fromMatterLevel(level) {
    const percent = Math.round((Number(level) || 0) / (MATTER_LEVEL_MAX / 100));
    return Math.max(0, Math.min(100, percent));
  }

  /**
   * @param {number} kelvin The colour temperature as the device counts it.
   * @returns {number} The same temperature in the mireds Matter counts in.
   */
  toMireds(kelvin) {
    const value = Number(kelvin);
    if (!value) {
      return 0;
    }
    return Math.round(1000000 / value);
  }

  /**
   * @param {number} mireds The colour temperature as Matter counts it.
   * @returns {number} The same temperature in kelvin.
   */
  fromMireds(mireds) {
    const value = Number(mireds);
    if (!value) {
      return 0;
    }
    return Math.round(1000000 / value);
  }


  /*----------========== HELPERS ==========----------*/

  _remember(cluster, attributes) {
    this.pushed[cluster] = Object.assign({}, this.pushed[cluster], attributes);
    this.pushedAt[cluster] = Date.now();
  }

  _changedAttributes(cluster, attributes) {
    const pushed = this.pushed[cluster] || {};
    const changed = {};

    Object.keys(attributes).forEach((key) => {
      if (pushed[key] !== attributes[key]) {
        changed[key] = attributes[key];
      }
    });

    return changed;
  }

  _deviceId() {
    const miotDevice = this.device.getMiotDevice ? this.device.getMiotDevice() : null;
    return (miotDevice && miotDevice.getDeviceId && miotDevice.getDeviceId()) || this.config.deviceId || this.config.ip;
  }

  _serialNumber() {
    // The spec allows 32 characters for a bridged device's serial number.
    return String(this._deviceId()).slice(0, 32);
  }

}


module.exports = MatterTwin;
