import {
  buildWorkbookXlsx,
  type XlsxCell,
  type XlsxSheet,
} from "./xlsxWriter.js";

export const RELATIONAL_ROW_COUNT = 3_000;

const id = (prefix: string, number: number) =>
  `${prefix}-${String(number).padStart(4, "0")}`;
const dateSerial = (offset: number) => 45_658 + (offset % 730);
const pick = <T>(values: readonly T[], index: number) =>
  values[index % values.length];

export const RELATIONAL_SHEET_NAMES = [
  "Orders",
  "OrderLines",
  "Customers",
  "Products",
  "SalesReps",
  "Regions",
  "Payments",
  "Inventory",
  "Targets",
  "CustomerFeedback",
] as const;

function makeOrders(): XlsxSheet {
  const headers = [
    "Order ID",
    "Order Date",
    "Customer ID",
    "Product ID",
    "Sales Rep ID",
    "Region ID",
    "Payment ID",
    "Channel",
    "Quantity",
    "Unit Price",
    "Discount %",
    "Net Amount",
  ];
  const rows = Array.from({ length: RELATIONAL_ROW_COUNT }, (_, index) => {
    const quantity = (index % 8) + 1;
    const unitPrice = 1_250 + (index % 37) * 125;
    const discount = [0, 0.05, 0.1, 0.15][index % 4];
    return [
      id("ORD", index + 1),
      { date: dateSerial(index) },
      index % 149 === 0 ? "CUST-9999" : id("CUST", (index % 600) + 1),
      index % 197 === 0 ? "PROD-9999" : id("PROD", (index % 800) + 1),
      index % 251 === 0 ? "REP-9999" : id("REP", (index % 100) + 1),
      id("REG", (index % 20) + 1),
      id("PAY", index + 1),
      pick(["Online", "Retail", "Partner", "Mobile"], index),
      quantity,
      unitPrice,
      discount,
      Math.round(quantity * unitPrice * (1 - discount) * 100) / 100,
    ] as XlsxCell[];
  });
  return { name: "Orders", headers, rows, textColumns: [0, 2, 3, 4, 5, 6] };
}

function makeOrderLines(): XlsxSheet {
  const headers = [
    "Line ID",
    "Order ID",
    "Product ID",
    "Quantity",
    "Unit Price",
    "Line Amount",
  ];
  const rows = Array.from({ length: RELATIONAL_ROW_COUNT * 2 }, (_, index) => {
    const quantity = (index % 5) + 1;
    const unitPrice = 900 + (index % 41) * 90;
    return [
      id("LINE", index + 1),
      id("ORD", (Math.floor(index / 2) % RELATIONAL_ROW_COUNT) + 1),
      index % 211 === 0 ? "PROD-9999" : id("PROD", (index % 3_000) + 1),
      quantity,
      unitPrice,
      quantity * unitPrice,
    ] as XlsxCell[];
  });
  return { name: "OrderLines", headers, rows, textColumns: [0, 1, 2] };
}

function makeCustomers(): XlsxSheet {
  const headers = [
    "Customer ID",
    "Customer Name",
    "Email",
    "Phone",
    "Region ID",
    "Segment",
  ];
  const names = [
    "Asha Perera",
    "Bimal Silva",
    "Chamari Fernando",
    "Dinesh Kumar",
    "Eranga Jayasuriya",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("CUST", index + 1),
        index % 100 === 0 ? ` ${pick(names, index)} ` : pick(names, index),
        `customer${String(index + 1).padStart(4, "0")}@example.com`,
        `+9477${String(index % 10_000_000).padStart(7, "0")}`,
        id("REG", (index % 20) + 1),
        pick(["Enterprise", "SMB", "Consumer"], index),
      ] as XlsxCell[],
  );
  return {
    name: "Customers",
    headers,
    rows,
    textColumns: [0, 1, 2, 3, 4],
  };
}

function makeProducts(): XlsxSheet {
  const headers = [
    "Product ID",
    "Description",
    "Category",
    "Unit Cost",
    "Supplier ID",
    "Active",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("PROD", index + 1),
        `Product ${String(index + 1).padStart(4, "0")}`,
        pick(["Hardware", "Software", "Accessory", "Service"], index),
        500 + (index % 63) * 75,
        id("SUP", (index % 300) + 1),
        index % 17 === 0 ? "No" : "Yes",
      ] as XlsxCell[],
  );
  return {
    name: "Products",
    headers,
    rows,
    textColumns: [0, 1, 2, 4],
  };
}

