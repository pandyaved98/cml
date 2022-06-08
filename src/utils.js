const fs = require('fs');
const PATH = require('path');
const fetch = require('node-fetch');
const NodeSSH = require('node-ssh').NodeSSH;
const stripAnsi = require('strip-ansi');

const { FileMagic, MagicFlags } = require('@npcz/magic');
const tempy = require('tempy');

const exec = async (command) => {
  return new Promise((resolve, reject) => {
    require('child_process').exec(
      command,
      { ...process.env },
      (error, stdout, stderr) => {
        if (!process.stdout.isTTY) {
          stdout = stripAnsi(stdout);
          stderr = stripAnsi(stderr);
        }
        if (error) reject(new Error(`${command}\n\t${stdout}\n\t${stderr}`));

        resolve((stdout || stderr).slice(0, -1));
      }
    );
  });
};

const mimeType = async (opts) => {
  const { path, buffer } = opts;
  const magicFile = PATH.join(__dirname, '../assets/magic.mgc');
  if (fs.existsSync(magicFile)) FileMagic.magicFile = magicFile;
  const fileMagic = await FileMagic.getInstance();

  let tmppath;
  if (buffer) {
    tmppath = tempy.file();
    await fs.promises.writeFile(tmppath, buffer);
  }

  const [mime] = (
    fileMagic.detect(
      buffer ? tmppath : path,
      fileMagic.flags | MagicFlags.MAGIC_MIME
    ) || []
  ).split(';');

  return mime;
};

const fetchUploadData = async (opts) => {
  const { path, buffer, mimeType: mimeTypeIn } = opts;

  const size = path ? (await fs.promises.stat(path)).size : buffer.length;
  const data = path ? fs.createReadStream(path) : buffer;
  const mime = mimeTypeIn || (await mimeType(opts));

  return { mime, size, data };
};

const upload = async (opts) => {
  const { path, session } = opts;
  const endpoint = 'https://asset.cml.dev';

  const { mime, size, data: body } = await fetchUploadData(opts);
  const filename = path ? PATH.basename(path) : `file.${mime.split('/')[1]}`;

  const headers = {
    'Content-Length': size,
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${filename}"`
  };

  if (session) headers['Content-Address-Seed'] = `${session}:${path}`;

  const response = await fetch(endpoint, { method: 'POST', headers, body });
  const uri = await response.text();

  if (!uri)
    throw new Error(
      `Empty response from asset backend with status code ${response.status}`
    );

  return { uri, mime, size };
};

const randid = () => {
  return (
    Math.random().toString(36).substring(2, 7) +
    Math.random().toString(36).substring(2, 7)
  );
};

const sleep = (secs) => {
  return new Promise((resolve) => {
    setTimeout(resolve, secs * 1000);
  });
};

const isProcRunning = async (opts) => {
  const { name } = opts;

  const cmd = (() => {
    switch (process.platform) {
      case 'win32':
        return `tasklist`;
      case 'darwin':
        return `ps -ax`;
      case 'linux':
        return `ps -A`;
      default:
        return false;
    }
  })();

  return new Promise((resolve, reject) => {
    require('child_process').exec(cmd, (err, stdout) => {
      if (err) reject(err);

      resolve(stdout.toLowerCase().indexOf(name.toLowerCase()) > -1);
    });
  });
};

const watermarkUri = (opts = {}) => {
  const { uri, type } = opts;
  const url = new URL(uri);
  url.searchParams.append('cml', type);

  return url.toString();
};

const download = async (opts = {}) => {
  const { url, path } = opts;
  const res = await fetch(url);
  const stream = fs.createWriteStream(path);
  return new Promise((resolve, reject) => {
    stream.on('error', (err) => reject(err));
    res.body.pipe(stream);
    res.body.on('error', reject);
    stream.on('finish', resolve);
  });
};

const sshConnection = async (opts) => {
  const { host, username, privateKey, maxTries = 5 } = opts;

  const ssh = new NodeSSH();

  let trials = 0;
  while (true) {
    try {
      await ssh.connect({
        host,
        username,
        privateKey
      });
      break;
    } catch (err) {
      if (maxTries === trials) throw err;
      trials += 1;
      await sleep(10);
    }
  }

  return ssh;
};

const gpuPresent = async () => {
  let gpu = true;
  try {
    await exec('nvidia-smi');
  } catch (err) {
    try {
      await exec('cuda-smi');
    } catch (err) {
      gpu = false;
    }
  }

  return gpu;
};

exports.exec = exec;
exports.fetchUploadData = fetchUploadData;
exports.upload = upload;
exports.randid = randid;
exports.sleep = sleep;
exports.isProcRunning = isProcRunning;
exports.watermarkUri = watermarkUri;
exports.download = download;
exports.sshConnection = sshConnection;
exports.gpuPresent = gpuPresent;
