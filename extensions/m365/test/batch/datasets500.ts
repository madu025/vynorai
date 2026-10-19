/**
 * Five fresh test datasets (retail, HR, finance, inventory, support) with the traits that break
 * spreadsheet tools: leading-zero IDs, dates as numbers and as text, blanks, duplicate rows, stray
 * spaces, Sinhala text, mixed-case categories. Deterministic (seeded), 300 rows each. Used by the
 * 500-prompt real-model run and written to extensions/m365/test-data/xlsx for live testing.
 */
export type Kind =
  | "id"
  | "category"
  | "name"
  | "date"
  | "text-date"
  | "measure"
  | "percent"
  | "free";
export type Column = { name: string; kind: Kind };
export type Dataset = {
  id: string;
  sheet: string;
  columns: Column[];
  rows: Array<Array<string | number | null>>;
};

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)];
const int = (random: () => number, low: number, high: number) =>
  low + Math.floor(random() * (high - low + 1));
const pad = (value: number, width: number) =>
  String(value).padStart(width, "0");
const DATE_START = 45658; // 2025-01-01

function build(
  id: string,
  sheet: string,
  columns: Column[],
  seed: number,
  make: (random: () => number, index: number) => Array<string | number | null>,
): Dataset {
  const random = rng(seed);
  const rows = Array.from({ length: 300 }, (_, index) => make(random, index));
  // Realistic mess: duplicates, blanks, stray spaces.
  for (let index = 0; index < 15; index += 1)
    rows[280 + index] = [...rows[index * 3]];
  columns.forEach((column, columnIndex) => {
    if (column.kind === "category" || column.kind === "name") {
      for (let index = 0; index < 8; index += 1) {
        const row = rows[int(random, 0, 279)];
        if (typeof row[columnIndex] === "string")
          row[columnIndex] = ` ${row[columnIndex]}  `;
      }
    }
    if (column.kind === "measure" || column.kind === "free") {
      for (let index = 0; index < 6; index += 1)
        rows[int(random, 0, 279)][columnIndex] = null;
    }
  });
  return { id, sheet, columns, rows };
}

const SINHALA = [
  "කසුන්",
  "නිමල්",
  "සුනිල්",
  "දිල්ශාන්",
  "චමරි",
  "අනුරාධා",
  "ප්‍රසාද්",
  "තිලිණි",
];
const EN_NAMES = [
  "Asha Perera",
  "Bimal Silva",
  "Chamari Fernando",
  "Dinesh Kumar",
  "Eranga Jayasuriya",
  "Farah Nazeer",
  "Gayan Wickrama",
  "Hiruni Senanayake",
];

