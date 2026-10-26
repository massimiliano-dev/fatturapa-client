import { describe, expect, it } from 'vitest';
import { UnsafeXmlError } from '@massimiliano-dev/fatturapa-core';
import { documentMessages, maskQuotedValues, XsdValidator } from '../src/index.js';

const SCHEMA = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t" xmlns="urn:t">
  <xs:element name="r"><xs:complexType><xs:sequence>
    <xs:element name="n" type="xs:string" form="unqualified"/>
    <xs:element name="q" form="unqualified"><xs:simpleType><xs:restriction base="xs:decimal"><xs:pattern value="[0-9]+\\.[0-9]{2}"/></xs:restriction></xs:simpleType></xs:element>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const validator = new XsdValidator({ entry: { fileName: 'test.xsd', contents: SCHEMA }, includes: [] });

describe('XsdValidator', () => {
  it('validates and reports issues with masked values', async () => {
    expect(await validator.validate('<t:r xmlns:t="urn:t"><n>x</n><q>1.00</q></t:r>')).toEqual({
      valid: true,
      issues: [],
    });
    const bad = await validator.validate('<t:r xmlns:t="urn:t"><n>x</n><q>MARIO</q></t:r>');
    expect(bad.valid).toBe(false);
    expect(bad.issues[0]?.message).toContain("'[VALUE]'");
    expect(bad.issues[0]?.message).not.toContain('MARIO');
  });

  it('never echoes source lines of malformed documents', async () => {
    const result = await validator.validate('<t:r xmlns:t="urn:t"><n>SEGRETO</t:r>');
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SEGRETO');
  });

  it('refuses DOCTYPE before libxml2 sees it', async () => {
    await expect(
      validator.validate('<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>'),
    ).rejects.toThrow(UnsafeXmlError);
  });

  it('refuses unsafe schema file names', () => {
    expect(
      () => new XsdValidator({ entry: { fileName: '../x.xsd', contents: SCHEMA }, includes: [] }),
    ).toThrow(TypeError);
  });

  it('filters xmllint output', () => {
    expect(
      documentMessages('document.xml:3: parser error : x\n<n>SEGRETO</n>\n   ^\nother.xsd:1: warning'),
    ).toEqual([{ line: 3, message: 'x' }]);
    expect(maskQuotedValues("Element 'q': 'abc' is not a valid value of the atomic type")).toBe(
      "Element 'q': '[VALUE]' is not a valid value of the atomic type",
    );
  });
});
