export const EXCEPTIONS = [
  {
    id: "PAY-10482",
    counterparty: "Northbank Securities",
    amount: "USD 12,450,000",
    cutoff: "15:30 London",
    risk: "High",
    riskClass: "high",
    action: "Approve amended SSI",
    owner: "Treasury Ops",
    instrument: "USD cash wire",
    settlementDate: "2026-05-07",
    reason: "Beneficiary bank mismatch detected during payment screening."
  },
  {
    id: "FX-77210",
    counterparty: "Aster Capital",
    amount: "EUR 8,900,000",
    cutoff: "16:00 Frankfurt",
    risk: "Medium",
    riskClass: "medium",
    action: "Confirm value date",
    owner: "FX Settlements",
    instrument: "EUR/USD spot",
    settlementDate: "2026-05-08",
    reason: "Counterparty confirmation references T+1 while internal booking is T+2."
  },
  {
    id: "COL-31844",
    counterparty: "Harbor Clearing",
    amount: "GBP 2,150,000",
    cutoff: "13:00 London",
    risk: "Low",
    riskClass: "low",
    action: "Acknowledge collateral call",
    owner: "Collateral Management",
    instrument: "Initial margin",
    settlementDate: "2026-05-07",
    reason: "Margin call is inside tolerance but requires same-day acknowledgement."
  },
  {
    id: "PAY-10517",
    counterparty: "Cedar Ridge Asset Mgmt",
    amount: "JPY 1,840,000,000",
    cutoff: "10:00 Tokyo",
    risk: "High",
    riskClass: "high",
    action: "Escalate sanctions review",
    owner: "Payments Control",
    instrument: "JPY cash wire",
    settlementDate: "2026-05-08",
    reason: "Payment is queued pending compliance review against updated routing details."
  }
];