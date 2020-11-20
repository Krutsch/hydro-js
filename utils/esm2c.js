import path from "path";
import fs from "fs";

let file = fs.readFileSync(path.join(process.cwd(), "dist/library.js"), {
  encoding: "utf-8",
});

file = file.replace(/export {(.*)};/, "module.exports = {$1};");
fs.writeFileSync(path.join(process.cwd(), "dist/library.cjs.js"), file);
