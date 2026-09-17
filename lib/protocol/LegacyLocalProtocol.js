const Logger = require('../utils/Logger.js');


/**
 * Talks to a device that answers the old miIO commands on the local network instead of the MIoT
 * ones, and answers the rest of the plugin as though it were MIoT.
 *
 * Some devices - the Yeelight desk lamps among them - are described by a MIoT spec and reachable
 * through the Xiaomi cloud with it, but locally they only understand the commands they shipped
 * with: `get_prop ["power","bright","ct"]` rather than `get_properties [{siid,piid}]`. Until now
 * the plugin's answer for those was the cloud, which means an account, a round trip to China and
 * a lamp that stops working when the internet does.
 *
 * A device class describes the translation and this turns each MIoT request into the commands the
 * device knows, then shapes the answer the way the caller expects.
 */
class LegacyLocalProtocol {

  /**
   * @param {object} spec What the device class declares: `properties` keyed by "siid.piid", and
   *   optionally `actions` keyed by "siid.aiid".
   * @param {function} send Sends one raw command to the device: (method, params) => Promise.
   * @param {Logger} logger Where to complain.
   */
  constructor(spec, send, logger) {
    this.properties = (spec && spec.properties) || {};
    this.actions = (spec && spec.actions) || {};
    this.send = send;
    this.logger = logger || new Logger();
  }


  /*----------========== PUBLIC ==========----------*/

  /**
   * @param {Array<{siid: number, piid: number}>} params What the caller wants to read.
   * @returns {Promise<Array<object>>} One answer per request, in the order asked for, shaped the
   *   way a MIoT device answers.
   */
  async readProperties(params = []) {
    const wanted = params.map(param => ({ param, mapping: this._propertyFor(param) }));
    const readable = wanted.filter(entry => entry.mapping && entry.mapping.read);

    if (readable.length === 0) {
      return wanted.map(entry => this._failed(entry.param));
    }

    const names = readable.map(entry => entry.mapping.read);
    const values = await this.send('get_prop', names);

    if (!Array.isArray(values) || values.length !== names.length) {
      throw new Error(`Unexpected answer to get_prop ${JSON.stringify(names)}: ${JSON.stringify(values)}`);
    }

    const byName = new Map(names.map((name, index) => [name, values[index]]));
    return wanted.map((entry) => {
      if (!entry.mapping || !entry.mapping.read) {
        return this._failed(entry.param);
      }
      const raw = byName.get(entry.mapping.read);
      // A device answering "unsupported" for a property it does not have says so as null.
      if (raw === undefined || raw === null) {
        return this._failed(entry.param);
      }
      const value = entry.mapping.fromDevice ? entry.mapping.fromDevice(raw) : raw;
      return Object.assign({}, entry.param, { code: 0, value });
    });
  }

  /**
   * @param {Array<{siid: number, piid: number, value: *}>} params What the caller wants to write.
   * @returns {Promise<Array<object>>} One answer per request, in the order asked for.
   */
  async writeProperties(params = []) {
    const answers = [];

    // One command at a time: these devices answer a single request at a time, and a lamp told to
    // change brightness and colour temperature at once drops one of them.
    for (const param of params) {
      const mapping = this._propertyFor(param);
      if (!mapping || !mapping.write) {
        this.logger.debug(`No local command for writing ${param.siid}.${param.piid}`);
        answers.push(this._failed(param));
        continue;
      }

      const command = mapping.write(param.value);
      await this.send(command.method, command.params || []);
      answers.push(Object.assign({}, param, { code: 0 }));
    }

    return answers;
  }

  /**
   * @param {{siid: number, aiid: number, in: Array}} param The action to run.
   * @returns {Promise<object>} The answer, shaped the way a MIoT device answers.
   */
  async runAction(param = {}) {
    const mapping = this.actions[`${param.siid}.${param.aiid}`];
    if (!mapping) {
      this.logger.debug(`No local command for action ${param.siid}.${param.aiid}`);
      return this._failed(param);
    }

    const command = typeof mapping === 'function' ? mapping(param.in || []) : mapping;
    await this.send(command.method, command.params || []);
    return Object.assign({}, param, { code: 0 });
  }

  /**
   * @param {{siid: number, piid: number}} param What is being asked for.
   * @returns {boolean} Whether this device can answer it locally.
   */
  knows(param = {}) {
    return !!this._propertyFor(param);
  }


  /*----------========== HELPERS ==========----------*/

  _propertyFor(param) {
    return this.properties[`${param.siid}.${param.piid}`];
  }

  _failed(param) {
    // The code a MIoT device sends for a property it does not have.
    return Object.assign({}, param, { code: -4003 });
  }

}


module.exports = LegacyLocalProtocol;
