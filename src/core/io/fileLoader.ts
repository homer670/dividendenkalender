// Detects and loads all file formats supported by Portfolio Performance
// (see name.abuchen.portfolio.model.ClientFactory):
//  - plain XML (with or without id references)
//  - ZIP compressed (data.xml or data.portfolio inside)
//  - binary protobuf (PPPBV1 signature)
//  - AES encrypted (PORTFOLIO signature), containing XML or protobuf

import { unzipSync } from 'fflate';
import { cbc } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { Client } from '../model';
import { hasProtobufSignature, loadProtobufClient, LoadWarning } from './protobufClient';
import { loadXmlClient } from './xmlClient';
import { utf8Decode } from './protoReader';
import { CURRENT_VERSION } from './upgrade';

const ENCRYPTED_SIGNATURE = [0x50, 0x4f, 0x52, 0x54, 0x46, 0x4f, 0x4c, 0x49, 0x4f]; // PORTFOLIO
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4
const SALT = new Uint8Array([112, 67, 103, 107, 164, 131, 144, 161, 159, 142, 117, 200, 203, 187, 231, 228]);
const ITERATION_COUNT = 65536;

export type FileKind = 'encrypted' | 'zip' | 'binary' | 'xml' | 'unknown';

export class PasswordRequiredError extends Error {
  constructor() {
    super('Die Datei ist verschlüsselt. Bitte Passwort eingeben.');
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Das Passwort ist falsch.');
  }
}

function startsWith(data: Uint8Array, signature: number[]): boolean {
  if (data.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (data[i] !== signature[i]) return false;
  return true;
}

export function detectFileKind(data: Uint8Array): FileKind {
  if (startsWith(data, ENCRYPTED_SIGNATURE)) return 'encrypted';
  if (startsWith(data, ZIP_SIGNATURE)) return 'zip';
  if (hasProtobufSignature(data)) return 'binary';
  // skip UTF-8 BOM and whitespace
  let i = 0;
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) i = 3;
  while (i < data.length && (data[i] === 0x20 || data[i] === 0x0a || data[i] === 0x0d || data[i] === 0x09)) i++;
  if (data[i] === 0x3c /* < */) return 'xml';
  return 'unknown';
}

export function isEncrypted(data: Uint8Array): boolean {
  return detectFileKind(data) === 'encrypted';
}

export interface LoadResult {
  client: Client;
  warnings: LoadWarning[];
}

function loadPlainContent(content: Uint8Array, warnings: LoadWarning[]): Client {
  if (hasProtobufSignature(content)) return loadProtobufClient(content, warnings);
  return loadXmlClient(utf8Decode(content), warnings);
}

function firstZipEntry(data: Uint8Array): { name: string; content: Uint8Array } {
  const entries = unzipSync(data);
  const names = Object.keys(entries);
  if (names.length === 0) throw new Error('Leere ZIP-Datei');
  // ZipInputStream#getNextEntry reads the first entry
  const name = names[0];
  return { name, content: entries[name] };
}

export async function loadClientFile(data: Uint8Array, password?: string | null): Promise<LoadResult> {
  const warnings: LoadWarning[] = [];
  const kind = detectFileKind(data);
  let client: Client;
  switch (kind) {
    case 'encrypted':
      if (!password) throw new PasswordRequiredError();
      client = await loadEncrypted(data, password, warnings);
      client.fileFormat.encrypted = true;
      break;
    case 'zip': {
      const entry = firstZipEntry(data);
      client = loadPlainContent(entry.content, warnings);
      client.fileFormat.compressed = true;
      break;
    }
    case 'binary':
      client = loadProtobufClient(data, warnings);
      break;
    case 'xml':
      client = loadXmlClient(utf8Decode(data), warnings);
      break;
    default:
      throw new Error('Unbekanntes Dateiformat. Bitte eine Portfolio Performance Datei (.portfolio oder .xml) wählen.');
  }
  return { client, warnings };
}

async function loadEncrypted(data: Uint8Array, password: string, warnings: LoadWarning[]): Promise<Client> {
  let offset = ENCRYPTED_SIGNATURE.length;
  const method = data[offset++];
  const keyLength = method === 1 ? 32 : 16;
  const iv = data.subarray(offset, offset + 16);
  offset += 16;
  if (iv.length !== 16) throw new Error('Datei ist beschädigt (IV fehlt)');

  const key = await pbkdf2Async(sha1, password, SALT, { c: ITERATION_COUNT, dkLen: keyLength, asyncTick: 20 });

  let decrypted: Uint8Array;
  try {
    decrypted = cbc(key, iv.slice()).decrypt(data.subarray(offset));
  } catch {
    throw new WrongPasswordError();
  }
  if (decrypted.length < 8) throw new WrongPasswordError();
  const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
  const contentType = view.getInt32(0, false);
  const version = view.getInt32(4, false);
  if (contentType < 1 || contentType > 2 || version < 1 || version > CURRENT_VERSION + 20) throw new WrongPasswordError();
  if (version > CURRENT_VERSION)
    throw new Error(
      `Die Datei wurde mit einer neueren Version von Portfolio Performance gespeichert (Version ${version}).`,
    );

  let entry: { name: string; content: Uint8Array };
  try {
    entry = firstZipEntry(decrypted.subarray(8));
  } catch {
    throw new WrongPasswordError();
  }
  return contentType === 2
    ? loadProtobufClient(entry.content, warnings)
    : loadXmlClient(utf8Decode(entry.content), warnings);
}
