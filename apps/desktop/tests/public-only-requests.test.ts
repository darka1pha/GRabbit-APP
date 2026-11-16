import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isIpLiteral, isPrivateHost } from '@grabbit/core';
import { httpRequest, PrivateNetworkError, publicOnlyLookup } from '../src/main/downloads/http-client';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'printer.local',
    'nas.home.arpa',
    'router.lan',
    'LOCALHOST.',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '[::1]',
    '::',
    '::ffff:127.0.0.1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '',
  ])('refuses %s', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['example.com', '93.184.216.34', '172.32.0.1', '100.128.0.1', '8.8.8.8', '2606:4700::1111', 'local.example.com'])(
    'allows %s',
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    }
  );

  it('recognises IP literals', () => {
    expect(isIpLiteral('1.2.3.4')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('999.1.1.1')).toBe(false);
    expect(isIpLiteral('example.com')).toBe(false);
  });
});

describe('public-only requests', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/target` });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it('still reaches the local network for the user’s own downloads', async () => {
    const res = await httpRequest(`http://127.0.0.1:${port}/redirect`);
    res.body.resume();
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`http://127.0.0.1:${port}/target`);
  });

  it('refuses a private first hop', async () => {
    await expect(httpRequest(`http://127.0.0.1:${port}/x`, { publicOnly: true })).rejects.toBeInstanceOf(
      PrivateNetworkError
    );
    await expect(httpRequest(`http://localhost:${port}/x`, { publicOnly: true })).rejects.toBeInstanceOf(
      PrivateNetworkError
    );
  });

  it('refuses at connect time when a name resolves to a private address', async () => {
    // The name check alone would pass a public-looking name; the lookup used for the socket must not
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      publicOnlyLookup('localhost', {}, (err) => resolve(err))
    );
    expect(error).toBeInstanceOf(PrivateNetworkError);
    expect(error?.code).toBe('EPRIVATE');
  });

  it('applies that lookup to sockets opened through an agent', async () => {
    // The public-only agents rely on Node passing the agent's `lookup` to every new socket
    const agent = new http.Agent({ keepAlive: true, lookup: publicOnlyLookup as never } as http.AgentOptions);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const req = http.request({ host: 'localhost', port, agent }, (res) => {
        res.resume();
        resolve(null);
      });
      req.on('error', resolve);
      req.end();
    });
    agent.destroy();
    expect(error?.code).toBe('EPRIVATE');
  });
});
