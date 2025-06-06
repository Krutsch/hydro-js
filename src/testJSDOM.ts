import { JSDOM } from "jsdom";
const { window } = new JSDOM(`<!doctype html>
  <html lang="en">
    <head>
    </head>
    <body>
    </body>
  </html>`);

// @ts-expect-error
globalThis.window = window;
globalThis.document = window.document;

const {
  html,
  h,
  hydro,
  render,
  setGlobalSchedule,
  setReuseElements,
  reactive,
  unset,
  emit,
  watchEffect,
  observe,
  getValue,
  onRender,
  onCleanup,
  internals,
  ternary,
  setInsertDiffing,
  $,
  unobserve,
  setAsyncUpdate,
  setReactivity,
  view,
} = await import("./library.js");

// Local debugging
//@ts-ignore
window.html = html;
//@ts-ignore
window.render = render;
//@ts-ignore
window.hydro = hydro;
//@ts-ignore
window.setReactivity = setReactivity;

setGlobalSchedule(false); // Simplifies testing

const sleep = (time: number) =>
  new Promise((resolve) => setTimeout(resolve, time));

document.head.insertAdjacentHTML(
  "beforeend",
  `<style>
  .badge {
    display: inline-block;
    padding: 0.25em 0.4em;
    border-radius: 0.25rem;
    color: #fff;
  }
  .success {
    background-color: #28a745;
  }
  .error {
    background-color: #dc3545;
  }
</style>`
);
const results: Array<{ name: string; success: boolean }> = [];

// --------- TESTS START ------------

