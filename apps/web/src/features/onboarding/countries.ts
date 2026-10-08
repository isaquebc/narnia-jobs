/** Países mais comuns para o público-alvo. Código ISO-2, nome em pt-BR, DDI e dígitos do código de área (0 = sem área). */
export interface CountryInfo {
  code: string;
  name: string;
  dial: string;
  areaDigits: number;
  numberDigits: [number, number];
  currency: string;
  timezone: string;
}

export const COUNTRIES: CountryInfo[] = [
  {
    code: "BR",
    name: "Brasil",
    dial: "+55",
    areaDigits: 2,
    numberDigits: [8, 9],
    currency: "BRL",
    timezone: "America/Sao_Paulo",
  },
  {
    code: "PT",
    name: "Portugal",
    dial: "+351",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "EUR",
    timezone: "Europe/Lisbon",
  },
  {
    code: "US",
    name: "Estados Unidos",
    dial: "+1",
    areaDigits: 3,
    numberDigits: [7, 7],
    currency: "USD",
    timezone: "America/New_York",
  },
  {
    code: "CA",
    name: "Canadá",
    dial: "+1",
    areaDigits: 3,
    numberDigits: [7, 7],
    currency: "CAD",
    timezone: "America/Toronto",
  },
  {
    code: "GB",
    name: "Reino Unido",
    dial: "+44",
    areaDigits: 0,
    numberDigits: [9, 10],
    currency: "GBP",
    timezone: "Europe/London",
  },
  {
    code: "IE",
    name: "Irlanda",
    dial: "+353",
    areaDigits: 0,
    numberDigits: [7, 9],
    currency: "EUR",
    timezone: "Europe/Dublin",
  },
  {
    code: "DE",
    name: "Alemanha",
    dial: "+49",
    areaDigits: 0,
    numberDigits: [6, 11],
    currency: "EUR",
    timezone: "Europe/Berlin",
  },
  {
    code: "NL",
    name: "Países Baixos",
    dial: "+31",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "EUR",
    timezone: "Europe/Amsterdam",
  },
  {
    code: "ES",
    name: "Espanha",
    dial: "+34",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "EUR",
    timezone: "Europe/Madrid",
  },
  {
    code: "FR",
    name: "França",
    dial: "+33",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "EUR",
    timezone: "Europe/Paris",
  },
  {
    code: "IT",
    name: "Itália",
    dial: "+39",
    areaDigits: 0,
    numberDigits: [6, 11],
    currency: "EUR",
    timezone: "Europe/Rome",
  },
  {
    code: "CH",
    name: "Suíça",
    dial: "+41",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "CHF",
    timezone: "Europe/Zurich",
  },
  {
    code: "SE",
    name: "Suécia",
    dial: "+46",
    areaDigits: 0,
    numberDigits: [7, 10],
    currency: "SEK",
    timezone: "Europe/Stockholm",
  },
  {
    code: "PL",
    name: "Polônia",
    dial: "+48",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "PLN",
    timezone: "Europe/Warsaw",
  },
  {
    code: "AR",
    name: "Argentina",
    dial: "+54",
    areaDigits: 0,
    numberDigits: [10, 10],
    currency: "ARS",
    timezone: "America/Argentina/Buenos_Aires",
  },
  {
    code: "CL",
    name: "Chile",
    dial: "+56",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "CLP",
    timezone: "America/Santiago",
  },
  {
    code: "CO",
    name: "Colômbia",
    dial: "+57",
    areaDigits: 0,
    numberDigits: [10, 10],
    currency: "COP",
    timezone: "America/Bogota",
  },
  {
    code: "MX",
    name: "México",
    dial: "+52",
    areaDigits: 0,
    numberDigits: [10, 10],
    currency: "MXN",
    timezone: "America/Mexico_City",
  },
  {
    code: "UY",
    name: "Uruguai",
    dial: "+598",
    areaDigits: 0,
    numberDigits: [8, 8],
    currency: "UYU",
    timezone: "America/Montevideo",
  },
  {
    code: "AU",
    name: "Austrália",
    dial: "+61",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "AUD",
    timezone: "Australia/Sydney",
  },
  {
    code: "NZ",
    name: "Nova Zelândia",
    dial: "+64",
    areaDigits: 0,
    numberDigits: [8, 10],
    currency: "NZD",
    timezone: "Pacific/Auckland",
  },
  {
    code: "JP",
    name: "Japão",
    dial: "+81",
    areaDigits: 0,
    numberDigits: [9, 10],
    currency: "JPY",
    timezone: "Asia/Tokyo",
  },
  {
    code: "AE",
    name: "Emirados Árabes",
    dial: "+971",
    areaDigits: 0,
    numberDigits: [8, 9],
    currency: "AED",
    timezone: "Asia/Dubai",
  },
  {
    code: "AO",
    name: "Angola",
    dial: "+244",
    areaDigits: 0,
    numberDigits: [9, 9],
    currency: "AOA",
    timezone: "Africa/Luanda",
  },
  {
    code: "MZ",
    name: "Moçambique",
    dial: "+258",
    areaDigits: 0,
    numberDigits: [8, 9],
    currency: "MZN",
    timezone: "Africa/Maputo",
  },
];

export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code);

export const CURRENCIES = ["BRL", "USD", "EUR", "GBP", "CAD", "CHF", "AUD"] as const;

/** Fusos IANA disponíveis no navegador (com fallback para uma lista curta). */
export function listTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const all = intl.supportedValuesOf?.("timeZone");
    if (all && all.length > 0) return all;
  } catch {
    // navegador antigo
  }
  return [...new Set(COUNTRIES.map((c) => c.timezone).concat("UTC"))].sort();
}
