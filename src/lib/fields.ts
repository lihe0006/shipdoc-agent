/**
 * Field catalog for Malaysian import shipment document checks.
 *
 * Sources: the box layout of Customs No.1 (K1, Pin.2015/Rev.2015), the
 * ASEAN-China FTA Certificate of Origin (Form E), standard ocean bill of lading
 * (house and master) layouts, and typical commercial invoice / packing list
 * (CIPL) content. Each field lists where it appears on each document so the
 * extractor knows where to look and the comparer knows what "the same field"
 * means across documents.
 */

export const DOC_TYPES = [
  "commercial_invoice",
  "packing_list",
  "bill_of_lading",
  "k1",
  "form_e",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  commercial_invoice: "Commercial invoice",
  packing_list: "Packing list",
  bill_of_lading: "Bill of lading",
  k1: "K1 customs declaration",
  form_e: "Form E (ACFTA CO)",
  other: "Other",
};

export const DOC_TYPE_SHORT: Record<DocType, string> = {
  commercial_invoice: "CI",
  packing_list: "PL",
  bill_of_lading: "BL",
  k1: "K1",
  form_e: "Form E",
  other: "Other",
};

export type FieldCategory =
  | "Parties"
  | "References"
  | "Transport"
  | "Cargo"
  | "Commercial"
  | "Origin & tariff";

export interface FieldDef {
  key: string;
  label: string;
  category: FieldCategory;
  /** Where the field sits on each document type. */
  locations: Partial<Record<DocType, string>>;
  /** Guidance for the comparer: what counts as a real mismatch. */
  rule: string;
}

