import type {
  KeyToNodeMap,
  NodeChangeEntry,
  NodeChanges,
} from "./ownership.js";

export type UpdateEffect<Handle extends object> =
  | {
      kind: "replace";
      node: Handle;
      value: unknown;
    }
  | {
      kind: "text";
      node: Handle;
      start: number;
      end: number;
      value: string;
    }
  | {
      kind: "control";
      node: Handle;
      key: string;
      value: unknown;
    }
  | {
      kind: "event";
      node: Handle;
      key: string;
      value: unknown;
      oldValue: unknown;
    }
  | {
      kind: "object";
      node: Handle;
      value: Record<string, unknown>;
      oldValue: unknown;
    }
  | {
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
  applyEvent(
    node: Handle,
    key: string,
    value: unknown,
    oldValue: unknown,
  ): void;
  applyObject(
    node: Handle,
    value: Record<string, unknown>,
    oldValue: unknown,
  ): void;
  applyAttribute(
    node: Handle,
    key: string,
    start: number,
    end: number,
    value: unknown,
  ): void;
}

export function createRecordingUpdateAdapter(
  effects: UpdateEffect<Element | Text>[],
): UpdateAdapter<Element | Text> {
  return {
    isConnected: (node) => node.isConnected,
    isText: (node) => node.nodeType === 3,
    isNode: (value) =>
      value != null && typeof value === "object" && "nodeType" in value,
    isFunction: (value) => typeof value === "function",
    isEventObject: (value) =>
      value != null && typeof value === "object" && "event" in value,
    isObject: (value): value is Record<string, unknown> =>
      value != null && typeof value === "object",
    replace: (node, value) => {
      effects.push({ kind: "replace", node, value });
      return value as Element | Text;
    },
    applyText: (node, start, end, value) => {
      effects.push({ kind: "text", node, start, end, value });
    },
    applyControl: (node, key, value) => {
      effects.push({ kind: "control", node, key, value });
    },
    applyEvent: (node, key, value, oldValue) => {
      effects.push({ kind: "event", node, key, value, oldValue });
    },
    applyObject: (node, value, oldValue) => {
      effects.push({ kind: "object", node, value, oldValue });
    },
    applyAttribute: (node, key, start, end, value) => {
      effects.push({ kind: "attribute", node, key, start, end, value });
    },
  };
}

export interface UpdateEngine<Handle extends object> {
  checkReactivityMap(
    obj: object,
    key: PropertyKey,
    value: unknown,
    oldValue: unknown,
  ): void;
  updateDOM(
    keyToNodeMap: KeyToNodeMap,
    hydroKey: string,
    entry: NodeChangeEntry,
    value: unknown,
    oldValue: unknown,
  ): void;
}

