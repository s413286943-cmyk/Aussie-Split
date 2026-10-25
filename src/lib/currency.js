// Currencies the ledger accepts. NZD needs the matching Supabase migration
// (supabase/migrations/20261025090000_allow_nzd_currency.sql) before production writes succeed.
export const supportedCurrencies = ["NZD", "CNY", "AUD"];

const currencyPrefixes = {
  CNY: "¥",
  NZD: "NZ$",
  AUD: "A$",
};

export function isSupportedCurrency(currency) {
  return supportedCurrencies.includes(currency);
}

export function currencyPrefix(currency) {
  return currencyPrefixes[currency] ?? `${currency} `;
}

export function formatCurrencyAmount(currency, amount) {
  const value = Number(amount || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currencyPrefix(currency)}${value}`;
}
