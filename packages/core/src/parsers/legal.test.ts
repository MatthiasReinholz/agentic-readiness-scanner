import { describe, expect, it } from 'vitest';

import {
  findIdentifiers,
  isValidCnpj,
  isValidCuit,
  isValidNit,
  isValidRuc,
  isValidRut,
  isValidSwissUid,
  officialWithdrawalLanguage,
} from './legal.js';

describe('identifier check digits', () => {
  it('accepts real and well-formed numbers and rejects a changed digit', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('11.111.111/1111-11')).toBe(false);
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12.345.678-K')).toBe(false);
    // DIAN's own NIT and the RUC of Banco de Crédito del Perú.
    expect(isValidNit('800.197.268-4')).toBe(true);
    expect(isValidNit('800.197.268-5')).toBe(false);
    expect(isValidRuc('20100047218')).toBe(true);
    expect(isValidRuc('20100047219')).toBe(false);
    expect(isValidCuit('20-12345678-6')).toBe(true);
    expect(isValidCuit('20-12345678-7')).toBe(false);
    expect(isValidSwissUid('CHE-116.281.710')).toBe(true);
    expect(isValidSwissUid('CHE-116.281.711')).toBe(false);
  });

  it('finds identifiers in context and tags whether they validate', () => {
    const found = findIdentifiers(
      'Example GmbH · USt-IdNr.: DE 123 456 789 · Registered in England and Wales, company number 01234567 · CNPJ 11.222.333/0001-82 · RUT 12.345.678-5',
    );
    expect(found).toEqual(
      expect.arrayContaining([
        { scheme: 'eu-vat', value: 'DE123456789', valid: true },
        { scheme: 'uk-company', value: '01234567', valid: true },
        { scheme: 'br-cnpj', value: '11.222.333/0001-82', valid: false },
        { scheme: 'cl-rut', value: '12.345.678-5', valid: true },
      ]),
    );
  });
});

describe('official withdrawal labels', () => {
  it('recognises the Article 11a label in any official language, case and quotes aside', () => {
    expect(officialWithdrawalLanguage('Vertrag widerrufen')).toBe('de');
    expect(officialWithdrawalLanguage('“Withdraw from contract here”')).toBe('en');
    expect(officialWithdrawalLanguage('Renoncer au contrat ici')).toBe('fr');
    expect(officialWithdrawalLanguage('Widerrufsformular')).toBeNull();
  });
});
