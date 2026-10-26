import { DynamicModule, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type { SdiProvider } from '@massimiliano-dev/fatturapa-core';
import { FATTURAPA_MODULE_OPTIONS, FATTURAPA_PROVIDER, FATTURAPA_VALIDATOR } from './constants.js';
import type { FatturaPAModuleAsyncOptions, FatturaPAModuleOptions } from './options.js';

/**
 * Provides an `SdiProvider` and an optional invoice validator.
 *
 * ```ts
 * FatturaPAModule.forRootAsync({
 *   inject: [SecretsService],
 *   useFactory: async (secrets: SecretsService) => ({
 *     provider: new OpenapiItProvider({ environment: 'sandbox', token: () => secrets.get('openapi-it-token') }),
 *     validator: await createFatturaPAValidator(process.env.FATTURAPA_SCHEMAS_DIR!),
 *   }),
 * })
 *
 * constructor(@Inject(FATTURAPA_PROVIDER) private readonly sdi: SdiProvider) {}
 * ```
 *
 * The provider is closed on application shutdown.
 */
@Module({})
export class FatturaPAModule implements OnApplicationShutdown {
  constructor(@Inject(FATTURAPA_PROVIDER) private readonly provider: SdiProvider) {}

  static forRootAsync(options: FatturaPAModuleAsyncOptions): DynamicModule {
    return {
      module: FatturaPAModule,
      global: options.isGlobal ?? true,
      imports: options.imports ?? [],
      providers: [
        { provide: FATTURAPA_MODULE_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: FATTURAPA_PROVIDER,
          useFactory: (o: FatturaPAModuleOptions) => {
            if (!o?.provider || typeof o.provider.send !== 'function')
              throw new TypeError('FatturaPAModule: provider is required');
            return o.provider;
          },
          inject: [FATTURAPA_MODULE_OPTIONS],
        },
        {
          provide: FATTURAPA_VALIDATOR,
          useFactory: (o: FatturaPAModuleOptions) => o.validator,
          inject: [FATTURAPA_MODULE_OPTIONS],
        },
      ],
      exports: [FATTURAPA_PROVIDER, FATTURAPA_VALIDATOR],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.provider.close();
  }
}