export function createUpdateEngine<Handle extends object>(options: {
  adapter: UpdateAdapter<Handle>;
  allNodeChanges: WeakMap<Handle, NodeChanges>;
  reactivityMap: WeakMap<object, KeyToNodeMap>;
  schedule: (...args: any[]) => void;
  isAsync: (obj: object) => boolean;
  isServerSideCached: boolean;
  shouldIgnoreIsConnected: () => boolean;
  onEvent: (key: string) => string;
  twoWayKey: string;
}): UpdateEngine<Handle> {
  const adapter = options.adapter;
  function checkReactivityMap(
    obj: object,
    key: PropertyKey,
    value: unknown,
    oldValue: unknown,
  ) {
    const keyToNodeMap = options.reactivityMap.get(obj)!;
    const stringKey = String(key);
    const entry = keyToNodeMap.get(stringKey);
    if (entry) {
      if (options.isAsync(obj)) {
        options.schedule(
          updateDOM,
          keyToNodeMap,
          stringKey,
          entry,
          value,
          oldValue,
        );
      } else {
        updateDOM(keyToNodeMap, stringKey, entry, value, oldValue);
      }
    }

    if (adapter.isObject(value)) {
      const source = value;
      if (Array.isArray(value) && keyToNodeMap.size < value.length) {
        for (const subKey of keyToNodeMap.keys()) {
          if (!Object.prototype.propertyIsEnumerable.call(value, subKey)) {
            continue;
          }
          updateSubKey(obj, keyToNodeMap, subKey, source[subKey], oldValue);
        }
      } else {
        const subKeys = Object.keys(source);
        for (let index = 0; index < subKeys.length; index++) {
          const subKey = subKeys[index];
          updateSubKey(obj, keyToNodeMap, subKey, source[subKey], oldValue);
        }
      }
    }
  }

  function updateSubKey(
    obj: object,
    keyToNodeMap: KeyToNodeMap,
    subKey: string,
    subValue: unknown,
    oldValue: unknown,
  ) {
    const entry = keyToNodeMap.get(subKey);
    if (!entry) return;

    const subOldValue =
      adapter.isObject(oldValue) && oldValue[subKey]
        ? oldValue[subKey]
        : oldValue;
    if (options.isAsync(obj)) {
      options.schedule(
        updateDOM,
        keyToNodeMap,
        subKey,
        entry,
        subValue,
        subOldValue,
      );
    } else {
      updateDOM(keyToNodeMap, subKey, entry, subValue, subOldValue);
    }
  }

  function updateDOM(
    keyToNodeMap: KeyToNodeMap,
    hydroKey: string,
    entry: NodeChangeEntry,
    value: unknown,
    oldValue: unknown,
  ) {
    const valueIsNode = adapter.isNode(value);
    if (entry instanceof Map) {
      const rekeyed: Array<
        [Handle, Handle | null, NodeChanges]
      > = [];
      entry.forEach((changes, node) => {
        const mapped = applyNodeChanges(
          node as Handle,
          changes,
          value,
          oldValue,
          valueIsNode,
        );
        if (mapped !== node) {
          rekeyed.push([node as Handle, mapped, changes]);
        }
      });

      for (const [node, mapped, changes] of rekeyed) {
        entry.delete(node as Element | Text);
        if (mapped) entry.set(mapped as Element | Text, changes);
      }
      if (entry.size === 0) keyToNodeMap.delete(hydroKey);
      return;
    }

    const mapped = applyNodeChanges(
      entry.node as Handle,
      entry.changes,
      value,
      oldValue,
      valueIsNode,
    );
    if (mapped === entry.node) return;
    if (mapped) entry.node = mapped as Element | Text;
    else keyToNodeMap.delete(hydroKey);
  }

  function applyNodeChanges(
    originalNode: Handle,
    changes: NodeChanges,
    value: unknown,
    oldValue: unknown,
    valueIsNode: boolean,
  ): Handle | null {
    if (
      !options.shouldIgnoreIsConnected() &&
      !options.adapter.isConnected(originalNode)
    ) {
      options.allNodeChanges.delete(originalNode);
      return null;
    }

    let mapped: Handle | null = originalNode;
    let valueString: string | undefined;
    for (const change of changes) {
      const [start, end, key] = change;
      let useStartEnd = false;
      const node = mapped ?? originalNode;

      if (valueIsNode && (!options.isServerSideCached || value !== node)) {
        mapped = adapter.replace(node, value);
      } else if (adapter.isText(node)) {
        useStartEnd = true;
        valueString ??= String(value);
        adapter.applyText(node, start, end, valueString);
      } else if (key === options.twoWayKey) {
        adapter.applyControl(node, key, value);
      } else if (adapter.isFunction(value) || adapter.isEventObject(value)) {
        adapter.applyEvent(node, options.onEvent(key!), value, oldValue);
      } else if (adapter.isObject(value)) {
        adapter.applyObject(node, value, oldValue);
      } else {
        useStartEnd = true;
        valueString ??= String(value);
        adapter.applyAttribute(node, key!, start, end, value);
      }

      if (useStartEnd) {
        valueString ??= String(value);
        change[1] = start + valueString.length;
        const changesForNode = options.allNodeChanges.get(node);
        if (changesForNode) {
          let passedNode = false;
          const difference = String(oldValue).length - valueString.length;
          for (const nodeChange of changesForNode) {
            if (nodeChange === change) {
              passedNode = true;
              continue;
            }
            if (passedNode && (adapter.isText(node) || key === nodeChange[2])) {
              nodeChange[0] -= difference;
              nodeChange[1] -= difference;
            }
          }
        }
      }
    }
    return mapped;
  }

  return { checkReactivityMap, updateDOM };
}
