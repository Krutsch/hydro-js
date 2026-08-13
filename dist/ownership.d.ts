export type NodeChange = [
    number,
    number,
    string | undefined,
    object,
    string
];
export type NodeChanges = NodeChange[];
export type SingleNodeChanges = {
    node: Element | Text;
    changes: NodeChanges;
};
export type NodeChangeEntry = SingleNodeChanges | Map<Element | Text, NodeChanges>;
export type KeyToNodeMap = Map<string, NodeChangeEntry>;
export interface EventObject {
    event: EventListener;
    options: AddEventListenerOptions;
}
export type LifecycleFn = Function | Function[];
export type LifecycleKind = "render" | "cleanup";
type TrackedHandlers = EventListener | Set<EventListener>;
type LifecycleNode = Element | DocumentFragment | Text;
export interface Ownership {
    allNodeChanges: WeakMap<Text | Element, NodeChanges>;
    elemEventFunctions: WeakMap<Element, Map<string, TrackedHandlers>>;
    reactivityMap: WeakMap<object, KeyToNodeMap>;
    bindMap: WeakMap<object, Array<Element>>;
    boundElemProxies: WeakMap<Element, object | Array<object>>;
    tmpSwap: WeakMap<object, KeyToNodeMap>;
    onRenderMap: WeakMap<LifecycleNode, LifecycleFn>;
    onCleanupMap: WeakMap<LifecycleNode, LifecycleFn>;
    addEventListener(node: Element, eventName: string, obj: EventObject | EventListener): void;
    removeTrackedEventListener(node: Element, eventName: string, handler: EventListener): void;
    purgeTrackedEventListeners(node: Element): void;
    pushTrackedHandlers(functions: Function[], elem: Element): void;
    trackBoundElement(proxy: object, elem: Element): void;
    untrackBoundElement(proxy: object, elem: Element): void;
    purgeNode(node: Text | Element | DocumentFragment): void;
    purgeSubtree(root: Text | Element | DocumentFragment): void;
    purgeDetached(node: LifecycleNode): void;
    recordTrace(start: number, end: number, node: Text | Element, hydroKey: string, resolvedObj: object, key?: string): void;
    addLifecycle(kind: LifecycleKind, node: LifecycleNode, fn: Function): void;
    pushLifecycleFunctions(functions: Function[], kind: LifecycleKind, node: LifecycleNode): void;
    runLifecycle(node: LifecycleNode, kind: LifecycleKind): void;
    resetViewRows(root: Element): void;
}
export declare function createOwnership(options: {
    showElement: number;
    fragmentToElements: WeakMap<DocumentFragment, Array<ChildNode>>;
    isTextNode: (node: Node) => node is Text;
    schedule: (fn: Function) => void;
    shouldSchedule: () => boolean;
    shouldIgnoreIsConnected: () => boolean;
}): Ownership;
export {};
