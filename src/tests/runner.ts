import playwright from "playwright";
import fs from "fs";
import path from "path";

let success = true;

for (const browserType of ["chromium", "firefox", "webkit"]) {
  //@ts-ignore
  const browser = await playwright[browserType].launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const file = fs.readFileSync(path.join(process.cwd(), "dist/tests/main.js"), {
    encoding: "base64",
  });

  console.log(browserType);

  page.on("pageerror", (err: Error) => {
    console.warn(`Page error: ${err}`);
    success = false;
  });

  await page.setContent(`
    <!DOCTYPE html>
    <html lang="en">
        <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Document</title>
        <script type="module" src="data:text/javascript;base64,${file}"></script>
        </head>
        <body>
        </body>
    </html>
  `);

  await page.waitForSelector("#done");
  const result = await page.evaluate(
    (element: Element) => element.textContent,
    await page.$("#results")
  );

  console.log(result);

  if (result.includes("Error:")) {
    success = false;
    process.exit();
  }

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });

  await page.screenshot({
    path: `dist/screenshots/${browserType}.png`,
  });

  await browser.close();
}
console.log(success ? "✔️✔️✔️  Tests succeeded!" : "❗❗❗ Tests failed!");
