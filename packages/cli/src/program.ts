import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { buildSdiFileName, FatturaPAError, redact } from '@massimiliano-dev/fatturapa-core';
import { inspectCommand } from './commands/inspect.js';
import { notificationCommand } from './commands/notification.js';
import { sendCommand, statusCommand } from './commands/providers.js';
import { validateCommand } from './commands/validate.js';
import { ExitCode, type CliIo } from './io.js';

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidArgumentError('expected YYYY-MM-DD');
  return value;
}

function buildProgram(io: CliIo, setExit: (code: number) => void): Command {
  const program = new Command('fatturapa')
    .description(
      'Unofficial FatturaPA tools: build, validate and inspect Italian e-invoices, parse SDI notifications, send via providers.',
    )
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .showHelpAfterError();

  program
    .command('validate')
    .argument('<file>', 'invoice XML or .xml.p7m')
    .description('Validate against the official XSD and the SDI content rules. Exit code 1 if invalid.')
    .option(
      '--schemas <dir>',
      'schemas folder (default $FATTURAPA_SCHEMAS_DIR or ./vendor/fatturapa-schemas)',
    )
    .option('--rules-only', 'skip the XSD, run only the SDI content rules')
    .option('--today <date>', 'reference date for rule 00403', isoDate)
    .option('--json', 'machine-readable output')
    .action(async (file: string, options) => setExit(await validateCommand(io, file, options)));

  program
    .command('inspect')
    .argument('<file>', 'invoice XML or .xml.p7m')
    .description('Print a summary (identifiers masked) and the SDI rule check.')
    .option('--today <date>', 'reference date for rule 00403', isoDate)
    .option('--json', 'machine-readable output')
    .action(async (file: string, options) => setExit(await inspectCommand(io, file, options)));

  program
    .command('notification')
    .argument('<file>', 'SDI notification XML (RC, NS, MC, NE, DT, AT, MT, EC, SE)')
    .description('Parse an SDI notification; NS errors come with the official description.')
    .option('--json', 'machine-readable output')
    .action(async (file: string, options) => setExit(await notificationCommand(io, file, options)));

  program
    .command('filename')
    .description('Build an SDI file name, e.g. IT01234567890_00001.xml.')
    .requiredOption('--id <countryAndId>', 'transmitter id with country prefix, e.g. IT01234567890')
    .requiredOption('--progressive <n>', 'counter (number, base-36 encoded) or 1-5 alphanumeric characters')
    .option('--p7m', 'signed CAdES file (.xml.p7m)')
    .action((options: { id: string; progressive: string; p7m?: boolean }) => {
      const match = /^([A-Z]{2})(.+)$/.exec(options.id);
      if (!match) throw new FatturaPAError('--id must start with a two-letter country code');
      const progressive = /^\d+$/.test(options.progressive)
        ? Number(options.progressive)
        : options.progressive;
      io.stdout(
        `${buildSdiFileName({ country: match[1]!, identifier: match[2]!, progressive, extension: options.p7m ? 'xml.p7m' : 'xml' })}\n`,
      );
      setExit(ExitCode.ok);
    });

  const providerOptions = (cmd: Command) =>
    cmd
      .addOption(
        new Option('--provider <name>', 'SDI intermediary')
          .choices(['openapi-it', 'fattureincloud'])
          .makeOptionMandatory(),
      )
      .addOption(
        new Option('--env <env>', 'Openapi.it environment')
          .choices(['sandbox', 'production'])
          .default('sandbox'),
      )
      .option('--company <id>', 'Fatture in Cloud company id (default $FIC_COMPANY_ID)')
      .option('--confirm-production', 'required to act on production data');

  providerOptions(
    program
      .command('send')
      .argument('<file>', 'unsigned invoice XML')
      .description(
        'Validate locally, then send through the provider. Token from OPENAPI_IT_TOKEN, never from flags.',
      ),
  )
    .option('--schemas <dir>', 'schemas folder for the local validation')
    .option('--no-validate', 'skip the local validation (not recommended)')
    .option('--signature', 'let the provider sign the invoice')
    .option('--legal-storage', 'send to legal storage (conservazione)')
    .option('--today <date>', 'reference date for rule 00403', isoDate)
    .option('--dry-run', 'validate and print what would be sent, without sending')
    .action(async (file: string, options) => setExit(await sendCommand(io, file, options)));

  providerOptions(
    program
      .command('status')
      .argument('<id>', 'provider invoice id')
      .description('Print the normalised status of an outgoing invoice.'),
  ).action(async (id: string, options) => setExit(await statusCommand(io, id, options)));

  return program;
}

/** Runs the CLI and returns the exit code. Errors are printed redacted and without stack traces. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let exitCode: number = ExitCode.ok;
  const program = buildProgram(io, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? ExitCode.ok : ExitCode.error;
    const known = error instanceof FatturaPAError || error instanceof RangeError || error instanceof Error;
    io.stderr(`fatturapa: ${redact(known ? (error as Error).message : 'unexpected error')}\n`);
    const name = (error as Error)?.name;
    return name === 'UnsafeXmlError' || name === 'FatturaPAParseError' || name === 'P7mError'
      ? ExitCode.invalid
      : ExitCode.error;
  }
}
