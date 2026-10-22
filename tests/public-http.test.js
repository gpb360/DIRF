import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { assertPublicHttpsUrl, fetchTextSafely, isPrivateAddress } from "../src/public-http.js";

const lookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("public address checks normalize mapped forms and exclude special-use space", async () => {
  const privateAddresses = [
    "127.0.0.1", "10.1.2.3", "172.31.1.2", "192.168.0.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.1.2.3", "255.255.255.255", "198.18.0.1",
    "192.0.2.1", "::1", "::", "fc00::1", "fe80::1", "fe80::1%eth0",
    "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1", "3fff::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1",
    "::ffff:a00:1", "::ffff:192.168.0.1", "not-an-address",
  ];
  for (const address of privateAddresses) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["93.184.216.34", "2606:4700:4700::1111", "::ffff:93.184.216.34"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
  for (const input of ["https://127.1/", "https://2130706433/", "https://[::ffff:7f00:1]/"]) {
    await assert.rejects(assertPublicHttpsUrl(input), /private or local/);
  }
  await assert.rejects(assertPublicHttpsUrl("https://example.test", {
    lookup: async () => [...await lookup(), { address: "::ffff:7f00:1", family: 6 }],
  }), /private or local/);
});

test("HTTPS uses the validated DNS answers without changing the TLS hostname", async () => {
  let lookups = 0;
  const result = await fetchTextSafely("https://example.test/docs", {}, {
    lookup: async () => {
      lookups += 1;
      return lookups === 1 ? await lookup() : [{ address: "127.0.0.1", family: 4 }];
    },
    request(url, options, respond) {
      assert.equal(url.hostname, "example.test");
      assert.equal(options.agent, false);
      assert.equal(options.headers["accept-encoding"], "identity");
      options.lookup("example.test", {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, "93.184.216.34");
        assert.equal(family, 4);
      });
      options.lookup("example.test", { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
      });
      const req = new EventEmitter();
      req.end = () => {
        const response = Readable.from([Buffer.from("checked")]);
        response.headers = { "content-type": "text/plain" };
        response.statusCode = 200;
        respond(response);
      };
      return req;
    },
  });
  assert.equal(lookups, 1);
  assert.equal(result.body, "checked");
  assert.equal(result.finalUrl, "https://example.test/docs");
});

test("one deadline cancels a body that stalls after headers", async () => {
  let cancelled = false;
  let signal;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(fetchTextSafely("https://example.test", { timeoutMs: 25 }, {
    lookup,
    fetch: async (_url, options) => { signal = options.signal; return new Response(body); },
  }), /timed out after 25 ms/);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("the deadline also bounds DNS and never starts a late request", async () => {
  let requests = 0;
  await assert.rejects(fetchTextSafely("https://example.test", { timeoutMs: 10 }, {
    lookup: () => new Promise((resolve) => setTimeout(() => resolve(lookup()), 40)),
    fetch: async () => { requests += 1; return new Response("late"); },
  }), /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(requests, 0);
});

test("redirects dispose their bodies and revalidate their destination", async () => {
  let cancelled = false;
  let requests = 0;
  await assert.rejects(fetchTextSafely("https://example.test", {}, {
    lookup,
    fetch: async () => {
      requests += 1;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status: 302, headers: { location: "https://[::ffff:7f00:1]/" },
      });
    },
  }), /private or local/);
  assert.equal(requests, 1);
  assert.equal(cancelled, true);
});

test("redirects share the original deadline", async () => {
  let calls = 0;
  await assert.rejects(fetchTextSafely("https://example.test", { timeoutMs: 30 }, {
    lookup,
    fetch: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response("redirect", { status: 302, headers: { location: "/next" } });
    },
  }), /timed out/);
  assert.ok(calls <= 2);
});

test("HTTP errors and declared oversize bodies are disposed", async () => {
  for (const [status, headers, error] of [[500, {}, /HTTP 500/], [200, { "content-length": "6" }, /5 byte limit/]]) {
    let cancelled = false;
    await assert.rejects(fetchTextSafely("https://example.test", { maxBytes: 5 }, {
      lookup, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers }),
    }), error);
    assert.equal(cancelled, true);
  }
});

test("successful relative redirects preserve text and enforce the redirect limit", async () => {
  let calls = 0;
  const result = await fetchTextSafely("https://example.test/start", {}, {
    lookup, fetch: async () => ++calls === 1
      ? new Response(null, { status: 302, headers: { location: "/done" } })
      : new Response("done", { headers: { "content-type": "text/plain" } }),
  });
  assert.equal(result.body, "done");
  assert.equal(result.finalUrl, "https://example.test/done");
  await assert.rejects(fetchTextSafely("https://example.test", {}, {
    lookup, fetch: async () => new Response(null, { status: 302, headers: { location: "/again" } }),
  }), /redirect limit/);
});
