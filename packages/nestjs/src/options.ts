import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';
import type { SdiProvider } from '@massimiliano-dev/fatturapa-core';

/** Anything with a `validate(xml)` method, e.g. `FatturaPAValidator` from fatturapa-validator. */
export interface InvoiceValidatorLike {
  validate(
    xml: string | Uint8Array,
    options?: { today?: string },
  ): Promise<{ valid: boolean; issues: unknown[] }>;
}

/** Options of {@link FatturaPAModule}. Load tokens from a secret store inside `useFactory`. */
export interface FatturaPAModuleOptions {
  /** The SDI intermediary, e.g. `new OpenapiItProvider({...})` or `new FattureInCloudProvider({...})`. */
  provider: SdiProvider;
  /** Optional local validator. */
  validator?: InvoiceValidatorLike;
}

export interface FatturaPAModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nest factory signature
  useFactory: (...args: any[]) => FatturaPAModuleOptions | Promise<FatturaPAModuleOptions>;
  /** Register the module globally. Default true. */
  isGlobal?: boolean;
}
