export type ActualOperation =
  | "create"
  | "replace"
  | "create-many"
  | "append"
  | "update"
  | "select"
  | "swap"
  | "remove"
  | "clear";

type ActualResult = {
  elapsedMs: number;
  frameElapsedMs: number;
  rowCount: number;
  selectedCount: number;
  firstLabel: string;
  passed: boolean;
};

type ActualMemoryResult = {
  cycles: number;
  rowsPerCycle: number;
  aliveBeforeReturn: number;
  passed: boolean;
};

declare global {
  interface Window {
    __actualBenchmark?: {
      run(operation: ActualOperation): Promise<ActualResult>;
      memory(cycles: number): Promise<ActualMemoryResult>;
      memorySurvivors(): number;
      releaseMemoryRefs(): void;
    };
  }
}

const button = (id: string) => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing benchmark button: #${id}`);
  }
  return element;
};

const rows = () => document.querySelectorAll("tbody tr");

function rowIds() {
  return Array.from(
    rows(),
    (row) => row.querySelector("td")?.textContent ?? "",
  );
}

function rowNodes() {
  return Array.from(rows());
}

function firstLabel() {
  return document.querySelector("tbody tr td:nth-child(2)")?.textContent ?? "";
}

function selectedCount() {
  return document.querySelectorAll("tbody tr.danger").length;
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const profilingEnabled = new URLSearchParams(window.location.search).has(
  "profile",
);
let memoryRefs: Array<WeakRef<Element>> | undefined;
function markProfile(name: string) {
  if (profilingEnabled) performance.mark(name);
}

async function settleForMemory() {
  await nextFrame();
  if (typeof window.gc !== "function") {
    throw new Error(
      "window.gc is unavailable; launch Chromium with exposed GC",
    );
  }
  window.gc();
  await new Promise((resolve) => setTimeout(resolve, 25));
  window.gc();
}

function prepare(operation: ActualOperation) {
  if (
    operation === "replace" ||
    operation === "append" ||
    operation === "update" ||
    operation === "select" ||
    operation === "swap" ||
    operation === "remove" ||
    operation === "clear"
  ) {
    button("run").click();
  }
}

function perform(operation: ActualOperation) {
  switch (operation) {
    case "create":
    case "replace":
      button("run").click();
      return;
    case "create-many":
      button("runlots").click();
      return;
    case "append":
      button("add").click();
      return;
    case "update":
      button("update").click();
      return;
    case "select":
      document
        .querySelector("tbody tr:nth-child(2) td:nth-child(2) a")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      return;
    case "swap":
      button("swaprows").click();
      return;
    case "remove":
      document
        .querySelector("tbody tr:nth-child(5) td:nth-child(3) a")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      return;
    case "clear":
      button("clear").click();
      return;
  }
}

function verify(
  operation: ActualOperation,
  beforeRows: Element[],
  beforeLabels: string[],
) {
  const afterIds = rowIds();
  const afterRows = rowNodes();
  const beforeCount = beforeRows.length;
  const rowCount = afterIds.length;
  const rowsPreserved = beforeRows.every((row) => afterRows.includes(row));
  const rowsReplaced = beforeRows.every((row) => !afterRows.includes(row));
  const updatedLabels = beforeLabels.every((label, index) => {
    const afterLabel =
      afterRows[index]?.querySelector("td:nth-child(2)")?.textContent ?? "";
    return index % 10 === 0
      ? afterLabel === `${label} !!!`
      : afterLabel === label;
  });
  const passed =
    (operation === "create" && rowCount === 1000) ||
    (operation === "replace" && rowCount === 1000 && rowsReplaced) ||
    (operation === "create-many" && rowCount === 10000) ||
    (operation === "append" &&
      rowCount === beforeCount + 1000 &&
      rowsPreserved) ||
    (operation === "update" &&
      rowCount === beforeCount &&
      rowsPreserved &&
      updatedLabels) ||
    (operation === "select" &&
      selectedCount() === 1 &&
      afterRows[1]?.classList.contains("danger")) ||
    (operation === "swap" &&
      rowCount === beforeCount &&
      beforeRows[1] === afterRows[998] &&
      beforeRows[998] === afterRows[1]) ||
    (operation === "remove" &&
      rowCount === beforeCount - 1 &&
      !afterRows.includes(beforeRows[4])) ||
    (operation === "clear" && rowCount === 0 && !rowsPreserved);

  return { rowCount, passed };
}

export function installActualBenchmark() {
  window.__actualBenchmark = {
    async run(operation) {
      prepare(operation);
      await nextFrame();
      await nextFrame();
      const beforeRows = rowNodes();
      const beforeIds = rowIds();
      const beforeLabels = beforeRows.map(
        (row) => row.querySelector("td:nth-child(2)")?.textContent ?? "",
      );
      const start = performance.now();
      markProfile("hydro-actual-handler-start");
      perform(operation);
      const elapsedMs = performance.now() - start;
      markProfile("hydro-actual-handler-end");
      await nextFrame();
      await nextFrame();
      const frameElapsedMs = performance.now() - start;
      markProfile("hydro-actual-frame-end");
      const result = verify(operation, beforeRows, beforeLabels);
      const afterIds = rowIds();
      const afterRows = rowNodes();
      if (operation === "swap") {
        result.passed =
          result.passed &&
          beforeIds[1] === afterIds[998] &&
          beforeIds[998] === afterIds[1];
      }
      if (operation === "remove") {
        result.passed =
          result.passed && beforeIds.length === afterIds.length + 1;
        result.passed = result.passed && !afterRows.includes(beforeRows[4]);
      }
      return {
        elapsedMs,
        frameElapsedMs,
        rowCount: result.rowCount,
        selectedCount: selectedCount(),
        firstLabel: firstLabel(),
        passed: result.passed,
      };
    },
    async memory(cycles) {
      if (!Number.isInteger(cycles) || cycles < 1) {
        throw new Error("memory cycles must be a positive integer");
      }
      if (typeof window.gc !== "function") {
        throw new Error(
          "window.gc is unavailable; launch Chromium with exposed GC",
        );
      }

      const refs: Array<WeakRef<Element>> = [];
      for (let cycle = 0; cycle < cycles; cycle++) {
        button("runlots").click();
        for (const row of rowNodes()) refs.push(new WeakRef(row));
        button("clear").click();
        if (rows().length !== 0) {
          throw new Error(
            `clear left ${rows().length} rows after cycle ${cycle}`,
          );
        }
      }
      await settleForMemory();
      memoryRefs = refs;
      const aliveBeforeReturn = refs.reduce(
        (count, ref) => count + (ref.deref() ? 1 : 0),
        0,
      );
      return {
        cycles,
        rowsPerCycle: 10000,
        aliveBeforeReturn,
        passed: aliveBeforeReturn === 0,
      };
    },
    memorySurvivors() {
      if (!memoryRefs) throw new Error("memory probe has not run");
      return memoryRefs.reduce(
        (count, ref) => count + (ref.deref() ? 1 : 0),
        0,
      );
    },
    releaseMemoryRefs() {
      memoryRefs = undefined;
    },
  };
}
