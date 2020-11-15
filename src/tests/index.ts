import {
  html,
  hydro,
  render,
  setGlobalSchedule,
  reactive,
  unset,
  observe,
  getValue,
  onRender,
  onCleanup,
  internals,
  ternary,
  setInsertDiffing,
} from "../library.js";

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
describe("library", () => {
  describe("functions", () => {
    describe("html", () => {
      // Test all HTML Elements expect html, head and body
      // https://developer.mozilla.org/en-US/docs/Web/HTML/Element
      // https://en.wikipedia.org/wiki/HTML_element
      [
        "link",
        "meta",
        "style",
        "title",
        "svg",
        "address",
        "article",
        "aside",
        "footer",
        "header",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hgroup",
        "main",
        "nav",
        "section",
        "blockquote",
        "dd",
        "div",
        "dl",
        "dt",
        "figcaption",
        "figure",
        "hr",
        "li",
        "ol",
        "p",
        "pre",
        "ul",
        "a",
        "abbr",
        "b",
        "bdi",
        "bdo",
        "br",
        "cite",
        "code",
        "data",
        "dfn",
        "em",
        "i",
        "kbd",
        "mark",
        "q",
        "rb",
        "rp",
        "rt",
        "rtc",
        "ruby",
        "s",
        "samp",
        "small",
        "span",
        "strong",
        "sub",
        "sup",
        "time",
        "u",
        "var",
        "wbr",
        "area",
        "audio",
        "img",
        "map",
        "track",
        "video",
        "embed",
        "iframe",
        "object",
        "param",
        "picture",
        "source",
        "canvas",
        "noscript",
        "script",
        "del",
        "ins",
        "caption",
        "col",
        "colgroup",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "button",
        "datalist",
        "fieldset",
        "form",
        "input",
        "label",
        "legend",
        "meter",
        "optgroup",
        "option",
        "output",
        "progress",
        "select",
        "textarea",
        "details",
        "dialog",
        "menu",
        "summary",
        "slot",
        "template",
      ].forEach((tag) => {
        test(`is able to create element ${tag}`, () => {
          const elem = html`<${tag} />` as Element;
          return elem.localName === tag;
        });
      });

      test("returns empty text node", () => {
        return document.createTextNode("").isEqualNode(html``);
      });

      test("returns text node", () => {
        return document.createTextNode("hello").isEqualNode(html`hello`);
      });

      test("returns document fragment", () => {
        const node = html`<div><p>hi</p></div>
          <div><span>ho</span></div>` as DocumentFragment;
        return (
          node.nodeName !== "svg" &&
          "getElementById" in node &&
          node.childElementCount === 2
        );
      });

      test("returns element", () => {
        const elem = html`<p>hello</p>` as Element;
        return elem.localName === "p" && elem.textContent!.includes("hello");
      });

      test("variable input (node)", () => {
        const p = html`<p>hi</p>`;
        const elem = html`<div>${p}</div>`;
        return elem.contains(p) && elem.textContent!.includes("hi");
      });

      test("variable input (primitive value)", () => {
        const test = "test";
        const elem = html`<div>${test}</div>`;
        return elem.textContent!.includes(test);
      });

      test("variable input (hydro)", () => {
        const elem = html`<div>{{ test}}</div>`;
        setTimeout(() => {
          hydro.test = null;
        });
        return elem.textContent!.includes(hydro.test);
      });

      test("variable input (reactive)", () => {
        const test = reactive("test");
        const elem = html`<div>${test}</div>`;
        setTimeout(unset, 0, test);
        return elem.textContent!.includes(getValue(test));
      });

      test("variable input (eventListener)", () => {
        const onClick = (e: any) => (e.currentTarget.textContent = 1);
        const elem = html`<div onclick=${onClick}>0</div>`;
        //@ts-ignore
        elem.click();
        return elem.textContent!.includes("1");
      });

      test("variable input (array - normal)", () => {
        const arr = [42, "test"];
        const elem = html`<div>${arr}</div>`;
        return (
          elem.textContent!.includes("42") && elem.textContent!.includes("test")
        );
      });

      test("variable input (function)", () => {
        const onClick = (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 1);
        const elem = html`<div onclick=${onClick}>0</div>` as Element;
        //@ts-ignore
        elem.click();
        return elem.textContent!.includes("1");
      });

      test("variable input (eventListener as object)", () => {
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

      test("variable input (array - node)", () => {
        const p = html`<p>test</p>`;
        const arr = [42, p];
        const elem = html`<div>${arr}</div>`;
        return (
          elem.textContent!.includes("42") &&
          elem.textContent!.includes("test") &&
          elem.contains(p)
        );
      });

      test("variable input (object)", () => {
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

      test("variable input (object - with eventListenerObject)", () => {
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

      test("resolves deep reactive", () => {
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
          document.body.innerText.includes("Fabian") &&
          document.body.innerText.includes("123") &&
          document.body.innerText.includes("0")
        );
      });

      test("nested reactive", () => {
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

      test("removes {{..}}) from html attribute", () => {
        const attr = reactive({ id: "test" });
        const elem = html`<p ${attr}></p>` as Element;
        const unmount = render(elem);

        setTimeout(() => {
          unmount();
          unset(attr);
        });

        return elem.id === "test" && !elem.hasAttribute("{{attr}}");
      });

      test("two-way attribute", () => {
        const text = reactive("text");
        const checked = reactive(["John", "Mike"]);
        const checkedRadio = reactive("A");
        const select = reactive("cat");

        const unmount = render(
          html`
            <div>
              <input id="text" type="text" two-way=${text} />
              <textarea two-way=${text}></textarea>

              <label>
                <input
                  id="checkbox1"
                  type="checkbox"
                  name="John"
                  two-way=${checked}
                />
                John
              </label>
              <label>
                <input
                  id="checkbox2"
                  type="checkbox"
                  name="Mike"
                  two-way=${checked}
                />
                Mike
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
          window.$("#text").value === "text" &&
          //@ts-ignore
          window.$("textarea").value === "text" &&
          //@ts-ignore
          window.$("#checkbox1").checked &&
          //@ts-ignore
          window.$("#checkbox2").checked &&
          //@ts-ignore
          window.$("#radio1").checked &&
          //@ts-ignore
          !window.$("#radio2").checked &&
          //@ts-ignore
          window.$("select").value === "cat";

        text("haha");
        checked([]);
        checkedRadio("B");
        select("dog");

        setTimeout(() => {
          unmount();
          unset(text);
          unset(checked);
          unset(checkedRadio);
          unset(select);
        });

        return (
          cond &&
          //@ts-ignore
          window.$("#text").value === "haha" &&
          //@ts-ignore
          window.$("textarea").value === "haha" &&
          //@ts-ignore
          !window.$("#checkbox1").checked &&
          //@ts-ignore
          !window.$("#checkbox2").checked &&
          //@ts-ignore
          !window.$("#radio1").checked &&
          //@ts-ignore
          window.$("#radio2").checked &&
          //@ts-ignore
          window.$("select").value === "dog"
        );
      });
    });

    describe("compare", () => {
      test("same functions return true", () => {
        const fn1 = () => 2;
        const fn2 = () => 2;
        const elem1 = html`<p onclick=${fn1}></p>` as Element;
        const elem2 = html`<p onclick=${fn2}></p>` as Element;
        return internals.compare(elem1, elem2) === true;
      });

      test("same lifecycle hooks return true", () => {
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

      test("different function return false", () => {
        const fn1 = () => 2;
        const fn2 = () => 3;
        const elem1 = html`<p onclick=${fn1}></p>` as Element;
        const elem2 = html`<p onclick=${fn2}></p>` as Element;
        return internals.compare(elem1, elem2) === false;
      });

      test("different lifecycle hooks return false", () => {
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
      test("where does not exist - no render", () => {
        const elemCount = document.body.querySelectorAll("*").length;
        const unmount = render(html`<p>what</p>`, "#doesNotExist");

        setTimeout(unmount);
        return document.body.querySelectorAll("*").length === elemCount;
      });

      test("elem is DocumentFragment, no where", () => {
        const elem = html`<div id="first">1</div>
          <div id="second">2</div>`;
        const unmount = render(elem);

        setTimeout(unmount);
        return (
          window.$("#first")!.textContent!.includes("1") &&
          window.$("#second")!.textContent!.includes("2")
        );
      });

      test("elem is svg, no where", () => {
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

      test("elem is textNode, no where", () => {
        const elem = html`what`;
        const unmount = render(elem);

        setTimeout(unmount);
        return elem.isConnected && document.body.textContent!.includes("what");
      });

      test("elem is Element, no where", () => {
        const elem = html`<p id="whatWhere">what</p>`;
        const unmount = render(elem);

        setTimeout(unmount);
        return (
          elem.isConnected &&
          window.$("#whatWhere")!.textContent!.includes("what")
        );
      });

      test("elem is DocumentFragment, with where", () => {
        document.body.insertAdjacentHTML("beforeend", '<p id="hello">here</p>');
        const elem = html`<div id="firstOne">1</div>
          <div id="secondOne">2</div>`;
        const unmount = render(elem, "#hello");

        setTimeout(unmount);
        return (
          window.$("#firstOne")!.textContent!.includes("1") &&
          window.$("#secondOne")!.textContent!.includes("2") &&
          !document.body.querySelector("#hello")
        );
      });

      test("elem is svg, with where", () => {
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

      test("elem is textNode, with where", () => {
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

      test("elem is Element, with where", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<p id="hello4">here</p>'
        );
        const elem = html`<p id="testThisWhat">what</p>`;
        const unmount = render(elem, "#hello4");

        setTimeout(unmount);
        return (
          elem.isConnected &&
          window.$("#testThisWhat")!.textContent!.includes("what") &&
          !document.body.querySelector("#hello4")
        );
      });

      test("replace an element will replace the event", () => {
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

      test("replacing elements will not stop their state", async () => {
        setInsertDiffing(true);
        const video1 = html`
          <div id="video">
            <p>Value: 0</p>
            <video width="400" controls autoplay loop muted>
              <source
                src="https://www.w3schools.com/html/mov_bbb.mp4"
                type="video/mp4"
              />
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
            </video>
          </div>
        `;
        // Video Test
        render(video1);

        await sleep(300);
        const time = window.$("video")!.currentTime;

        const unmount = render(video2, "#video");
        setInsertDiffing(false);

        await sleep(150);

        setTimeout(() => {
          unmount();
        });

        return time <= window.$("video")!.currentTime;
      });

      test("calls lifecyle hooks on deep elements", () => {
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

      test("calls the correct lifecyle hooks when replacing elements", () => {
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
    });

    describe("reactive", () => {
      test("primitive value", () => {
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
        window.$("#reactClick").click();

        setTimeout(() => {
          unmount();
          unset(counter);
        });

        return window.$("#reactClick")!.textContent!.includes("1");
      });

      test("reactive (object)", () => {
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
        window.$("#reactiveObj1").click();
        //@ts-ignore
        window.$("#reactiveObj2").click();
        setTimeout(() => {
          unmount();
          unset(obj1);
          unset(obj2);
        });
        return (
          window.$("#reactiveObj1")!.textContent!.includes("777") &&
          window.$("#reactiveObj2")!.textContent!.includes("777")
        );
      });

      test("reactive (array)", () => {
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
        window.$("#reactiveArr1").click();
        //@ts-ignore
        window.$("#reactiveArr2").click();
        //@ts-ignore
        window.$("#reactiveArr3").click();
        //@ts-ignore
        window.$("#reactiveArr4").click();

        setTimeout(() => {
          unmount();
          unset(arr1);
          unset(arr2);
        });

        return (
          window.$("#reactiveArr1")!.textContent!.includes("2") &&
          window.$("#reactiveArr2")!.textContent!.includes("3") &&
          window.$("#reactiveArr3")!.textContent!.includes("4") &&
          window.$("#reactiveArr4")!.textContent!.includes("5")
        );
      });
    });

    describe("observe", () => {
      test("observe hydro", () => {
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

      test("observe reactive", () => {
        let result = 0;
        const test = reactive(0);

        observe(test, () => {
          result++;
        });

        test(1);

        setTimeout(() => {
          unset(test);
        });

        return result === 1;
      });

      test("observe primitive - function", () => {
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

      test("observe not working for primitive with function and no return", () => {
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

      test("observe object", () => {
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
      test("observe object (return another) function", () => {
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
      test("observe object (modified arg)", () => {
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

      test("observe object and modify arg plus no return", () => {
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

      test("observe object and modify arg plus no return - new syntax", () => {
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
  });

  describe("getValue", () => {
    test("primitive value", () => {
      const x = reactive(4);
      setTimeout(unset, 0, x);
      return getValue(x) === 4;
    });

    test("object", () => {
      const obj = { test: 4 };
      const x = reactive(obj);
      setTimeout(unset, 0, x);
      return getValue(x).test === obj.test;
    });

    test("array", () => {
      const arr = [4];
      const x = reactive(arr);
      setTimeout(unset, 0, x);
      return getValue(x)[0] === arr[0];
    });
  });

  describe("ternary", () => {
    test("re-renders component", () => {
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
      window.$("#reRender").click();

      setTimeout(() => {
        unmount();
        unset(isToggleOn);
      });

      return window.$("#reRender")!.textContent!.includes("ON");
    });

    test("re-renders component - function", () => {
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
      window.$("#reRenderF").click();

      setTimeout(() => {
        unmount();
        unset(isToggleOn);
      });

      return window.$("#reRenderF")!.textContent!.includes("ON");
    });
  });

  describe("onRender", () => {
    test("onRender", () => {
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
    test("onCleanup", () => {
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
    test("intern properties", () => {
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

    test("updateDOM does not remove focus", () => {
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
      window.$("#thisB").focus();
      //@ts-ignore
      window.$("#thisB").click();

      onCleanup(unset, elem, count);

      setTimeout(unmount);

      return document.activeElement === window.$("#thisB");
    });

    test("using reactive variables in one variable - variable will be updated too", () => {
      const dynamicOne = reactive("classA");
      const dynamicTwo = reactive("classB");
      const classes = reactive(`${dynamicOne} ${dynamicTwo}`);
      const unmount = render(
        html` <div id="classes" class=${classes}>test</div> `
      );

      let cond =
        window.$("#classes")!.classList.contains(getValue(dynamicOne)) &&
        window.$("#classes")!.classList.contains(getValue(dynamicTwo));

      dynamicOne("foo");
      dynamicTwo("bar");

      cond =
        cond &&
        !window.$("#classes")!.classList.contains("classA") &&
        !window.$("#classes")!.classList.contains("classA") &&
        window.$("#classes")!.classList.contains(getValue(dynamicOne)) &&
        window.$("#classes")!.classList.contains(getValue(dynamicTwo));

      classes("peter pan");

      cond =
        cond &&
        !window.$("#classes")!.classList.contains(getValue(dynamicOne)) &&
        !window.$("#classes")!.classList.contains(getValue(dynamicTwo)) &&
        window.$("#classes")!.classList.contains("peter") &&
        window.$("#classes")!.classList.contains("pan");

      setTimeout(() => {
        unmount();
        unset(classes);
        unset(dynamicOne);
        unset(dynamicTwo);
      });

      return cond;
    });

    test("swap operation (hydro)", () => {
      hydro.array = ["x", "y"];
      [hydro.array[0], hydro.array[1]] = [hydro.array[1], hydro.array[0]];

      setTimeout(() => {
        hydro.array = null;
      });

      return hydro.array[0] === "y";
    });

    test("swap operation (reactive)", () => {
      const array = reactive(["x", "y"]);

      array((arr: typeof array) => {
        [arr[0], arr[1]] = [arr[1], arr[0]];
      });

      setTimeout(unset, 0, array);

      return getValue(array)[0] === "y";
    });

    test("promise handling", async () => {
      const promise = reactive(
        new Promise((resolve) => setTimeout(() => resolve(777), 200))
      );

      const unmount = render(html`<p id="async">
        ${ternary(
          promise,
          html`<h2>${promise}</h2>`,
          html`<h2>Loading...</h2>`
        )}
      </p>`);

      await sleep(201);

      setTimeout(() => {
        unmount();
        unset(promise);
      }, 201);

      return window.$("#async")!.textContent!.includes("777");
    });
  });

  describe("integration", () => {
    test("attributes are reactive", () => {
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
      return (
        window.$(`#${id2}`)! &&
        window.$(`#${id2}`)!.getAttribute("href") === href2
      );
    });

    test("event is reactive", () => {
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

      return window.$("#testREvent")!.textContent === "2";
    });

    test("eventObject is reactive", () => {
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
      window.$("#testEvent").click();
      //@ts-ignore
      window.$("#testEvent").click();

      let cond = window.$("#testEvent")!.textContent!.includes("5");

      testEvent({
        event: (e: any) =>
          (e.currentTarget.textContent =
            Number(e.currentTarget.textContent) + 42),
        options: { once: true },
      });

      //@ts-ignore
      window.$("#testEvent").click();
      //@ts-ignore
      window.$("#testEvent").click();

      setTimeout(() => {
        unset(testEvent);
        unmount();
      });

      return cond && window.$("#testEvent")!.textContent!.includes("47");
    });
  });

  describe("data handling check", () => {
    test("hydro is {}", async () => {
      await sleep(700);
      return JSON.stringify(hydro) === JSON.stringify({});
    });

    test("hydro does not have any observers", async () => {
      await sleep(700);
      return hydro.getObservers().size === 0;
    });

    test("body has DOM Elements - unmount", async () => {
      await sleep(700);
      setTimeout(() => document.body.dispatchEvent(new CustomEvent("done")));
      return document.body.querySelectorAll("*").length === 0;
    });
  });
});
// --------- TESTS END ------------

document.body.addEventListener("done", () => {
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
});

async function test(name: string, testFn: () => boolean | Promise<boolean>) {
  if (await testFn()) {
    results.push({ name, success: true });
  } else {
    results.push({ name, success: false });
  }
}

function describe(_desc: string, wrapper: Function) {
  wrapper();
}
function xdescribe(_desc: string, _wrapper: Function) {}
