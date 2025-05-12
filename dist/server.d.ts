declare const library: Promise<typeof import("./library.js") & {
    renderToString: typeof renderToString;
    setDOMRenderer: typeof setDOMRenderer;
}>;
declare function setDOMRenderer(engine?: string, filePath?: string): Promise<void>;
declare function renderToString(): string;
export default library;
