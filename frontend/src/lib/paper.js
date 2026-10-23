/**
 * Paper sizes a bill can be printed on (Settings default, or ?paper= on the bill page).
 * Rolls are thermal receipt printers and print the narrow receipt layout; sheets print a
 * full-page invoice. `fontSize` is the base size each layout scales from.
 */
export const BILL_PAPERS = {
  "58mm": { label: "58 mm thermal roll", roll: true, width: 58, fontSize: "10px", logoWidth: 26 },
  "80mm": { label: "80 mm thermal roll", roll: true, width: 80, fontSize: "11.5px", logoWidth: 34 },
  a5: { label: "A5 sheet", width: 148, height: 210, fontSize: "9.5px" },
  a4: { label: "A4 sheet", width: 210, height: 297, fontSize: "12px" },
  a3: { label: "A3 sheet", width: 297, height: 420, fontSize: "16.5px" },
};

export const DEFAULT_PAPER = "80mm";

export const paperFor = (key) => (BILL_PAPERS[key] ? key : DEFAULT_PAPER);
