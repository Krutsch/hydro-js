import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { JSDOM } from "jsdom";

let serializer: XMLSerializer;

const library = new Promise((resolve) =>
  setDOMRenderer().then(() =>
    import("./library.js").then((lib) => {
      resolve({ ...lib, renderToString, setDOMRenderer });
    })
  )
) as Promise<
  typeof import("./library.js") & {
    renderToString: typeof renderToString;
    setDOMRenderer: typeof setDOMRenderer;
  }
>;
async function setDOMRenderer(engine = "happy-dom", filePath = "index.html") {
  const indexFile = await readFile(filePath, "utf-8");
  let window;

  if (engine === "happy-dom") {
    window = new Window({ url: "https://localhost:8080" });
    window.document.write(indexFile);
    await window.happyDOM.waitUntilComplete();
  } else if (engine === "jsdom") {
    window = new JSDOM(indexFile).window;
    serializer = new window.XMLSerializer();
  }

  // @ts-expect-error
  globalThis.window = window;
  // @ts-expect-error
  globalThis.document = window.document;
}

function renderToString() {
  return (
    document.documentElement.getHTML?.({
      serializableShadowRoots: true,
    }) ?? serializer.serializeToString(document)
  );
}

export default library;