export const FIELDS: FieldDef[] = [
  // ── Parties ──
  {
    key: "exporter",
    label: "Exporter / shipper",
    category: "Parties",
    locations: {
      commercial_invoice: "Seller / issuer letterhead",
      packing_list: "Issuer letterhead",
      bill_of_lading: "Shipper box",
      k1: "Box 1 Consignor / Exporter",
      form_e: "Box 1 Products consigned from (exporter)",
    },
    rule:
      "Compare legal entity names ignoring punctuation, case and 'Co./Company', 'Sdn Bhd/Sdn. Bhd.', 'LLC/L.L.C.'. A different entity on Form E is acceptable ONLY if box 13 'Third Party Invoicing' is ticked and the invoicing party named in box 7 matches the CI seller. A Master BL shipper is usually the origin forwarder, not the seller; compare the House BL shipper to the seller.",
  },
  {
    key: "importer",
    label: "Importer / consignee",
    category: "Parties",
    locations: {
      commercial_invoice: "Bill to / Ship to",
      packing_list: "Ship to",
      bill_of_lading: "Consignee box",
      k1: "Box 2 Consignee / Importer",
      form_e: "Box 2 Products consigned to",
    },
    rule:
      "Must be the same Malaysian entity on all documents. Address formatting and line breaks are not mismatches; a different entity, missing 'Sdn Bhd' or a 'To order' BL without endorsement is.",
  },
  {
    key: "notify_party",
    label: "Notify party",
    category: "Parties",
    locations: { bill_of_lading: "Notify party box" },
    rule: "Informational. 'Same as consignee' is acceptable.",
  },
  {
    key: "declarant_agent",
    label: "Forwarding / customs agent",
    category: "Parties",
    locations: {
      k1: "Box 3 Authorized agent",
      bill_of_lading: "Delivery agent / party to contact for cargo release",
    },
    rule: "Informational; different agents on K1 and BL are common.",
  },

  // ── References ──
  {
    key: "invoice_numbers",
    label: "Invoice number(s)",
    category: "References",
    locations: {
      commercial_invoice: "Invoice no. (one per invoice)",
      packing_list: "Packing list / order no.",
      bill_of_lading: "Description area, often 'PO NO' or 'INV NO'",
      k1: "Box 35 Invoice no.",
      form_e: "Box 10 Number and date of invoices",
    },
    rule:
      "The set of invoice numbers should match across documents. Treat letter-O vs digit-0 confusions and line wraps as minor. A missing or extra invoice is a mismatch.",
  },
  {
    key: "invoice_date",
    label: "Invoice date",
    category: "References",
    locations: {
      commercial_invoice: "Invoice date",
      form_e: "Box 10 invoice date",
    },
    rule: "Dates must be the same calendar date regardless of format.",
  },
  {
    key: "bl_number",
    label: "Bill of lading no.",
    category: "References",
    locations: {
      bill_of_lading: "B/L No. (house and/or master)",
      k1: "Box 20 Bill of lading / consignment note no.",
    },
    rule:
      "K1 box 20 should quote the BL the importer receives (usually the House BL). A House BL's 'shipper's reference' often quotes the Master BL number; link them rather than flagging.",
  },
  {
    key: "form_e_reference",
    label: "Form E reference no.",
    category: "References",
    locations: {
      form_e: "Reference No. (top right)",
      k1: "Box 21 Special treatment and/or preferential claim declaration text",
    },
    rule: "Must match exactly when preferential duty is claimed on K1.",
  },
  {
    key: "form_e_issue_date",
    label: "Form E issue date",
    category: "References",
    locations: {
      form_e: "Box 11 place and date of declaration / box 12 certification date",
      k1: "Preferential claim text 'date of issue'",
    },
    rule: "Must be the same date. Form E should be issued no later than shipment (or marked 'Issued retroactively').",
  },

  // ── Transport ──
  {
    key: "vessel_voyage",
    label: "Vessel / voyage",
    category: "Transport",
    locations: {
      bill_of_lading: "Ocean vessel / voyage no.",
      k1: "Box 6 Name of vessel / flight",
      form_e: "Box 3 Vessel's name / aircraft",
    },
    rule:
      "Vessel names must match; voyage omitted on one document is minor. A different vessel is a mismatch (common when cargo is rolled to another sailing after Form E is issued).",
  },
  {
    key: "departure_date",
    label: "Departure / on-board date",
    category: "Transport",
    locations: {
      bill_of_lading: "Shipped on board date / laden on board date",
      form_e: "Box 3 Departure date",
    },
    rule: "Should be the same date. A difference of more than a few days usually means the vessel changed.",
  },
  {
    key: "arrival_date",
    label: "Import / arrival date",
    category: "Transport",
    locations: { k1: "Box 5 Date of import" },
    rule: "Must be after the departure date.",
  },
  {
    key: "port_of_loading",
    label: "Port of loading",
    category: "Transport",
    locations: {
      bill_of_lading: "Port of loading",
      k1: "Box 8 Port / place of loading",
      form_e: "Box 3 route 'From …'",
    },
    rule: "Same port (UN/LOCODE or name). Place of receipt differing from port of loading is not a mismatch.",
  },
  {
    key: "port_of_discharge",
    label: "Port of discharge",
    category: "Transport",
    locations: {
      bill_of_lading: "Port of discharge",
      k1: "Box 7 Port / place of import",
      form_e: "Box 3 Port of discharge",
    },
    rule: "Same Malaysian port. 'Port Klang' vs 'MYPKG' vs 'Port Klang (P)' are the same.",
  },
  {
    key: "place_of_delivery",
    label: "Place of delivery",
    category: "Transport",
    locations: { bill_of_lading: "Place of delivery" },
    rule: "Informational.",
  },
  {
    key: "freight_terms",
    label: "Freight terms",
    category: "Transport",
    locations: {
      bill_of_lading: "Freight prepaid / collect",
      k1: "Box 25 Freight amount",
      commercial_invoice: "Implied by incoterm",
    },
    rule:
      "House BL freight terms should be consistent with the incoterm (EXW/FOB → collect; CFR/CIF → prepaid). Master and House BL can legitimately differ.",
  },

  // ── Cargo ──
  {
    key: "container_numbers",
    label: "Container / seal no.",
    category: "Cargo",
    locations: {
      bill_of_lading: "Marks & numbers / container no. seal no.",
      k1: "Box 29 Container no.",
    },
    rule: "Container numbers must match exactly (4 letters + 7 digits).",
  },
  {
    key: "marks_numbers",
    label: "Shipping marks",
    category: "Cargo",
    locations: {
      bill_of_lading: "Marks & numbers",
      k1: "Box 29 Marks and nos.",
      form_e: "Box 6 Marks and numbers on packages",
      packing_list: "Shipping marks",
    },
    rule: "'N/M' (no marks) vs actual marks is minor.",
  },
  {
    key: "package_count",
    label: "No. & type of packages",
    category: "Cargo",
    locations: {
      bill_of_lading: "No. of packages + total in words",
      k1: "Box 30/31 Number and type of packages",
      packing_list: "Total cartons / pallets",
      commercial_invoice: "Total cartons",
      form_e: "Box 7 number and type of packages",
    },
    rule:
      "Compare like with like. Pallets (outer) vs cartons (inner) are different packing levels and are NOT a mismatch if both are internally consistent; flag only when the same package type has a different count, or when the in-words total disagrees with the figure.",
  },
  {
    key: "gross_weight",
    label: "Gross weight (kg)",
    category: "Cargo",
    locations: {
      bill_of_lading: "Gross weight",
      k1: "Box 26 Gross weight",
      packing_list: "Total gross weight",
      commercial_invoice: "Gross weight",
    },
    rule:
      "BL and K1 must match exactly. CIPL carton-level weight can be lower than the palletised BL weight; treat as minor with an explanation, unless the CIPL total is higher than the BL.",
  },
  {
    key: "measurement_cbm",
    label: "Measurement (CBM)",
    category: "Cargo",
    locations: {
      bill_of_lading: "Measurement m³",
      k1: "Box 27 Measurement",
      packing_list: "Total volume",
    },
    rule: "BL and K1 must match. Packing list carton CBM below palletised CBM is minor.",
  },
  {
    key: "goods_description",
    label: "Goods description",
    category: "Cargo",
    locations: {
      commercial_invoice: "Item descriptions",
      bill_of_lading: "Description of goods",
      k1: "Box 32 Description of goods",
      form_e: "Box 7 description",
    },
    rule: "Same goods in substance; wording and level of detail can differ.",
  },
  {
    key: "total_quantity",
    label: "Total quantity",
    category: "Cargo",
    locations: {
      commercial_invoice: "Sum of line quantities",
      packing_list: "Sum of shipped quantities",
      form_e: "Sum of box 9 quantities",
      k1: "Sum of box 37 quantities (often in KGM, not pieces)",
    },
    rule: "Compare in the same unit only. K1 tariff-unit quantities (KGM) cannot be compared with pieces.",
  },

  // ── Commercial ──
  {
    key: "incoterms",
    label: "Incoterms",
    category: "Commercial",
    locations: {
      commercial_invoice: "Terms of delivery / incoterm",
      k1: "Value basis (FOB box 28 / CIF box 24)",
    },
    rule:
      "K1 always declares FOB and CIF values. If the invoice is EXW, check that inland/origin charges were handled; EXW invoice vs FOB declaration is a minor difference to review, not a hard mismatch.",
  },
  {
    key: "currency",
    label: "Invoice currency",
    category: "Commercial",
    locations: {
      commercial_invoice: "Currency",
      k1: "Invoice value currency + exchange rate",
    },
    rule: "Must match.",
  },
  {
    key: "invoice_total",
    label: "Invoice value",
    category: "Commercial",
    locations: {
      commercial_invoice: "Invoice total (sum across all invoices)",
      k1: "Invoice value (FOB) in foreign currency",
      form_e: "Box 9 FOB value (only when RVC criterion applies)",
    },
    rule:
      "K1 foreign-currency invoice value must equal the sum of all invoice totals exactly. Rounding under 0.01 is a match.",
  },
  {
    key: "payment_country",
    label: "Country of payment / export",
    category: "Commercial",
    locations: { k1: "Box 17 Payment for goods to be made to (country)" },
    rule: "Should be the country of the invoicing party.",
  },

  // ── Origin & tariff ──
  {
    key: "country_of_origin",
    label: "Country of origin",
    category: "Origin & tariff",
    locations: {
      commercial_invoice: "Country of origin per line",
      packing_list: "COO per line",
      k1: "Box 36 Country of origin code",
      form_e: "Box 11 'produced in' / Issued in",
    },
    rule: "Must be the same country (CN = China = People's Republic of China).",
  },
  {
    key: "hs_code",
    label: "HS code",
    category: "Origin & tariff",
    locations: {
      commercial_invoice: "HTS / HS code per line",
      bill_of_lading: "HS code in description",
      k1: "Box 33 Tariff code (Malaysian 10-digit)",
      form_e: "Box 7 HS number (6-digit)",
    },
    rule:
      "Compare at the 6-digit level (dots and spaces ignored). K1 adds national digits. A different 6-digit heading is a mismatch and may void the Form E preference.",
  },
  {
    key: "origin_criterion",
    label: "Origin criterion",
    category: "Origin & tariff",
    locations: { form_e: "Box 8 Origin criteria (WO / PE / RVC / PSR)" },
    rule: "Informational per line.",
  },
];

export const FIELD_KEYS = FIELDS.map((f) => f.key) as [string, ...string[]];
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<string, FieldDef>;

/** Renders the catalog as prompt text. */
export function fieldCatalogText(): string {
  return FIELDS.map((f) => {
    const loc = Object.entries(f.locations)
      .map(([d, where]) => `${DOC_TYPE_SHORT[d as DocType]}: ${where}`)
      .join("; ");
    return `- ${f.key} — ${f.label} [${f.category}]\n  where: ${loc}\n  rule: ${f.rule}`;
  }).join("\n");
}
