const DevTypes = require('../constants/DevTypes.js');
const LightTwin = require('./LightTwin.js');
const FanTwin = require('./FanTwin.js');
const AirQualityTwin = require('./AirQualityTwin.js');


/**
 * Which twin stands for which kind of device. A kind with no entry is simply not published over
 * Matter; its HomeKit side is untouched either way.
 */
const TWINS = {
  [DevTypes.LIGHT]: [LightTwin],
  [DevTypes.FAN]: [FanTwin],
  [DevTypes.AIR_PURIFIER]: [FanTwin, AirQualityTwin],
  [DevTypes.HUMIDIFIER]: [FanTwin],
  [DevTypes.OUTLET]: [LightTwin],
  [DevTypes.SWITCH]: [LightTwin],
};


/**
 * Publishes one device over Matter, alongside HomeKit rather than instead of it.
 *
 * Homebridge only defines `api.matter` on a bridge that has Matter switched on, so enabling it
 * there is the real opt-in; `enableMatter` in a device's config exists to leave one device out.
 *
 * Registration happens on every start, not just the first: Homebridge restores its cached Matter
 * accessories carrying stub handlers, and re-registering is what attaches the real ones.
 */
class MatterBridge {


  /**
   * @param {object} device The device object, the same one the HomeKit accessory drives.
   * @param {object} config The device's configuration.
   * @param {object} api The Homebridge API.
   * @param {object} logger Where to say what happened.
   * @param {string} uuidSeed What the accessory UUIDs are derived from, usually the device id.
   * @param {string} name The name shown in the controller app.
   */
  constructor(device, config, api, logger, uuidSeed, name) {
    this.device = device;
    this.config = config || {};
    this.api = api;
    this.logger = logger;
    this.uuidSeed = uuidSeed;
    this.name = name;
    this.twins = new Map();
  }

  /**
   * @param {object} api The Homebridge API.
   * @returns {boolean} Whether this Homebridge can publish over Matter at all.
   */
  static isAvailable(api) {
    return !!(api
      && typeof api.isMatterAvailable === 'function'
      && api.isMatterAvailable()
      && api.isMatterEnabled()
      && api.matter
      && typeof api.matter.registerPlatformAccessories === 'function');
  }

  /**
   * @param {object} device The device to publish.
   * @param {object} api The Homebridge API.
   * @param {object} config The device's configuration.
   * @param {object} logger Where to say what happened.
   * @returns {Array<MatterTwin>} The twins this device has, before they are given a UUID.
   */
  static twinsFor(device, api, config, logger) {
    const classes = TWINS[device.getType()] || [];
    return classes
      .map(Twin => new Twin(device, config, api, logger))
      .filter(twin => twin.supported());
  }

  /**
   * Builds, registers and starts reporting everything this device shows over Matter.
   *
   * @param {string} pluginName The plugin identifier to register under.
   * @param {string} platformName The platform name to register under.
   * @param {Array<object>} cached What Homebridge restored from its Matter cache.
   * @returns {Promise<boolean>} Whether anything was published.
   */
  async publish(pluginName, platformName, cached = []) {
    if (this.config.enableMatter === false) {
      await this._unregisterStale(pluginName, platformName, cached);
      return false;
    }

    if (!MatterBridge.isAvailable(this.api)) {
      this.logger.debug('Matter is not enabled for this bridge, publishing over HomeKit only');
      return false;
    }

    const twins = MatterBridge.twinsFor(this.device, this.api, this.config, this.logger);
    if (twins.length === 0) {
      this.logger.debug(`Nothing to publish over Matter for a ${this.device.getType()} device`);
      await this._unregisterStale(pluginName, platformName, cached);
      return false;
    }

    const accessories = twins.map((twin, index) => {
      const suffix = twin.constructor.name.replace('Twin', '').toLowerCase();
      const uuid = this.api.matter.uuid.generate(`miot-matter-${this.uuidSeed}-${suffix}`);
      // The first accessory is the device itself and carries its name; anything else is a part of
      // it and says which part, short enough to leave the name room.
      const name = index === 0 ? this.name : `${this.name} ${MatterBridge.SUFFIX_NAMES[suffix] || suffix}`;

      this.twins.set(uuid, twin);
      return twin.descriptor(uuid, name);
    });

    try {
      await this.api.matter.registerPlatformAccessories(pluginName, platformName, accessories);
    } catch (err) {
      this.logger.warn(`Could not publish over Matter: ${err.message || err}`);
      return false;
    }

    await this._unregisterStale(pluginName, platformName, cached);

    // Whatever the device does, and whoever asked for it, the controllers hear about it.
    twins.forEach(twin => twin.follow());

    this.logger.info(`Published ${accessories.length} Matter accessory(ies): ${accessories.map(a => a.displayName).join(', ')}`);
    return true;
  }

  /**
   * Reports the current state of everything published, whether it changed or not.
   *
   * @returns {void}
   */
  report() {
    this.twins.forEach(twin => twin.report());
  }


  /*----------========== HELPERS ==========----------*/

  /**
   * Takes away what this device used to publish and no longer does - a light that lost its dimmer
   * in a config change, or a device left out of Matter altogether. A controller keeps whatever it
   * was once given until it is told otherwise.
   */
  async _unregisterStale(pluginName, platformName, cached = []) {
    const deviceId = String(this.uuidSeed);
    const stale = cached.filter(accessory => accessory
      && accessory.context
      && String(accessory.context.deviceId) === deviceId
      && !this.twins.has(accessory.UUID));

    if (stale.length === 0) {
      return;
    }

    try {
      await this.api.matter.unregisterPlatformAccessories(pluginName, platformName, stale);
      this.logger.info(`Removed ${stale.length} Matter accessory(ies) no longer published: ${stale.map(a => a.displayName).join(', ')}`);
    } catch (err) {
      this.logger.warn(`Could not remove the Matter accessories no longer published: ${err.message || err}`);
    }
  }

}


/** What the extra accessories of one device are called. */
MatterBridge.SUFFIX_NAMES = {
  airquality: 'PM2.5',
};

module.exports = MatterBridge;
