import { db } from "../db.js";
import { financialYear, indiaDate } from "../time.js";

/** Hands out EWS/INV/YY-YY/NNN (or QT, RP, LT) numbers, one sequence per type and financial year. */
export async function nextDocumentNumber(kind: "INV" | "QT" | "RP" | "LT", onDate: string = indiaDate()): Promise<string> {
  const fy = financialYear(onDate);
  const key = `${kind}/${fy}`;
  const [row] = await db()`
    INSERT INTO sequence_counters (name, value) VALUES (${key}, 1)
    ON CONFLICT (name) DO UPDATE SET value = sequence_counters.value + 1
    RETURNING value`;
  return `EWS/${kind}/${fy}/${String(row.value).padStart(3, "0")}`;
}
