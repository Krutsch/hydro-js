export function createViewState() {
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
export function createView(runtime) {
    const state = runtime.state;
    const { select, getValue, observe, unset, onCleanup, runLifecycle, setReactivity, isPrewired, resetRows, reuseElements, } = runtime;
    const eventFunctions = state.eventFunctions;
    const enter = state.enter.bind(state);
    const exit = state.exit.bind(state);
    return function view(root, data, renderFunction) {
        const rootElem = select(root);
        if (!rootElem) {
            throw new TypeError(`View root not found: ${root}`);
        }
        enter();
        try {
            const elements = getValue(data).map(renderFunction);
            const initialRowsAreWired = eventFunctions.size === 0 && elements.every(isPrewired);
            appendAll(rootElem, elements);
            for (const elem of elements)
                runLifecycle(elem);
            if (rootElem.hasChildNodes() && !initialRowsAreWired) {
                setReactivity(rootElem, eventFunctions);
            }
            onCleanup(unset, rootElem, data);
        }
        finally {
            eventFunctions.clear();
            exit();
        }
        const stopViewObserver = observe(data, (newData, oldData) => {
            enter();
            try {
                let newRowsAreWired = false;
                const reuse = reuseElements();
                if (!newData?.length ||
                    (!reuse && newData?.length === oldData?.length)) {
                    resetRows(rootElem);
                    if (newData === null)
                        return;
                }
                else if (reuse) {
                    for (let i = 0; i < oldData?.length && newData?.length; i++) {
                        oldData[i].id = newData[i].id;
                        oldData[i].label = newData[i].label;
                        newData[i] = oldData[i];
                    }
                }
                if (oldData?.length &&
                    newData?.length > oldData?.length &&
                    newData[0] === oldData[0]) {
                    const length = oldData.length;
                    const slicedData = newData.slice(length);
                    const newElements = slicedData.map((item, i) => renderFunction(item, i + length));
                    const appendedRowsAreWired = eventFunctions.size === 0 && newElements.every(isPrewired);
                    newRowsAreWired = appendedRowsAreWired;
                    appendAll(rootElem, newElements);
                    for (const elem of newElements)
                        runLifecycle(elem);
                }
                else if (oldData?.length === 0 ||
                    (!reuse && newData?.length)) {
                    if (!reuse && oldData?.length && rootElem.hasChildNodes()) {
                        resetRows(rootElem);
                    }
                    const elements = newData.map(renderFunction);
                    const replacementRowsAreWired = eventFunctions.size === 0 && elements.every(isPrewired);
                    newRowsAreWired = replacementRowsAreWired;
                    appendAll(rootElem, elements);
                    for (const elem of elements)
                        runLifecycle(elem);
                }
                if (rootElem.hasChildNodes() && !newRowsAreWired) {
                    setReactivity(rootElem, eventFunctions);
                }
            }
            finally {
                eventFunctions.clear();
                exit();
            }
        });
        onCleanup(stopViewObserver, rootElem);
    };
}
function appendAll(root, nodes) {
    const length = nodes.length;
    if (length === 0)
        return;
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
