type AdditionalTestApi = {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => boolean | Promise<boolean>) => void;
  html: any;
  h: any;
  render: any;
  reactive: any;
  unset: any;
  getValue: any;
  setReuseElements: any;
  setIgnoreIsConnected: any;
  setAsyncUpdate: any;
  watchEffect: any;
  onRender: any;
  onCleanup: any;
  onAttributeChange: any;
  onTreeChange: any;
  view: any;
  internals: any;
};

export function registerAdditionalTests(
  api: AdditionalTestApi,
  sleep: (time: number) => Promise<unknown>,
) {
  const {
    html,
    describe,
    it,
    h,
    render,
    reactive,
    unset,
    getValue,
    setReuseElements,
    setIgnoreIsConnected,
    setAsyncUpdate,
    watchEffect,
    onRender,
    onCleanup,
    onAttributeChange,
    onTreeChange,
    view,
    internals,
  } = api;

  describe("shared coverage additions", () => {
    it("keeps compiled template instances independent", () => {
      let firstCalls = 0;
      let secondCalls = 0;
      const makeButton = (label: string, handler: () => void) =>
        html`<button data-label=${label} onclick=${handler}>${label}</button>`;
      const first = makeButton("one", () => firstCalls++);
      const second = makeButton("two", () => secondCalls++);

      first.click();
      second.click();
      return (
        first !== second &&
        first.dataset.label === "one" &&
        second.dataset.label === "two" &&
        firstCalls === 1 &&
        secondCalls === 1
      );
    });

    it("updates one reactive value in multiple nodes", () => {
      const value = reactive("one");
      const first = html`<p>${value}</p>`;
      const second = html`<span>${value}</span>`;
      const unmountFirst = render(first, "", false);
      const unmountSecond = render(second, "", false);

      value("two");
      const condition =
        first.textContent === "two" && second.textContent === "two";
      unmountFirst();
      unmountSecond();
      unset(value);
      return condition;
    });

    it("preserves table row attributes", () => {
      const row = html`<tr id="shared-row" data-row="1">
        <td>row</td>
      </tr>`;
      const cell = html`<td data-cell="1">cell</td>`;
      const section = html`<thead>
        <tr>
          <th>head</th>
        </tr>
      </thead>`;
      return (
        row.localName === "tr" &&
        row.id === "shared-row" &&
        row.dataset.row === "1" &&
        cell.localName === "td" &&
        cell.dataset.cell === "1" &&
        section.localName === "thead"
      );
    });

    it("replaces reactive content with nodes and fragments", () => {
      const value = reactive("text");
      const elem = html`<div>${value}</div>`;
      const unmount = render(elem, "", false);
      const node = html`<span>node</span>`;
      value(node);
      const nodeCondition = elem.querySelector("span") === node;
      const fragment = html`<i>one</i><b>two</b>`;
      value(fragment);
      const fragmentCondition =
        elem.querySelector("i")?.textContent === "one" &&
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
      const button = html`<button ${first} ${second} ${third}>click</button>`;
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
      const elem = html`<p>${value}</p>`;
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

    it("rejects a missing view root before rendering rows", () => {
      const data = reactive([{}]);
      let threw = false;

      try {
        view("#view-root-missing", data, () => html`<li>ignored</li>`);
      } catch {
        threw = true;
      }

      let clicked = 0;
      const button = html`<button onclick=${() => clicked++}>click</button>`;
      const unmount = render(button, "", false);
      button.click();
      unmount();
      unset(data);

      return threw && clicked === 1;
    });

    it("keeps nested view event wiring isolated", () => {
      let outerClicks = 0;
      let innerClicks = 0;
      const outerData = reactive([{}]);
      const innerData = reactive([{}]);
      const outerList = html`<ul id="nested-view-outer"></ul>`;
      const innerList = html`<ul id="nested-view-inner"></ul>`;
      const unmountOuterList = render(outerList, "", false);
      const unmountInnerList = render(innerList, "", false);

      view("#nested-view-outer", outerData, () => {
        const outerButton = html`
          <button onclick=${() => outerClicks++}>outer</button>
        `;
        view(
          "#nested-view-inner",
          innerData,
          () => html`<button onclick=${() => innerClicks++}>inner</button>`,
        );
        return outerButton;
      });

      outerList.querySelector("button")?.click();
      innerList.querySelector("button")?.click();
      unmountOuterList();
      unmountInnerList();
      unset(outerData);
      unset(innerData);

      return outerClicks === 1 && innerClicks === 1;
    });

    it("covers view reset, append, and replacement", async () => {
      const data = reactive([]);
      const list = html`<ul id="shared-view"></ul>`;
      const unmount = render(list, "", false);
      view("#shared-view", data, (item: any) => html`<li>${item.id}</li>`);

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
      const elem = html`<p>lifecycle</p>`;
      let rendered = 0;
      let cleaned = 0;
      onRender(() => rendered++, elem);
      onRender(() => rendered++, elem);
      onCleanup(() => cleaned++, elem);
      onCleanup(() => cleaned++, elem);

      render(elem, "", false)();
      return rendered === 2 && cleaned === 2;
    });

    it("reports hydro attribute changes until unsubscribed", () => {
      const value = reactive("one");
      const disabled = reactive(true);
      const root = html`<section>
        <button data-value=${value} disabled=${disabled}>tracked</button>
        <button data-value=${value}>other</button>
      </section>`;
      const unmount = render(root, "", false);
      const [elem, other] = root.querySelectorAll("button");
      const names: string[] = [];
      const stop = onAttributeChange((name: string) => names.push(name), elem);

      value("two");
      disabled(false);
      const hydroChanges =
        elem.getAttribute("data-value") === "two" &&
        other.getAttribute("data-value") === "two" &&
        !elem.hasAttribute("disabled") &&
        names.join(",") === "data-value,disabled";

      elem.setAttribute("data-native", "ignored");
      const nativeIgnored = names.length === 2;
      stop();
      stop();
      value("three");
      unmount();
      unset(value);
      unset(disabled);

      return hydroChanges && nativeIgnored && names.length === 2;
    });

    it("reports rendered tree changes until unsubscribed", () => {
      const parents: Node[] = [];
      const stop = onTreeChange(
        (parent: Node) => parents.push(parent),
        document.body,
      );
      const elem = html`<p>tree change</p>`;
      const constructedWithoutSignal = parents.length === 0;
      const unmount = render(elem, "", false);
      stop();
      unmount();
      return (
        constructedWithoutSignal &&
        parents.length === 1 &&
        parents[0] === document.body
      );
    });

    it("reports replacement and removal to ancestor subscriptions", () => {
      const root = html`<section><span>before</span></section>`;
      const unmountRoot = render(root, "", false);
      const parents: Node[] = [];
      const stop = onTreeChange((parent: Node) => parents.push(parent), root);
      const replacement = html`<strong>after</strong>`;
      const unmountReplacement = render(replacement, root.firstChild, false);
      const replaced = parents.includes(root);
      unmountReplacement();
      const removed = parents.filter((parent) => parent === root).length >= 2;
      stop();
      unmountRoot();
      return replaced && removed;
    });

    it("reports view additions and resets", async () => {
      const data = reactive([]);
      const list = html`<ul id="tree-change-view"></ul>`;
      const unmount = render(list, "", false);
      const parents: Node[] = [];
      const stop = onTreeChange((parent: Node) => parents.push(parent), list);
      view("#tree-change-view", data, (item: any) => html`<li>${item.id}</li>`);

      data([{ id: 1 }, { id: 2 }]);
      await sleep(2);
      const appended = parents.includes(list);
      data([]);
      await sleep(2);
      const reset = parents.filter((parent) => parent === list).length >= 2;

      stop();
      unmount();
      unset(data);
      return appended && reset;
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
      const elem = html`<p>${data.label}</p>`;
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
      const list = html`<ul id="shared-keyed"></ul>`;
      const unmount = render(list, "", false);
      view("#shared-keyed", data, (_item: any, index: number) =>
        h("li", { bind: data[index] }, data[index].id),
      );
      data((current: any[]) => {
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