export const DATASETS: Dataset[] = [
  build(
    "retail",
    "Orders",
    [
      { name: "Order No", kind: "id" },
      { name: "Order Date", kind: "date" },
      { name: "Customer", kind: "name" },
      { name: "Region", kind: "category" },
      { name: "Product", kind: "category" },
      { name: "Category", kind: "category" },
      { name: "Qty", kind: "measure" },
      { name: "Unit Price", kind: "measure" },
      { name: "Discount %", kind: "percent" },
      { name: "Net Amount", kind: "measure" },
      { name: "Payment Method", kind: "category" },
    ],
    11,
    (random, index) => {
      const qty = int(random, 1, 20);
      const price = int(random, 5, 500) * 10;
      const discount = pick(random, [0, 0.05, 0.1, 0.15]);
      return [
        pad(index + 1, 6),
        DATE_START + int(random, 0, 300),
        pick(random, EN_NAMES),
        pick(random, ["Western", "Central", "Southern", "Northern", "Eastern"]),
        pick(random, [
          "Laptop",
          "Phone",
          "Router",
          "Cable",
          "Monitor",
          "Printer",
        ]),
        pick(random, ["Computing", "Mobile", "Network", "Accessories"]),
        qty,
        price,
        discount,
        Math.round(qty * price * (1 - discount)),
        pick(random, ["Card", "Cash", "Bank Transfer", "Online"]),
      ];
    },
  ),
  build(
    "hr",
    "Staff",
    [
      { name: "Employee ID", kind: "id" },
      { name: "Full Name", kind: "name" },
      { name: "Department", kind: "category" },
      { name: "Designation", kind: "category" },
      { name: "Join Date", kind: "date" },
      { name: "Salary (LKR)", kind: "measure" },
      { name: "Bonus", kind: "measure" },
      { name: "Status", kind: "category" },
      { name: "Manager", kind: "name" },
      { name: "Location", kind: "category" },
    ],
    23,
    (random, index) => [
      `E${pad(index + 1, 5)}`,
      random() < 0.3
        ? `${pick(random, SINHALA)} ${pick(random, SINHALA)}`
        : pick(random, EN_NAMES),
      pick(random, ["Finance", "Engineering", "Sales", "Operations", "HR"]),
      pick(random, ["Executive", "Manager", "Engineer", "Analyst", "Clerk"]),
      DATE_START - int(random, 0, 3000),
      int(random, 60, 450) * 1000,
      int(random, 0, 50) * 1000,
      pick(random, ["Active", "On Leave", "Resigned"]),
      pick(random, EN_NAMES),
      pick(random, ["Colombo", "Kandy", "Galle", "Jaffna"]),
    ],
  ),
  build(
    "finance",
    "Ledger",
    [
      { name: "Voucher No", kind: "id" },
      { name: "Posting Date", kind: "text-date" },
      { name: "Account Code", kind: "id" },
      { name: "Account Name", kind: "category" },
      { name: "Debit", kind: "measure" },
      { name: "Credit", kind: "measure" },
      { name: "Cost Centre", kind: "category" },
      { name: "Currency", kind: "category" },
      { name: "Narration", kind: "free" },
      { name: "Approved By", kind: "name" },
    ],
    37,
    (random, index) => {
      const debit = random() < 0.5 ? int(random, 1, 900) * 100 : 0;
      const day = int(random, 0, 330);
      const date = new Date(Date.UTC(2025, 0, 1 + day))
        .toISOString()
        .slice(0, 10);
      return [
        `V${pad(index + 1, 7)}`,
        date,
        pad(int(random, 1, 90), 4),
        pick(random, [
          "Sales Revenue",
          "Salaries",
          "Rent",
          "Utilities",
          "Inventory",
          "Bank Charges",
        ]),
        debit,
        debit ? 0 : int(random, 1, 900) * 100,
        pick(random, ["CC-HQ", "CC-OPS", "CC-SALES"]),
        pick(random, ["LKR", "LKR", "LKR", "USD"]),
        pick(random, [
          "Monthly payment",
          "Invoice settled",
          "Adjustment entry",
          "Advance",
          "Refund",
        ]),
        pick(random, EN_NAMES),
      ];
    },
  ),
  build(
    "inventory",
    "Stock",
    [
      { name: "SKU", kind: "id" },
      { name: "Warehouse", kind: "category" },
      { name: "Category", kind: "category" },
      { name: "On Hand", kind: "measure" },
      { name: "Reorder Level", kind: "measure" },
      { name: "Unit Cost", kind: "measure" },
      { name: "Last Counted", kind: "date" },
      { name: "Supplier", kind: "category" },
      { name: "Lead Time Days", kind: "measure" },
      { name: "Status", kind: "category" },
    ],
    41,
    (random, index) => [
      `00${pad(index + 1, 5)}`,
      pick(random, ["WH-Colombo", "WH-Kandy", "WH-Galle"]),
      pick(random, ["Raw", "Finished", "Packaging", "Spare"]),
      int(random, 0, 500),
      int(random, 20, 120),
      int(random, 10, 900) * 5,
      DATE_START + int(random, 0, 300),
      pick(random, ["Acme", "Globex", "Initech", "Umbrella"]),
      int(random, 2, 45),
      pick(random, ["OK", "Low", "Discontinued"]),
    ],
  ),
  build(
    "support",
    "Tickets",
    [
      { name: "Ticket ID", kind: "id" },
      { name: "Opened", kind: "date" },
      { name: "Closed", kind: "date" },
      { name: "Priority", kind: "category" },
      { name: "Channel", kind: "category" },
      { name: "Agent", kind: "name" },
      { name: "Customer", kind: "name" },
      { name: "Category", kind: "category" },
      { name: "Resolution Hours", kind: "measure" },
      { name: "CSAT", kind: "measure" },
    ],
    53,
    (random, index) => {
      const opened = DATE_START + int(random, 0, 300);
      return [
        `T-${pad(index + 1, 5)}`,
        opened,
        opened + int(random, 0, 9),
        pick(random, ["Low", "Medium", "High", "Critical"]),
        pick(random, ["Email", "Phone", "Chat", "Web"]),
        pick(random, EN_NAMES),
        pick(random, EN_NAMES),
        pick(random, ["Billing", "Technical", "Account", "Delivery"]),
        int(random, 1, 96),
        int(random, 1, 5),
      ];
    },
  ),
];
