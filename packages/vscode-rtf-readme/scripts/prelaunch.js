const FS = require('fs');
const Path = require('path');

let packageJSONPath = Path.resolve(__dirname, '..', 'package.json');

let content = JSON.parse(FS.readFileSync(packageJSONPath));

content['main'] = './bld/extension/extension.js';

let newContent = JSON.stringify(content, undefined, 2) + '\n';

FS.writeFileSync(packageJSONPath, newContent);