function makeSalesReps(): XlsxSheet {
  const headers = [
    "Sales Rep ID",
    "Rep Name",
    "Email",
    "Region ID",
    "Target Amount",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("REP", index + 1),
        `${pick(["Nimal", "Sajith", "Tharushi", "Malini"], index)} ${index + 1}`,
        `rep${String(index + 1).padStart(4, "0")}@example.com`,
        id("REG", (index % 20) + 1),
        100_000 + (index % 50) * 5_000,
      ] as XlsxCell[],
  );
  return { name: "SalesReps", headers, rows, textColumns: [0, 1, 2, 3] };
}

function makeRegions(): XlsxSheet {
  const headers = [
    "Region ID",
    "Region Name",
    "Country",
    "Manager ID",
    "Currency",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("REG", index + 1),
        index < 20
          ? pick(
              ["Western", "Central", "Southern", "Northern", "Eastern"],
              index,
            )
          : `Region ${index + 1}`,
        "Sri Lanka",
        id("MGR", index + 1),
        "LKR",
      ] as XlsxCell[],
  );
  return { name: "Regions", headers, rows, textColumns: [0, 1, 2, 3, 4] };
}

function makePayments(): XlsxSheet {
  const headers = [
    "Payment ID",
    "Order ID",
    "Payment Date",
    "Method",
    "Amount",
    "Status",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("PAY", index + 1),
        id("ORD", index + 1),
        { date: dateSerial(index + 3) },
        pick(["Card", "Cash", "Bank Transfer", "Online"], index),
        3_000 + (index % 97) * 250,
        index % 43 === 0 ? "Pending" : "Settled",
      ] as XlsxCell[],
  );
  return { name: "Payments", headers, rows, textColumns: [0, 1, 3, 5] };
}

function makeInventory(): XlsxSheet {
  const headers = [
    "Product ID",
    "Warehouse ID",
    "On Hand",
    "Reorder Level",
    "Last Restock",
    "Supplier ID",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("PROD", index + 1),
        id("WH", (index % 12) + 1),
        10 + (index % 400),
        20 + (index % 80),
        { date: dateSerial(index + 60) },
        id("SUP", (index % 300) + 1),
      ] as XlsxCell[],
  );
  return { name: "Inventory", headers, rows, textColumns: [0, 1, 5] };
}

function makeTargets(): XlsxSheet {
  const headers = [
    "Target ID",
    "Region ID",
    "Month",
    "Target Amount",
    "Actual Amount",
    "Variance",
    "Status",
  ];
  const rows = Array.from({ length: RELATIONAL_ROW_COUNT }, (_, index) => {
    const target = 2_000_000 + (index % 12) * 75_000;
    const actual = target + ((index % 9) - 4) * 32_000;
    return [
      id("TARGET", index + 1),
      id("REG", (index % 20) + 1),
      { date: dateSerial(index) },
      target,
      actual,
      actual - target,
      actual >= target ? "On target" : "Below target",
    ] as XlsxCell[];
  });
  return { name: "Targets", headers, rows, textColumns: [0, 1, 6] };
}

function makeCustomerFeedback(): XlsxSheet {
  const headers = [
    "Feedback ID",
    "Customer ID",
    "Order ID",
    "Review Text",
    "Rating",
    "Category",
    "Formula Status",
  ];
  const rows = Array.from(
    { length: RELATIONAL_ROW_COUNT },
    (_, index) =>
      [
        id("FB", index + 1),
        id("CUST", (index % 3_000) + 1),
        id("ORD", (index % 3_000) + 1),
        pick(
          [
            "Fast delivery and helpful support",
            "Product quality was good",
            "Delivery was late",
            "The replacement process was difficult",
          ],
          index,
        ),
        (index % 5) + 1,
        pick(["Delivery", "Quality", "Support", "Billing"], index),
        index % 211 === 0 ? "#VALUE!" : "OK",
      ] as XlsxCell[],
  );
  return {
    name: "CustomerFeedback",
    headers,
    rows,
    textColumns: [0, 1, 2, 3, 5, 6],
  };
}

export function relationalWorkbookSheets(): XlsxSheet[] {
  return [
    makeOrders(),
    makeOrderLines(),
    makeCustomers(),
    makeProducts(),
    makeSalesReps(),
    makeRegions(),
    makePayments(),
    makeInventory(),
    makeTargets(),
    makeCustomerFeedback(),
  ];
}

export function relationalWorkbookXlsx(): Buffer {
  return buildWorkbookXlsx(relationalWorkbookSheets());
}
