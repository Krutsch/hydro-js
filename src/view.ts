import type { EventObject } from "./ownership.js";

type ViewEvent = EventListener | EventObject;

export interface ViewState {
  readonly rendering: boolean;
  readonly eventFunctions: Map<string, ViewEvent>;
  enter(): void;
  exit(): void;
}

export function createViewState(): ViewState {
  let rendering = false;
  return {
    get rendering() {
      return rendering;
    },
    eventFunctions: new Map(),
    enter() {
      rendering = true;
    },
    exit() {
      rendering = false;
    },
  };
}

export interface ViewRuntime {
  state: ViewState;
  select: (root: string) => Element | null;
  getValue: (data: unknown) => any[];
  observe: (data: unknown, handler: Function) => (() => void) | undefined;
  unset: (data: unknown) => void;
  onCleanup: (fn: Function, node: Element, ...args: any[]) => void;
  runLifecycle: (node: Node) => void;
  setReactivity: (root: Element, eventFunctions: Map<string, ViewEvent>) => void;
  isPrewired: (node: Node) => boolean;
  resetRows: (root: Element) => void;
  reuseElements: () => boolean;
}

export function createView(runtime: ViewRuntime) {
  const state = runtime.state;
  const {
    select,
    getValue,
    observe,
    unset,
    onCleanup,
    runLifecycle,
    setReactivity,
    isPrewired,
    resetRows,
    reuseElements,
  } = runtime;
  const eventFunctions = state.eventFunctions;
  const enter = state.enter.bind(state);
  const exit = state.exit.bind(state);

  return function view(
    root: string,
    data: unknown,
    renderFunction: (value: any, index: number) => Node,
  ) {
    const rootElem = select(root);
    if (!rootElem) {
      throw new TypeError(`View root not found: ${root}`);
    }
    enter();
    try {
      const elements = getValue(data).map(renderFunction);
      const initialRowsAreWired =
        eventFunctions.size === 0 && elements.every(isPrewired);
      appendAll(rootElem, elements);
      for (const elem of elements) runLifecycle(elem);
      if (rootElem.hasChildNodes() && !initialRowsAreWired) {
        setReactivity(rootElem, eventFunctions);
      }
      onCleanup(unset, rootElem, data);
    } finally {
      eventFunctions.clear();
      exit();
    }

    const stopViewObserver = observe(
      data,
      (newData: any[], oldData: any[]) => {
        enter();
        try {
          let newRowsAreWired = false;
          const reuse = reuseElements();

          if (
            !newData?.length ||
            (!reuse && newData?.length === oldData?.length)
          ) {
            resetRows(rootElem);
            if (newData === null) return;
          } else if (reuse) {
            for (let i = 0; i < oldData?.length && newData?.length; i++) {
              oldData[i].id = newData[i].id;
              oldData[i].label = newData[i].label;
              newData[i] = oldData[i];
            }
          }

          if (
            oldData?.length &&
            newData?.length > oldData?.length &&
            newData[0] === oldData[0]
          ) {
            const length = oldData.length;
            const slicedData = newData.slice(length);
            const newElements = slicedData.map((item, i) =>
              renderFunction(item, i + length),
            );
            const appendedRowsAreWired =
              eventFunctions.size === 0 && newElements.every(isPrewired);
            newRowsAreWired = appendedRowsAreWired;
            appendAll(rootElem, newElements);
            for (const elem of newElements) runLifecycle(elem);
          } else if (
            oldData?.length === 0 ||
            (!reuse && newData?.length)
          ) {
            if (!reuse && oldData?.length && rootElem.hasChildNodes()) {
              resetRows(rootElem);
            }

            const elements = newData.map(renderFunction);
            const replacementRowsAreWired =
              eventFunctions.size === 0 && elements.every(isPrewired);
            newRowsAreWired = replacementRowsAreWired;
            appendAll(rootElem, elements);
            for (const elem of elements) runLifecycle(elem);
          }
          if (rootElem.hasChildNodes() && !newRowsAreWired) {
            setReactivity(rootElem, eventFunctions);
          }
        } finally {
          eventFunctions.clear();
          exit();
        }
      },
    )!;
    onCleanup(stopViewObserver, rootElem);
  };
}

function appendAll(root: Element, nodes: Array<Node>) {
  const length = nodes.length;
  if (length === 0) return;
  if (length === 1) {
    root.appendChild(nodes[0]);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < length; index++) {
    fragment.appendChild(nodes[index]);
  }
  root.appendChild(fragment);
}
