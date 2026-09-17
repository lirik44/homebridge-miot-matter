const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const LegacyLocalProtocol = require('../lib/protocol/LegacyLocalProtocol.js');
const YeelinkLightLamp4 = require('../lib/modules/light/devices/yeelink.light.lamp4.js');

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** The lamp's own translation, without building a whole device to get at it. */
const lampSpec = YeelinkLightLamp4.prototype.legacyLocalProtocol.call({});

function fakeDevice(answers = {}) {
  const sent = [];
  const send = async (method, params) => {
    sent.push({ method, params });
    if (method === 'get_prop') {
      return params.map(name => answers[name]);
    }
    return ['ok'];
  };
  return { sent, protocol: new LegacyLocalProtocol(lampSpec, send, silent) };
}

describe('reading a device that only speaks the old commands', () => {
  it('asks for every property in one command, as the device expects', async () => {
    const { sent, protocol } = fakeDevice({ power: 'on', bright: '40', ct: '4000' });

    const answer = await protocol.readProperties([
      { did: 'd', siid: 2, piid: 1 },
      { did: 'd', siid: 2, piid: 2 },
      { did: 'd', siid: 2, piid: 3 },
    ]);

    assert.deepEqual(sent, [{ method: 'get_prop', params: ['power', 'bright', 'ct'] }]);
    assert.deepEqual(answer, [
      { did: 'd', siid: 2, piid: 1, code: 0, value: true },
      { did: 'd', siid: 2, piid: 2, code: 0, value: 40 },
      { did: 'd', siid: 2, piid: 3, code: 0, value: 4000 },
    ]);
  });

  it('answers in the shape the rest of the plugin reads', async () => {
    // A MIoT device sends a code of 0 and the value; everything downstream checks that code.
    const { protocol } = fakeDevice({ power: 'off', bright: '1', ct: '2600' });
    const [on] = await protocol.readProperties([{ siid: 2, piid: 1 }]);

    assert.equal(on.code, 0);
    assert.equal(on.value, false);
  });

  it('says a property is not there rather than inventing a value', async () => {
    const { sent, protocol } = fakeDevice({});
    const answer = await protocol.readProperties([{ siid: 3, piid: 1 }]);

    assert.equal(answer[0].code, -4003);
    assert.equal(answer[0].value, undefined);
    // Nothing to ask the device for, so it is left alone.
    assert.deepEqual(sent, []);
  });

  it('keeps the answers in the order they were asked for', async () => {
    const { protocol } = fakeDevice({ power: 'on', bright: '55', ct: '3000' });

    const answer = await protocol.readProperties([
      { siid: 2, piid: 3 },
      { siid: 3, piid: 2 },
      { siid: 2, piid: 1 },
    ]);

    assert.deepEqual(answer.map(entry => entry.value), [3000, undefined, true]);
  });

  it('complains when the device answers something else entirely', async () => {
    const protocol = new LegacyLocalProtocol(lampSpec, async () => 'nonsense', silent);
    await assert.rejects(() => protocol.readProperties([{ siid: 2, piid: 1 }]), /Unexpected answer/);
  });
});

describe('writing to a device that only speaks the old commands', () => {
  it('turns the lamp on and off with its own command', async () => {
    const { sent, protocol } = fakeDevice();

    await protocol.writeProperties([{ siid: 2, piid: 1, value: true }]);
    await protocol.writeProperties([{ siid: 2, piid: 1, value: false }]);

    assert.deepEqual(sent, [
      { method: 'set_power', params: ['on', 'smooth', 500] },
      { method: 'set_power', params: ['off', 'smooth', 500] },
    ]);
  });

  it('sets brightness and colour temperature one command at a time', async () => {
    // The lamp answers one request at a time and drops the second of a pair sent together.
    const { sent, protocol } = fakeDevice();

    const answer = await protocol.writeProperties([
      { siid: 2, piid: 2, value: 40 },
      { siid: 2, piid: 3, value: 4000 },
    ]);

    assert.deepEqual(sent, [
      { method: 'set_bright', params: [40, 'smooth', 500] },
      { method: 'set_ct_abx', params: [4000, 'smooth', 500] },
    ]);
    assert.deepEqual(answer.map(entry => entry.code), [0, 0]);
  });

  it('refuses what the device has no command for', async () => {
    const { sent, protocol } = fakeDevice();
    const answer = await protocol.writeProperties([{ siid: 2, piid: 4, value: 1 }]);

    assert.equal(answer[0].code, -4003);
    assert.deepEqual(sent, []);
  });

  it('runs an action', async () => {
    const { sent, protocol } = fakeDevice();
    const answer = await protocol.runAction({ siid: 2, aiid: 1, in: [] });

    assert.equal(answer.code, 0);
    assert.deepEqual(sent, [{ method: 'toggle', params: [] }]);
  });
});
