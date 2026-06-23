export const couples = [
  { id: "us", shortName: "孙张", fullName: "孙晟 / 张心怡" },
  { id: "them", shortName: "胡董", fullName: "胡锦康 / 董瑞欣" },
];

export function coupleName(id) {
  return couples.find((couple) => couple.id === id)?.shortName || id;
}

export function formatPayerLabel(id) {
  return `${coupleName(id)}付款`;
}

export function formatSettlementDirection(netOtherOwesUs) {
  if (netOtherOwesUs > 0) return "胡董还需给孙张";
  if (netOtherOwesUs < 0) return "孙张还需给胡董";
  return "两边已结清";
}
