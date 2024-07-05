import serve, { error, log } from "create-serve";
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const IS_DEV = process.argv.includes("--dev");

function buildHTML(javacript) {
  const base64JavascriptContent = Buffer.from(javacript).toString("base64");

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body>
    <div id="root"></div>
    <script type="text/javascript" src="data:text/javascript;base64,${ base64JavascriptContent }"></script>
</body>
</html>
  `;
}

function buildMarkdown(html) {
  return `
|||
|-|-|
|name|example plugin|

\`\`\`
{
  appOption(app) {
    app.openSidebarEmbed();
  },
  renderEmbed(app) {
    return \`${ html }\`;
  },
}
\`\`\`
  `;
}

const packageNotePlugin = {
  name: "package-note-plugin",
  setup(build) {
    const options = build.initialOptions;
    options.write = false;

    build.onEnd(({ errors, outputFiles }) => {
      if (errors.length > 0) {
        console.error(errors);
      } else {
        const [ file ] = outputFiles;

        const htmlContent = buildHTML(file.text);
        const markdownContent = buildMarkdown(htmlContent);

        const markdownPath = path.join(path.dirname(file.path), "note.md");
        fs.writeFileSync(markdownPath, markdownContent);
      }
    });
  }
};

const serveBuildPlugin = {
  name: "update-dev-plugin",
  setup(build) {
    const options = build.initialOptions;
    options.write = false;
    console.log("setup")

    build.onEnd((errors, outputFiles) => {
      if (errors.length > 0) {
        error(`Build failed: ${ errors }`);
      } else {
        console.log("outputFiles", outputFiles)
        const [ file ] = outputFiles;

        const htmlContent = buildHTML(file.text);
        const htmlPath = path.join(path.dirname(file.path), "index.html");
        fs.writeFileSync(htmlPath, htmlContent);

        serve.update();
      }
    });
  }
};

const buildOptions = {
  bundle: true,
  define: {
    "process.env.NODE_ENV": IS_DEV ? '"development"' : '"production"',
  },
  entryPoints: [ "src/index.jsx" ],
  minify: !IS_DEV,
  outdir: "build",
  sourceRoot: "src",
  plugins: [ IS_DEV ? serveBuildPlugin : packageNotePlugin ],
  target: [ "chrome58" , "firefox57", "safari11", "edge16" ],
};

if (IS_DEV) {
  const context = await esbuild.context(buildOptions);
  context.watch();

  serve.start({
    port: 5000,
    root: "./www",
    live: true,
  });
} else {
  const context = await esbuild.context(buildOptions);
  await context.build();
}