import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { FatturaPAParseError } from './errors.js';
import { assertSafeXml, type SafeXmlOptions } from './safe-xml.js';

/** A parsed element: every child element is an array, attributes are prefixed with `@_`, text is `#text`. */
export type XmlNode = { [name: string]: XmlNode[] | string | undefined };

const MAX_DEPTH = 64;

// First start tag after the prolog, comments and processing instructions: [1] prefix or name, [2] local name.
const ROOT_TAG = /^\s*(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*<([A-Za-z_][\w.-]*)(?::([A-Za-z_][\w.-]*))?/;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Prefixes are stripped from element names only, so that xmlns declarations stay visible as attributes.
  removeNSPrefix: false,
  transformTagName: (name: string) => name.replace(/^[^:]*:/, ''),
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  alwaysCreateTextNode: true,
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: false,
  maxNestedTags: MAX_DEPTH,
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

/**
 * Parses an XML document after the {@link assertSafeXml} checks (no DOCTYPE/ENTITY, UTF-8 only, size
 * limit) and a well-formedness check. Namespace prefixes are removed. Returns the root element name and
 * node. Error messages never include document content.
 */
export function parseXmlDocument(
  input: string | Uint8Array,
  options: SafeXmlOptions = {},
): { name: string; node: XmlNode; namespace: string | undefined } {
  const text = assertSafeXml(input, options);
  // Defence in depth against prototype pollution in the parser: these names never occur in SDI documents.
  if (/<\/?\s*(?:[\w.-]+:)?(?:__proto__|constructor|prototype)\b/.test(text)) {
    throw new FatturaPAParseError('XML contains a reserved element name');
  }
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    throw new FatturaPAParseError(`XML is not well-formed (line ${valid.err.line})`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(text) as Record<string, unknown>;
  } catch {
    throw new FatturaPAParseError('XML could not be parsed');
  }
  const roots = Object.keys(parsed).filter((k) => !k.startsWith('?') && !k.startsWith('#'));
  if (roots.length !== 1) throw new FatturaPAParseError('XML must have exactly one root element');
  const name = roots[0]!;
  const value = parsed[name];
  const node = Array.isArray(value) ? (value[0] as XmlNode) : undefined;
  if (!node || typeof node !== 'object') throw new FatturaPAParseError('XML root element is empty');
  // Namespace of the root element: resolve its prefix against the declarations on the root itself.
  const rootTag = ROOT_TAG.exec(text);
  const prefix = rootTag?.[2] === undefined ? undefined : rootTag[1];
  const declared = node[prefix === undefined ? '@_xmlns' : `@_xmlns:${prefix}`];
  return { name, node, namespace: typeof declared === 'string' ? declared : undefined };
}

/** Child elements with the given name (empty array if none). */
export function children(node: XmlNode, name: string): XmlNode[] {
  const value = Object.prototype.hasOwnProperty.call(node, name) ? node[name] : undefined;
  return Array.isArray(value) ? value : [];
}

/** Text content of an element. */
export function textOf(node: XmlNode): string {
  const text = node['#text'];
  return typeof text === 'string' ? text : '';
}

/** Value of an attribute (without prefix). */
export function attribute(node: XmlNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
}
