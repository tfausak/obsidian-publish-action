const core = require('@actions/core');
const crypto = require('crypto');
const fs = require('fs').promises;
const https = require('https');
const path = require('path');

const httpRequest = (url, options, body) => new Promise((resolve, reject) => {
  const request = https.request(url, options, (response) => {
    const chunks = [];

    response.on('data', (chunk) => chunks.push(chunk));

    response.on('end', () => resolve({
      status: {
        code: response.statusCode,
        message: response.statusMessage,
      },
      headers: response.headers,
      body: Buffer.concat(chunks),
    }));
  });

  request.on('error', (error) => reject(error));

  request.end(body);
});

const readDirectoryRecursively = async (directory) => {
  const result = new Set();

  const entries = await fs.readdir(directory);
  for (const e of entries) {
    const entry = path.posix.join(directory, e);
    const stats = await fs.lstat(entry);

    if (stats.isDirectory()) {
      const files = await readDirectoryRecursively(entry);
      files.forEach((file) => result.add(file));
    } else {
      result.add(entry);
    }
  }

  return result;
};

const getLocalFiles = async (directory) => {
  const result = {};

  const files = await readDirectoryRecursively(directory);
  for (const file of files) {
    const buffer = await fs.readFile(file);
    const hash = crypto.createHash('sha256');
    hash.update(buffer);
    result[file] = hash.digest('hex');
  }

  return result;
};

const getRemoteFiles = async (site, token) => {
  const result = {};

  const response = await httpRequest(
    'https://publish-01.obsidian.md/api/list',
    { headers: { 'Content-Type': 'application/json' }, method: 'POST' },
    JSON.stringify({ id: site, token }));
  for (const file of JSON.parse(response.body.toString())) {
    result[file.path] = file.hash;
  }

  return result;
};

const pluralize = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const removeFile = async (site, token, file) => httpRequest(
  'https://publish-01.obsidian.md/api/remove',
  {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  },
  JSON.stringify({
    id: site,
    path: file,
    token,
  }),
);

const uploadFile = async (site, token, file) => {
  const buffer = await fs.readFile(file);
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return httpRequest(
    'https://publish-01.obsidian.md/api/upload',
    {
      headers: {
        'Content-Type': 'application/octet-stream',
        'obs-hash': hash.digest('hex'),
        'obs-id': site,
        'obs-path': file,
        'obs-token': token,
      },
      method: 'POST',
    },
    buffer,
  );
};

(async () => {
  // TODO: Allow using a different directory.
  const directory = '.';

  // TODO: Allow configuring custom exclusion rules.
  const exclude = /^(\.git|\.obsidian|node_modules)/;

  core.startGroup('Getting inputs');
  const site = core.getInput('site', { required: true });
  const token = core.getInput('token', { required: true });
  core.setSecret(token);
  core.info('Got inputs');
  core.endGroup();

  core.startGroup('Getting local files');
  const local = (await getLocalFiles(directory));
  for (const file of Object.keys(local)) {
    if (file.match(exclude)) {
      core.info(`Ignoring ${file} (${local[file]})`);
      delete local[file];
    }
  }
  core.info(`Got ${pluralize(Object.keys(local).length, 'file')}`);
  core.endGroup();

  core.startGroup('Getting remote files');
  const remote = await getRemoteFiles(site, token);
  core.info(`Got ${pluralize(Object.keys(remote).length, 'file')}`);
  core.endGroup();

  const toAdd = new Set();
  const toUpdate = new Set();
  const toRemove = new Set();
  for (const file of Object.keys(local)){
    if (remote.hasOwnProperty(file)) {
      if (local[file] !== remote[file]) {
        toUpdate.add(file);
      }
    } else {
      toAdd.add(file);
    }
  }
  for (const file of Object.keys(remote)) {
    if (!local.hasOwnProperty(file)) {
      toRemove.add(file);
    }
  }

  core.startGroup('Adding new files');
  core.info(`Adding ${pluralize(toAdd.size, 'file')}`);
  for (const file of toAdd) {
    const hash = local[file];
    core.info(`Adding ${file} (${hash})`);
    await uploadFile(site, token, file);
  }
  core.endGroup();

  core.startGroup('Updating existing files');
  core.info(`Updating ${pluralize(toUpdate.size, 'file')}`);
  for (const file of toUpdate) {
    const oldHash = remote[file];
    const newHash = local[file];
    core.info(`Updating ${file} (${oldHash} -> ${newHash})`);
    await uploadFile(site, token, file);
  }
  core.endGroup();

  core.startGroup('Removing old files');
  core.info(`Removing ${pluralize(toRemove.size, 'file')}`);
  for (const file of toRemove) {
    const hash = remote[file];
    core.info(`Removing ${file} (${hash})`);
    await removeFile(site, token, file);
  }
})().catch((error) => core.setFailed(error));
