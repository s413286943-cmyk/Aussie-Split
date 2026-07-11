export const seedExpenses = [
  expense("hotel-oaks-melbourne", "酒店", "Oaks Melbourne on Market Hotel", "2026-07-29", "CNY", 2534.86, "墨尔本 CBD，2晚"),
  expense("hotel-seaview", "酒店", "Seaview Motel & Apartments", "2026-07-31", "CNY", 906.28, "Apollo Bay，1晚"),
  expense("hotel-southern-ocean", "酒店", "Southern Ocean Villas", "2026-08-01", "CNY", 1691.52, "Port Campbell，1晚"),
  expense("hotel-holiday-inn", "酒店", "Holiday Inn Melbourne Airport", "2026-08-02", "CNY", 1581.12, "墨尔本机场，1晚，2间房"),
  expense("hotel-southern-cross", "酒店", "Southern Cross Atrium Apartments", "2026-08-03", "CNY", 9669.66, "凯恩斯，5晚"),
  expense("hotel-oaks-sydney", "酒店", "Oaks Sydney Goldsbrough Suites", "2026-08-08", "CNY", 9661.82, "悉尼，5晚"),
  expense("car-great-ocean", "租车", "墨尔本—大洋路租车，含保险", "2026-07-31", "CNY", 2746, "已锁定，含保险"),
  expense("car-atherton", "租车", "凯恩斯阿瑟顿租车，不含保险", "2026-08-06", "CNY", 752, "不含保险，后续如补保险另算"),
  expense("tour-daintree", "活动", "Billy Tea Daintree Rainforest & Cape Tribulation Tour", "2026-08-05", "AUD", 956, "4 adults，按原币记录"),
  expense("tour-whale", "活动", "Captain Cook Whale Watching", "2026-08-11", "AUD", 340.2, "已付款，含 fuel surcharge / card surcharge"),
];

function expense(id, category, item, date, currency, amount, note) {
  return {
    id,
    category,
    item,
    date,
    currency,
    amount,
    payer: "us",
    status: "confirmed",
    note,
    attachmentName: "",
    splitSettled: false,
  };
}
