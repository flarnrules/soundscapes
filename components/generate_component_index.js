// components/generate_component_index.js

export async function generateComponentIndex() {
  const directoryUrl = import.meta.url.replace(/generate_component_index\.js$/, '');
  const res = await fetch(directoryUrl);
  const text = await res.text();

  const matches = [...text.matchAll(/href="(.*?)"/g)];
  const jsFiles = matches
    .map(m => m[1])
    .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'generate_component_index.js');

  let exportLines = '';

  for (const file of jsFiles) {
    const name = file.replace('.js', '');
    const className = name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('');
    exportLines += `export { ${className} } from './${file}';\n`;
  }

  // Because we can't write to the filesystem from the browser, log the output.
  console.log('%c💡 Copy the following into components/index.js:', 'color: orange');
  console.log(exportLines);
}

