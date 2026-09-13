import { gzipSync } from 'zlib';

/**
 * The boot script, gzipped and base64-encoded, for vendors whose start
 * command is one line. base64 needs no quoting in any POSIX shell, and gzip is
 * an essential package on the Ubuntu base the images are built on. Gzipped,
 * the ~22 KB script is ~10 KB — only ~13 KB is proven to pass SimplePod.
 */
export function gzipBase64(script: string): string {
  return gzipSync(Buffer.from(script, 'utf8'), { level: 9 }).toString('base64');
}

/**
 * A start command that writes the script carried in an environment variable
 * to `path` and runs it. Keeping the payload in the environment keeps it out
 * of the command line, whose length some vendors cap without saying where.
 */
export function bootFromEnv(variable: string, path = '/workspace/aixman-boot.sh'): string {
  return `mkdir -p "$(dirname ${path})" && echo "$${variable}" | base64 -d | gunzip > ${path} && exec bash ${path}`;
}
