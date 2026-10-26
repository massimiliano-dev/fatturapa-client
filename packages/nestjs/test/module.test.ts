import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import type { SdiProvider } from '@massimiliano-dev/fatturapa-core';
import { FATTURAPA_PROVIDER, FATTURAPA_VALIDATOR, FatturaPAModule, InjectSdiProvider } from '../src/index.js';

class FakeProvider implements SdiProvider {
  readonly name = 'fake';
  readonly capabilities = {
    sendXml: true,
    sendModel: true,
    signature: false,
    receive: false,
    notifications: false,
    webhooks: false,
    sandbox: true,
  };
  closed = false;
  async send() {
    return { provider: 'fake', id: '1', status: 'queued' as const };
  }
  async getStatus(id: string) {
    return { provider: 'fake', id, status: 'delivered' as const };
  }
  async close() {
    this.closed = true;
  }
}

@Injectable()
class InvoicesService {
  constructor(@InjectSdiProvider() readonly sdi: SdiProvider) {}
}

@Module({ providers: [{ provide: 'CONFIG', useValue: { env: 'sandbox' } }], exports: ['CONFIG'] })
class ConfigModule {}

describe('FatturaPAModule', () => {
  it('injects the provider, exposes an optional validator and closes the provider on shutdown', async () => {
    const fake = new FakeProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FatturaPAModule.forRootAsync({
          imports: [ConfigModule],
          inject: ['CONFIG'],
          useFactory: (config: { env: string }) => {
            expect(config.env).toBe('sandbox');
            return { provider: fake };
          },
        }),
      ],
      providers: [InvoicesService],
    }).compile();
    // A testing module runs the same lifecycle hooks as an application, without an HTTP platform.
    const app = await moduleRef.init();
    expect(app.get(InvoicesService).sdi).toBe(fake);
    expect(app.get(FATTURAPA_PROVIDER)).toBe(fake);
    expect(app.get(FATTURAPA_VALIDATOR)).toBeUndefined();
    expect(await app.get(InvoicesService).sdi.getStatus('9')).toMatchObject({ status: 'delivered' });
    await app.close();
    expect(fake.closed).toBe(true);
  });

  it('fails fast without a provider', async () => {
    await expect(
      Test.createTestingModule({
        imports: [FatturaPAModule.forRootAsync({ useFactory: () => ({}) as never })],
      }).compile(),
    ).rejects.toThrow(/provider is required/);
  });
});
