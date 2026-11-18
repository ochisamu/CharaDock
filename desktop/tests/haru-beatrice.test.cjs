// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const test = require("node:test");
const { WebSocket, WebSocketServer } = require("ws");
const { startHaruVoiceProxy } = require("../lib/haru-beatrice.cjs");

test("Haru reply frames are converted in order and the final partial block is flushed", async t => {
  const upstream = http.createServer((_request, res) => res.end("Talk"));
  const ws = new WebSocketServer({ server: upstream });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => { ws.close(); upstream.close(); });
  const origin = "http://127.0.0.1:" + upstream.address().port;
  let input;
  ws.on("connection", socket => {
    socket.on("message", (data, binary) => {
      if (binary) {
        input = data;
        socket.send(JSON.stringify({ type: "text", text: "first" }));
        socket.send(Buffer.alloc(6400, 32));
        socket.send(JSON.stringify({ type: "text", text: "second" }));
        socket.send(Buffer.alloc(6400, 16));
        return;
      }
      const { type } = JSON.parse(data);
      if (type === "start") socket.send(JSON.stringify({ type: "started", sample_rate: 24000, frame_samples: 3200 }));
      if (type === "hang_up") { socket.send('{"type":"end"}'); socket.close(); }
    });
  });
  let stopped = 0;
  const proxy = await startHaruVoiceProxy(origin, ({ onAudio }) => ({
    async start() {},
    stop() { stopped++; },
    push(data) {
      const output = new Float32Array(data).map(sample => -sample);
      setImmediate(() => onAudio(output.buffer));
      return true;
    },
  }), "conversion failed");
  t.after(() => proxy.stop());
  assert.equal(await (await fetch(proxy.origin)).text(), "Talk");
  const refused = await fetch(proxy.origin, { headers: { Origin: "https://example.com" } });
  assert.equal(refused.status, 403);
  const client = new WebSocket(proxy.origin.replace("http:", "ws:") + "/v1/dialogue", { origin: proxy.origin });
  await once(client, "open");
  const received = [];
  client.on("message", (data, binary) => {
    if (binary) { received.push([data.length, data.readInt16LE(10)]); return; }
    const event = JSON.parse(data);
    received.push(event.text || event.type);
    if (event.type === "started") {
      client.send(Buffer.from([1, 2, 3, 4]));
      client.send('{"type":"hang_up"}');
    }
  });
  client.send('{"type":"start"}');
  await once(client, "close");
  assert.deepEqual(input, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(received.map(value => Array.isArray(value) ? value[0] : value), ["started", "first", 6400, "second", 6400, "end"]);
  assert.ok(received[2][1] < -8100 && received[4][1] < -4000);
  assert.equal(stopped, 1);
});
