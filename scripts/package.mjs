import { packager } from '@electron/packager';
import checksums from 'electron/checksums.json' with { type: 'json' };
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: process.platform },
    arch: { type: 'string', default: process.arch },
  },
});

const localMac = values.platform === 'darwin' && process.platform === 'darwin';
const bundles = await packager({
  dir: '.',
  name: 'HQ',
  out: 'out',
  platform: values.platform,
  arch: values.arch,
  asar: true,
  overwrite: true,
  appBundleId: 'local.hq.planner',
  icon: values.platform === 'darwin' ? 'design/dock-icons/hq.icns'
    : values.platform === 'win32' ? 'design/dock-icons/hq.ico' : 'ui/icon.png',
  download: { checksums, cacheRoot: process.env.electron_config_cache },
  ignore: /^\/(?!dist(?:\/|$)|ui(?:\/|$)|package[.]json$)/,
  osxSign: localMac ? {
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    continueOnError: false,
    optionsForFile: () => ({ hardenedRuntime: false }),
  } : undefined,
});

if (bundles.length === 0) throw new Error('Es wurde kein HQ-App-Paket erstellt.');
for (const bundle of bundles) console.log(bundle);
