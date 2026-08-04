export function registerAdditionalTests(api, sleep) {
    const { html, describe, it, h, render, reactive, unset, getValue, setReuseElements, setIgnoreIsConnected, setAsyncUpdate, watchEffect, onRender, onCleanup, view, internals, } = api;
    describe("shared coverage additions", () => {
        it("keeps compiled template instances independent", () => {
            let firstCalls = 0;
            let secondCalls = 0;
            const makeButton = (label, handler) => html `<button data-label=${label} onclick=${handler}>${label}</button>`;
            const first = makeButton("one", () => firstCalls++);
            const second = makeButton("two", () => secondCalls++);
            first.click();
            second.click();
            return (first !== second &&
                first.dataset.label === "one" &&
                second.dataset.label === "two" &&
                firstCalls === 1 &&
                secondCalls === 1);
        });
        it("updates one reactive value in multiple nodes", () => {
            const value = reactive("one");
            const first = html `<p>${value}</p>`;
            const second = html `<span>${value}</span>`;
            const unmountFirst = render(first, "", false);
            const unmountSecond = render(second, "", false);
            value("two");
            const condition = first.textContent === "two" && second.textContent === "two";
            unmountFirst();
            unmountSecond();
            unset(value);
            return condition;
        });
        it("preserves table row attributes", () => {
            const row = html `<tr id="shared-row" data-row="1">
        <td>row</td>
      </tr>`;
            const cell = html `<td data-cell="1">cell</td>`;
            const section = html `<thead>
        <tr>
          <th>head</th>
        </tr>
      </thead>`;
            return (row.localName === "tr" &&
                row.id === "shared-row" &&
                row.dataset.row === "1" &&
                cell.localName === "td" &&
                cell.dataset.cell === "1" &&
                section.localName === "thead");
        });
        it("replaces reactive content with nodes and fragments", () => {
            const value = reactive("text");
            const elem = html `<div>${value}</div>`;
            const unmount = render(elem, "", false);
            const node = html `<span>node</span>`;
            value(node);
            const nodeCondition = elem.querySelector("span") === node;
            const fragment = html `<i>one</i><b>two</b>`;
            value(fragment);
            const fragmentCondition = elem.querySelector("i")?.textContent === "one" &&
                elem.querySelector("b")?.textContent === "two";
            unmount();
            unset(value);
            return nodeCondition && fragmentCondition;
        });
        it("retains all handlers for one event until unmount", () => {
            let firstCalls = 0;
            let secondCalls = 0;
            let thirdCalls = 0;
            const first = reactive({ onclick: () => firstCalls++ });
            const second = reactive({ onclick: () => secondCalls++ });
            const third = reactive({ onclick: () => thirdCalls++ });
            const button = html `<button ${first} ${second} ${third}>click</button>`;
            const unmount = render(button, "", false);
            button.click();
            const fired = firstCalls === 1 && secondCalls === 1 && thirdCalls === 1;
            unmount();
            button.click();
            unset(first);
            unset(second);
            unset(third);
            return fired && firstCalls === 1 && secondCalls === 1 && thirdCalls === 1;
        });
        it("purges detached reactive nodes", () => {
            const value = reactive("before");
            const elem = html `<p>${value}</p>`;
            const text = elem.firstChild;
            const unmount = render(elem, "", false);
            elem.remove();
            setIgnoreIsConnected(false);
            value("after");
            const purged = !internals.allNodeChanges.has(text);
            unmount();
            unset(value);
            return purged;
        });
        it("covers view reset, append, and replacement", async () => {
            const data = reactive([]);
            const list = html `<ul id="shared-view"></ul>`;
            const unmount = render(list, "", false);
            view("#shared-view", data, (item) => html `<li>${item.id}</li>`);
            data([{ id: 1 }]);
            await sleep(2);
            setReuseElements(true);
            data([{ id: 2 }]);
            await sleep(2);
            setReuseElements(false);
            data([{ id: 3 }, { id: 4 }]);
            await sleep(2);
            data([]);
            await sleep(2);
            const condition = list.childElementCount === 0;
            unmount();
            unset(data);
            setReuseElements(true);
            return condition;
        });
        it("runs every lifecycle callback", () => {
            const elem = html `<p>lifecycle</p>`;
            let rendered = 0;
            let cleaned = 0;
            onRender(() => rendered++, elem);
            onRender(() => rendered++, elem);
            onCleanup(() => cleaned++, elem);
            onCleanup(() => cleaned++, elem);
            render(elem, "", false)();
            return rendered === 2 && cleaned === 2;
        });
        it("re-runs async watch effects", async () => {
            const value = reactive(1);
            let runs = 0;
            const stop = watchEffect(async () => {
                getValue(value);
                await Promise.resolve();
                runs++;
            });
            await sleep(2);
            value(2);
            await sleep(2);
            stop();
            unset(value);
            return runs >= 2;
        });
        it("updates scheduled nested values", async () => {
            const data = reactive({ label: "one" });
            const elem = html `<p>${data.label}</p>`;
            const unmount = render(elem, "", false);
            setAsyncUpdate(data, true);
            data({ label: "two" });
            await sleep(5);
            const condition = elem.textContent === "two";
            setAsyncUpdate(data, false);
            unmount();
            unset(data);
            return condition;
        });
        it("keeps bound keyed rows in order after a swap", async () => {
            setReuseElements(false);
            const data = reactive([{ id: 1 }, { id: 2 }, { id: 3 }]);
            const list = html `<ul id="shared-keyed"></ul>`;
            const unmount = render(list, "", false);
            view("#shared-keyed", data, (_item, index) => h("li", { bind: data[index] }, data[index].id));
            data((current) => {
                [current[1], current[2]] = [current[2], current[1]];
            });
            await sleep(5);
            const condition = list.textContent === "132";
            unmount();
            unset(data);
            setReuseElements(true);
            return condition;
        });
    });
}
