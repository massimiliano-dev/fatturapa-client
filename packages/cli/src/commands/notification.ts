import { parseSdiNotification, statusFromNotification } from '@massimiliano-dev/fatturapa-core';
import { readRegularFile } from '../files.js';
import { ExitCode, type CliIo } from '../io.js';

export async function notificationCommand(
  io: CliIo,
  file: string,
  options: { json?: boolean },
): Promise<number> {
  const { data } = await readRegularFile(file, { maxBytes: 1024 * 1024 });
  const n = parseSdiNotification(new Uint8Array(data));
  const status = statusFromNotification(n.type, n.Esito);
  if (options.json) {
    io.stdout(`${JSON.stringify({ ...n, status }, null, 2)}\n`);
  } else {
    io.stdout(
      `${n.type} (${n.rootElement}) for ${n.NomeFile ?? '?'}, SdI id ${n.IdentificativoSdI ?? '?'}: invoice status ${status}\n`,
    );
    if (n.Esito) io.stdout(`  esito ${n.Esito}${n.Descrizione ? `: ${n.Descrizione}` : ''}\n`);
    for (const e of n.ListaErrori ?? []) {
      io.stdout(
        `  ${e.Codice} ${e.Descrizione}${e.officialDescription && e.officialDescription !== e.Descrizione ? `\n        (${e.officialDescription})` : ''}\n`,
      );
    }
    if (!n.signed) io.stdout('  note: the notification carries no signature element\n');
  }
  return status === 'rejected' || status === 'refused' ? ExitCode.invalid : ExitCode.ok;
}
