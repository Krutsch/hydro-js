import type { EventObject } from "./ownership.js";
type ViewEvent = EventListener | EventObject;
export interface ViewState {
    readonly rendering: boolean;
    readonly eventFunctions: Map<string, ViewEvent>;
    enter(): void;
    exit(): void;
}
export declare function createViewState(): ViewState;
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
export declare function createView(runtime: ViewRuntime): (root: string, data: unknown, renderFunction: (value: any, index: number) => Node) => void;
export {};
