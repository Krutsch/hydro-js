import type { KeyToNodeMap, NodeChangeEntry, NodeChanges } from "./ownership.js";
export type UpdateEffect<Handle extends object> = {
    kind: "replace";
    node: Handle;
    value: unknown;
} | {
    kind: "text";
    node: Handle;
    start: number;
    end: number;
    value: string;
} | {
    kind: "control";
    node: Handle;
    key: string;
    value: unknown;
} | {
    kind: "event";
    node: Handle;
    key: string;
    value: unknown;
    oldValue: unknown;
} | {
    kind: "object";
    node: Handle;
    value: Record<string, unknown>;
    oldValue: unknown;
} | {
    kind: "attribute";
    node: Handle;
    key: string;
    start: number;
    end: number;
    value: unknown;
};
export interface UpdateAdapter<Handle extends object> {
    isConnected(node: Handle): boolean;
    isText(node: Handle): boolean;
    isNode(value: unknown): boolean;
    isFunction(value: unknown): boolean;
    isEventObject(value: unknown): boolean;
    isObject(value: unknown): value is Record<string, unknown>;
    replace(node: Handle, value: unknown): Handle | null;
    applyText(node: Handle, start: number, end: number, value: string): void;
    applyControl(node: Handle, key: string, value: unknown): void;
    applyEvent(node: Handle, key: string, value: unknown, oldValue: unknown): void;
    applyObject(node: Handle, value: Record<string, unknown>, oldValue: unknown): void;
    applyAttribute(node: Handle, key: string, start: number, end: number, value: unknown): void;
}
export declare function createRecordingUpdateAdapter(effects: UpdateEffect<Element | Text>[]): UpdateAdapter<Element | Text>;
export interface UpdateEngine<Handle extends object> {
    checkReactivityMap(obj: object, key: PropertyKey, value: unknown, oldValue: unknown): void;
    updateDOM(keyToNodeMap: KeyToNodeMap, hydroKey: string, entry: NodeChangeEntry, value: unknown, oldValue: unknown): void;
}
export declare function createUpdateEngine<Handle extends object>(options: {
    adapter: UpdateAdapter<Handle>;
    allNodeChanges: WeakMap<Handle, NodeChanges>;
    reactivityMap: WeakMap<object, KeyToNodeMap>;
    schedule: (...args: any[]) => void;
    isAsync: (obj: object) => boolean;
    isServerSideCached: boolean;
    shouldIgnoreIsConnected: () => boolean;
    onEvent: (key: string) => string;
    twoWayKey: string;
}): UpdateEngine<Handle>;
