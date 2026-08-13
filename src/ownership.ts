export type NodeChange = [
  number,
  number,
  string | undefined,
  object,
  string,
];
export type NodeChanges = NodeChange[];

export type SingleNodeChanges = {
  node: Element | Text;
  changes: NodeChanges;
};
export type NodeChangeEntry =
  | SingleNodeChanges
  | Map<Element | Text, NodeChanges>;
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
  elemEventFunctions: WeakMap<
    Element,
    Map<string, TrackedHandlers>
  >;
  reactivityMap: WeakMap<object, KeyToNodeMap>;
  bindMap: WeakMap<object, Array<Element>>;
  boundElemProxies: WeakMap<Element, object | Array<object>>;
  tmpSwap: WeakMap<object, KeyToNodeMap>;
  onRenderMap: WeakMap<LifecycleNode, LifecycleFn>;
  onCleanupMap: WeakMap<LifecycleNode, LifecycleFn>;
  addEventListener(
    node: Element,
    eventName: string,
    obj: EventObject | EventListener,
  ): void;
  removeTrackedEventListener(
    node: Element,
    eventName: string,
    handler: EventListener,
  ): void;
  purgeTrackedEventListeners(node: Element): void;
  pushTrackedHandlers(functions: Function[], elem: Element): void;
  trackBoundElement(proxy: object, elem: Element): void;
  untrackBoundElement(proxy: object, elem: Element): void;
  purgeNode(node: Text | Element | DocumentFragment): void;
  purgeSubtree(root: Text | Element | DocumentFragment): void;
  purgeDetached(node: LifecycleNode): void;
  recordTrace(
    start: number,
    end: number,
    node: Text | Element,
    hydroKey: string,
    resolvedObj: object,
    key?: string,
  ): void;
  addLifecycle(kind: LifecycleKind, node: LifecycleNode, fn: Function): void;
  pushLifecycleFunctions(
    functions: Function[],
    kind: LifecycleKind,
    node: LifecycleNode,
  ): void;
  runLifecycle(node: LifecycleNode, kind: LifecycleKind): void;
  resetViewRows(root: Element): void;
}