let condition = true;
describe("library", () => {
  describe("functions", () => {
    describe("h", () => {
      it("handles functions correctly", () => {
        return (
          h(() => h("p", null, ["Hello World"]), null, []).textContent ===
          "Hello World"
        );
      });

      it("returns a valid element", () => {
        const test = reactive("A");
        setTimeout(() => {
          unset(test);
        });
        return (h("div", null, [test]) as Element).localName === "div";
      });

      it("handles documentFragment", () => {
        return (
          (h(h, null, h("p", null, "hi"), h("p", null, "ho")) as Element)
            .nodeType === 11
        );
      });

      it("returns a valid element when it has children", () => {
        return h("div", null, [h("p", null, ["test"])]).childNodes.length === 1;
      });
    });

    describe("documentFragment", () => {
      it("render elem in fragment", () => {
        const fragment = html`<div>here</div>
          <div>and here</div>`;
        render(fragment);
        const unmount = render(html`<p>a</p>`, fragment);
        let condition = document.body.childElementCount === 1;
        unmount();

        return condition && document.body.childElementCount === 0;
      });

      it("render fragment in fragment", () => {
        const fragment = html`<div>here</div>
          <div>and here</div>`;
        render(fragment);
        const unmount = render(html`<p>a</p><p>b</b>`, fragment);
        let condition = document.body.childElementCount === 2;
        unmount();

        return condition && document.body.childElementCount === 0;
      });

      it("render fragment in elem", () => {
        const elem = html`<div>here</div>`;
        render(elem);
        const unmount = render(html`<p>a</p><p>b</b>`, elem);
        let condition = document.body.childElementCount === 2;
        unmount();

        return condition && document.body.childElementCount === 0;
      });

      it("render text in fragment", () => {
        const fragment = html`<div>here</div>
          <div>and here</div>`;
        render(fragment);
        const unmount = render(html`text`, fragment);
        let condition = document.body.childElementCount === 0;
        unmount();

        return condition && document.body.childElementCount === 0;
      });

      it("render fragment in text", () => {
        const text = html`text`;
        render(text);
        const unmount = render(
          html`<div>here</div>
            <div>and here</div>`,
          text
        );
        let condition = document.body.childElementCount === 2;
        unmount();

        return condition && document.body.childElementCount === 0;
      });

      it("render elem in fragment - setInsertDiffing", () => {
        setInsertDiffing(true);
        const fragment = html`<div>here</div>
          <div>and here</div>`;
        render(fragment);
        const unmount = render(html`<p>a</p>`, fragment);
        let condition = document.body.childElementCount === 1;
        unmount();
        setInsertDiffing(false);
        return condition && document.body.childElementCount === 0;
      });

      it("render fragment in fragment - setInsertDiffing", () => {
        setInsertDiffing(true);
        const fragment = html`<div>here</div>
          <div>and here</div>`;
        render(fragment);
        const unmount = render(html`<p>a</p><p>b</b>`, fragment);
        let condition = document.body.childElementCount === 2;
        unmount();
        setInsertDiffing(false);
        return condition && document.body.childElementCount === 0;
      });

      it("render fragment in elem - setInsertDiffing", () => {
        setInsertDiffing(true);
        const elem = html`<div>here</div>`;
        render(elem);
        const unmount = render(html`<p>a</p><p>b</b>`, elem);
        let condition = document.body.childElementCount === 2;
        unmount();
        setInsertDiffing(false);
        return condition && document.body.childElementCount === 0;
      });

      it("render text in fragment - setInsertDiffing", () => {
        setInsertDiffing(true);
        const fragment = html`<div>here</div>
          <div>and here</div>`;
        render(fragment);
        const unmount = render(html`text`, fragment);
        let condition = document.body.childElementCount === 0;
        unmount();
        setInsertDiffing(false);
        return condition && document.body.childElementCount === 0;
      });

      it("render fragment in text - setInsertDiffing", () => {
        setInsertDiffing(true);
        const text = html`text`;
        render(text);
        const unmount = render(
          html`<div>here</div>
            <div>and here</div>`,
          text
        );
        let condition = document.body.childElementCount === 2;
        unmount();
        setInsertDiffing(false);
        return condition && document.body.childElementCount === 0;
      });
    });

    describe("setReuseElements", () => {
      it("code coverage", () => {
        setReuseElements(true);
        return true;
      });
    });

    describe("setGlobalSchedule", () => {
      it("sets asnycUpdate on hydro objects", () => {
        hydro.schedule = {};
        let cond = hydro.schedule.asyncUpdate === false;
        setGlobalSchedule(true);
        cond = cond && hydro.schedule.asyncUpdate === true;
        setGlobalSchedule(false);

        setTimeout(() => {
          hydro.schedule = null;
        });

        return cond && hydro.schedule.asyncUpdate === false;
      });
    });

    describe("setAsyncUpdate", () => {
      it("sets asnycUpdate on reactive object", () => {
        const schedule = reactive({});
        setAsyncUpdate(schedule, false);
        setTimeout(unset, 0, schedule);
        return true;
      });

      it("works chained", () => {
        const abc = reactive({ a: { b: 4 } });
        setAsyncUpdate(abc.a, false);
        setTimeout(unset, 0, abc);
        return true;
      });
    });

    describe("html", () => {
      // https://html.spec.whatwg.org/
      [
        "a",
        "abbr",
        "address",
        "area",
        "article",
        "aside",
        "audio",
        "b",
        "base",
        "bdi",
        "bdo",
        "blockquote",
        "body",
        "br",
        "button",
        "canvas",
        "caption",
        "cite",
        "code",
        "col",
        "colgroup",
        "data",
        "datalist",
        "dd",
        "del",
        "details",
        "dfn",
        "dialog",
        "div",
        "dl",
        "dt",
        "em",
        "embed",
        "fencedframe",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "header",
        "hgroup",
        "hr",
        "html",
        "i",
        "iframe",
        "img",
        "input",
        "ins",
        "kbd",
        "label",
        "legend",
        "li",
        "link",
        "main",
        "map",
        "mark",
        "menu",
        "meta",
        "meter",
        "nav",
        "noscript",
        "object",
        "ol",
        "optgroup",
        "option",
        "output",
        "p",
        "picture",
        "pre",
        "progress",
        "q",
        "rp",
        "rt",
        "ruby",
        "s",
        "samp",
        "script",
        "search",
        "section",
        "select",
        "selectedcontent",
        "slot",
        "small",
        "source",
        "span",
        "strong",
        "style",
        "sub",
        "summary",
        "sup",
        "svg",
        "table",
        "tbody",
        "td",
        "template",
        "textarea",
        "tfoot",
        "th",
        "thead",
        "time",
        "title",
        "tr",
        "track",
        "u",
        "ul",
        "var",
        "video",
        "wbr",
        "custom-wc",
      ].forEach((tag) => {
        it(`is able to create element ${tag}`, () => {
          const elem = html`<${tag} />` as Element;
          return elem.localName === tag;
        });
      });

      it("handles false variables correctly", () => {
        return (
          html`<input type="checkbox" required=${false} />`.textContent === ""
        );
      });

      it("handles a new html doc correctly", () => {
        const elem = html`<html>
          <head></head>
          <body>
            a
          </body>
        </html>` as Element;
        return (
          elem.localName === "html" &&
          !!elem.querySelector("head") &&
          !!elem.querySelector("body")
        );
      });

      it("returns empty text node", () => {
        return document.createTextNode("").isEqualNode(html``);
      });

      it("returns text node", () => {
        return document.createTextNode("hello").isEqualNode(html`hello`);
      });

      it("returns document fragment", () => {
        const node = html`<div><p>hi</p></div>
          <div><span>ho</span></div>` as DocumentFragment;
        return (
          node.nodeName !== "svg" &&
          "getElementById" in node &&
          node.childElementCount === 2
        );
      });

      it("returns element", () => {
        const elem = html`<p>hello</p>` as Element;
        return elem.localName === "p" && elem.textContent!.includes("hello");
      });

      it("variable input (node)", () => {
        const p = html`<p>hi</p>`;
        const elem = html`<div>${p}</div>`;
        return elem.contains(p) && elem.textContent!.includes("hi");
      });

      it("variable input (primitive value)", () => {
        const test = "test";
        const elem = html`<div>${test}</div>`;
        return elem.textContent!.includes(test);
      });

      it("variable input (hydro)", () => {
        hydro.testValue = "test";
        const elem = html`<div>{{ testValue }}</div>`;
        setTimeout(() => {
          hydro.testValue = null;
        });
        return elem.textContent!.includes(hydro.testValue);
      });

      it("variable input (reactive) - does not include undefined", () => {
        const data = reactive({});
        const elem = html`<div>${data.test}</div>`;
        setTimeout(unset, 0, data);
        return !elem.textContent!.includes(String(undefined));
      });

      it("variable input (reactive)", () => {
        const test = reactive("test");
        const elem = html`<div>${test}</div>`;
        setTimeout(unset, 0, test);
        return elem.textContent!.includes(getValue(test));
      });

      it("variable input (eventListener)", () => {
        const onClick = (e: any) => (e.currentTarget.textContent = 1);
        const elem = html`<div onclick=${onClick}>0</div>`;
        //@ts-ignore
        elem.click();
        return elem.textContent!.includes("1");
      });

      it("variable input (array - normal)", () => {
        const arr = [42, "test"];
        const elem = html`<div>${arr}</div>`;
        return (
          elem.textContent!.includes("42") && elem.textContent!.includes("test")
        );
      });

      it("variable input (function)", () => {
        const onClick = (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 1);
        const elem = html`<div onclick=${onClick}>0</div>` as Element;
        //@ts-ignore
        elem.click();
        return elem.textContent!.includes("1");
      });

      it("variable input (eventListener as object)", () => {
        const onClick = {
          event: (e: any) =>
            (e.currentTarget.textContent =
              Number(e.currentTarget.textContent) + 1),
          options: {
            once: true,
          },
        };
        const elem = html`<div onclick=${onClick}>0</div>` as Element;
        //@ts-ignore
        elem.click();
        //@ts-ignore
        elem.click();
        return elem.textContent!.includes("1");
      });

      it("variable input (array - node)", () => {
        const p = html`<p>test</p>`;
        const arr = [42, p];
        const elem = html`<div>${arr}</div>`;
        return (
          elem.textContent!.includes("42") &&
          elem.textContent!.includes("test") &&
          elem.contains(p)
        );
      });

      it("variable input (object)", () => {
        const props = {
          id: "test",
          onclick: (e: any) =>
            (e.currentTarget.textContent =
              Number(e.currentTarget.textContent) + 1),
          target: "_blank",
        };
        const elem = html`<a ${props}>0</a>` as HTMLAnchorElement;
        //@ts-ignore
        elem.click();
        return (
          elem.id === "test" &&
          elem.target === "_blank" &&
          elem.textContent === "1"
        );
      });

      it("variable input (object - with eventListenerObject)", () => {
        const props = {
          id: "test",
          onclick: {
            event: (e: any) =>
              (e.currentTarget.textContent =
                Number(e.currentTarget.textContent) + 1),
            options: {
              once: true,
            },
          },
          target: "_blank",
        };
        const elem = html`<a ${props}>0</a>` as HTMLAnchorElement;
        //@ts-ignore
        elem.click();
        //@ts-ignore
        elem.click();
        return (
          elem.id === "test" &&
          elem.target === "_blank" &&
          elem.textContent === "1"
        );
      });

      it("resolves deep reactive", () => {
        const person = reactive({
          firstname: "Fabian",
          lastname: "Krutsch",
          char: { int: 777 },
          items: [1, 2, 3],
        });

        const elem = html`
          <p>
            <span>His firstname is: </span><span>${person.firstname}</span
            ><br />
            <span>His int value is: </span><span>${person.char.int}</span><br />
            <span>His first item is: </span><span>${person.items[0]}</span
            ><br />
          </p>
        `;
        const unmount = render(elem);

        person((curr: typeof person) => {
          curr.char.int = 123;
          curr.items[0] = 0;
        });

        setTimeout(() => {
          unmount();
          unset(person);
        });

        return (
          (document.body.textContent?.includes("Fabian") &&
            document.body.textContent?.includes("123") &&
            document.body.textContent?.includes("0")) ??
          false
        );
      });

      it("nested reactive", () => {
        const list = reactive([
          { text: "Lorem", success: true },
          { text: "ipsum", success: true },
        ]);
        const elem = html`
          <div>
            ${getValue(list).map((_, index) => {
              return html`<p>${list[index].text}</p>`;
            })}
          </div>
        `;
        const unmount = render(elem);
        list((curr: typeof list) => {
          curr[0].text = "Changed";
        });
        const native = document.createElement("div");
        native.insertAdjacentHTML("beforeend", `<p>Changed</p><p>ipsum</p>`);

        setTimeout(() => {
          unset(list);
          unmount();
        });
        return (
          native.innerHTML.trim() === (elem as HTMLDivElement).innerHTML.trim()
        );
      });

      it("removes {{..}}) from html attribute", () => {
        const attr = reactive({ id: "test" });
        const elem = html`<p ${attr}></p>` as Element;
        const unmount = render(elem);

        setTimeout(() => {
          unmount();
          unset(attr);
        });

        return elem.id === "test" && !elem.hasAttribute("{{attr}}");
      });

      it("two-way attribute", () => {
        const text = reactive("text");
        const checked = reactive(true);
        const checkedRadio = reactive("A");
        const select = reactive("cat");
        const datetime = reactive("2018-06-08T00:00");

        const unmount = render(
          html`
            <div>
              <input id="text" type="text" two-way=${text} />
              <textarea two-way=${text}></textarea>

              <label>
                <input id="checkbox1" type="checkbox" two-way=${checked} />
                John
              </label>

              <label>
                <input
                  id="datetime"
                  type="datetime-local"
                  two-way=${datetime}
                  min="2018-06-07T00:00"
                  max="2020-06-14T00:00"
                />
              </label>

              <label>
                <input
                  id="radio1"
                  type="radio"
                  name="group"
                  value="A"
                  two-way=${checkedRadio}
                />
                A
              </label>
              <label>
                <input
                  id="radio2"
                  type="radio"
                  name="group"
                  value="B"
                  two-way=${checkedRadio}
                />
                B
              </label>

              <label for="pet-select">Choose a pet:</label>
              <select name="pets" id="pet-select" two-way=${select}>
                <option value="">--Please choose an option--</option>
                <option value="dog">Dog</option>
                <option value="cat">Cat</option>
                <option value="hamster">Hamster</option>
                <option value="parrot">Parrot</option>
                <option value="spider">Spider</option>
                <option value="goldfish">Goldfish</option>
              </select>
            </div>
          `
        );
        let cond =
          //@ts-ignore
          $("#text")!.value === "text" &&
          //@ts-ignore
          $("textarea").value === "text" &&
          //@ts-ignore
          $("#checkbox1").checked &&
          //@ts-ignore
          $("#radio1").checked &&
          //@ts-ignore
          !$("#radio2").checked &&
          //@ts-ignore
          $("select").value === "cat" &&
          //@ts-ignore
          $("#datetime").value === "2018-06-08T00:00";

        // Code Coverage
        $("#radio1")!.dispatchEvent(new window.Event("change"));
        //@ts-ignore
        $("#checkbox1")!.click();

        text("haha");
        checked(false);
        checkedRadio("B");
        select("dog");
        datetime("2018-06-09T00:00");

        setTimeout(() => {
          unmount();
          unset(text);
          unset(checked);
          unset(checkedRadio);
          unset(select);
          unset(datetime);
        });

        return (
          cond &&
          //@ts-ignore
          $("#text").value === "haha" &&
          //@ts-ignore
          $("textarea").value === "haha" &&
          //@ts-ignore
          !$("#checkbox1").checked &&
          //@ts-ignore
          !$("#radio1").checked &&
          //@ts-ignore
          $("#radio2").checked &&
          //@ts-ignore
          $("select").value === "dog" &&
          //@ts-ignore
          $("#datetime").value === "2018-06-09T00:00"
        );
      });

      it("works with different events on one element", () => {
        let a, b, c;
        const elem = html`<p
          ona=${() => (a = true)}
          onb=${{ event: () => (b = true), options: {} }}
          onc=${() => (c = true)}
        >
          test
        </p>`;

        emit("a", {}, elem);
        emit("b", {}, elem);
        emit("c", {}, elem);

        return !!a && !!b && !!c;
      });

      it("stringifies object", () => {
        hydro.x = { a: 3 };
        const elem = html`<p>{{x}}</p>`;
        setTimeout(() => (hydro.x = null));
        return elem.textContent === '{"a":3}';
      });

      it("removes bind element", () => {
        hydro.y = { a: 3 };
        const elem = html`<p bind="{{y}}">asd</p>`;
        render(elem);
        hydro.y = null;
        return !elem.isConnected;
      });

      it("removes bind element with multiple elements", () => {
        hydro.z = 4;
        const elem = html`<p bind="{{z}}">asd</p>`;
        const elem2 = html`<p bind="{{z}}">asd2</p>`;
        render(elem);
        render(elem2);
        hydro.z = null;
        return !elem.isConnected && !elem2.isConnected;
      });

      it("super rare manipulation of DOM Element", () => {
        hydro.abc = { id: "jja", href: "cool" };
        const elem = html`<a id="{{abc.id}}" href="{{abc.href}}"
          >asdad</a
        >` as HTMLAnchorElement;
        elem.id = "{{abc.id}}";
        elem.href = "{{abc.href}}";
        html`<p>${elem}</p>`;
        setTimeout(() => (hydro.abc = null));
        return true;
      });
    });

    describe("compare", () => {
      it("lifecycle hooks and text Nodes - false - length", () => {
        const renderFn1 = () => 2;
        const renderFn2 = () => 3;
        const cleanFn1 = () => 3;

        const elem1 = html`a` as Element;
        const elem2 = html`a` as Element;

        onRender(renderFn1, elem1);
        onRender(renderFn2, elem2);
        onCleanup(cleanFn1, elem1);

        return internals.compare(elem1, elem2) === false;
      });

      it("lifecycle hooks and text Nodes - false - string", () => {
        const renderFn1 = () => 2;
        const renderFn2 = () => 3;
        const cleanFn1 = () => 3;
        const cleanFn2 = () => 3;

        const elem1 = html`a` as Element;
        const elem2 = html`a` as Element;

        onRender(renderFn1, elem1);
        onRender(renderFn2, elem2);
        onCleanup(cleanFn1, elem1);
        onCleanup(cleanFn2, elem2);

        return internals.compare(elem1, elem2) === false;
      });

      it("returns false if child has different lifecycle hooks - onlyTextChildren", () => {
        const subelem1 = html`hello`;
        onRender(() => 2, subelem1);
        const elem1 = html`<p>${subelem1}</p>` as Element;

        const subelem2 = html`hello`;
        onRender(() => 3, subelem2);
        const elem2 = html`<p>${subelem2}</p>` as Element;

        return internals.compare(elem1, elem2, true) === false;
      });

      it("returns false if child has different lifecycle hooks", () => {
        const subelem1 = html`hello`;
        onRender(() => 2, subelem1);
        const elem1 = html`<p>${subelem1}</p>` as Element;

        const subelem2 = html`hello`;
        onRender(() => 3, subelem2);
        const elem2 = html`<p>${subelem2}</p>` as Element;

        return internals.compare(elem1, elem2) === false;
      });

      it("lifecycle hooks and text Nodes - true", () => {
        const renderFn1 = () => 2;
        const renderFn2 = () => 2;
        const cleanFn1 = () => 3;
        const cleanFn2 = () => 3;

        const elem1 = html`a` as Element;
        const elem2 = html`a` as Element;

        onRender(renderFn1, elem1);
        onRender(renderFn2, elem2);
        onCleanup(cleanFn1, elem1);
        onCleanup(cleanFn2, elem2);

        return internals.compare(elem1, elem2) === true;
      });

      it("same functions return true", () => {
        const fn1 = () => 2;
        const fn2 = () => 2;
        const elem1 = html`<p onclick=${fn1}></p>` as Element;
        const elem2 = html`<p onclick=${fn2}></p>` as Element;
        return internals.compare(elem1, elem2) === true;
      });

      it("same lifecycle hooks return true", () => {
        const fn1 = () => 2;
        const fn2 = () => 2;

        const elem1 = html`<p>1</p>` as Element;
        onRender(fn1, elem1);
        onCleanup(fn2, elem1);

        const elem2 = html`<p>1</p>` as Element;
        onRender(fn1, elem2);
        onCleanup(fn2, elem2);

        return internals.compare(elem1, elem2) === true;
      });

      it("different function return false", () => {
        const fn1 = () => 2;
        const fn2 = () => 3;
        const elem1 = html`<p onclick=${fn1}></p>` as Element;
        const elem2 = html`<p onclick=${fn2}></p>` as Element;
        return internals.compare(elem1, elem2) === false;
      });

      it("different lifecycle hooks return false", () => {
        const fn1 = () => 2;
        const fn2 = () => 3;

        const elem1 = html`<p>1</p>` as Element;
        onRender(fn1, elem1);
        onCleanup(fn2, elem1);

        const elem2 = html`<p>1</p>` as Element;
        onRender(fn1, elem2);
        onCleanup(fn1, elem2);

        return internals.compare(elem1, elem2) === false;
      });
    });

    describe("render", () => {
      it("does diffing with documentFragment", () => {
        setInsertDiffing(true);
        const elem1 = html`it`;
        const elem2 = html`<p>hello</p>
          <p>world</p>`;
        render(elem1);
        const unmount = render(elem2, elem1);
        setInsertDiffing(false);

        setTimeout(unmount);

        return (
          !document.body.textContent!.includes("hi") &&
          document.body.textContent!.includes("hello") &&
          document.body.textContent!.includes("world")
        );
      });

      it("do not reuseElements", () => {
        setReuseElements(false);
        const elem1 = html`a`;
        const elem2 = html`a`;
        render(elem1);
        const unmount = render(elem2, elem1 as Element);

        setTimeout(unmount);
        setReuseElements(true);
        return !elem1.isConnected && elem2.isConnected;
      });

      it("can render elements wrapped in reactive", async () => {
        const number = reactive(5);
        const elem = reactive(html`<p>${number}</p>`);
        const unmount = render(elem);
        const cond = getValue(elem).textContent!.includes(
          String(getValue(number))
        );

        setTimeout(() => number(6), 50);

        setTimeout(() => {
          unset(number);
          unset(elem);
          unmount();
        }, 150);

        await sleep(100);
        return (
          cond && getValue(elem).textContent!.includes(String(getValue(number)))
        );
      });

      it("where does not exist - no render", () => {
        const elemCount = document.body.querySelectorAll("*").length;
        const unmount = render(html`<p>what</p>`, "#doesNotExist");

        setTimeout(unmount);
        return document.body.querySelectorAll("*").length === elemCount;
      });

      it("elem is DocumentFragment, no where", () => {
        const elem = html`<div id="first">1</div>
          <div id="second">2</div>`;
        const unmount = render(elem);

        setTimeout(unmount);
        return (
          $("#first")!.textContent!.includes("1") &&
          $("#second")!.textContent!.includes("2")
        );
      });

      it("elem is svg, no where", () => {
        const elem = html`<svg height="100" width="100">
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="black"
            stroke-width="3"
            fill="red"
          />
        </svg>`;
        const unmount = render(elem);

        setTimeout(unmount);
        return elem.isConnected && !!document.body.querySelector("circle");
      });

      it("elem is textNode, no where", () => {
        const elem = html`what`;
        const unmount = render(elem);

        setTimeout(unmount);
        return elem.isConnected && document.body.textContent!.includes("what");
      });

      it("elem is Element, no where", () => {
        const elem = html`<p id="whatWhere">what</p>`;
        const unmount = render(elem);

        setTimeout(unmount);
        return (
          elem.isConnected && $("#whatWhere")!.textContent!.includes("what")
        );
      });

      it("elem is DocumentFragment, with where", () => {
        document.body.insertAdjacentHTML("beforeend", '<p id="hello">here</p>');
        const elem = html`<div id="firstOne">1</div>
          <div id="secondOne">2</div>`;
        const unmount = render(elem, "#hello");

        setTimeout(unmount);
        return (
          $("#firstOne")!.textContent!.includes("1") &&
          $("#secondOne")!.textContent!.includes("2") &&
          !document.body.querySelector("#hello")
        );
      });

      it("elem is svg, with where", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<p id="hello2">here</p>'
        );
        const elem = html`<svg height="100" width="100">
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="black"
            stroke-width="3"
            fill="red"
          />
        </svg>`;
        const unmount = render(elem, "#hello2");

        setTimeout(unmount);
        return elem.isConnected && !!document.body.querySelector("circle");
      });

      it("elem is textNode, with where", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<p id="hello3">here</p>'
        );
        const elem = html`what`;
        const unmount = render(elem, "#hello3");

        setTimeout(unmount);
        return (
          elem.isConnected &&
          document.body.textContent!.includes("what") &&
          !document.body.querySelector("#hello3")
        );
      });

      it("elem is Element, with where", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<p id="hello4">here</p>'
        );
        const elem = html`<p id="testThisWhat">what</p>`;
        const unmount = render(elem, "#hello4");

        setTimeout(unmount);
        return (
          elem.isConnected &&
          $("#testThisWhat")!.textContent!.includes("what") &&
          !document.body.querySelector("#hello4")
        );
      });

      it("replace an element will replace the event", () => {
        const click1 = (e: any) => (e.currentTarget.textContent = 1);
        const click2 = (e: any) => (e.currentTarget.textContent = 2);
        let elem = html` <div id="event" onclick=${click1}>0</div> `;

        render(elem);
        //@ts-ignore
        elem.click();
        let cond = elem.textContent!.includes("1");

        elem = html` <div id="event" onclick=${click2}>0</div> `;
        const unmount = render(elem, "#event");
        //@ts-ignore
        elem.click();

        setTimeout(unmount);

        return cond && elem.textContent!.includes("2");
      });

      it("replacing elements will not stop their state", async () => {
        await sleep(300);
        setInsertDiffing(true);
        const video1 = html`
          <div id="video">
            <p>Value: 0</p>
            <video width="400" controls autoplay loop muted>
              <source
                src="https://www.w3schools.com/html/mov_bbb.mp4"
                type="video/mp4"
              />
              <p>code coverage</p>
            </video>
          </div>
        `;
        const video2 = html`
          <div id="video">
            <p>Value: 1</p>
            <video width="400" controls autoplay loop muted>
              <source
                src="https://www.w3schools.com/html/mov_bbb.mp4"
                type="video/mp4"
              />
              <p>code coverage</p>
            </video>
          </div>
        `;
        // Video Test
        render(video1);

        await sleep(300);
        const time = $("video")!.currentTime;

        const unmount = render(video2, "#video");
        setInsertDiffing(false);

        await sleep(150);

        setTimeout(() => {
          unmount();
        });

        return time <= $("video")!.currentTime;
      });

      it("calls lifecyle hooks on deep elements", () => {
        let subOnRender = false;
        let subOnCleanup = false;
        let elemOnRender = false;
        let elemOnCleanup = false;

        function SubElem() {
          const subElem = html`<p></p>`;
          onRender(() => (subOnRender = true), subElem);
          onCleanup(() => (subOnCleanup = true), subElem);
          return subElem;
        }
        function Elem() {
          const elem = html`<p>${SubElem()}</p>`;
          onRender(() => (elemOnRender = true), elem);
          onCleanup(() => (elemOnCleanup = true), elem);
          return elem;
        }
        const unmount = render(Elem());
        unmount();

        return subOnRender && subOnCleanup && elemOnRender && elemOnCleanup;
      });

      it("calls the correct lifecyle hooks when replacing elements", () => {
        let subOnRender = false;
        let subOnCleanup = false;
        let elemOnRender = false;
        let elemOnCleanup = false;

        const subElem = html`<p id="replace"></p>`;
        onRender(() => (subOnRender = true), subElem);
        onCleanup(() => (subOnCleanup = true), subElem);
        render(subElem);

        const elem = html`<p id="replace"></p>`;
        onRender(() => (elemOnRender = true), elem);
        onCleanup(() => (elemOnCleanup = true), elem);
        const unmount = render(elem, "#replace");

        setTimeout(unmount);
        return subOnRender && subOnCleanup && elemOnRender && !elemOnCleanup;
      });

      it("diffs head against head", () => {
        let oldValue: string | null;
        let oldChildCount = 0;
        setTimeout(() => {
          oldValue = document.head.outerHTML;
          oldChildCount = document.head.childElementCount;
          setInsertDiffing(false);
          render(document.createElement("head"), document.head, false);
          condition = condition && 0 === document.head.childElementCount;
        }, 750);
        setTimeout(() => {
          setInsertDiffing(false);
          render(html`${oldValue}`, document.head, false);
          condition =
            condition && oldChildCount === document.head.childElementCount;
        }, 800);
        return true;
      });

      it("diffs body against body", () => {
        let oldValue: string | null;
        let oldChildCount = 0;
        setTimeout(() => {
          oldValue = document.body.outerHTML;
          oldChildCount = document.body.childElementCount;
          setInsertDiffing(false);
          render(document.createElement("body"), document.body, false);
          condition = condition && 0 === document.body.childElementCount;
        }, 850);
        setTimeout(() => {
          setInsertDiffing(false);
          render(html`${oldValue}`, document.body, false);
          condition =
            condition && oldChildCount === document.body.childElementCount;
        }, 900);
        return true;
      });

      it("diffs html against html", () => {
        let oldValue: string | null;
        let oldChildCount = 0;
        setTimeout(() => {
          oldValue = document.documentElement.outerHTML;
          oldChildCount = document.documentElement.childElementCount;
          setInsertDiffing(false);
          render(
            document.createElement("html"),
            document.documentElement,
            false
          );
          condition =
            condition && 0 === document.documentElement.childElementCount;
        }, 950);
        setTimeout(() => {
          setInsertDiffing(false);
          render(html`${oldValue}`, document.documentElement, false);
          condition =
            condition &&
            oldChildCount === document.documentElement.childElementCount;
        }, 1000);
        return true;
      });

      it("diffs head against head - setInsertDiffing", () => {
        let oldValue: string | null;
        let oldChildCount = 0;
        setTimeout(() => {
          oldValue = document.head.outerHTML;
          oldChildCount = document.head.childElementCount;
          setInsertDiffing(true);
          render(document.createElement("head"), document.head, false);
          condition = condition && 0 === document.head.childElementCount;
        }, 1050);
        setTimeout(() => {
          setInsertDiffing(true);
          render(html`${oldValue}`, document.head, false);
          condition =
            condition && oldChildCount === document.head.childElementCount;
        }, 1100);
        return true;
      });

      it("diffs body against body - setInsertDiffing", () => {
        let oldValue: string | null;
        let oldChildCount = 0;
        setTimeout(() => {
          oldValue = document.body.outerHTML;
          oldChildCount = document.body.childElementCount;
          setInsertDiffing(true);
          render(document.createElement("body"), document.body, false);
          condition = condition && 0 === document.body.childElementCount;
        }, 1150);
        setTimeout(() => {
          setInsertDiffing(true);
          render(html`${oldValue}`, document.body, false);
          condition =
            condition && oldChildCount === document.body.childElementCount;
        }, 1200);
        return true;
      });

      it("diffs html against html - setInsertDiffing", () => {
        let oldValue: string | null;
        let oldChildCount = 0;
        setTimeout(() => {
          oldValue = document.documentElement.outerHTML;
          oldChildCount = document.documentElement.childElementCount;
          setInsertDiffing(true);
          render(
            document.createElement("html"),
            document.documentElement,
            false
          );
          condition =
            condition && 0 === document.documentElement.childElementCount;
        }, 1250);
        setTimeout(() => {
          setInsertDiffing(true);
          render(html`${oldValue}`, document.documentElement, false);
          condition =
            condition &&
            oldChildCount === document.documentElement.childElementCount;
          done();
        }, 1300);
        return true;
      });
    });

    describe("reactive", () => {
      it("primitive value", () => {
        const counter = reactive(0);
        const unmount = render(
          html`
            <div
              id="reactClick"
              onclick=${() => counter((prev: number) => prev + 1)}
            >
              ${counter}
            </div>
          `
        );
        //@ts-ignore
        $("#reactClick").click();

        setTimeout(() => {
          unmount();
          unset(counter);
        });

        return $("#reactClick")!.textContent!.includes("1");
      });

      it("reactive (object)", () => {
        let obj1 = reactive({ a: { b: 5 } });
        let obj2 = reactive({ a: { b: 5 } });

        const unmount = render(
          html`
            <div>
              <div
                id="reactiveObj1"
                onclick=${() =>
                  obj1((current: typeof obj1) => {
                    current.a.b = 777;

                    return current;
                  })}
              >
                ${obj1.a.b}
              </div>
              <div
                id="reactiveObj2"
                onclick=${() =>
                  obj2((current: typeof obj2) => {
                    current.a.b = 777;
                  })}
              >
                ${obj2.a.b}
              </div>
            </div>
          `
        );
        //@ts-ignore
        $("#reactiveObj1").click();
        //@ts-ignore
        $("#reactiveObj2").click();
        setTimeout(() => {
          unmount();
          unset(obj1);
          unset(obj2);
        });
        return (
          $("#reactiveObj1")!.textContent!.includes("777") &&
          $("#reactiveObj2")!.textContent!.includes("777")
        );
      });

      it("reactive (array)", () => {
        const arr1 = reactive([1, [2]]);
        const arr2 = reactive([3, [4]]);

        const unmount = render(
          html`
            <div
              id="reactiveArr1"
              onclick=${() =>
                arr1((current: any) => {
                  current[0] += 1;

                  return current;
                })}
            >
              ${arr1[0]}
            </div>
            <div
              id="reactiveArr2"
              onclick=${() =>
                arr1((current: any) => {
                  current[1][0] += 1;

                  return current;
                })}
            >
              ${arr1[1][0]}
            </div>
            <div
              id="reactiveArr3"
              onclick=${() =>
                arr2((current: any) => {
                  current[0] += 1;
                })}
            >
              ${arr2[0]}
            </div>
            <div
              id="reactiveArr4"
              onclick=${() =>
                arr2((current: any) => {
                  current[1][0] += 1;
                })}
            >
              ${arr2[1][0]}
            </div>
          `
        );
        //@ts-ignore
        $("#reactiveArr1").click();
        //@ts-ignore
        $("#reactiveArr2").click();
        //@ts-ignore
        $("#reactiveArr3").click();
        //@ts-ignore
        $("#reactiveArr4").click();

        setTimeout(() => {
          unmount();
          unset(arr1);
          unset(arr2);
        });

        return (
          $("#reactiveArr1")!.textContent!.includes("2") &&
          $("#reactiveArr2")!.textContent!.includes("3") &&
          $("#reactiveArr3")!.textContent!.includes("4") &&
          $("#reactiveArr4")!.textContent!.includes("5")
        );
      });

      it("special logic for prev functions", () => {
        const a = reactive(undefined);
        const b = reactive(44);
        b(undefined);
        hydro.c = undefined;
        hydro.d = 44;
        hydro.d = undefined;
        const e = reactive(44);
        e((prev: any) => undefined);

        setTimeout(() => {
          unset(a);
          unset(b);
          hydro.c = null;
          hydro.d = null;
          unset(e);
        });

        return (
          getValue(a) === undefined &&
            getValue(b) === undefined &&
            hydro.c === undefined &&
            hydro.d === undefined,
          getValue(e) === 44
        );
      });
    });

    describe("watchEffect", () => {
      it("tracks and dependencies and re-runs the function (setter)", async () => {
        let watchCounter = 0;

        hydro.count1 = 0;
        hydro.count2 = 0;

        watchEffect(() => {
          hydro.count1 = 2;
          hydro.count2 = 2;
          watchCounter++;
        });

        hydro.count1 = 1;
        hydro.count2 = 1;

        setTimeout(() => {
          hydro.count1 = null;
          hydro.count2 = null;
        }, 200);

        await sleep(300);
        return watchCounter === 5;
      });

      it("tracks and dependencies and re-runs the function (getter)", () => {
        let watchCounter = 0;

        const count3 = reactive(0);
        const count4 = reactive(0);

        watchEffect(() => {
          getValue(count3);
          getValue(count4);
          watchCounter++;
        });

        count3(1);
        count4(1);

        setTimeout(() => {
          unset(count3);
          unset(count4);
        });

        return watchCounter === 3;
      });

      it("tracks and dependencies and re-runs the function (stop)", () => {
        let watchCounter = 0;

        const count5 = reactive(0);

        const stop = watchEffect(() => {
          getValue(count5);
          watchCounter++;
        });

        stop();
        count5(1);
        setTimeout(() => {
          unset(count5);
        });

        return watchCounter === 1;
      });
    });

    describe("observe", () => {
      it("observe hydro", () => {
        let test = 0;
        hydro.test = 0;

        hydro.observe("test", () => {
          test++;
        });

        hydro.test++;

        setTimeout(() => {
          hydro.test = null;
        });

        return test === 1;
      });

      it("observe reactive", () => {
        let result = 0;
        const test = reactive(0);

        observe(test, () => {
          result++;
        });

        test(1);

        setTimeout(() => {
          unobserve(test);
          unset(test);
        });

        return result === 1;
      });

      it("observe primitive - function", () => {
        let result = 0;
        const test = reactive(0);

        observe(test, () => {
          result++;
        });

        test((prev: typeof test) => ++prev);

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });

      it("observe not working for primitive with function and no return", () => {
        let result = 0;
        const test = reactive(0);

        observe(test, () => {
          result++;
        });

        test((prev: number) => {
          prev = 1;
        });

        setTimeout(() => {
          unset(test);
        });

        return result === 0;
      });

      it("observe object", () => {
        let result = 0;
        const test = reactive({ value: 0 });

        observe(test, () => {
          result++;
        });

        test({ value: 1 });

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });
      it("observe object (return another) function", () => {
        let result = 0;
        const test = reactive({ value: 0 });

        observe(test, () => {
          result++;
        });

        test(() => {
          return { value: 1 };
        });

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });
      it("observe object (modified arg)", () => {
        let result = 0;
        const test = reactive({ value: 0 });

        observe(test.value, () => {
          result++;
        });

        test((prev: typeof test) => {
          prev.value++;
          return prev;
        });

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });

      it("observe object and modify arg plus no return", () => {
        let result = 0;
        const test = reactive({ value: 0 });

        observe(test.value, () => {
          result++;
        });

        test((prev: typeof test) => {
          prev.value++;
        });

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });

      it("observe object and modify arg plus no return - new syntax", () => {
        let result = 0;
        const test = reactive({ value: 0 });

        observe(test.value, () => {
          result++;
        });

        test.value.setter(5);

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });
    });

    describe("getValue", () => {
      it("primitive value", () => {
        const x = reactive(4);
        setTimeout(unset, 0, x);
        return getValue(x) === 4;
      });

      it("object", () => {
        const obj = { test: 4 };
        const x = reactive(obj);
        setTimeout(unset, 0, x);
        return getValue(x).test === obj.test;
      });

      it("array", () => {
        const arr = [4];
        const x = reactive(arr);
        setTimeout(unset, 0, x);
        return getValue(x)[0] === arr[0];
      });
    });

    describe("unobserve", () => {
      it("works chained", () => {
        const abc = reactive({ a: { b: 4 } });
        unobserve(abc.a);
        setTimeout(unset, 0, abc);
        return true;
      });
    });

    describe("unset", () => {
      it("works chained", () => {
        const abc = reactive({ a: { b: 4 } });
        unset(abc.a);
        setTimeout(unset, 0, abc);
        return !getValue(abc).a;
      });
    });

    describe("ternary", () => {
      it("condition as function", () => {
        const isTrue = reactive(true);

        let wasSetTrue = false;
        ternary(
          () => getValue(isTrue),
          () => (wasSetTrue = false),
          () => (wasSetTrue = true),
          isTrue
        );

        isTrue(false);

        setTimeout(unset, 0, isTrue);

        //@ts-ignore
        return wasSetTrue === true;
      });

      it("re-renders component", () => {
        const isToggleOn = reactive(false);
        let unmount: Function;

        const handleClick = () => isToggleOn((prev: Boolean) => !prev);

        unmount = render(
          html`
            <button id="reRender" onclick=${handleClick}>
              ${ternary(isToggleOn, "ON", "OFF")}
            </button>
          `
        );

        //@ts-ignore
        $("#reRender").click();

        setTimeout(() => {
          unmount();
          unset(isToggleOn);
        });

        return $("#reRender")!.textContent!.includes("ON");
      });

      it("re-renders component - function", () => {
        const isToggleOn = reactive(false);
        let unmount: Function;

        const handleClick = () => isToggleOn((prev: Boolean) => !prev);

        unmount = render(
          html`
            <button id="reRenderF" onclick=${handleClick}>
              ${ternary(
                isToggleOn,
                () => "ON",
                () => "OFF"
              )}
            </button>
          `
        );

        //@ts-ignore
        $("#reRenderF").click();

        setTimeout(() => {
          unmount();
          unset(isToggleOn);
        });

        return $("#reRenderF")!.textContent!.includes("ON");
      });
    });

    describe("onRender", () => {
      it("works with DocumentFragment", () => {
        const elem = html`<p>1</p>
          <p>2</p>`;
        let count = 0;
        onRender(() => count++, elem, 1);
        const unmount = render(elem);

        setTimeout(unmount);
        return count === 1;
      });

      it("onRender", () => {
        let count = 0;
        const x = reactive(4);
        const elem = html` <p id="x">${x}</p> `;

        onRender(() => {
          count++;
        }, elem);

        const unmount = render(elem);

        setTimeout(() => {
          unset(x);
          unmount();
        });

        return count === 1;
      });
    });

    describe("onCleanup", () => {
      it("onCleanup", () => {
        let count = 0;
        const x = reactive(4);
        const elem = html` <p id="x">${x}</p> `;

        onCleanup(() => {
          count++;
          unset(x);
        }, elem);

        const unmount = render(elem);
        unmount();

        return count === 1;
      });
    });

    describe("generateProxy", () => {
      it("add observer to observers", () => {
        hydro.x = 7;
        let firstObserver = false;
        let secondObserver = false;
        hydro.observe("x", () => {
          firstObserver = true;
        });
        hydro.observe("x", () => {
          secondObserver = true;
        });

        hydro.x = 777;

        setTimeout(() => {
          hydro.x = null;
        });

        return firstObserver && secondObserver;
      });

      it("handles swapping data correctly", () => {
        hydro.data = [{ name: "Sebastian" }, { name: "Peter" }];

        const unmount = render(
          html`<div>
            ${hydro.data.map(
              (_: unknown, i: number) =>
                html`<p id="data-${i}">Name: {{data[${i}].name}}</p>`
            )}
          </div>`
        );

        [hydro.data[0], hydro.data[1]] = [hydro.data[1], hydro.data[0]];

        setTimeout(() => {
          unmount();
          hydro.data = null;
        });

        return (
          $("#data-0")!.textContent!.includes("Peter") &&
          $("#data-1")!.textContent!.includes("Sebastian")
        );
      });

      it("handles rejecting promise as expected", async () => {
        hydro.prom = Promise.reject("This is a Test for a rejected Promise");
        await sleep(1);
        return hydro.prom === void 0;
      });

      it("intern properties", () => {
        hydro.obj = {};

        const isProxy = hydro.obj.isProxy === true;
        const asyncUpdate = hydro.obj.asyncUpdate === false;
        hydro.obj.asyncUpdate = true;
        const asyncWritable = hydro.obj.asyncUpdate === true;

        setTimeout(() => {
          hydro.obj = null;
        });

        return isProxy && asyncUpdate && asyncWritable;
      });

      it("will not set falsy boolean attributes", () => {
        const checked = reactive(0);
        const elem = html`<input checked=${checked} />` as Element;
        const unmount = render(elem);

        let cond = elem.hasAttribute("checked") === false;
        checked(1);
        cond = cond && elem.hasAttribute("checked");
        checked(false);
        cond = cond && elem.hasAttribute("checked") === false;

        setTimeout(() => {
          unset(checked);
          unmount();
        });

        return cond;
      });

      it("will not set falsy boolean attributes on obj", () => {
        const checked = reactive({ disabled: "" });
        const attr = reactive({ id: "boolAttr" });
        const elem = html`<input ${checked} ${attr} />` as Element;
        const unmount = render(elem);

        setTimeout(() => {
          unset(checked);
          unset(attr);
          unmount();
        });

        return !elem.hasAttribute("checked");
      });

      it("updateDOM does not remove focus", () => {
        const count = reactive(0);
        const increment = () => count(1);

        const elem = html`
          <div>
            <span>${count}</span>
            <button type="button" id="thisB" onclick=${increment}>
              Increment
            </button>
          </div>
        `;

        const unmount = render(elem);
        //@ts-ignore
        // needed for automation
        $("#thisB").focus();
        //@ts-ignore
        $("#thisB").click();

        onCleanup(unset, elem, count);

        setTimeout(unmount);

        return document.activeElement === $("#thisB");
      });

      it("using reactive variables in one variable - variable will be updated too", () => {
        const dynamicOne = reactive("classA");
        const dynamicTwo = reactive("classB");
        const classes = reactive(`${dynamicOne} ${dynamicTwo}`);
        const unmount = render(
          html` <div id="classes" class=${classes}>test</div> `
        );

        let cond =
          $("#classes")!.classList.contains(getValue(dynamicOne)) &&
          $("#classes")!.classList.contains(getValue(dynamicTwo));

        dynamicOne("foo");
        dynamicTwo("bar");

        cond =
          cond &&
          !$("#classes")!.classList.contains("classA") &&
          !$("#classes")!.classList.contains("classA") &&
          $("#classes")!.classList.contains(getValue(dynamicOne)) &&
          $("#classes")!.classList.contains(getValue(dynamicTwo));

        classes("peter pan");

        cond =
          cond &&
          !$("#classes")!.classList.contains(getValue(dynamicOne)) &&
          !$("#classes")!.classList.contains(getValue(dynamicTwo)) &&
          $("#classes")!.classList.contains("peter") &&
          $("#classes")!.classList.contains("pan");

        setTimeout(() => {
          unmount();
          unset(classes);
          unset(dynamicOne);
          unset(dynamicTwo);
        });

        return cond;
      });

      it("swap operation (hydro)", () => {
        hydro.array = ["x", "y"];
        [hydro.array[0], hydro.array[1]] = [hydro.array[1], hydro.array[0]];

        setTimeout(() => {
          hydro.array = null;
        });

        return hydro.array[0] === "y";
      });

      it("swap operation (reactive)", () => {
        const array = reactive(["x", "y"]);

        array((arr: typeof array) => {
          [arr[0], arr[1]] = [arr[1], arr[0]];
        });

        setTimeout(unset, 0, array);

        return getValue(array)[0] === "y";
      });

      it("promise handling", async () => {
        const promise = reactive(
          new Promise((resolve) => setTimeout(() => resolve(777), 200))
        );

        const unmount = render(html`<p id="async">
          ${ternary(
            promise,
            () => html`<h2>${promise}</h2>`,
            () => html`<h2>Loading...</h2>`
          )}
        </p>`);

        await sleep(201);

        setTimeout(() => {
          unmount();
          unset(promise);
        }, 201);

        return $("#async")!.textContent!.includes("777");
      });
    });

    describe("view", () => {
      it("creates a view that will handle add, delete and swap", async () => {
        let condition: boolean;

        const data = reactive([
          { id: 4, label: "Red Onions" },
          { id: 5, label: "Green Socks" },
        ]);
        const unmount = render(html`<ul></ul>`);
        view(
          "ul",
          data,
          (item, i) =>
            html`<li>Reactive: ${data[i].id}, Non-reactive: ${item.label}</li>`
        );

        await sleep(300);

        condition =
          $("ul")!.textContent!.includes("Red Onions") &&
          $("ul")!.textContent!.includes("Green Socks");

        data[0].setter((curr: (typeof data)[number]) => {
          curr.id = 6;
          curr.label = "Orange Hat";
        });

        condition =
          condition &&
          !$("ul")!.textContent!.includes("Orange Hat") &&
          $("ul")!.textContent!.includes("6");

        data((curr: typeof data) => {
          [curr[0], curr[1]] = [curr[1], curr[0]];
        });

        condition = condition && getValue(data)[0].id === 5;

        setTimeout(() => {
          unset(data);
          unmount();
        }, 300);

        return condition;
      });

      it("creates a view that will handle add, delete and swap with (keyed)", async () => {
        setReuseElements(false);
        let condition: boolean;

        const data = reactive([
          { id: 4, label: "Red Onions" },
          { id: 5, label: "Green Socks" },
        ]);
        const unmount = render(html`<ul></ul>`);
        view(
          "ul",
          data,
          (item, i) =>
            html`<li>Reactive: ${data[i].id}, Non-reactive: ${item.label}</li>`
        );

        await sleep(300);

        condition =
          $("ul")!.textContent!.includes("Red Onions") &&
          $("ul")!.textContent!.includes("Green Socks");

        data[0].setter((curr: (typeof data)[number]) => {
          curr.id = 6;
          curr.label = "Orange Hat";
        });

        condition =
          condition &&
          !$("ul")!.textContent!.includes("Orange Hat") &&
          $("ul")!.textContent!.includes("6");

        data((curr: typeof data) => {
          [curr[0], curr[1]] = [curr[1], curr[0]];
        });

        condition = condition && getValue(data)[0].id === 5;

        setTimeout(() => {
          unset(data);
          unmount();
        }, 300);

        setReuseElements(true);

        return condition;
      });
    });
  });

  describe("integration", () => {
    it("attributes are reactive", () => {
      const id = "firstId";
      const href = "https://www.google.com/";

      const props = reactive({ id, href });
      const elem = html` <a ${props}>link</a> `;

      const unmount = render(elem);

      props({ id: "secondId", href: "https://www.netlify.com/" });

      setTimeout(() => {
        unmount();
        unset(props);
      });

      const { id: id2, href: href2 } = getValue(props);
      return $(`#${id2}`)! && $(`#${id2}`)!.getAttribute("href") === href2;
    });

    it("event is reactive", () => {
      const props = reactive({
        onclick: (e: any) => (e.currentTarget.textContent = 1),
      });
      const elem = html` <p id="testREvent" ${props}>0</p> `;
      const unmount = render(elem);

      props({ onclick: (e: any) => (e.currentTarget.textContent = 2) });

      //@ts-ignore
      elem.click();

      setTimeout(() => {
        unmount();
        unset(props);
      });

      return $("#testREvent")!.textContent === "2";
    });

    it("event is reactive with eventobject", () => {
      const props = reactive({
        onclick: (e: any) => (e.currentTarget.textContent = 1),
      });
      const elem = html` <p id="testREvent" ${props}>0</p> `;
      const unmount = render(elem);

      props({
        onclick: {
          event: (e: any) => (e.currentTarget.textContent = 2),
          options: {},
        },
        id: "testREvent2",
      });

      //@ts-ignore
      elem.click();

      setTimeout(() => {
        unmount();
        unset(props);
      });

      return $("#testREvent2")!.textContent === "2";
    });

    it("eventObject is reactive", () => {
      const testEvent = reactive({
        event: (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 5),
        options: { once: true },
      });

      const unmount = render(
        html` <p id="testEvent" onclick=${testEvent}>0</p> `
      );

      //@ts-ignore
      $("#testEvent").click();
      //@ts-ignore
      $("#testEvent").click();

      let cond = $("#testEvent")!.textContent!.includes("5");

      testEvent({
        event: (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 42),
        options: { once: true },
      });

      //@ts-ignore
      $("#testEvent").click();
      //@ts-ignore
      $("#testEvent").click();

      setTimeout(() => {
        unset(testEvent);
        unmount();
      });

      return cond && $("#testEvent")!.textContent!.includes("47");
    });

    it("eventObject can be replaced by normal fn", () => {
      const testEvent2 = reactive({
        event: (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 5),
        options: { once: true },
      });

      const unmount = render(
        html` <p id="testEvent2" onclick=${testEvent2}>0</p> `
      );

      //@ts-ignore
      $("#testEvent2").click();
      //@ts-ignore
      $("#testEvent2").click();

      let cond = $("#testEvent2")!.textContent!.includes("5");

      testEvent2(
        (x: any) => (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 10)
      );

      //@ts-ignore
      $("#testEvent2").click();
      //@ts-ignore
      $("#testEvent2").click();

      setTimeout(() => {
        unset(testEvent2);
        unmount();
      });

      return cond && $("#testEvent2")!.textContent!.includes("25");
    });
  });

  describe("data handling check", () => {
    it("hydro is {}", async () => {
      await sleep(700);
      return JSON.stringify(hydro) === JSON.stringify({});
    });

    it("hydro does not have any observers", async () => {
      await sleep(700);
      return hydro.getObservers().size === 0;
    });

    it("body has DOM Elements - unmount", async () => {
      await sleep(900);
      return document.body.querySelectorAll("*").length === 0;
    });
  });
});
// --------- TESTS END ------------

function done() {
  // Last test
  const name = "Render head, body and html correctly";
  if (condition) {
    results.push({ name, success: condition });
  } else {
    console.log(`Failed at: ${name}`);
    results.push({ name, success: condition });
  }

  document.body.insertAdjacentHTML("beforeend", `<div id="results"></div>`);
  results.forEach((result) => {
    document.querySelector("#results")!.insertAdjacentHTML(
      "beforeend",
      `<p>
              <span class="badge ${result.success ? "success" : "error"}"
                >${result.success ? "✔️  Success" : "❗  Error"}</span
              >: ${result.name}
            </p>`
    );
  });

  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="done">Testing done</div>`
  );
}

async function it(name: string, testFn: () => boolean | Promise<boolean>) {
  if (await testFn()) {
    results.push({ name, success: true });
  } else {
    console.log(`Failed at: ${name}`);
    results.push({ name, success: false });
  }
}

function describe(_desc: string, wrapper: Function) {
  wrapper();
}
function xdescribe(_desc: string, _wrapper: Function) {}
function xit(_desc: string, _wrapper: Function) {}
