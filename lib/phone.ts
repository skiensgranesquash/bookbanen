/**
 * Normaliserer et norsk mobilnummer til 8 siffer uten landkode (formatet
 * Vipps' ePayment API forventer i customer.phoneNumber), eller returnerer
 * null hvis input ikke ser ut som et gyldig norsk mobilnummer.
 */
export function normalizeNorwegianMobile(input: string): string | null {
  const digitsOnly = input.replace(/[^\d]/g, "");

  let national = digitsOnly;
  if (national.startsWith("0047")) national = national.slice(4);
  else if (national.startsWith("47") && national.length === 10) national = national.slice(2);

  if (!/^\d{8}$/.test(national)) return null;
  if (!/^[49]/.test(national)) return null; // norske mobilnummer starter på 4 eller 9

  return national;
}
