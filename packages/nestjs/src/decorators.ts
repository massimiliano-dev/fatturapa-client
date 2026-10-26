import { Inject } from '@nestjs/common';
import { FATTURAPA_PROVIDER, FATTURAPA_VALIDATOR } from './constants.js';

/** `@InjectSdiProvider()` = `@Inject(FATTURAPA_PROVIDER)`. */
export const InjectSdiProvider = (): ParameterDecorator => Inject(FATTURAPA_PROVIDER);
/** `@InjectInvoiceValidator()` = `@Inject(FATTURAPA_VALIDATOR)`. */
export const InjectInvoiceValidator = (): ParameterDecorator => Inject(FATTURAPA_VALIDATOR);