export function createOwnership(options: {
  showElement: number;
  fragmentToElements: WeakMap<DocumentFragment, Array<ChildNode>>;
  isTextNode: (node: Node) => node is Text;
  schedule: (fn: Function) => void;
  shouldSchedule: () => boolean;
  shouldIgnoreIsConnected: () => boolean;
}): Ownership {
  const allNodeChanges = new WeakMap<Text | Element, NodeChanges>();
  const elemEventFunctions = new WeakMap<
    Element,
    Map<string, TrackedHandlers>
  >();
  const reactivityMap = new WeakMap<object, KeyToNodeMap>();
  const bindMap = new WeakMap<object, Array<Element>>();
  const boundElemProxies = new WeakMap<Element, object | Array<object>>();
  const tmpSwap = new WeakMap<object, KeyToNodeMap>();
  const onRenderMap = new WeakMap<LifecycleNode, LifecycleFn>();
  const onCleanupMap = new WeakMap<LifecycleNode, LifecycleFn>();
  let calledOnRender = false;
  let calledOnCleanup = false;

  const pendingCleanupRows: Array<Array<ChildNode>> = [];
  let pendingCleanupCount = 0;
  let cleanupFlushScheduled = false;
  const PENDING_CLEANUP_LIMIT = 2000;

  function getLifecycleMap(kind: LifecycleKind) {
    return kind === "render" ? onRenderMap : onCleanupMap;
  }

  function addEventListener(
    node: Element,
    eventName: string,
    obj: EventObject | EventListener,
  ) {
    const isFn = typeof obj === "function";
    const handler = isFn ? obj : obj.event;

    node.addEventListener(eventName, handler, isFn ? {} : obj.options);
    const events = elemEventFunctions.get(node);
    if (events) {
      const handlers = events.get(eventName);
      if (handlers === undefined) {
        events.set(eventName, handler);
      } else if (handlers instanceof Set) {
        handlers.add(handler);
      } else if (handlers !== handler) {
        events.set(eventName, new Set([handlers, handler]));
      }
    } else {
      elemEventFunctions.set(node, new Map([[eventName, handler]]));
    }
  }

  function removeTrackedEventListener(
    node: Element,
    eventName: string,
    handler: EventListener,
  ) {
    node.removeEventListener(eventName, handler);
    node.removeEventListener(eventName, handler, true);
    const map = elemEventFunctions.get(node);
    if (!map) return;

    const handlers = map.get(eventName);
    if (handlers === undefined) return;

    if (handlers instanceof Set) {
      handlers.delete(handler);
      if (handlers.size === 0) map.delete(eventName);
    } else if (handlers === handler) {
      map.delete(eventName);
    }
    if (map.size === 0) elemEventFunctions.delete(node);
  }

  function purgeTrackedEventListeners(node: Element) {
    const events = elemEventFunctions.get(node);
    if (!events) return;

    events.forEach((handlers, eventName) => {
      if (handlers instanceof Set) {
        handlers.forEach((handler) => {
          node.removeEventListener(eventName, handler);
          node.removeEventListener(eventName, handler, true);
        });
      } else {
        node.removeEventListener(eventName, handlers);
        node.removeEventListener(eventName, handlers, true);
      }
    });
    elemEventFunctions.delete(node);
  }

  function pushTrackedHandlers(functions: Function[], elem: Element) {
    const events = elemEventFunctions.get(elem);
    if (!events) return;

    events.forEach((handlers) => {
      if (handlers instanceof Set) {
        handlers.forEach((handler) => functions.push(handler));
      } else {
        functions.push(handlers);
      }
    });
  }

  function trackBoundElement(proxy: object, elem: Element) {
    const boundElements = bindMap.get(proxy);
    if (boundElements) {
      boundElements.push(elem);
    } else {
      bindMap.set(proxy, [elem]);
    }

    const current = boundElemProxies.get(elem);
    if (!current) {
      boundElemProxies.set(elem, proxy);
    } else if (Array.isArray(current)) {
      if (!current.includes(proxy)) current.push(proxy);
    } else if (current !== proxy) {
      boundElemProxies.set(elem, [current, proxy]);
    }
  }

  function untrackBoundElement(proxy: object, elem: Element) {
    const elements = bindMap.get(proxy);
    if (!elements) return;

    const index = elements.indexOf(elem);
    if (index !== -1) elements.splice(index, 1);
    if (elements.length === 0) bindMap.delete(proxy);
  }

  function recordTrace(
    start: number,
    end: number,
    node: Text | Element,
    hydroKey: string,
    resolvedObj: object,
    key?: string,
  ) {
    const change: NodeChange = [start, end, key, resolvedObj, hydroKey];

    const changesForNode = allNodeChanges.get(node);
    if (changesForNode) {
      changesForNode.push(change);
    } else {
      allNodeChanges.set(node, [change]);
    }

    const keyToNodeMap = reactivityMap.get(resolvedObj);
    if (keyToNodeMap) {
      const entry = keyToNodeMap.get(hydroKey);

      if (entry === undefined) {
        keyToNodeMap.set(hydroKey, { node, changes: [change] });
      } else if (entry instanceof Map) {
        const keyChanges = entry.get(node);
        if (keyChanges) {
          keyChanges.push(change);
        } else {
          entry.set(node, [change]);
        }
      } else if (entry.node === node) {
        entry.changes.push(change);
      } else {
        keyToNodeMap.set(
          hydroKey,
          new Map([
            [entry.node, entry.changes],
            [node, [change]],
          ]),
        );
      }
    } else {
      reactivityMap.set(
        resolvedObj,
        new Map([[hydroKey, { node, changes: [change] }]]),
      );
    }
  }

  function purgeNode(node: Text | Element | DocumentFragment) {
    if (node.nodeType === 11) return;

    const ownedNode = node as Text | Element;

    if (!options.isTextNode(ownedNode)) {
      purgeTrackedEventListeners(ownedNode);
      const proxies = boundElemProxies.get(ownedNode);
      if (proxies) {
        if (Array.isArray(proxies)) {
          for (const proxy of proxies) untrackBoundElement(proxy, ownedNode);
        } else {
          untrackBoundElement(proxies, ownedNode);
        }
        boundElemProxies.delete(ownedNode);
      }
    }

    const changes = allNodeChanges.get(ownedNode);
    if (!changes) return;

    for (const change of changes) {
      const proxy = change[3];
      const hydroKey = change[4];
      const keyToNodeMap = reactivityMap.get(proxy);
      if (!keyToNodeMap) continue;

      const entry = keyToNodeMap.get(hydroKey);
      if (entry instanceof Map) {
        if (entry.delete(ownedNode) && entry.size === 0) {
          keyToNodeMap.delete(hydroKey);
        }
      } else if (entry !== undefined && entry.node === ownedNode) {
        keyToNodeMap.delete(hydroKey);
      }
      if (keyToNodeMap.size === 0) reactivityMap.delete(proxy);
    }
    allNodeChanges.delete(ownedNode);
  }

  function purgeSubtree(root: Text | Element | DocumentFragment) {
    if (options.isTextNode(root)) {
      purgeNode(root);
      return;
    }

    purgeNode(root);
    const elements = document.createNodeIterator(root, options.showElement);
    let elem;
    while ((elem = elements.nextNode())) {
      purgeNode(elem as Element);
      let child = elem.firstChild;
      while (child) {
        if (options.isTextNode(child)) purgeNode(child);
        child = child.nextSibling;
      }
    }

    if (root.nodeType === 11) {
      let child = root.firstChild;
      while (child) {
        if (options.isTextNode(child)) purgeNode(child);
        child = child.nextSibling;
      }
    }
  }

  function purgeDetached(node: LifecycleNode) {
    if (options.shouldIgnoreIsConnected()) return;

    if (node.nodeType === 11) {
      const children = options.fragmentToElements.get(node as DocumentFragment);
      if (children) {
        for (const child of children) {
          if (!child.isConnected) purgeSubtree(child as Text | Element);
        }
      }
    } else if (!node.isConnected) {
      purgeSubtree(node);
    }
  }

  function addLifecycle(kind: LifecycleKind, node: LifecycleNode, fn: Function) {
    const lifecycleMap = getLifecycleMap(kind);
    const current = lifecycleMap.get(node);
    if (!current) {
      lifecycleMap.set(node, fn);
    } else if (Array.isArray(current)) {
      current.push(fn);
    } else {
      lifecycleMap.set(node, [current, fn]);
    }
    if (kind === "render") calledOnRender = true;
    else calledOnCleanup = true;
  }

  function pushLifecycleFunctions(
    functions: Function[],
    kind: LifecycleKind,
    node: LifecycleNode,
  ) {
    const handlers = getLifecycleMap(kind).get(node);
    if (!handlers) return;

    if (Array.isArray(handlers)) functions.push(...handlers);
    else functions.push(handlers);
  }

  function executeLifecycle(kind: LifecycleKind, node: LifecycleNode) {
    const lifecycleMap = getLifecycleMap(kind);
    const handlers = lifecycleMap.get(node);
    if (!handlers) return;

    const execute = () => {
      if (Array.isArray(handlers)) handlers.forEach((handler) => handler());
      else handlers();
    };

    if (options.shouldSchedule()) options.schedule(execute);
    else execute();
    lifecycleMap.delete(node);
  }

  function runLifecycle(node: LifecycleNode, kind: LifecycleKind) {
    if (
      (kind === "render" && !calledOnRender) ||
      (kind === "cleanup" && !calledOnCleanup)
    ) {
      return;
    }

    executeLifecycle(kind, node);

    const elements = document.createNodeIterator(node, options.showElement);
    let subElem;
    while ((subElem = elements.nextNode())) {
      executeLifecycle(kind, subElem as Element);

      let childNode = subElem.firstChild;
      while (childNode) {
        if (options.isTextNode(childNode)) {
          executeLifecycle(kind, childNode);
        }
        childNode = childNode.nextSibling;
      }
    }
  }

  function cleanupDetachedNode(node: ChildNode, hasCleanup: boolean) {
    if (options.isTextNode(node)) {
      if (hasCleanup) executeLifecycle("cleanup", node);
      purgeNode(node);
      return;
    }

    if (hasCleanup) executeLifecycle("cleanup", node as Element);
    purgeNode(node as Element);
    let child = node.firstChild;
    while (child) {
      cleanupDetachedNode(child, hasCleanup);
      child = child.nextSibling;
    }
  }

  function cleanupDetachedRows(rows: Array<ChildNode>) {
    const hasCleanup = calledOnCleanup;
    for (const row of rows) cleanupDetachedNode(row, hasCleanup);
  }

  function flushCleanupQueue() {
    cleanupFlushScheduled = false;
    const batches = pendingCleanupRows.splice(0, pendingCleanupRows.length);
    pendingCleanupCount = 0;
    for (const rows of batches) cleanupDetachedRows(rows);
  }

  function resetViewRows(rootElem: Element) {
    const rows = Array.from(rootElem.childNodes);
    rootElem.textContent = "";
    if (rows.length === 0) return;

    pendingCleanupRows.push(rows);
    pendingCleanupCount += rows.length;
    if (pendingCleanupCount >= PENDING_CLEANUP_LIMIT) {
      flushCleanupQueue();
    } else if (!cleanupFlushScheduled) {
      cleanupFlushScheduled = true;
      options.schedule(flushCleanupQueue);
    }
  }

  return {
    allNodeChanges,
    elemEventFunctions,
    reactivityMap,
    bindMap,
    boundElemProxies,
    tmpSwap,
    onRenderMap,
    onCleanupMap,
    addEventListener,
    removeTrackedEventListener,
    purgeTrackedEventListeners,
    pushTrackedHandlers,
    trackBoundElement,
    untrackBoundElement,
    purgeNode,
    purgeSubtree,
    purgeDetached,
    recordTrace,
    addLifecycle,
    pushLifecycleFunctions,
    runLifecycle,
    resetViewRows,
  };
}
