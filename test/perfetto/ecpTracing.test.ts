import * as http from 'http';
import { expect } from 'chai';
import { enablePerfettoTracing, triggerHeapSnapshot } from '../../src/client/perfetto/ecpTracing';

// Spins up a minimal HTTP server to capture incoming requests.
function makeServer(
  statusCode: number,
  body: string,
): { server: http.Server; requests: http.IncomingMessage[]; close: () => Promise<void> } {
  const requests: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    res.writeHead(statusCode);
    res.end(body);
  });
  return {
    server,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function listenOn(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Could not bind'));
    });
  });
}

describe('ecpTracing', () => {
  describe('enablePerfettoTracing', () => {
    it('sends POST /perfetto/enable/dev to the device', async () => {
      const { server, requests, close } = makeServer(200, '<ecp-response>OK</ecp-response>');
      const port = await listenOn(server);

      await enablePerfettoTracing('127.0.0.1', 'dev', port);

      expect(requests).to.have.length(1);
      expect(requests[0].method).to.equal('POST');
      expect(requests[0].url).to.equal('/perfetto/enable/dev');

      await close();
    });

    it('uses a custom channel id', async () => {
      const { server, requests, close } = makeServer(200, '');
      const port = await listenOn(server);

      await enablePerfettoTracing('127.0.0.1', 'mychannel', port);

      expect(requests[0].url).to.equal('/perfetto/enable/mychannel');
      await close();
    });

    it('throws on non-2xx response', async () => {
      const { server, close } = makeServer(403, 'Forbidden');
      const port = await listenOn(server);

      let threw = false;
      try {
        await enablePerfettoTracing('127.0.0.1', 'dev', port);
      } catch (err) {
        threw = true;
        expect((err as Error).message).to.include('403');
      }
      expect(threw).to.be.true;
      await close();
    });
  });

  describe('triggerHeapSnapshot', () => {
    it('sends POST /perfetto/heapgraph/trigger/dev', async () => {
      const { server, requests, close } = makeServer(200, '');
      const port = await listenOn(server);

      await triggerHeapSnapshot('127.0.0.1', 'dev', port);

      expect(requests[0].url).to.equal('/perfetto/heapgraph/trigger/dev');
      await close();
    });
  });
});
